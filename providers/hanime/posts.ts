import { Post, ProviderContext } from "../types";
import {
  DEFAULT_RETRIES,
  DEFAULT_TIMEOUT_SECS,
  HTML_HEADERS,
  JSON_HEADERS,
  absUrl,
  clampPage,
  decodeEntities,
  dedupePosts,
  firstNonEmpty,
  normalizeTitle,
  readNumberSetting,
  requestHtml,
  requestJson,
  resolveBaseUrl,
} from "./common";

// Hanime listing scraper (search + catalog browse).
//
//   Browse : https://hanime.tv/browse/trending[/?page=<n>]
//   Tags   : https://hanime.tv/browse/tags/<tag>[?page=<n>]
//   Search : https://hanime.tv/search?q=<query> renders client-side, so the
//            searchable index is pulled from the guest API and filtered locally:
//            GET https://guest.freeanimehentai.net/api/v11/search_hvs
//
// The browse pages are server-rendered; each result is an anchor to
// `/videos/hentai/<slug>` with the cover image and an `h3` title. The search
// API returns the full catalogue index, which is filtered by name/search
// titles and paginated 24 per page.

export const SEARCH_INDEX_URL =
  "https://guest.freeanimehentai.net/api/v11/search_hvs";
export const PAGE_SIZE = 24;

function titleFromAnchor($: any, anchor: any): string {
  return normalizeTitle(
    firstNonEmpty([
      anchor.find("h3").first().text(),
      anchor.find("img").first().attr("alt"),
      anchor.attr("title"),
      anchor.text(),
    ]),
  ).replace(/^Watch\s+/i, "");
}

function imageFromAnchor(anchor: any): string {
  return firstNonEmpty([
    anchor.find("img").first().attr("src"),
    anchor.find("img").first().attr("data-src"),
    anchor.find("img").first().attr("data-lazy-src"),
  ]);
}

export function parseListing($: any, baseUrl: string): Post[] {
  const posts: Post[] = [];
  const anchors = $('a[href*="/videos/hentai/"]');

  anchors.each(function (this: any) {
    const anchor = $(this);
    const href = String(anchor.attr("href") || "").trim();
    if (!/\/videos\/hentai\/[a-z0-9-]+/i.test(href)) return;

    const title = decodeEntities(titleFromAnchor($, anchor));
    if (!title) return;

    const link = absUrl(baseUrl, href.split("?")[0]);
    const image = imageFromAnchor(anchor);
    const post: Post = {
      title,
      link,
      image: image ? absUrl(baseUrl, image) : "",
    };
    posts.push(post);
  });

  return dedupePosts(posts);
}

interface IndexItem {
  name?: string;
  slug?: string;
  search_titles?: string;
  cover_url?: string;
  poster_url?: string;
  brand?: string;
}

// Local keyword filter over the guest search index. Every query term must
// appear in either the name or the search titles; name matches rank first.
export function filterIndex(items: IndexItem[], query: string): IndexItem[] {
  const terms = normalizeTitle(query).toLowerCase().split(" ").filter(Boolean);
  if (!terms.length) return [];

  const scored: { item: IndexItem; score: number }[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item || !item.slug) continue;
    const name = String(item.name || "").toLowerCase();
    const titles = String(item.search_titles || "").toLowerCase();
    let score = 0;
    let matched = true;
    for (let t = 0; t < terms.length; t++) {
      const term = terms[t];
      const inName = name.indexOf(term) !== -1;
      const inTitles = titles.indexOf(term) !== -1;
      if (!inName && !inTitles) {
        matched = false;
        break;
      }
      if (inName) score += 2;
      if (inTitles) score += 1;
    }
    if (matched) scored.push({ item, score });
  }

  scored.sort(function (a, b) {
    return b.score - a.score;
  });
  return scored.map(function (entry) {
    return entry.item;
  });
}

function indexToPosts(items: IndexItem[], baseUrl: string, page: number): Post[] {
  const safePage = clampPage(page);
  const start = (safePage - 1) * PAGE_SIZE;
  const slice = items.slice(start, start + PAGE_SIZE);
  const posts: Post[] = [];
  for (let i = 0; i < slice.length; i++) {
    const item = slice[i];
    const slug = normalizeTitle(item.slug);
    if (!slug) continue;
    const title = decodeEntities(normalizeTitle(item.name));
    if (!title) continue;
    const image = firstNonEmpty([item.cover_url, item.poster_url]);
    const post: Post = {
      title,
      link: baseUrl + "/videos/hentai/" + slug,
      image: image ? absUrl(baseUrl, image) : "",
    };
    if (item.brand) post.tag = normalizeTitle(item.brand);
    posts.push(post);
  }
  return posts;
}

function buildBrowseUrl(baseUrl: string, filter: string, page: number): string {
  const clean = String(filter || "").trim();
  const path = clean ? (clean.charAt(0) === "/" ? clean : "/" + clean) : "/browse/trending";
  const safePage = clampPage(page);
  if (safePage <= 1) return baseUrl + path;
  return baseUrl + path + (path.indexOf("?") === -1 ? "?page=" : "&page=") + safePage;
}

async function readContext(
  providerContext: ProviderContext,
): Promise<{ baseUrl: string; timeoutMs: number; retries: number }> {
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
  const { cheerio } = providerContext;
  const { baseUrl, timeoutMs, retries } = await readContext(providerContext);
  const url = buildBrowseUrl(baseUrl, filter || "", clampPage(page));

  const html = await requestHtml(providerContext, url, {
    timeoutMs,
    retries,
    signal,
    headers: HTML_HEADERS,
  });
  return parseListing(cheerio.load(html), baseUrl);
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
  const payload = await requestJson(providerContext, SEARCH_INDEX_URL, {
    timeoutMs,
    retries,
    signal,
    headers: JSON_HEADERS,
  });

  const items: IndexItem[] = payload && Array.isArray(payload.data) ? payload.data : [];
  return indexToPosts(filterIndex(items, query), baseUrl, clampPage(page));
};
