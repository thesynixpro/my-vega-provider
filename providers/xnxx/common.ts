import { ProviderContext } from "../types";

// Shared helpers for the XNXX provider.
//
// This file is intentionally dependency-free: it only touches the injected
// `providerContext` (axios + cheerio + kvStore). esbuild inlines it into each
// provider module (posts/meta/stream), so it never lands in its own dist file
// and never becomes a runtime import.

export const DEFAULT_BASE_URL = "https://www.xnxx.com";
export const DEFAULT_TIMEOUT_SECS = 20;
export const DEFAULT_RETRIES = 2;
export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0";

export const HTML_HEADERS: Record<string, string> = {
  "User-Agent": USER_AGENT,
  "Accept-Language": "en-US,en;q=0.9",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

export function clampPage(page: unknown): number {
  const value = Math.floor(Number(page));
  return Number.isFinite(value) && value > 0 ? value : 1;
}

export function resolveBaseUrl(override: unknown): string {
  if (typeof override === "string" && /^https?:\/\//i.test(override.trim())) {
    return override.trim().replace(/\/+$/, "");
  }
  return DEFAULT_BASE_URL;
}

export function absUrl(baseUrl: string, value: unknown): string {
  const url = String(value == null ? "" : value).trim();
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  if (url.indexOf("//") === 0) return "https:" + url;
  return baseUrl + (url.charAt(0) === "/" ? url : "/" + url);
}

export function normalizeTitle(value: unknown): string {
  return String(value == null ? "" : value)
    .replace(/\s+/g, " ")
    .trim();
}

export function firstNonEmpty(values: unknown[]): string {
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

// Builds "<base><path>" or "<base><path>/<page>" (page 1 keeps the bare path).
export function buildPathUrl(baseUrl: string, path: string, page: number): string {
  const clean = path ? "/" + String(path).replace(/^\/+|\/+$/g, "") : "";
  const safePage = clampPage(page);
  if (safePage <= 1) return baseUrl + (clean || "/");
  return baseUrl + clean + "/" + safePage;
}

export async function readNumberSetting(
  providerContext: ProviderContext,
  key: string,
  fallback: number,
): Promise<number> {
  try {
    const value = await providerContext.kvStore.get<unknown>(key);
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  } catch (e) {
    return fallback;
  }
}

export async function readStringSetting(
  providerContext: ProviderContext,
  key: string,
  fallback = "",
): Promise<string> {
  try {
    const value = await providerContext.kvStore.get<unknown>(key);
    return typeof value === "string" ? value : fallback;
  } catch (e) {
    return fallback;
  }
}

export async function readBoolSetting(
  providerContext: ProviderContext,
  key: string,
  fallback: boolean,
): Promise<boolean> {
  try {
    const value = await providerContext.kvStore.get<unknown>(key);
    return typeof value === "boolean" ? value : fallback;
  } catch (e) {
    return fallback;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RequestOptions {
  timeoutMs?: number;
  retries?: number;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

// Fetches an HTML page with a small retry/backoff loop. Only the injected
// axios instance is used. Throws a descriptive error after the last attempt.
export async function requestHtml(
  providerContext: ProviderContext,
  url: string,
  options: RequestOptions = {},
): Promise<string> {
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_SECS * 1000;
  const retries =
    typeof options.retries === "number" ? options.retries : DEFAULT_RETRIES;
  const headers = options.headers || HTML_HEADERS;
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await providerContext.axios.get(url, {
        headers,
        timeout: timeoutMs,
        signal: options.signal,
      });
      const data =
        typeof response.data === "string" ? response.data : String(response.data);
      if (!data || data.length < 100) {
        throw new Error("Empty or truncated response body");
      }
      return data;
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await sleep(400 * (attempt + 1));
      }
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error("XNXX request failed for " + url + ": " + message);
}

// Walks up from an anchor to the nearest listing container. Avoids relying on
// the `:has()` selector, which is not present in every bundled cheerio build.
export function nearestBlock($: any, anchor: any): any {
  let node = anchor;
  for (let i = 0; i < 6 && node && node.length; i++) {
    const className = String(node.attr("class") || "");
    if (/thumb-block|video-thumb|video-block|thumb-block-wrap/i.test(className)) {
      return node;
    }
    node = node.parent();
  }
  return anchor.parent();
}
