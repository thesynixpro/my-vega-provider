import { Post, ProviderContext } from "../types";
import {
  DEFAULT_RETRIES,
  DEFAULT_TIMEOUT_SECS,
  JSON_HEADERS,
  clampPage,
  decodeEntities,
  dedupePosts,
  durationLabel,
  normalizeTitle,
  parseDurationSeconds,
  readNumberSetting,
  requestJson,
  resolveBaseUrl,
} from "./common";

// Pornhub listing scraper (search + catalog browse).
//
// Pornhub's video grid is rendered client-side, so listing/search data comes
// from the public webmasters JSON API instead of the HTML:
//
//   GET /webmasters/search?search=<q>&page=<n>&thumbsize=large
//   GET /webmasters/search?ordering=<mostviewed|newest|rating>&page=<n>
//   GET /webmasters/search?category=<slug>&page=<n>
//
// The response is `{ videos: [...] }`; each entry carries the title, the
// canonical view page URL, a thumbnail and a "MM:SS" duration. The endpoint is
// unauthenticated but rate limited, so a small retry/backoff loop is used.

interface ListingContext {
  baseUrl: string;
  timeoutMs: number;
  retries: number;
}

export function parseListing(payload: any): Post[] {
  const videos = payload && Array.isArray(payload.videos) ? payload.videos : [];
  const posts: Post[] = [];
  for (let i = 0; i < videos.length; i++) {
    const video = videos[i];
    if (!video) continue;
    const title = decodeEntities(normalizeTitle(video.title));
    const link = normalizeTitle(video.url);
    if (!title || !link) continue;
    const thumb =
      normalizeTitle(video.default_thumb) || normalizeTitle(video.thumb);
    const post: Post = { title, link, image: thumb ? decodeEntities(thumb) : "" };
    const label = durationLabel(parseDurationSeconds(video.duration));
    if (label) post.tag = label;
    posts.push(post);
  }
  return dedupePosts(posts);
}

function appendFilter(filter: string, params: string[]): void {
  const clean = String(filter || "").trim();
  const separator = clean.indexOf(":");
  if (separator > 0) {
    const key = clean.slice(0, separator).trim().toLowerCase();
    const value = clean.slice(separator + 1).trim();
    if (
      value &&
      (key === "ordering" || key === "category" || key === "search" || key === "tags")
    ) {
      params.push(key + "=" + encodeURIComponent(value).replace(/%20/g, "+"));
      return;
    }
  }
  params.push("ordering=mostviewed");
}

async function readContext(providerContext: ProviderContext): Promise<ListingContext> {
  const override = await providerContext.kvStore.get<unknown>("baseUrlOverride");
  const timeoutSecs = await readNumberSetting(
    providerContext,
    "requestTimeoutSecs",
    DEFAULT_TIMEOUT_SECS,
  );
  const retries = await readNumberSetting(
    providerContext,
    "retryAttempts",
    DEFAULT_RETRIES,
  );
  return {
    baseUrl: resolveBaseUrl(override),
    timeoutMs: Math.round(timeoutSecs) * 1000,
    retries: Math.round(retries),
  };
}

export const getPosts = async function ({
  filter,
  page,
  providerValue,
  signal,
  providerContext,
}: {
  filter: string;
  page: number;
  providerValue: string;
  signal: AbortSignal;
  providerContext: ProviderContext;
}): Promise<Post[]> {
  const { baseUrl, timeoutMs, retries } = await readContext(providerContext);
  const params = ["thumbsize=large", "page=" + clampPage(page)];
  appendFilter(filter, params);

  const url = baseUrl + "/webmasters/search?" + params.join("&");
  const payload = await requestJson(providerContext, url, {
    timeoutMs,
    retries,
    signal,
    headers: JSON_HEADERS,
  });
  return parseListing(payload);
};

export const getSearchPosts = async function ({
  searchQuery,
  page,
  providerValue,
  signal,
  providerContext,
}: {
  searchQuery: string;
  page: number;
  providerValue: string;
  signal: AbortSignal;
  providerContext: ProviderContext;
}): Promise<Post[]> {
  const query = normalizeTitle(searchQuery);
  if (!query) return [];

  const { baseUrl, timeoutMs, retries } = await readContext(providerContext);
  const params = [
    "thumbsize=large",
    "page=" + clampPage(page),
    "search=" + encodeURIComponent(query).replace(/%20/g, "+"),
  ];

  const url = baseUrl + "/webmasters/search?" + params.join("&");
  const payload = await requestJson(providerContext, url, {
    timeoutMs,
    retries,
    signal,
    headers: JSON_HEADERS,
  });
  return parseListing(payload);
};
