import { Post, ProviderContext } from "../types";
import {
  DEFAULT_RETRIES,
  DEFAULT_TIMEOUT_SECS,
  HTML_HEADERS,
  absUrl,
  clampPage,
  firstNonEmpty,
  nearestBlock,
  normalizeTitle,
  readNumberSetting,
  requestHtml,
  resolveBaseUrl,
} from "./common";

// XVideos listing scraper (search + catalog browse).
//
//   Search : https://www.xvideos.com/?k=<query>&p=<page-1>
//   Browse : https://www.xvideos.com/c/<Name-ID>[/<page-1>]
//
// Each video is a `div.thumb-block` with the title, duration and HD badge in
// `.thumb-under`. `div.thumb-block-profile` cards are ignored.

function imageFromItem($: any, item: any): string {
  const img = item.find("img").first();
  return firstNonEmpty([
    img.attr("data-sfwthumb"),
    img.attr("data-src"),
    img.attr("data-mzl"),
    img.attr("src"),
  ]);
}

function hdFromItem($: any, item: any): string {
  const mark = normalizeTitle(item.find(".video-hd-mark").first().text());
  if (!mark) return "";
  const digits = mark.match(/(\d{3,4})\s*p?/i);
  return digits ? digits[1] : "";
}

function parseListing($: any, baseUrl: string): Post[] {
  const posts: Post[] = [];
  const anchors = $('.thumb-under p.title a[href^="/video."]');

  anchors.each(function (this: any) {
    const anchor = $(this);
    const href = String(anchor.attr("href") || "").trim();
    if (!/^\/video\.[0-9a-z]+/i.test(href)) return;

    const item = nearestBlock($, anchor);
    const duration = normalizeTitle(item.find(".duration").first().text());
    let title = normalizeTitle(anchor.attr("title"));
    if (!title) {
      title = normalizeTitle(anchor.text());
      if (duration && title.indexOf(duration) !== -1) {
        title = normalizeTitle(title.replace(duration, ""));
      }
    }
    if (!title) return;

    const link = absUrl(baseUrl, href);
    for (let i = 0; i < posts.length; i++) {
      if (posts[i].link === link) return;
    }

    const image = imageFromItem($, item);
    const hd = hdFromItem($, item);
    const post: Post = {
      title,
      link,
      image: image ? absUrl(baseUrl, image) : "",
    };
    if (hd) post.tag = hd + "p";
    posts.push(post);
  });

  return posts;
}

function buildSearchUrl(baseUrl: string, query: string, page: number): string {
  const encoded = encodeURIComponent(query).replace(/%20/g, "+");
  const safePage = clampPage(page);
  if (safePage <= 1) return baseUrl + "/?k=" + encoded;
  return baseUrl + "/?k=" + encoded + "&p=" + (safePage - 1);
}

function buildBrowseUrl(baseUrl: string, path: string, page: number): string {
  const clean = path ? "/" + String(path).replace(/^\/+|\/+$/g, "") : "";
  const safePage = clampPage(page);
  if (!clean) {
    return safePage <= 1 ? baseUrl + "/" : baseUrl + "/?p=" + (safePage - 1);
  }
  if (safePage <= 1) return baseUrl + clean;
  return baseUrl + clean + "/" + (safePage - 1);
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
  const { cheerio } = providerContext;
  const query = normalizeTitle(searchQuery);
  if (!query) return [];

  const { baseUrl, timeoutMs, retries } = await readContext(providerContext);
  const url = buildSearchUrl(baseUrl, query, clampPage(page));

  const html = await requestHtml(providerContext, url, {
    timeoutMs,
    retries,
    signal,
    headers: HTML_HEADERS,
  });
  return parseListing(cheerio.load(html), baseUrl);
};
