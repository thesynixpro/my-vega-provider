import { Post, ProviderContext } from "../types";
import {
  DEFAULT_RETRIES,
  DEFAULT_TIMEOUT_SECS,
  HTML_HEADERS,
  absUrl,
  clampPage,
  decodeEntities,
  dedupePosts,
  firstNonEmpty,
  normalizeTitle,
  readNumberSetting,
  requestHtml,
  resolveBaseUrl,
} from "./common";

// CosXplay listing scraper (search + catalog browse).
//
//   Browse : https://cosxplay.com/[/page/<n>/]
//            https://cosxplay.com/<tag-path>/[/page/<n>/]
//   Search : https://cosxplay.com/search/<query>/[/page/<n>/]
//
// Every result is a `.video-block` card holding `a.thumb[href]` (the video URL),
// `img.video-img` (thumbnail + alt title), `span.title`, `span.duration` and
// `span.views-number`.

export function parseListing($: any, baseUrl: string): Post[] {
  const posts: Post[] = [];
  const cards = $(".video-block");

  cards.each(function (this: any) {
    const card = $(this);
    const anchor = firstNonEmpty([
      String(card.find("a.thumb").first().attr("href") || ""),
      String(card.find("a.infos").first().attr("href") || ""),
    ]);
    if (!anchor || !/^https?:\/\//i.test(anchor)) return;

    const img = card.find("img.video-img").first();
    let title = decodeEntities(normalizeTitle(card.find("span.title").first().text()));
    if (!title) title = decodeEntities(normalizeTitle(img.attr("alt")));
    if (!title) title = decodeEntities(normalizeTitle(card.find("a.thumb").first().attr("aria-label")));
    if (!title) return;

    const image = firstNonEmpty([img.attr("src"), img.attr("data-src")]);
    const post: Post = {
      title,
      link: absUrl(baseUrl, anchor),
      image: image ? absUrl(baseUrl, image) : "",
    };

    const duration = normalizeTitle(card.find("span.duration").first().text());
    if (duration) post.tag = decodeEntities(duration);

    posts.push(post);
  });

  return dedupePosts(posts);
}

function buildBrowseUrl(baseUrl: string, filter: string, page: number): string {
  const clean = String(filter || "").trim().replace(/^\/+|\/+$/g, "");
  const safePage = clampPage(page);
  const base = clean ? baseUrl + "/" + clean : baseUrl;
  if (safePage <= 1) return base + "/";
  return base + "/page/" + safePage + "/";
}

function buildSearchUrl(baseUrl: string, query: string, page: number): string {
  const safePage = clampPage(page);
  const encoded = encodeURIComponent(query).replace(/%20/g, "-");
  const base = baseUrl + "/search/" + encoded;
  if (safePage <= 1) return base + "/";
  return base + "/page/" + safePage + "/";
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
