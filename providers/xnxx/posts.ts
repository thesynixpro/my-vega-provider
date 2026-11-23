import { Post, ProviderContext } from "../types";
import {
  DEFAULT_RETRIES,
  DEFAULT_TIMEOUT_SECS,
  HTML_HEADERS,
  absUrl,
  buildPathUrl,
  clampPage,
  firstNonEmpty,
  nearestBlock,
  normalizeTitle,
  readNumberSetting,
  requestHtml,
  resolveBaseUrl,
} from "./common";

// XNXX listing scraper (search + catalog browse).
//
//   Search  : https://www.xnxx.com/search/<query>[/<page>]
//   Browse  : https://www.xnxx.com<hits|best|tags/<tag>>[/<page>]
//
// XNXX renders one `div.thumb-block` per video in the mozaique listing grid.
// The title, thumbnail and HD badge live inside `.thumb-under`; newer markup
// also carries a `data-video` JSON blob with a thumbnail fallback.

function thumbFromDataVideo(dataVideo: string): string {
  if (!dataVideo) return "";
  try {
    const parsed = JSON.parse(dataVideo);
    return firstNonEmpty([
      parsed.sfwThumbUrl,
      parsed.previewVideo,
      parsed.mozaiqueListing,
    ]);
  } catch (e) {
    return "";
  }
}

function imageFromItem($: any, item: any): string {
  const img = item.find("img").first();
  return firstNonEmpty([
    img.attr("data-sfwthumb"),
    img.attr("data-src"),
    img.attr("data-mzl"),
    thumbFromDataVideo(String(item.attr("data-video") || "")),
    img.attr("src"),
  ]);
}

function hdFromItem($: any, item: any): string {
  let mark = normalizeTitle(item.find(".video-hd-mark").first().text());
  if (!mark) mark = normalizeTitle(item.find(".video-hd").first().text());
  if (!mark) return "";
  const digits = mark.match(/(\d{3,4})\s*p?/i);
  return digits ? digits[1] : "";
}

function parseListing($: any, html: string, baseUrl: string): Post[] {
  const posts: Post[] = [];
  const anchors = $('a[href*="/video-"]');

  anchors.each(function (this: any) {
    const anchor = $(this);
    const href = String(anchor.attr("href") || "").trim();
    if (!/\/video-[0-9a-z]+/i.test(href)) return;

    const item = nearestBlock($, anchor);
    const title = normalizeTitle(
      firstNonEmpty([
        anchor.attr("title"),
        item.find("a.thumb-link").first().attr("title"),
        item.find(".thumb-under p a").first().attr("title"),
        anchor.text(),
        item.find(".thumb-under p a").first().text(),
      ]),
    );
    if (!title) return;

    const link = absUrl(baseUrl, href);
    if (!link) return;

    // Skip duplicate anchors (XNXX renders the title link twice).
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

function buildListingUrl(baseUrl: string, path: string, page: number): string {
  return buildPathUrl(baseUrl, path, page);
}

async function loadListing(
  providerContext: ProviderContext,
  url: string,
  timeoutMs: number,
  retries: number,
  signal?: AbortSignal,
): Promise<string> {
  return requestHtml(providerContext, url, {
    timeoutMs,
    retries,
    signal,
    headers: HTML_HEADERS,
  });
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
  const url = buildListingUrl(baseUrl, filter || "", clampPage(page));

  const html = await loadListing(providerContext, url, timeoutMs, retries, signal);
  const $ = cheerio.load(html);
  return parseListing($, html, baseUrl);
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
  const encoded = encodeURIComponent(query).replace(/%20/g, "+");
  const url = buildListingUrl(baseUrl, "/search/" + encoded, clampPage(page));

  const html = await loadListing(providerContext, url, timeoutMs, retries, signal);
  const $ = cheerio.load(html);
  return parseListing($, html, baseUrl);
};
