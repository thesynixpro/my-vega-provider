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

// CosXplay video detail scraper.
//
// Detail pages carry a JSON-LD `@graph` with a `VideoObject` (name,
// description, ISO-8601 duration, thumbnail, embed URL, actor list), a
// `Person` for the actor and `about[]` tags, plus standard Open Graph tags.
// `linkList` routes the page back through getStream.

function jsonLdGraph($: any): any[] {
  const nodes: any[] = [];
  $('script[type="application/ld+json"]').each(function (this: any) {
    const raw = $(this).text();
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      for (let i = 0; i < list.length; i++) {
        const entry = list[i];
        if (!entry) continue;
        if (Array.isArray(entry["@graph"])) {
          for (let g = 0; g < entry["@graph"].length; g++) nodes.push(entry["@graph"][g]);
        } else {
          nodes.push(entry);
        }
      }
    } catch (e) {
      // Ignore malformed JSON-LD.
    }
  });
  return nodes;
}

function findNode(nodes: any[], type: string): any {
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i] && nodes[i]["@type"] === type) return nodes[i];
  }
  return null;
}

function cleanTitle(value: string): string {
  return normalizeTitle(value).replace(/\s*\|\s*CosXplay\.com.*$/i, "").trim();
}

function collectTags(nodes: any[], video: any): string[] {
  const tags: string[] = [];
  const push = function (value: string): void {
    const tag = decodeEntities(normalizeTitle(value));
    if (!tag || tag.length > 40) return;
    for (let i = 0; i < tags.length; i++) {
      if (tags[i].toLowerCase() === tag.toLowerCase()) return;
    }
    tags.push(tag);
  };

  if (video && typeof video.keywords === "string") {
    const parts = video.keywords.split(",");
    for (let i = 0; i < parts.length; i++) push(parts[i]);
  }
  if (video && Array.isArray(video.about)) {
    for (let i = 0; i < video.about.length; i++) {
      push((video.about[i] && video.about[i].name) || "");
    }
  }
  return tags;
}

function collectCast(nodes: any[], video: any): string[] {
  const cast: string[] = [];
  const push = function (value: string): void {
    const name = decodeEntities(normalizeTitle(value));
    if (!name || name.length > 60) return;
    for (let i = 0; i < cast.length; i++) {
      if (cast[i].toLowerCase() === name.toLowerCase()) return;
    }
    cast.push(name);
  };

  if (video && Array.isArray(video.actor)) {
    for (let i = 0; i < video.actor.length; i++) {
      push(video.actor[i] && video.actor[i].name);
    }
  }
  const person = findNode(nodes, "Person");
  if (person && person.name) push(person.name);
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
  const nodes = jsonLdGraph($);
  const video = findNode(nodes, "VideoObject");

  const thumbnail = video
    ? Array.isArray(video.thumbnailUrl)
      ? video.thumbnailUrl[0]
      : video.thumbnailUrl
    : "";
  const image = absUrl(
    baseUrl,
    firstNonEmpty([
      decodeEntities(metaContent($, "og:image")),
      thumbnail,
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
  const tags = collectTags(nodes, video);
  const cast = collectCast(nodes, video);

  const parts: string[] = [];
  const description = stripTags(
    firstNonEmpty([
      video && video.description,
      decodeEntities(metaContent($, "description")),
      decodeEntities(metaContent($, "og:description")),
    ]),
  );
  if (description) parts.push(description);
  if (duration) parts.push("Duration: " + duration);
  if (tags.length) parts.push("Tags: " + tags.slice(0, 8).join(", "));
  if (cast.length) parts.push("Starring: " + cast.slice(0, 4).join(", "));
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
