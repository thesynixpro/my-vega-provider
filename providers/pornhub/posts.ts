import { Post, ProviderContext } from "../types";
import {
  DEFAULT_RETRIES,
  DEFAULT_TIMEOUT_SECS,
  HTML_HEADERS,
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

interface ListingContext { baseUrl: string; timeoutMs: number; retries: number; }

function absoluteUrl(baseUrl: string, value: unknown): string {
  const raw = decodeEntities(normalizeTitle(value));
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.indexOf("//") === 0) return "https:" + raw;
  return baseUrl + (raw.charAt(0) === "/" ? raw : "/" + raw);
}

function videoArray(payload: any): any[] {
  if (!payload) return [];
  if (Array.isArray(payload)) {
    if (payload.some((item) => item && typeof item === "object" && (item.viewkey || item.vkey || item.video_url || item.url || item.link || item.video_title || item.videoTitle || item.title || item.name))) return payload;
    return payload.reduce((all: any[], item: any) => all.concat(videoArray(item)), []);
  }
  if (typeof payload !== "object") return [];
  const preferred = ["videos", "data", "results", "items", "response", "video_list", "search_result"];
  for (const key of preferred) {
    if (payload[key] != null) {
      const found = videoArray(payload[key]);
      if (found.length) return found;
    }
  }
  // Some API revisions return a keyed object instead of an array.
  const values = Object.keys(payload).map((key) => payload[key]);
  return values.reduce((all: any[], item: any) => all.concat(videoArray(item)), []);
}

export function parseListing(payload: any, baseUrl: string = "https://www.pornhub.com"): Post[] {
  const videos = videoArray(payload);
  const posts: Post[] = [];
  for (const video of videos) {
    if (!video || typeof video !== "object") continue;
    const title = decodeEntities(normalizeTitle(
      video.title || video.video_title || video.name || video.alt || video.videoTitle,
    ));
    const viewkey = video.viewkey || video.vkey || video.video_key || video.videoKey;
    const rawLink = video.url || video.video_url || video.link || video.videoUrl ||
      video.video_page_url || video.page_url || (viewkey ? "/view_video.php?viewkey=" + viewkey : "");
    const link = absoluteUrl(baseUrl, rawLink);
    if (!title || !link || !/(?:\/view_video\.php\?viewkey=|\/video\?viewkey=)/i.test(link)) continue;
    const thumb = video.default_thumb || video.thumb || video.thumbnail || video.image ||
      video.preview || video.thumb_url || video.thumbnail_url;
    const post: Post = { title, link, image: absoluteUrl(baseUrl, thumb) };
    const label = durationLabel(parseDurationSeconds(video.duration || video.length || video.video_duration || video.duration_seconds));
    if (label) post.tag = label;
    posts.push(post);
  }
  return dedupePosts(posts);
}

export function parseHtmlListing($: any, baseUrl: string): Post[] {
  const posts: Post[] = [];
  const anchors = $('a[href*="viewkey="], a[data-video-vkey], [data-video-vkey] a');
  anchors.each(function (this: any) {
    const anchor = $(this);
    const card = anchor.closest("li, .pcVideoListItem, .videoBox, .thumbnail, .wrap, .videoPreview, [data-video-vkey]");
    const scope = card && card.length ? card : anchor;
    const image = scope.find("img").first();
    const dataKey = scope.attr("data-video-vkey") || anchor.attr("data-video-vkey");
    const href = normalizeTitle(anchor.attr("href")) || (dataKey ? "/view_video.php?viewkey=" + dataKey : "");
    if (!href || !/viewkey=/i.test(href)) return;
    const title = decodeEntities(normalizeTitle(
      anchor.attr("title") || anchor.attr("data-title") || image.attr("alt") ||
      image.attr("title") || scope.find("[title]").first().attr("title") ||
      scope.find(".title, .videoTitle, [class*='title']").first().text() || anchor.text(),
    ));
    if (!title) return;
    const rawImage = image.attr("data-src") || image.attr("data-thumb_url") ||
      image.attr("data-original") || image.attr("src");
    const post: Post = { title, link: absoluteUrl(baseUrl, href), image: absoluteUrl(baseUrl, rawImage) };
    const duration = normalizeTitle(scope.find(".duration, .videoDuration, [class*='duration']").first().text());
    if (duration) post.tag = duration;
    posts.push(post);
  });
  return dedupePosts(posts);
}

