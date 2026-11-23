import { ProviderContext } from "../types";

export const BRAND = "AnimeHindiDub";
export const DEFAULT_BASE_URL = "https://animehindidub.com";
export const DEFAULT_TIMEOUT_SECS = 25;
export const DEFAULT_RETRIES = 2;
export const HTML_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9,hi;q=0.8",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

export function normalize(value: unknown): string {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
}
export function absolute(base: string, value: unknown): string {
  const raw = normalize(value);
  if (!raw) return "";
  try { return new URL(raw, base).toString(); } catch (e) { return ""; }
}
export function sameOrigin(base: string, candidate: string): boolean {
  try { return new URL(base).origin === new URL(candidate).origin; } catch (e) { return false; }
}
export function pageNumber(value: unknown): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 1000) : 1;
}
export function cleanText(value: unknown): string {
  return normalize(String(value == null ? "" : value).replace(/<[^>]*>/g, " "))
    .replace(/&amp;/g, "&").replace(/&nbsp;/g, " ")
    .replace(/&#8217;|&rsquo;/g, "’").replace(/&#8211;|&ndash;/g, "–")
    .replace(/&#038;/g, "&").replace(/&quot;/g, '"');
}
export async function getBase(providerContext: ProviderContext): Promise<string> {
  try {
    const override = await providerContext.kvStore.get<unknown>("baseUrlOverride");
    if (typeof override === "string" && /^https?:\/\//i.test(override.trim())) return override.trim().replace(/\/+$/, "");
  } catch (e) {}
  return DEFAULT_BASE_URL;
}
export async function fetchHtml(providerContext: ProviderContext, url: string, signal?: AbortSignal): Promise<string> {
  let last: unknown;
  for (let attempt = 0; attempt <= DEFAULT_RETRIES; attempt++) {
    try {
      const response = await providerContext.axios.get(url, {
        headers: HTML_HEADERS, timeout: DEFAULT_TIMEOUT_SECS * 1000, signal,
      });
      if (typeof response.data !== "string" || response.data.length < 30) throw new Error("Empty HTML response");
      return response.data;
    } catch (error) {
      last = error;
      if (attempt < DEFAULT_RETRIES) await new Promise(resolve => setTimeout(resolve, 350 * (attempt + 1)));
    }
  }
  throw new Error(BRAND + " request failed: " + String(last));
}
