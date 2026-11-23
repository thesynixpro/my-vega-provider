import { Info, ProviderContext } from "../types";
import {
  BRAND,
  DEFAULT_RETRIES,
  DEFAULT_TIMEOUT_SECS,
  HTML_HEADERS,
  absUrl,
  decodeEntities,
  firstNonEmpty,
  formatDuration,
  metaContent,
  normalizeTitle,
  parseIsoDuration,
  readNumberSetting,
  requestHtml,
  resolveBaseUrl,
  stripTags,
} from "./common";

// Hanime video detail scraper.
//
// Detail pages (`/videos/hentai/<slug>`) are server-rendered and carry a
// JSON-LD `VideoObject` (name, description, thumbnail, ISO-8601 duration) plus
// standard Open Graph tags. Franchise siblings (`...-1`, `...-2`, ...) are
// listed on the page; when present they are exposed as episodes. The player
// itself needs a signed handshake, so stream.ts falls back to a webview entry.

// Derives the franchise key by dropping a trailing "-<number>" from the slug.
export function seriesKey(slug: string): string {
  return String(slug || "")
    .trim()
    .replace(/-\d+$/i, "");
}

function slugFromUrl(url: string): string {
  const match = String(url || "").match(/\/videos\/hentai\/([a-z0-9-]+)/i);
  return match ? match[1].toLowerCase() : "";
}

function episodeNumber(slug: string): number {
  const match = String(slug || "").match(/-(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function jsonLdVideo($: any): any {
  const blocks = $('script[type="application/ld+json"]');
  let found: any = null;
  blocks.each(function (this: any) {
    if (found) return;
    const raw = $(this).text();
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      for (let i = 0; i < list.length; i++) {
        if (list[i] && list[i]["@type"] === "VideoObject") found = list[i];
      }
    } catch (e) {
      // Ignore malformed JSON-LD.
    }
  });
  return found;
}

function cleanTitle(value: string): string {
  return normalizeTitle(value)
    .replace(/^Watch\s+/i, "")
    .replace(/\s+Hentai Video in .*$/i, "")
    .replace(/\s*[-–]\s*hanime\.tv.*$/i, "")
    .trim();
}

function collectTags($: any, video: any): string[] {
  const tags: string[] = [];
  if (video && typeof video.keywords === "string") {
    const parts = video.keywords.split(",");
    for (let i = 0; i < parts.length; i++) pushTag(tags, parts[i]);
  }
  const links = $('a[href*="/browse/tags/"]');
  links.each(function (this: any) {
    pushTag(tags, $(this).text());
  });
  return tags;
}

function pushTag(tags: string[], value: string): void {
  const tag = decodeEntities(normalizeTitle(value));
  if (!tag || tag.length > 40) return;
  for (let i = 0; i < tags.length; i++) {
    if (tags[i].toLowerCase() === tag.toLowerCase()) return;
  }
  tags.push(tag);
}

export const getMeta = async function ({
  link,
  providerContext,
}: {
  link: string;
  providerContext: ProviderContext;
}): Promise<Info> {
  const { cheerio } = providerContext;
  const pageUrl = String(link || "").trim();
  if (!/^https?:\/\//i.test(pageUrl)) {
    throw new Error(BRAND + " getMeta requires an absolute video URL, received: " + pageUrl);
  }

  const override = await providerContext.kvStore.get<unknown>("baseUrlOverride");
  const baseUrl = resolveBaseUrl(override);
  const timeoutSecs = await readNumberSetting(
    providerContext,
    "requestTimeoutSecs",
    DEFAULT_TIMEOUT_SECS,
  );
  const retries = await readNumberSetting(providerContext, "retryAttempts", DEFAULT_RETRIES);

  const html = await requestHtml(providerContext, pageUrl, {
    timeoutMs: Math.round(timeoutSecs) * 1000,
    retries: Math.round(retries),
    headers: HTML_HEADERS,
  });

  const $ = cheerio.load(html);
  const video = jsonLdVideo($);

  const image = absUrl(
    baseUrl,
    firstNonEmpty([
      decodeEntities(metaContent($, "og:image")),
      video && video.thumbnailUrl,
    ]),
  );
  const title = cleanTitle(
    firstNonEmpty([
      video && video.name,
      decodeEntities(metaContent($, "og:title")),
      $("title").first().text(),
    ]),
  );
  if (!title) {
    throw new Error(BRAND + " getMeta could not read a title from " + pageUrl);
  }

  const durationSeconds = parseIsoDuration(video && video.duration);
  const duration = formatDuration(durationSeconds);
  const tags = collectTags($, video);

  // Collect franchise siblings and expose them as episodes.
  const currentSlug = slugFromUrl(pageUrl);
  const key = seriesKey(currentSlug);
  const episodes: { title: string; link: string; image: string; number: number }[] = [];
  const seen: Record<string, boolean> = {};
  $('a[href*="/videos/hentai/"]').each(function (this: any) {
    const anchor = $(this);
    const href = String(anchor.attr("href") || "").split("?")[0];
    const slug = slugFromUrl(href);
    if (!slug || seen[slug]) return;
    if (key && seriesKey(slug) !== key) return;
    seen[slug] = true;
    const epTitle = cleanTitle(
      firstNonEmpty([anchor.find("h3").first().text(), anchor.attr("title"), anchor.text()]),
    );
    episodes.push({
      title: epTitle || slug,
      link: absUrl(baseUrl, href),
      image: video && video.thumbnailUrl ? absUrl(baseUrl, video.thumbnailUrl) : image,
      number: episodeNumber(slug),
    });
  });

  const isSeries = episodes.length > 1;
  const synopsisParts: string[] = [];
  const description = stripTags(
    firstNonEmpty([
      video && video.description,
      decodeEntities(metaContent($, "og:description")),
    ]),
  );
  if (description) synopsisParts.push(description);
  if (duration) synopsisParts.push("Duration: " + duration);
  if (tags.length) synopsisParts.push("Tags: " + tags.slice(0, 8).join(", "));
  if (isSeries) synopsisParts.push(episodes.length + " episodes in this series");
  if (!synopsisParts.length) {
    synopsisParts.push(BRAND + " video. Open the source page for the full description.");
  }

  const linkList = [
    isSeries
      ? {
          title: "Episodes",
          directLinks: episodes
            .sort(function (a, b) {
              return a.number - b.number;
            })
            .map(function (episode) {
              return {
                title: episode.number
                  ? "Episode " + episode.number
                  : episode.title,
                link: episode.link,
                type: "series" as const,
                image: episode.image,
              };
            }),
        }
      : {
          title: BRAND,
          directLinks: [
            {
              title: "Play",
              link: pageUrl,
              type: "movie" as const,
              image,
            },
          ],
        },
  ];

  const info: Info = {
    title,
    image,
    synopsis: synopsisParts.join(" | "),
    imdbId: "",
    type: isSeries ? "series" : "movie",
    tags,
    cast: [],
    linkList,
    webUrl: pageUrl,
  };

  return info;
};
