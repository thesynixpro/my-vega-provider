import { Stream, ProviderContext } from "../types";
import {
  BRAND,
  DEFAULT_RETRIES,
  DEFAULT_TIMEOUT_SECS,
  HTML_HEADERS,
  absUrl,
  decodeEntities,
  metaContent,
  normalizeTitle,
  readBoolSetting,
  readNumberSetting,
  resolveBaseUrl,
} from "./common";

// Pornhub playback resolver.
//
// The detail page exposes a signed progressive MP4 through `og:video` (and
// `og:video:secure_url`) plus the embed page URL in `og:video:url`; the JSON-LD
// `VideoObject.contentUrl` mirrors the MP4. The signature (`validfrom` /
// `validto` / `hash`) is time limited, so this function always re-fetches the
// page instead of caching raw stream URLs. When nothing resolves, the original
// page URL is returned as a webview fallback rather than inventing a link.

interface Candidate {
  link: string;
  type: string;
  height: number;
}

async function requestHtml(providerContext: ProviderContext, url: string, options: any = {}): Promise<string> {
  const response = await providerContext.axios.get(url, {
    headers: options.headers || HTML_HEADERS,
    timeout: options.timeoutMs || DEFAULT_TIMEOUT_SECS * 1000,
    signal: options.signal,
  });
  const body = typeof response.data === "string" ? response.data : String(response.data || "");
  if (!body || body.length < 30) throw new Error("Pornhub returned an empty HTML response");
  return body;
}

function scoreHeightFromUrl(url: string): number {
  const named = url.match(/(\d{3,4})[pP][_.-]/) || url.match(/(\d{3,4})P_/);
  if (named) return Number(named[1]);
  const bare = url.match(/(\d{3,4})p\b/);
  return bare ? Number(bare[1]) : 0;
}

function collectCandidates(html: string, $: any): Candidate[] {
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
      height: scoreHeightFromUrl(clean),
    });
  };

  push(metaContent($, "og:video:secure_url"), "mp4");
  push(metaContent($, "og:video"), "mp4");

  // JSON-LD contentUrl (mirrors the progressive MP4).
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
          push(entry.contentUrl, "mp4");
        }
        if (entry && Array.isArray(entry["@graph"])) {
          for (let g = 0; g < entry["@graph"].length; g++) {
            const node = entry["@graph"][g];
            if (node && node["@type"] === "VideoObject" && node.contentUrl) {
              push(node.contentUrl, "mp4");
            }
          }
        }
      }
    } catch (e) {
      // Ignore malformed JSON-LD.
    }
  });

  // Any inline .mp4 URL (escaping aware).
  const mp4Pattern = /https?:\\?\/\\?\/[^"'\s\\]+\.mp4[^"'\s\\]*/gi;
  let match = mp4Pattern.exec(html);
  while (match) {
    push(match[0].replace(/\\\//g, "/"), "mp4");
    match = mp4Pattern.exec(html);
  }

  return candidates;
}

function embedUrl(html: string): string {
  const match = html.match(/https?:\/\/(?:www\.|m\.)?pornhub\.com\/embed\/[A-Za-z0-9]+/i);
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
    };
    if (quality) stream.quality = quality;
    streams.push(stream);
  }

  // Highest quality first for streaming; lowest first for downloads.
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
