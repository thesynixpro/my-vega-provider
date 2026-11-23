import { Stream, ProviderContext } from "../types";
import {
  DEFAULT_RETRIES,
  DEFAULT_TIMEOUT_SECS,
  HTML_HEADERS,
  USER_AGENT,
  absUrl,
  calcHash,
  normalizeTitle,
  pageHashFromHtml,
  readBoolSetting,
  readNumberSetting,
  request,
  requestHtml,
  resolveBaseUrl,
  videoIdFromUrl,
} from "./common";

// Eporner playback resolver.
//
// Eporner embeds a 32-character hex `hash` in the video page. The player asks
// its own public endpoint for the sources:
//
//   GET /xhr/video/<id>?hash=<base36(hash)>&device=generic
//       &domain=www.eporner.com&fallback=false
//
// which returns `{ available, sources: { hls: {...}, mp4: {...} } }`. As a
// fallback the served `/dload/<id>/<height>/<file>.mp4` links are read straight
// from the page. When nothing resolves, the original page URL is returned.

interface Candidate {
  link: string;
  type: string;
  height: number;
}

function heightFromText(text: string): number {
  const match = String(text || "").match(/(\d{3,4})\s*p?/i);
  return match ? Number(match[1]) : 0;
}

function heightFromUrl(url: string): number {
  const named = url.match(/-(\d{3,4})p\.mp4/i) || url.match(/(\d{3,4})p?\/[^/]*\.mp4/i);
  return named ? Number(named[1]) : 0;
}

function collectCandidates(html: string, payload: any): Candidate[] {
  const candidates: Candidate[] = [];
  const seen: Record<string, boolean> = {};

  const push = function (url: string, type: string, height: number): void {
    const clean = normalizeTitle(url);
    if (!clean || !/^https?:\/\//i.test(clean)) return;
    if (seen[clean]) return;
    seen[clean] = true;
    candidates.push({
      link: clean,
      type,
      height: height || (type === "m3u8" ? 0 : heightFromUrl(clean)),
    });
  };

  // 1. Prefer the structured sources from the player endpoint.
  const sources = payload && payload.sources ? payload.sources : null;
  if (sources && typeof sources === "object") {
    const kinds = Object.keys(sources);
    for (let k = 0; k < kinds.length; k++) {
      const kind = kinds[k];
      const group = sources[kind];
      if (!group || typeof group !== "object") continue;
      const type = /m3u8|hls/i.test(kind) ? "m3u8" : "mp4";

      if (typeof group.src === "string") {
        push(group.src, type, heightFromText(kind));
        continue;
      }

      const formatIds = Object.keys(group);
      for (let f = 0; f < formatIds.length; f++) {
        const formatId = formatIds[f];
        const entry = group[formatId];
        if (!entry || typeof entry.src !== "string") continue;
        const isHls = /m3u8|hls/i.test(formatId) || !/\.mp4/i.test(entry.src);
        push(entry.src, isHls ? "m3u8" : "mp4", heightFromText(formatId));
      }
    }
  }

  // 2. Fall back to any .m3u8 / .mp4 URL visible in the page.
  const mp4Pattern = /https?:\/\/[^"'\s\\]+\.mp4[^"'\s\\]*/gi;
  let match = mp4Pattern.exec(html);
  while (match) {
    push(match[0].replace(/\\u0026/gi, "&").replace(/\\\//g, "/"), "mp4", 0);
    match = mp4Pattern.exec(html);
  }

  const hlsPattern = /https?:\/\/[^"'\s\\]+\.m3u8[^"'\s\\]*/gi;
  match = hlsPattern.exec(html);
  while (match) {
    push(match[0].replace(/\\u0026/gi, "&").replace(/\\\//g, "/"), "m3u8", 0);
    match = hlsPattern.exec(html);
  }

  return candidates;
}

async function fetchPlayerSources(
  providerContext: ProviderContext,
  videoId: string,
  hash: string,
  pageUrl: string,
  timeoutMs: number,
  retries: number,
  signal?: AbortSignal,
): Promise<any> {
  const calculated = calcHash(hash);
  if (!videoId || !calculated) return null;

  const endpoint =
    "http://www.eporner.com/xhr/video/" +
    videoId +
    "?hash=" +
    calculated +
    "&device=generic&domain=www.eporner.com&fallback=false";

  return request(providerContext, endpoint, {
    timeoutMs,
    retries,
    signal,
    responseType: "json",
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: pageUrl,
      Origin: "https://www.eporner.com",
      "X-Requested-With": "XMLHttpRequest",
    },
  });
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
    throw new Error("Eporner getStream requires an absolute video URL, received: " + pageUrl);
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

  const timeoutMs = Math.round(timeoutSecs) * 1000;
  const attempts = Math.round(retries);

  const html = await requestHtml(providerContext, pageUrl, {
    timeoutMs,
    retries: attempts,
    signal,
    headers: HTML_HEADERS,
  });

  const videoId = videoIdFromUrl(pageUrl);
  const hash = pageHashFromHtml(html);

  let payload: any = null;
  try {
    payload = await fetchPlayerSources(
      providerContext,
      videoId,
      hash,
      pageUrl,
      timeoutMs,
      attempts,
      signal,
    );
  } catch (e) {
    payload = null;
  }

  const candidates = collectCandidates(html, payload);
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
      server: candidate.type === "m3u8" ? "Eporner-HLS" : "Eporner",
      link: candidate.link,
      type: candidate.type,
    };
    if (quality) stream.quality = quality;
    if (stream.type === "m3u8") stream.tag = "Adaptive";
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
        server: "Eporner-Web",
        link: absUrl(baseUrl, pageUrl),
        type: "webview",
        tag: "Open in browser",
      },
    ];
  }

  return streams;
};
