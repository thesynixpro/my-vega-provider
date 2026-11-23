import { ProviderContext } from "../types";

// Shared helpers for the Pornhub provider.
//
// This file is intentionally dependency-free: it only touches the injected
// `providerContext` (axios + cheerio + kvStore). esbuild inlines it into each
// provider module (posts/meta/stream), so it never lands in its own dist file
// and never becomes a runtime import.

export const DEFAULT_BASE_URL = "https://www.pornhub.com";
export const DEFAULT_TIMEOUT_SECS = 20;
export const DEFAULT_RETRIES = 2;
export const BRAND = "Pornhub";
export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0";

export const HTML_HEADERS: Record<string, string> = {
  "User-Agent": USER_AGENT,
  "Accept-Language": "en-US,en;q=0.9",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

export const JSON_HEADERS: Record<string, string> = {
  "User-Agent": USER_AGENT,
  "Accept-Language": "en-US,en;q=0.9",
  Accept: "application/json, text/plain, */*",
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

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#039;": "'",
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
  "&hellip;": "...",
  "&mdash;": "-",
  "&ndash;": "-",
  "&rsquo;": "'",
  "&lsquo;": "'",
  "&ldquo;": '"',
  "&rdquo;": '"',
};

// Decodes the handful of HTML entities the target sites emit in titles.
export function decodeEntities(value: unknown): string {
  return String(value == null ? "" : value)
    .replace(/&#(\d+);/g, function (_match, digits: string) {
      return String.fromCharCode(Number(digits));
    })
    .replace(/&#x([0-9a-f]+);/gi, function (_match, hex: string) {
      return String.fromCharCode(parseInt(hex, 16));
    })
    .replace(/&[a-z#0-9]+;/gi, function (match) {
      const mapped = ENTITIES[match.toLowerCase()];
      return mapped === undefined ? match : mapped;
    });
}

export function stripTags(value: unknown): string {
  return decodeEntities(String(value == null ? "" : value).replace(/<[^>]*>/g, " "));
}

export function dedupePosts<T extends { link: string }>(posts: T[]): T[] {
  const seen: Record<string, boolean> = {};
  const out: T[] = [];
  for (let i = 0; i < posts.length; i++) {
    const link = posts[i].link;
    if (!link || seen[link]) continue;
    seen[link] = true;
    out.push(posts[i]);
  }
  return out;
}

// Walks up from an anchor to the nearest listing container.
export function nearestBlock($: any, anchor: any): any {
  let node = anchor;
  for (let i = 0; i < 8 && node && node.length; i++) {
    const className = String(node.attr("class") || "");
    if (/thumb-block|video-block|video-thumb|videobox|mbcontent/i.test(className)) {
      return node;
    }
    node = node.parent();
  }
  return anchor.parent();
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

// Fetches a page or JSON endpoint with a small retry/backoff loop. Only the
// injected axios instance is used.
export async function request(
  providerContext: ProviderContext,
  url: string,
  options: RequestOptions = {},
): Promise<any> {
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_SECS * 1000;
  const retries = typeof options.retries === "number" ? options.retries : DEFAULT_RETRIES;
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
      if (text.length < 50) throw new Error("Empty or truncated response body");
      return text;
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await sleep(400 * (attempt + 1));
      }
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(BRAND + " request failed for " + url + ": " + message);
}

export async function requestHtml(
  providerContext: ProviderContext,
  url: string,
  options: RequestOptions = {},
): Promise<string> {
  return request(providerContext, url, options);
}

export async function requestJson(
  providerContext: ProviderContext,
  url: string,
  options: RequestOptions = {},
): Promise<any> {
  const merged: RequestOptions = Object.assign({}, options, {
    responseType: "json",
    headers: options.headers || JSON_HEADERS,
  });
  return request(providerContext, url, merged);
}

// Parses "12:34", "1:02:03", "12 min", "42 sec" and plain seconds into seconds.
export function parseDurationSeconds(value: unknown): number {
  const text = normalizeTitle(value);
  if (!text) return 0;
  const clock = text.match(/(\d{1,3}):(\d{2})(?::(\d{2}))?/);
  if (clock) {
    const parts = clock[0].split(":").map(function (part) {
      return Number(part);
    });
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return parts[0] * 60 + parts[1];
  }
  const hours = text.match(/(\d+)\s*h(?:our|r)?\b/i);
  const minutes = text.match(/(\d+)\s*mi?n(?:ute)?\b/i);
  const secs = text.match(/(\d+)\s*s(?:ec|econd)?\b/i);
  if (hours || minutes || secs) {
    return (
      (hours ? Number(hours[1]) : 0) * 3600 +
      (minutes ? Number(minutes[1]) : 0) * 60 +
      (secs ? Number(secs[1]) : 0)
    );
  }
  const direct = Number(text);
  return Number.isFinite(direct) && direct > 0 ? Math.round(direct) : 0;
}

// Parses ISO-8601 durations such as "PT16M21S" or "P0DT0H8M9S" into seconds.
export function parseIsoDuration(value: unknown): number {
  const text = String(value == null ? "" : value).trim();
  if (!text) return 0;
  const match = text.match(
    /P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?/i,
  );
  if (!match) return 0;
  const total =
    Number(match[1] || 0) * 86400 +
    Number(match[2] || 0) * 3600 +
    Number(match[3] || 0) * 60 +
    Math.round(Number(match[4] || 0));
  return total > 0 ? total : 0;
}

export function formatDuration(seconds: number): string {
  if (!seconds) return "";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hours) return hours + "h " + String(minutes).padStart(2, "0") + "m";
  return minutes + "m " + String(secs).padStart(2, "0") + "s";
}

// Rounded human duration used for listing tags (e.g. "12 min").
export function durationLabel(seconds: number): string {
  if (!seconds) return "";
  if (seconds >= 3600) return Math.round((seconds / 3600) * 10) / 10 + " h";
  return Math.max(1, Math.round(seconds / 60)) + " min";
}

export function metaContent($: any, property: string): string {
  const node = $('meta[property="' + property + '"]').first();
  if (node.attr("content")) return String(node.attr("content"));
  const named = $('meta[name="' + property + '"]').first();
  return named.attr("content") ? String(named.attr("content")) : "";
}
