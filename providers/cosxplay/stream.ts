import { Stream, ProviderContext } from "../types";
import {
  BRAND,
  DEFAULT_RETRIES,
  DEFAULT_TIMEOUT_SECS,
  HTML_HEADERS,
  absUrl,
  decodeEntities,
  normalizeTitle,
  readBoolSetting,
  readNumberSetting,
  requestHtml,
  resolveBaseUrl,
} from "./common";

// CosXplay playback resolver.
//
// Detail pages embed a `VideoObject` in their JSON-LD `@graph` with a direct
// progressive MP4 in `contentUrl` and an `/embed/<id>` page in `embedUrl`.
// Because the MP4 is a plain CDN URL (no signature), it is returned directly;
// the embed page is offered as a secondary source and the original page is the
// webview fallback.

interface Candidate {
  link: string;
  type: string;
  height: number;
}

function scoreHeight(url: string): number {
  const match = url.match(/[_-](\d{3,4})[_.-]/) || url.match(/(\d{3,4})p\./i);
  return match ? Number(match[1]) : 0;
}

export function collectCandidates(html: string): Candidate[] {
  const candidates: Candidate[] = [];
  const seen: Record<string, boolean> = {};

  const push = function (value: unknown, type: string): void {
    const clean = normalizeTitle(decodeEntities(value));
    if (!clean || !/^https?:\/\//i.test(clean)) return;
    if (seen[clean]) return;
    seen[clean] = true;
    candidates.push({
      link: clean,
      type: /\.m3u8/i.test(clean) ? "m3u8" : type,
      height: scoreHeight(clean),
    });
  };

  // JSON-LD contentUrl / embedUrl.
  const blocks = html.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi);
  if (blocks) {
    for (let i = 0; i < blocks.length; i++) {
      const inner = blocks[i].replace(/^[\s\S]*?>/, "").replace(/<\/script>$/i, "");
      try {
        const parsed = JSON.parse(inner);
        const list = Array.isArray(parsed) ? parsed : [parsed];
        for (let j = 0; j < list.length; j++) {
          const entry = list[j];
          const graph = entry && Array.isArray(entry["@graph"]) ? entry["@graph"] : [entry];
          for (let g = 0; g < graph.length; g++) {
            const node = graph[g];
            if (node && node["@type"] === "VideoObject" && node.contentUrl) {
              push(node.contentUrl, "mp4");
            }
          }
        }
      } catch (e) {
        // Ignore malformed JSON-LD.
      }
    }
  }

  // data-trailer-url is a hover preview, not the main video; only used as a
  // last-but-one resort so an explicit contentUrl always wins.
  const trailer = html.match(/data-trailer-url="([^"]+\.mp4[^"]*)"/i);
  if (trailer) push(trailer[1], "mp4");

  // Any inline MP4 (excluding the low-res trailer CDN).
  const mp4Pattern = /https?:\\?\/\\?\/[^"'\s\\]+\.mp4[^"'\s\\]*/gi;
  let match = mp4Pattern.exec(html);
  while (match) {
    push(match[0].replace(/\\\//g, "/"), "mp4");
    match = mp4Pattern.exec(html);
  }

  return candidates;
}

function embedUrl(html: string): string {
  const match = html.match(
    /https?:\/\/(?:[a-z0-9-]+\.)*cosxplay\.com\/embed\/[0-9]+/i,
  );
  return match ? match[0] : "";
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

  const candidates = collectCandidates(html);
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

  const embed = embedUrl(html);
  if (embed && !isDownload) {
    streams.push({
      server: BRAND + "-Embed",
      link: embed,
      type: "webview",
      tag: "Embed",
    });
  }

  if (!streams.length) {
    return [
      {
        server: BRAND + "-Web",
        link: pageUrl || absUrl(baseUrl, pageUrl),
        type: "webview",
        tag: "Open in browser",
      },
    ];
  }

  return streams;
};
