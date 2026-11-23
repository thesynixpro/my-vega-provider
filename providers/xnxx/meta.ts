import { Info, ProviderContext } from "../types";
import {
  DEFAULT_RETRIES,
  DEFAULT_TIMEOUT_SECS,
  HTML_HEADERS,
  absUrl,
  firstNonEmpty,
  normalizeTitle,
  readNumberSetting,
  requestHtml,
  resolveBaseUrl,
} from "./common";

// XNXX video detail scraper.
//
// Every XNXX video page exposes standard Open Graph tags (`og:title`,
// `og:image`, `og:duration`) plus a `div.video-tags` block. The player itself
// is resolved later in stream.ts, so `linkList` simply routes the canonical
// page URL back through getStream.

function parseDurationSeconds(raw: unknown): number {
  const text = String(raw == null ? "" : raw).trim();
  const direct = Number(text);
  if (Number.isFinite(direct) && direct > 0) return Math.round(direct);

  // Fall back to parsing "12min", "1h 5min" or "12:34".
  const clock = text.match(/(\d+):(\d{2})(?::(\d{2}))?/);
  if (clock) {
    const parts = clock[0].split(":").map(function (value) {
      return Number(value);
    });
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return parts[0] * 60 + parts[1];
  }

  const hours = text.match(/(\d+)\s*h/i);
  const minutes = text.match(/(\d+)\s*min/i);
  if (hours || minutes) {
    return (hours ? Number(hours[1]) : 0) * 3600 + (minutes ? Number(minutes[1]) : 0) * 60;
  }
  return 0;
}

function formatDuration(seconds: number): string {
  if (!seconds) return "";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours) {
    return hours + "h " + String(minutes).padStart(2, "0") + "m";
  }
  return minutes + "m " + String(secs).padStart(2, "0") + "s";
}

function metaContent($: any, property: string): string {
  const node = $('meta[property="' + property + '"]').first();
  if (node.attr("content")) return String(node.attr("content"));
  const named = $('meta[name="' + property + '"]').first();
  return named.attr("content") ? String(named.attr("content")) : "";
}

function collectTags($: any): string[] {
  const tags: string[] = [];
  const links = $(".video-tags a, .video-metadata a[href*=\"/tags/\"], .video-tags-list a");
  links.each(function (this: any) {
    const tag = normalizeTitle($(this).text());
    if (tag && tag.length < 40) {
      for (let i = 0; i < tags.length; i++) {
        if (tags[i].toLowerCase() === tag.toLowerCase()) return;
      }
      tags.push(tag);
    }
  });
  return tags;
}

function collectCast($: any): string[] {
  const cast: string[] = [];
  const uploader = normalizeTitle($(".video-uploader-name").first().text());
  const altUploader = normalizeTitle($('a[href*="/porn-maker/"], a[href*="/pornstar/"]').first().text());
  const name = firstNonEmpty([uploader, altUploader]);
  if (name && name.length < 60) cast.push(name);
  return cast;
}

function synopsisFrom($: any, tags: string[], duration: string): string {
  const jsonLd = $('script[type="application/ld+json"]').first().text();
  if (jsonLd) {
    try {
      const parsed = JSON.parse(jsonLd);
      const description = normalizeTitle(parsed && parsed.description);
      if (description) return description;
    } catch (e) {
      // Ignore malformed JSON-LD.
    }
  }

  const parts: string[] = [];
  const category = normalizeTitle($('a[href*="/tags/"]').first().text());
  if (category) parts.push("Category: " + category);
  if (tags.length) parts.push("Tags: " + tags.slice(0, 8).join(", "));
  if (duration) parts.push("Duration: " + duration);
  if (!parts.length) {
    parts.push("XNXX video. Open the source page for the full description.");
  }
  return parts.join(" | ");
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
    throw new Error("XNXX getMeta requires an absolute video URL, received: " + pageUrl);
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
  const image = absUrl(baseUrl, metaContent($, "og:image"));
  const title = normalizeTitle(
    firstNonEmpty([metaContent($, "og:title"), $("h2.page-title").first().text(), $("title").first().text()]),
  );
  if (!title) {
    throw new Error("XNXX getMeta could not read a title from " + pageUrl);
  }

  const durationSeconds = parseDurationSeconds(metaContent($, "og:duration"));
  const duration = formatDuration(durationSeconds);
  const tags = collectTags($);
  const cast = collectCast($);

  const info: Info = {
    title: title.replace(/\s*-\s*XNXX\.COM.*$/i, "").trim(),
    image,
    synopsis: synopsisFrom($, tags, duration),
    imdbId: "",
    type: "movie",
    tags,
    cast,
    linkList: [
      {
        title: "XNXX",
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
