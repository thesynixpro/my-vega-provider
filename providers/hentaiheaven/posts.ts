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

// HentaiHeaven listing scraper (search + catalog browse).
//
//   Browse : https://hentaihaven.xxx/<filter>[/page/<n>/]
//   Search : the on-site search page resolves client-side, so the WordPress
//            content API is used instead:
//            GET https://cms.hentaihaven.xxx/wp-json/wp/v2/wp-manga
//                ?search=<q>&page=<n>&per_page=24&_fields=id,slug,link,title,meta
//
// Browse pages are server-rendered; every card is an anchor to
// `/watch/<slug>/` with the cover image (`img.hentaihaven.xxx`) and an `alt`
// title. The CMS search returns the matching titles and their cover paths.

export const CMS_BASE_URL = "https://cms.hentaihaven.xxx";
export const IMAGE_BASE_URL = "https://img.hentaihaven.xxx";
export const PER_PAGE = 24;

function cardTitle($: any, anchor: any): string {
  return decodeEntities(
    normalizeTitle(
      firstNonEmpty([
        anchor.find("img").first().attr("alt"),
        anchor.attr("aria-label"),
        anchor.attr("title"),
        anchor.find("h3").first().text(),
        anchor.text(),
      ]),
    ),
  );
}

function cardImage(anchor: any): string {
  const img = anchor.find("img").first();
  return firstNonEmpty([
    img.attr("src"),
    img.attr("data-src"),
    img.attr("data-lazy-src"),
  ]);
}

function isWatchHref(href: string): boolean {
  return /^\/(?:[a-z]{2}\/)?watch\/[a-z0-9-]+\/?$/i.test(href) || /\/watch\/[a-z0-9-]+\/?$/i.test(href);
}

export function parseListing($: any, baseUrl: string): Post[] {
  const posts: Post[] = [];
  const anchors = $('a[href*="/watch/"]');

  anchors.each(function (this: any) {
    const anchor = $(this);
    const href = String(anchor.attr("href") || "").trim();
    if (!isWatchHref(href)) return;
    if (/\/episode-\d+\/?$/i.test(href)) return;

    const title = cardTitle($, anchor);
    if (!title) return;

    const link = absUrl(baseUrl, href.split("?")[0]);
    const image = cardImage(anchor);
    posts.push({
      title,
      link,
      image: image ? absUrl(baseUrl, image) : "",
    });
  });

  return dedupePosts(posts);
}

function imageFromCmsMeta(meta: any): string {
  if (!meta || typeof meta !== "object") return "";
  const rel = normalizeTitle(meta.vraven_remote_thumbnail);
  if (!rel) return "";
  return IMAGE_BASE_URL + "/" + rel.replace(/^\/+/, "");
}

export function parseCmsResults(payload: any, baseUrl: string): Post[] {
  const items = Array.isArray(payload) ? payload : [];
  const posts: Post[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item || !item.slug) continue;
    const title = decodeEntities(
      normalizeTitle(item.title && (item.title.rendered || item.title)),
    );
    if (!title) continue;
    posts.push({
      title,
      link: baseUrl + "/watch/" + normalizeTitle(item.slug) + "/",
      image: imageFromCmsMeta(item.meta),
    });
  }
  return dedupePosts(posts);
}

function buildBrowseUrl(baseUrl: string, filter: string, page: number): string {
  const clean = String(filter || "").trim();
  const path = clean ? (clean.charAt(0) === "/" ? clean : "/" + clean) : "/watch/";
  const safePage = clampPage(page);
  if (safePage <= 1) return baseUrl + path;
  const [withoutQuery, query] = path.split("?");
  const withPage =
    withoutQuery.replace(/\/+$/, "") + "/page/" + safePage + "/";
  return baseUrl + withPage + (query ? "?" + query : "");
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
  const url =
    CMS_BASE_URL +
    "/wp-json/wp/v2/wp-manga?search=" +
    encodeURIComponent(query) +
    "&page=" +
    clampPage(page) +
    "&per_page=" +
    PER_PAGE +
    "&_fields=id,slug,link,title,meta";

  const payload = await requestJson(providerContext, url, {
    timeoutMs,
    retries,
    signal,
    headers: JSON_HEADERS,
  });
  return parseCmsResults(payload, baseUrl);
};
