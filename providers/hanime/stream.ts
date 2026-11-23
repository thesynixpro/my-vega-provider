import { Stream, ProviderContext } from "../types";
import {
  BRAND,
  DEFAULT_RETRIES,
  DEFAULT_TIMEOUT_SECS,
  HTML_HEADERS,
  absUrl,
  readBoolSetting,
  readNumberSetting,
  requestHtml,
  resolveBaseUrl,
} from "./common";

// Hanime playback resolver.
//
// Hanime's player is fetched with a short-lived signed handshake
// (`/api/v11/handshake`) that is gated behind a browser challenge, so a direct
// stream cannot be resolved headlessly. This function therefore returns a
// single webview entry pointing at the original page, where playback works in
// the app's browser. No direct URL is fabricated.

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

  // Only inspect the page to surface any m3u8 the server may expose inline; the
  // handshake-gated manifest is not fetched.
  let manifest = "";
  try {
    const html = await requestHtml(providerContext, pageUrl, {
      timeoutMs: Math.round(timeoutSecs) * 1000,
      retries: Math.round(retries),
      signal,
      headers: HTML_HEADERS,
    });
    const match = html.match(/https?:\/\/[^"'\s\\]+\.m3u8[^"'\s\\]*/i);
    if (match) manifest = match[0].replace(/\\u0026/gi, "&").replace(/\\\//g, "/");
  } catch (e) {
    manifest = "";
  }

  const streams: Stream[] = [];
  if (manifest && includeHls) {
    streams.push({
      server: BRAND + "-HLS",
      link: manifest,
      type: "m3u8",
      tag: "Adaptive",
    });
  }

  streams.push({
    server: BRAND + "-Web",
    link: pageUrl || absUrl(baseUrl, pageUrl),
    type: "webview",
    tag: isDownload ? "Open in browser to download" : "Open in browser",
  });

  return streams;
};
