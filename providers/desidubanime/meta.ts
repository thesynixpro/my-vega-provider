import { Info, ProviderContext } from "../types";
import { absolute, cleanText, fetchHtml, getBase, sameOrigin } from "./common";

function meta($: any, key: string): string {
  return String($(`meta[property="${key}"]`).attr("content") || $(`meta[name="${key}"]`).attr("content") || "");
}
export const getMeta = async function({ link, providerContext }: {
  link: string; providerContext: ProviderContext;
}): Promise<Info> {
  const base = await getBase(providerContext);
  const pageUrl = absolute(base, link);
  if (!pageUrl || !sameOrigin(base, pageUrl)) throw new Error("Invalid " + "DesiDubAnime" + " anime URL");
  const html = await fetchHtml(providerContext, pageUrl);
  const $ = providerContext.cheerio.load(html);
  const title = cleanText(meta($, "og:title") || $("h1").first().text() || $("title").first().text());
  const image = absolute(base, meta($, "og:image") || $("article img, .poster img, .cover img").first().attr("src") || "");
  const synopsis = cleanText(meta($, "og:description") || $("meta[name='description']").attr("content") || $(".entry-content, .description, .synopsis").first().text());
  const episodes: { title: string; link: string; image: string }[] = [];
  const seen: Record<string, boolean> = {};
  $("a[href]").each(function(this: any) {
    const a = $(this);
    const href = absolute(base, a.attr("href"));
    const label = cleanText(a.attr("title") || a.text());
    if (!href || !sameOrigin(base, href) || href === pageUrl || seen[href]) return;
    if (!/(episode|ep\.?\s*\d+|watch|part\s*\d+)/i.test(label + " " + href)) return;
    seen[href] = true;
    episodes.push({ title: label || "Open episode", link: href, image: absolute(base, a.find("img").attr("src") || image) });
  });
  return {
    title: title || "Anime",
    image,
    synopsis: synopsis || "Open the original source page for anime information and episode availability.",
    imdbId: "",
    type: episodes.length ? "series" : "movie",
    tags: [],
    cast: [],
    linkList: episodes.length ? [{ title: "Episodes", directLinks: episodes.slice(0, 100).map(ep => ({ title: ep.title, link: ep.link, type: "series" as const, image: ep.image })) }] : [{ title: "Source", directLinks: [{ title: "Open source page", link: pageUrl, type: "movie" as const, image }] }],
    webUrl: pageUrl,
  };
};
