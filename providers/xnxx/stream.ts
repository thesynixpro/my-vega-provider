import { Stream, ProviderContext } from "../types";
import {
  DEFAULT_RETRIES,
  DEFAULT_TIMEOUT_SECS,
  HTML_HEADERS,
  absUrl,
  normalizeTitle,
  readBoolSetting,
  readNumberSetting,
  requestHtml,
  resolveBaseUrl,
} from "./common";

// XNXX playback resolver.
//
// XNXX loads its player from `html5player.setVideoUrlLow()` /
// `setVideoUrlHigh()` / `setVideoHLS()` and mirrors the progressive MP4 in the
// page's JSON-LD as `contentUrl`. The signed `secure=<sig>,<expiry>` links are
// time limited, so this function always re-fetches the page instead of caching
// raw stream URLs. If nothing can be extracted, the original page URL is
// returned as a webview fallback rather than inventing a link.

interface Candidate {
  link: string;
  type: string;
  height: number;
}

function scoreHeightFromUrl(url: string): number {
  const named = url.match(/(\d{3,4})p?\.[a-z0-9]+(?:\?|$)/i);
  if (named) return Number(named[1]);
  const inline = url.match(/[_-](\d{3,4})[_.-]/);
  if (inline) return Number(inline[1]);
  return 0;
}

function collectCandidates(html: string): Candidate[] {
  const candidates: Candidate[] = [];
  const seen: Record<string, boolean> = {};

  const push = function (url: string, type: string): void {
    const clean = normalizeTitle(url);
    if (!clean || !/^https?:\/\//i.test(clean)) return;
    if (seen[clean]) return;
    seen[clean] = true;
    candidates.push({ link: clean, type, height: scoreHeightFromUrl(clean) });
  };

  const patterns: { regex: RegExp; type: string }[] = [
    { regex: /html5player\.setVideoHLS\(\s*'([^']+)'\s*\)/gi, type: "m3u8" },
    { regex: /html5player\.setVideoUrlHigh\(\s*'([^']+)'\s*\)/gi, type: "mp4" },
    { regex: /html5player\.setVideoUrlLow\(\s*'([^']+)'\s*\)/gi, type: "mp4" },
    { regex: /"(?:contentUrl|videoUrl)"\s*:\s*"([^"]+\.(?:mp4|m3u8)[^"]*)"/gi, type: "mp4" },
    { regex: /https?:\/\/[^"'\s\\]+\.m3u8[^"'\s\\]*/gi, type: "m3u8" },
  ];

  for (let i = 0; i < patterns.length; i++) {
    const pattern = patterns[i];
    let match = pattern.regex.exec(html);
    while (match) {
      const value = match[1] !== undefined ? match[1] : match[0];
      const decoded = String(value)
        .replace(/\\u0026/gi, "&")
        .replace(/\\\//g, "/")
        .replace(/\\/g, "");
      const type = /\.m3u8/i.test(decoded) || pattern.type === "m3u8" ? "m3u8" : "mp4";
      push(decoded, type);
      match = pattern.regex.exec(html);
    }
  }

  return candidates;
}

function qualityLabel(height: number, type: string): string | undefined {
  if (height) return String(height);
  if (type === "m3u8") return undefined;
  return undefined;
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
    throw new Error("XNXX getStream requires an absolute video URL, received: " + pageUrl);
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

    const quality = qualityLabel(candidate.height, candidate.type);
    if (quality && allowedList.length && allowedList.indexOf(quality) === -1) continue;

    const server = candidate.type === "m3u8" ? "XNXX-HLS" : "XNXX";
    const stream: Stream = {
      server,
      link: candidate.link,
      type: candidate.type,
    };
    if (quality) stream.quality = quality;
    streams.push(stream);
  }

  // Sort high quality first for streaming; small files first for downloads.
  streams.sort(function (a, b) {
    const aq = Number(a.quality) || 0;
    const bq = Number(b.quality) || 0;
    if (isDownload) return aq - bq;
    return bq - aq;
  });

  if (!streams.length) {
    return [
      {
        server: "XNXX-Web",
        link: pageUrl || absUrl(baseUrl, pageUrl),
        type: "webview",
        tag: "Open in browser",
      },
    ];
  }

  return streams;
};
