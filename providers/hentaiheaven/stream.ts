import { Stream, ProviderContext } from "../types";
import {
  BRAND,
  DEFAULT_RETRIES,
  DEFAULT_TIMEOUT_SECS,
  HTML_HEADERS,
  decodeEntities,
  normalizeTitle,
  readBoolSetting,
  readNumberSetting,
  requestHtml,
  resolveBaseUrl,
} from "./common";

// HentaiHeaven playback resolver.
//
// Episode pages embed the playable manifest as an indexable `<source>` element
// (`data-hhaven-indexable-source`) and repeat it in the JSON-LD
// `VideoObject.contentUrl`. Series landing pages do not embed a manifest, so
// they fall through to a webview entry pointing at the page.

interface Candidate {
  link: string;
  type: string;
  height: number;
}

function scoreHeight(url: string): number {
  const match = url.match(/(\d{3,4})p(?:\/|\.|\?|$)/i) || url.match(/[_-](\d{3,4})[_.-]/);
  return match ? Number(match[1]) : 0;
}

export function collectCandidates(html: string, $: any): Candidate[] {
  const candidates: Candidate[] = [];
  const seen: Record<string, boolean> = {};

  const push = function (value: unknown): void {
    const clean = normalizeTitle(decodeEntities(value)).replace(/\\u0026/gi, "&").replace(/\\\//g, "/");
    if (!clean || !/^https?:\/\//i.test(clean)) return;
    // Skip hover previews and poster images.
    if (/\/preview\.(mp4|webm)/i.test(clean)) return;
    if (/\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(clean)) return;
    if (seen[clean]) return;
    seen[clean] = true;
    candidates.push({
      link: clean,
      type: /\.m3u8/i.test(clean) ? "m3u8" : "mp4",
      height: scoreHeight(clean),
    });
  };

  $("source[data-hhaven-indexable-source], video source").each(function (this: any) {
    push($(this).attr("src"));
  });

  const blocks = $('script[type="application/ld+json"]');
  blocks.each(function (this: any) {
    const raw = $(this).text();
    if (!raw || raw.indexOf("VideoObject") === -1) return;
    try {
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      for (let i = 0; i < list.length; i++) {
        const entry = list[i];
        if (entry && entry["@type"] === "VideoObject" && entry.contentUrl) {
          push(entry.contentUrl);
        }
        if (entry && Array.isArray(entry["@graph"])) {
          for (let g = 0; g < entry["@graph"].length; g++) {
            const node = entry["@graph"][g];
            if (node && node["@type"] === "VideoObject" && node.contentUrl) {
              push(node.contentUrl);
            }
          }
        }
      }
    } catch (e) {
      // Ignore malformed JSON-LD.
    }
  });

  // Any inline manifest URL as a last resort.
  const pattern = /https?:\\?\/\\?\/[^"'\s\\]+\.m3u8[^"'\s\\]*/gi;
  let match = pattern.exec(html);
  while (match) {
    push(match[0]);
    match = pattern.exec(html);
  }

  return candidates;
}

export const getStream = async function ({
  link,
  type,
  signal,
  providerContext,
  isDownload,
}: {
  link: string;
  type: string;
  signal?: AbortSignal;
  providerContext: ProviderContext;
  isDownload?: boolean;
}): Promise<Stream[]> {
  const pageUrl = String(link || "").trim();
  if (!/^https?:\/\//i.test(pageUrl)) {
    throw new Error(BRAND + " getStream requires an absolute video URL, received: " + pageUrl);
  }

  const override = await providerContext.kvStore.get<unknown>("baseUrlOverride");
  const baseUrl = resolveBaseUrl(override);
  const timeoutSecs = await readNumberSetting(
    providerContext,
    "requestTimeoutSecs",
    DEFAULT_TIMEOUT_SECS,
  );
  const retries = await readNumberSetting(providerContext, "retryAttempts", DEFAULT_RETRIES);
  const includeHls = await readBoolSetting(providerContext, "includeHls", true);
  const allowed = await providerContext.kvStore.get<unknown>("allowedResolutions");
  const allowedList = Array.isArray(allowed)
    ? allowed.map(function (value) {
        return String(value);
      })
    : [];

  const html = await requestHtml(providerContext, pageUrl, {
    timeoutMs: Math.round(timeoutSecs) * 1000,
    retries: Math.round(retries),
    signal,
    headers: HTML_HEADERS,
  });

  const $ = providerContext.cheerio.load(html);
  const candidates = collectCandidates(html, $);
  const streams: Stream[] = [];
  const seenLinks: Record<string, boolean> = {};

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    if (candidate.type === "m3u8" && !includeHls) continue;
    if (seenLinks[candidate.link]) continue;
    seenLinks[candidate.link] = true;

    const quality = candidate.height ? String(candidate.height) : undefined;
    if (quality && allowedList.length && allowedList.indexOf(quality) === -1) continue;

    const stream: Stream = {
      server: candidate.type === "m3u8" ? BRAND + "-HLS" : BRAND,
      link: candidate.link,
      type: candidate.type,
      headers: {
        Referer: pageUrl + "/",
        Origin: baseUrl,
      },
    };
    if (quality) stream.quality = quality;
    streams.push(stream);
  }

  streams.sort(function (a, b) {
    const aq = Number(a.quality) || 0;
    const bq = Number(b.quality) || 0;
    if (isDownload) return aq - bq;
    return bq - aq;
  });

  if (!streams.length) {
    return [
      {
        server: BRAND + "-Web",
        link: pageUrl,
        type: "webview",
        tag: "Open in browser",
      },
    ];
  }

  return streams;
};
