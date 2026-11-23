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

// Eporner video detail scraper.
//
// Metadata comes from Open Graph tags and the page's heading, which carries
// "<Title> <duration> <quality>". The download/stream resolution lives in
// stream.ts.

function parseDurationSeconds(raw: unknown): number {
  const text = String(raw == null ? "" : raw).trim();
  const direct = Number(text);
  if (Number.isFinite(direct) && direct > 0) return Math.round(direct);

  const hours = text.match(/(\d+)\s*h/i);
  const minutes = text.match(/(\d+)\s*min/i);
  if (hours || minutes) {
    return (hours ? Number(hours[1]) : 0) * 3600 + (minutes ? Number(minutes[1]) : 0) * 60;
  }

  const clock = text.match(/(\d+):(\d{2})(?::(\d{2}))?/);
  if (clock) {
    const parts = clock[0].split(":").map(function (value) {
      return Number(value);
    });
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return parts[0] * 60 + parts[1];
  }
  return 0;
}

function formatDuration(seconds: number): string {
  if (!seconds) return "";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours) return hours + "h " + String(minutes).padStart(2, "0") + "m";
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
  const links = $(
    '.vid-tags a, a[href*="/cat/"], a[href*="/tag/"], .categories a, #categories a',
  );
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
  const uploader = firstNonEmpty([
    normalizeTitle($('a[href*="/profile/"] .name').first().text()),
    normalizeTitle($('a[href*="/profile/"]').first().text()),
    normalizeTitle($('a[href*="/channel/"]').first().text()),
  ]);
  if (uploader && uploader.length < 60) cast.push(uploader);
  return cast;
}

function synopsisFrom($: any, tags: string[], duration: string): string {
  const jsonLd = $('script[type="application/ld+json"]').first().text();
  if (jsonLd) {
    try {
      const parsed = JSON.parse(jsonLd);
      if (typeof parsed === "string" && parsed.trim()) return normalizeTitle(parsed);
      const description = normalizeTitle(parsed && parsed.description);
      if (description) return description;
    } catch (e) {
      // Ignore malformed JSON-LD.
    }
  }

  const parts: string[] = [];
  if (tags.length) parts.push("Categories: " + tags.slice(0, 8).join(", "));
  if (duration) parts.push("Duration: " + duration);
  if (!parts.length) parts.push("Eporner video. Open the source page for full details.");
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
    throw new Error("Eporner getMeta requires an absolute video URL, received: " + pageUrl);
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
  const heading = normalizeTitle($("#cinemainfo h1, h1.mbtitlename, h1").first().text());
  const title = normalizeTitle(
    firstNonEmpty([metaContent($, "og:title"), heading, $("title").first().text()]),
  );
  if (!title) {
    throw new Error("Eporner getMeta could not read a title from " + pageUrl);
  }

  const durationSeconds = parseDurationSeconds(metaContent($, "og:duration"));
  const duration = formatDuration(durationSeconds);
  const tags = collectTags($);
  const cast = collectCast($);

  const info: Info = {
    title: title.replace(/\s*-\s*EPORNER.*$/i, "").trim(),
    image,
    synopsis: synopsisFrom($, tags, duration),
    imdbId: "",
    type: "movie",
    tags,
    cast,
    linkList: [
      {
        title: "Eporner",
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
