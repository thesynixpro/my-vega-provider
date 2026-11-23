import { Post, ProviderContext } from "../types";
import {
  DEFAULT_RETRIES,
  DEFAULT_TIMEOUT_SECS,
  HTML_HEADERS,
  absUrl,
  clampPage,
  firstNonEmpty,
  normalizeTitle,
  readNumberSetting,
  requestHtml,
  resolveBaseUrl,
} from "./common";

// Eporner listing scraper (search + catalog browse).
//
//   Search : https://www.eporner.com/search/<query>/[<page>/]
//   Browse : https://www.eporner.com/<cat|best-videos|top-rated>/[<page>/]
//
// Each result is a `.mb` box containing a thumbnail anchor and a title anchor
// (`a[title]`). The exact class names have varied over time, so parsing walks
// up from the title anchor to the nearest box and reads fields defensively.

function boxTokens(node: any): string[] {
  return String(node.attr("class") || "").split(/\s+/);
}

function isListingBox(node: any): boolean {
  const tokens = boxTokens(node);
  for (let i = 0; i < tokens.length; i++) {
    if (/^(mb|mbcontent|mbimg|vth|videobox|vidbox)$/i.test(tokens[i])) return true;
  }
  return false;
}

function nearestBox($: any, anchor: any): any {
  let node = anchor;
  for (let i = 0; i < 6 && node && node.length; i++) {
    if (isListingBox(node)) return node;
    node = node.parent();
  }
  return anchor.parent();
}

function qualityFromText(text: string): string {
  const match = text.match(/\b(\d{3,4})p\b/i);
  if (!match) return "";
  return match[1];
}

function parseListing($: any, baseUrl: string): Post[] {
  const posts: Post[] = [];
  const anchors = $('a[href*="/video-"]');

  anchors.each(function (this: any) {
    const anchor = $(this);
    const href = String(anchor.attr("href") || "").trim();
    if (!/\/video-[A-Za-z0-9]+/i.test(href)) return;

    const title = normalizeTitle(firstNonEmpty([anchor.attr("title"), anchor.text()]));
    if (!title) return;

    const link = absUrl(baseUrl, href);
    for (let i = 0; i < posts.length; i++) {
      if (posts[i].link === link) return;
    }

    const box = nearestBox($, anchor);
    const img = box.find("img").first();
    const image = firstNonEmpty([
      img.attr("data-src"),
      img.attr("src"),
      img.attr("data-original"),
    ]);

    let quality = qualityFromText(normalizeTitle(box.find(".mvp-quality").first().text()));
    if (!quality) quality = qualityFromText(normalizeTitle(box.text()));

    const post: Post = {
      title,
      link,
      image: image ? absUrl(baseUrl, image) : "",
    };
    if (quality) post.tag = quality + "p";
    posts.push(post);
  });

  return posts;
}

function buildSearchUrl(baseUrl: string, query: string, page: number): string {
  const safePage = clampPage(page);
  const encoded = String(query).replace(/\s+/g, "-");
  if (safePage <= 1) return baseUrl + "/search/" + encoded + "/";
  return baseUrl + "/search/" + encoded + "/" + safePage + "/";
}

function buildBrowseUrl(baseUrl: string, path: string, page: number): string {
  const clean = String(path || "").replace(/^\/+|\/+$/g, "");
  const safePage = clampPage(page);
  if (!clean) return baseUrl + "/" + (safePage <= 1 ? "" : safePage + "/");
  if (safePage <= 1) return baseUrl + "/" + clean + "/";
  return baseUrl + "/" + clean + "/" + safePage + "/";
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
