import { ProviderContext } from "../types";

// Shared helpers for the Eporner provider.
//
// Only the injected `providerContext` is used (axios + cheerio + kvStore).
// esbuild inlines this into each provider module, so it is never imported at
// runtime and never lands in its own dist file.

export const DEFAULT_BASE_URL = "https://www.eporner.com";
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
  responseType?: "text" | "json";
}

// Fetches a page (or JSON endpoint) with a retry/backoff loop.
export async function request(
  providerContext: ProviderContext,
  url: string,
  options: RequestOptions = {},
): Promise<any> {
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
      const data = response.data;
      if (data == null) throw new Error("Empty response body");
      if (options.responseType === "json") {
        if (typeof data === "object") return data;
        return JSON.parse(String(data));
      }
      const text = typeof data === "string" ? data : JSON.stringify(data);
      if (text.length < 100) throw new Error("Empty or truncated response body");
      return text;
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await sleep(400 * (attempt + 1));
      }
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error("Eporner request failed for " + url + ": " + message);
}

export async function requestHtml(
  providerContext: ProviderContext,
  url: string,
  options: RequestOptions = {},
): Promise<string> {
  return request(providerContext, url, options);
}

// Encodes an integer as a base-N string (lowercase), matching the hash scheme
// used by Eporner's own player. Implemented manually to avoid any third-party
// dependency inside the sandbox.
export function encodeBaseN(value: number, base: number): string {
  const digits = "0123456789abcdefghijklmnopqrstuvwxyz";
  let n = Math.floor(Math.abs(value));
  if (n === 0) return "0";
  let out = "";
  while (n > 0) {
    const remainder = n % base;
    out = digits.charAt(remainder) + out;
    n = Math.floor(n / base);
  }
  return out;
}

// Eporner's public player derives a 36-base (?) hash from the 32 hex chars in
// the page (`hash = <32 hex>`). Four chunks of 8 hex chars are each converted
// to base 36 and concatenated.
export function calcHash(hexHash: string): string {
  const clean = String(hexHash || "").trim();
  if (!/^[\da-fA-F]{32}$/.test(clean)) return "";
  let out = "";
  for (let i = 0; i < 32; i += 8) {
    const chunk = clean.substring(i, i + 8);
    out += encodeBaseN(parseInt(chunk, 16), 36);
  }
  return out;
}

export function pageHashFromHtml(html: string): string {
  const match = html.match(/hash\s*[:=]\s*["']([\da-fA-F]{32})["']/);
  return match ? match[1] : "";
}

export function videoIdFromUrl(url: string): string {
  const match = String(url || "").match(
    /eporner\.com\/(?:(?:hd-porn|embed)\/|video-)([A-Za-z0-9]+)/i,
  );
  return match ? match[1] : "";
}
