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

// HentaiHeaven video detail scraper.
//
// Watch pages (`/watch/<slug>/`) are server-rendered by a Next.js app and carry
// Open Graph tags plus a JSON-LD `VideoObject`. Episode links on the page
// (`/watch/<slug>/episode-<n>/`) are exposed as a season. `stream.ts` resolves
// playback from an episode page.

// Series slug from a `/watch/<slug>/` or `/watch/<slug>/episode-<n>/` URL.
export function slugFromUrl(url: string): string {
  const match = String(url || "").match(/\/watch\/([a-z0-9-]+)(?:\/|$)/i);
  return match ? match[1].toLowerCase() : "";
}

function episodeNumber(href: string): number {
  const match = String(href || "").match(/\/episode-(\d+)\/?$/i);
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
        const entry = list[i];
        if (entry && entry["@type"] === "VideoObject") found = entry;
        if (entry && Array.isArray(entry["@graph"])) {
          for (let g = 0; g < entry["@graph"].length; g++) {
            const node = entry["@graph"][g];
            if (node && node["@type"] === "VideoObject") found = node;
          }
        }
      }
    } catch (e) {
      // Ignore malformed JSON-LD.
    }
  });
  return found;
}

function cleanTitle(value: string): string {
  return normalizeTitle(value)
    .replace(/\s*[-–]\s*Hentai Haven.*$/i, "")
    .replace(/\s*\|\s*Watch free Hentai HD.*$/i, "")
    .trim();
}

function collectTags($: any, video: any): string[] {
  const tags: string[] = [];
  if (video && typeof video.keywords === "string") {
    const parts = video.keywords.split(",");
    for (let i = 0; i < parts.length; i++) pushTag(tags, parts[i]);
  }
  $('a[href*="/series/"], a[href*="/tag/"]').each(function (this: any) {
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

function collectCast(video: any): string[] {
  const cast: string[] = [];
  if (video && video.actor) {
    const list = Array.isArray(video.actor) ? video.actor : [video.actor];
    for (let i = 0; i < list.length; i++) {
      const name = decodeEntities(normalizeTitle(list[i] && list[i].name));
      if (name && name.length < 60) cast.push(name);
    }
  }
  return cast;
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
      decodeEntities(metaContent($, "og:title")),
      video && video.name,
      $("title").first().text(),
    ]),
  );
  if (!title) {
    throw new Error(BRAND + " getMeta could not read a title from " + pageUrl);
  }

  const durationSeconds = parseIsoDuration(video && video.duration);
  const duration = formatDuration(durationSeconds);
  const tags = collectTags($, video);
  const cast = collectCast(video);

  // Episode links for the same series.
  const seriesSlug = slugFromUrl(pageUrl);
  const episodes: { number: number; link: string }[] = [];
  const seen: Record<string, boolean> = {};
  $('a[href*="/episode-"]').each(function (this: any) {
    const href = String($(this).attr("href") || "").split("?")[0];
    const number = episodeNumber(href);
    if (!number) return;
    if (seriesSlug && slugFromUrl(href) !== seriesSlug) return;
    const absolute = absUrl(baseUrl, href);
    if (seen[absolute]) return;
    seen[absolute] = true;
    episodes.push({ number, link: absolute });
  });

  const isSeries = episodes.length >= 2;
  const parts: string[] = [];
  const description = stripTags(
    firstNonEmpty([
      decodeEntities(metaContent($, "og:description")),
      video && video.description,
    ]),
  );
  if (description) parts.push(description);
  if (duration) parts.push("Duration: " + duration);
  if (tags.length) parts.push("Tags: " + tags.slice(0, 8).join(", "));
  if (isSeries) parts.push(episodes.length + " episodes available");
  if (!parts.length) {
    parts.push(BRAND + " video. Open the source page for the full description.");
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
                title: "Episode " + episode.number,
                link: episode.link,
                type: "series" as const,
                image,
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
    synopsis: parts.join(" | "),
    imdbId: "",
    type: isSeries ? "series" : "movie",
    tags,
    cast,
    linkList,
    webUrl: pageUrl,
  };

  return info;
};