function appendFilter(filter: string, params: string[]): void {
  const clean = String(filter || "").trim();
  const separator = clean.indexOf(":");
  if (separator > 0) {
    const key = clean.slice(0, separator).trim().toLowerCase();
    const value = clean.slice(separator + 1).trim();
    if (value && ["ordering", "category", "search", "tags"].indexOf(key) >= 0) {
      params.push(key + "=" + encodeURIComponent(value).replace(/%20/g, "+"));
      return;
    }
  }
  params.push("ordering=mostviewed");
}

async function readContext(providerContext: ProviderContext): Promise<ListingContext> {
  const override = await providerContext.kvStore.get<unknown>("baseUrlOverride");
  const timeoutSecs = await readNumberSetting(providerContext, "requestTimeoutSecs", DEFAULT_TIMEOUT_SECS);
  const retries = await readNumberSetting(providerContext, "retryAttempts", DEFAULT_RETRIES);
  return { baseUrl: resolveBaseUrl(override), timeoutMs: Math.round(timeoutSecs) * 1000, retries: Math.round(retries) };
}

async function fetchPosts(url: string, context: ListingContext, providerContext: ProviderContext, signal?: AbortSignal): Promise<{ posts: Post[]; reason: string }> {
  let apiReason = "JSON endpoint returned no recognizable video items";
  try {
    const payload = await requestJson(providerContext, url, { timeoutMs: context.timeoutMs, retries: context.retries, signal, headers: JSON_HEADERS });
    const parsed = parseListing(payload, context.baseUrl);
    if (parsed.length) return { posts: parsed, reason: "" };
    const keys = payload && typeof payload === "object" ? Object.keys(payload).slice(0, 12).join(", ") : typeof payload;
    apiReason = "JSON endpoint returned no video items (response keys: " + (keys || "none") + ")";
  } catch (error: any) {
    apiReason = "JSON endpoint: " + String(error && error.message || error).slice(0, 180);
  }

  try {
    const response = await providerContext.axios.get(url.replace("/webmasters/search?", "/video?"), {
      headers: HTML_HEADERS, timeout: context.timeoutMs, signal,
    });
    const html = typeof response.data === "string" ? response.data : String(response.data || "");
    if (html.length > 30) {
      const parsed = parseHtmlListing(providerContext.cheerio.load(html), context.baseUrl);
      if (parsed.length) return { posts: parsed, reason: "" };
    }
  } catch (error: any) {
    apiReason += "; HTML request: " + String(error && error.message || error).slice(0, 140);
  }

  // This is an interactive, user-mediated fallback. If the site presents a
  // verification page, the user can complete it in Vega's WebView; no challenge
  // is solved or bypassed by the provider code.
  try {
    const web = await providerContext.openWebView(url.replace("/webmasters/search?", "/video?"), {
      title: "Pornhub listing verification",
      description: "If the website requests verification, complete it in this window. Vega will then read the visible listing.",
      headers: HTML_HEADERS,
      force: true,
      timeoutMs: 45000,
    });
    if (web && web.data) {
      const parsed = parseHtmlListing(providerContext.cheerio.load(web.data), context.baseUrl);
      if (parsed.length) return { posts: parsed, reason: "" };
      apiReason += "; WebView opened but no video cards were found";
    } else {
      apiReason += "; interactive WebView did not return page HTML";
    }
  } catch (error: any) {
    apiReason += "; WebView: " + String(error && error.message || error).slice(0, 140);
  }
  return { posts: [], reason: apiReason };
}

export const getPosts = async function ({ filter, page, signal, providerContext }: {
  filter: string; page: number; providerValue: string; signal: AbortSignal; providerContext: ProviderContext;
}): Promise<Post[]> {
  const context = await readContext(providerContext);
  const params = ["thumbsize=large", "page=" + clampPage(page)];
  appendFilter(filter, params);
  const result = await fetchPosts(context.baseUrl + "/webmasters/search?" + params.join("&"), context, providerContext, signal);
  if (!result.posts.length) throw new Error("Pornhub listing failed: " + result.reason);
  return result.posts;
};

export const getSearchPosts = async function ({ searchQuery, page, signal, providerContext }: {
  searchQuery: string; page: number; providerValue: string; signal: AbortSignal; providerContext: ProviderContext;
}): Promise<Post[]> {
  const query = normalizeTitle(searchQuery);
  if (!query) return [];
  const context = await readContext(providerContext);
  const params = ["thumbsize=large", "page=" + clampPage(page), "search=" + encodeURIComponent(query).replace(/%20/g, "+")];
  const result = await fetchPosts(context.baseUrl + "/webmasters/search?" + params.join("&"), context, providerContext, signal);
  if (!result.posts.length) throw new Error("Pornhub search failed: " + result.reason);
  return result.posts;
};
