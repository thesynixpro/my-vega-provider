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
  parseDurationSeconds,
  parseIsoDuration,
  readNumberSetting,
  requestHtml,
  resolveBaseUrl,
} from "./common";

// Pornhub video detail scraper.
//
// The detail page is fully server-rendered: standard Open Graph tags carry the
// title, poster and description, and a JSON-LD `VideoObject` adds the ISO-8601
// duration and keywords. `linkList` routes the canonical page back through
// getStream, which resolves the player.

function jsonLdVideo($: any): any {
  const blocks = $('script[type="application/ld+json"]');
  let found: any = null;
  blocks.each(function (this: any) {
    if (found) return;
    const raw = $(this).text();
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      const candidate = Array.isArray(parsed)
        ? parsed.filter(function (entry: any) {
            return entry && entry["@type"] === "VideoObject";
          })[0]
        : parsed && parsed["@type"] === "VideoObject"
          ? parsed
          : parsed && Array.isArray(parsed["@graph"])
            ? parsed["@graph"].filter(function (entry: any) {
                return entry && entry["@type"] === "VideoObject";
              })[0]
            : null;
      if (candidate) found = candidate;
    } catch (e) {
      // Ignore malformed JSON-LD.
    }
  });
  return found;
}

function collectTags($: any, video: any): string[] {
  const tags: string[] = [];

  if (video && typeof video.keywords === "string") {
    const parts = video.keywords.split(",");
    for (let i = 0; i < parts.length; i++) {
      pushTag(tags, decodeEntities(normalizeTitle(parts[i])));
    }
  }

  const links = $('a[href*="/tags/"], a[href*="/categories/"]');
  links.each(function (this: any) {
    pushTag(tags, decodeEntities($(this).text()));
  });

  return tags;
}

function pushTag(tags: string[], value: string): void {
  const tag = normalizeTitle(value);
  if (!tag || tag.length > 40) return;
  for (let i = 0; i < tags.length; i++) {
    if (tags[i].toLowerCase() === tag.toLowerCase()) return;
  }
  tags.push(tag);
}

function collectCast($: any): string[] {
  const cast: string[] = [];
  const links = $('a[href*="/pornstar/"], a[href*="/model/"]');
  links.each(function (this: any) {
    const name = decodeEntities(normalizeTitle($(this).text()));
    if (!name || name.length > 60) return;
    for (let i = 0; i < cast.length; i++) {
      if (cast[i].toLowerCase() === name.toLowerCase()) return;
    }
    cast.push(name);
  });
  return cast;
}

function cleanTitle(value: string): string {
  return normalizeTitle(value)
    .replace(/\s*[-–]\s*Pornhub\.com.*$/i, "")
    .replace(/\s*\|\s*Pornhub.*$/i, "")
    .trim();
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

  const image = absUrl(baseUrl, decodeEntities(metaContent($, "og:image")));
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

  const durationSeconds =
    parseIsoDuration(video && video.duration) ||
    parseDurationSeconds(metaContent($, "og:duration"));
  const duration = formatDuration(durationSeconds);
  const tags = collectTags($, video);
  const cast = collectCast($);

  const description = firstNonEmpty([
    decodeEntities(metaContent($, "og:description")),
    video && decodeEntities(video.description),
  ]);
  const parts: string[] = [];
  if (description) parts.push(description);
  if (duration) parts.push("Duration: " + duration);
  if (tags.length) parts.push("Tags: " + tags.slice(0, 8).join(", "));
  if (!parts.length) {
    parts.push(BRAND + " video. Open the source page for the full description.");
  }

  const info: Info = {
    title,
    image,
    synopsis: parts.join(" | "),
    imdbId: "",
    type: "movie",
    tags,
    cast,
    linkList: [
      {
        title: BRAND,
        directLinks: [
          {
            title: "Play",
            link: pageUrl,
            type: "movie",
            image,
          },
        ],
      },
    ],
    webUrl: pageUrl,
  };

  return info;
};
