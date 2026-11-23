import { Post, ProviderContext } from "../types";
import { absolute, cleanText, fetchHtml, getBase, pageNumber, sameOrigin } from "./common";

function listingUrl(base: string, filter: string, page: number): string {
  const path = filter || "/";
  if (page <= 1) return absolute(base, path);
  if (path === "/" || path === "") return absolute(base, "/page/" + page + "/");
  return absolute(base, path.replace(/\/$/, "") + "/page/" + page + "/");
}

export function parseListing($: any, base: string): Post[] {
  const results: Post[] = [];
  const seen: Record<string, boolean> = {};
  $("article a[href], .post a[href], .bs a[href], .item a[href], .anime a[href], a[href]").each(function(this: any) {
    const a = $(this);
    const href = String(a.attr("href") || "").trim();
    if (!href || href.charAt(0) === "#" || /^(mailto:|javascript:|tel:)/i.test(href)) return;
    const link = absolute(base, href);
    if (!link || !sameOrigin(base, link) || link === base + "/" || seen[link]) return;
    const imageEl = a.find("img").first().length ? a.find("img").first() : a.closest("article, .post, .bs, .item, .anime").find("img").first();
    const image = absolute(base, imageEl.attr("data-src") || imageEl.attr("data-lazy-src") || imageEl.attr("src") || imageEl.attr("data-original") || "");
    const title = cleanText(a.attr("title") || imageEl.attr("alt") || a.find("h2,h3,h4,.tt,.title").first().text() || a.text());
    if (!title || title.length < 2 || title.length > 180) return;
    if (/^(home|watch now|watchlist|info|login|register|next|previous|view more|read more)$/i.test(title)) return;
    // Require a poster or an anime/article-like container to avoid collecting navigation links.
    const containerClass = String(a.closest("article, .post, .bs, .item, .anime").attr("class") || "");
    if (!image && !containerClass && !/\/(anime|category|[a-z0-9-]+)\/?$/i.test(new URL(link).pathname)) return;
    seen[link] = true;
    results.push({ title, link, image });
  });
  return results.slice(0, 60);
}

export const getPosts = async function({ filter, page, signal, providerContext }: {
  filter: string; page: number; providerValue: string; signal: AbortSignal; providerContext: ProviderContext;
}): Promise<Post[]> {
  const base = await getBase(providerContext);
  const html = await fetchHtml(providerContext, listingUrl(base, filter, pageNumber(page)), signal);
  return parseListing(providerContext.cheerio.load(html), base);
};

export const getSearchPosts = async function({ searchQuery, page, signal, providerContext }: {
  searchQuery: string; page: number; providerValue: string; signal: AbortSignal; providerContext: ProviderContext;
}): Promise<Post[]> {
  const query = String(searchQuery || "").trim();
  if (!query) return [];
  const base = await getBase(providerContext);
  const url = absolute(base, "/?s=" + encodeURIComponent(query) + (pageNumber(page) > 1 ? "&paged=" + pageNumber(page) : ""));
  const html = await fetchHtml(providerContext, url, signal);
  return parseListing(providerContext.cheerio.load(html), base);
};
