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
  requestHtml,
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

export function parseListing(payload: any, baseUrl: string = "https://www.pornhub.com"): Post[] {
  // The endpoint has returned both { videos: [...] } and wrapped/nested
  // payloads across site revisions. Accept arrays and the common wrappers.
  let videos: any[] = [];
  if (Array.isArray(payload)) {
    videos = payload;
  } else if (payload && Array.isArray(payload.videos)) {
    videos = payload.videos;
  } else if (payload && payload.data && Array.isArray(payload.data.videos)) {
    videos = payload.data.videos;
  } else if (payload && payload.response && Array.isArray(payload.response.videos)) {
    videos = payload.response.videos;
  } else if (payload && payload.data && Array.isArray(payload.data)) {
    videos = payload.data;
  }

  const posts: Post[] = [];
  for (let i = 0; i < videos.length; i++) {
    const video = videos[i];
    if (!video) continue;
    const title = decodeEntities(normalizeTitle(
      video.title || video.video_title || video.name || video.alt,
    ));
    const rawLink = normalizeTitle(
      video.url || video.video_url || video.link || video.videoUrl ||
      (video.viewkey ? "/view_video.php?viewkey=" + video.viewkey : ""),
    );
    if (!title || !rawLink) continue;

    const link = /^https?:\/\//i.test(rawLink)
      ? rawLink
      : rawLink.indexOf("//") === 0
        ? "https:" + rawLink
        : baseUrl + (rawLink.charAt(0) === "/" ? rawLink : "/" + rawLink);
    const thumb = normalizeTitle(
      video.default_thumb || video.thumb || video.thumbnail ||
      video.image || video.preview,
    );
    const post: Post = {
      title,
      link,
      image: thumb
        ? (/^https?:\/\//i.test(thumb) ? thumb : thumb.indexOf("//") === 0 ? "https:" + thumb : baseUrl + (thumb.charAt(0) === "/" ? thumb : "/" + thumb))
        : "",
    };
    const label = durationLabel(parseDurationSeconds(
      video.duration || video.length || video.video_duration,
    ));
    if (label) post.tag = label;
    posts.push(post);
  }
  return dedupePosts(posts);
}

// HTML fallback for regions / sessions where the JSON endpoint is blocked or
// returns an empty payload. Parse only ordinary video-card links, not adverts.
export function parseHtmlListing($: any, baseUrl: string): Post[] {
  const posts: Post[] = [];
  const anchors = $('a[href*="/view_video.php?viewkey="], a[href*="/video?viewkey="]');
  anchors.each(function (this: any) {
    const anchor = $(this);
    const href = normalizeTitle(anchor.attr("href"));
    if (!href) return;
    const card = anchor.closest("li, .pcVideoListItem, .videoBox, .thumbnail, .wrap");
    const scope = card && card.length ? card : anchor;
    const image = scope.find("img").first();
    const title = decodeEntities(normalizeTitle(
      anchor.attr("title") || image.attr("alt") || scope.find("[title]").first().attr("title") || anchor.text(),
    ));
    if (!title) return;
    const rawImage = normalizeTitle(image.attr("data-src") || image.attr("data-thumb_url") || image.attr("src"));
    const link = /^https?:\/\//i.test(href) ? href : baseUrl + (href.charAt(0) === "/" ? href : "/" + href);
    const post: Post = {
      title,
      link,
      image: rawImage ? (/^https?:\/\//i.test(rawImage) ? rawImage : rawImage.indexOf("//") === 0 ? "https:" + rawImage : baseUrl + (rawImage.charAt(0) === "/" ? rawImage : "/" + rawImage)) : "",
    };
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
  try {
    const payload = await requestJson(providerContext, url, {
      timeoutMs,
      retries,
      signal,
      headers: JSON_HEADERS,
    });
    const parsed = parseListing(payload, baseUrl);
    if (parsed.length) return parsed;
  } catch (error) {
    // Fall through to the public HTML page when the JSON endpoint is blocked.
  }

  const htmlUrl = baseUrl + "/video";
  const html = await requestHtml(providerContext, htmlUrl, {
    timeoutMs,
    retries,
    signal,
    headers: HTML_HEADERS,
  });
  return parseHtmlListing(providerContext.cheerio.load(html), baseUrl);
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
  try {
    const payload = await requestJson(providerContext, url, {
      timeoutMs,
      retries,
      signal,
      headers: JSON_HEADERS,
    });
    const parsed = parseListing(payload, baseUrl);
    if (parsed.length) return parsed;
  } catch (error) {
    // Fall through to HTML search below.
  }

  const htmlUrl = baseUrl + "/video/search?search=" +
    encodeURIComponent(query).replace(/%20/g, "+");
  const html = await requestHtml(providerContext, htmlUrl, {
    timeoutMs,
    retries,
    signal,
    headers: HTML_HEADERS,
  });
  return parseHtmlListing(providerContext.cheerio.load(html), baseUrl);
};
