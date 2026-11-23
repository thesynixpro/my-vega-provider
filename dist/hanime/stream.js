// @vega-provider hanime
// @vega-version 1.0.0
"use strict";
var DEFAULT_BASE_URL = "https://hanime.tv";

var DEFAULT_TIMEOUT_SECS = 20;

var DEFAULT_RETRIES = 2;

var BRAND = "Hanime";

var USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0";

var HTML_HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept-Language": "en-US,en;q=0.9",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

function resolveBaseUrl(override) {
  if (typeof override === "string" && /^https?:\/\//i.test(override.trim())) {
    return override.trim().replace(/\/+$/, "");
  }
  return DEFAULT_BASE_URL;
}

function absUrl(baseUrl, value) {
  var url = String(value == null ? "" : value).trim();
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  if (url.indexOf("//") === 0) return "https:" + url;
  return baseUrl + (url.charAt(0) === "/" ? url : "/" + url);
}

async function readNumberSetting(providerContext, key, fallback) {
  try {
    var value = await providerContext.kvStore.get(key);
    var parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  } catch (e) {
    return fallback;
  }
}

async function readBoolSetting(providerContext, key, fallback) {
  try {
    var value = await providerContext.kvStore.get(key);
    return typeof value === "boolean" ? value : fallback;
  } catch (e) {
    return fallback;
  }
}

function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

async function request(providerContext, url, options) {
  options = options || {};
  var timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_SECS * 1000;
  var retries = typeof options.retries === "number" ? options.retries : DEFAULT_RETRIES;
  var headers = options.headers || HTML_HEADERS;
  var lastError = null;

  for (var attempt = 0; attempt <= retries; attempt++) {
    try {
      var response = await providerContext.axios.get(url, {
        headers: headers,
        timeout: timeoutMs,
        signal: options.signal,
      });
      var data = response.data;
      if (data == null) throw new Error("Empty response body");
      if (options.responseType === "json") {
        if (typeof data === "object") return data;
        return JSON.parse(String(data));
      }
      var text = typeof data === "string" ? data : JSON.stringify(data);
      if (text.length < 50) throw new Error("Empty or truncated response body");
      return text;
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await sleep(400 * (attempt + 1));
      }
    }
  }

  var message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(BRAND + " request failed for " + url + ": " + message);
}

async function requestHtml(providerContext, url, options) {
  return request(providerContext, url, options);
}

// Hanime playback resolver.
//
// Hanime's player is fetched with a short-lived signed handshake
// (`/api/v11/handshake`) that is gated behind a browser challenge, so a direct
// stream cannot be resolved headlessly. This function therefore returns a
// single webview entry pointing at the original page. No direct URL is
// fabricated. Helpers below are inlined from providers/hanime/common.ts.

var getStream = async function ({ link, type, signal, providerContext, isDownload }) {
  var pageUrl = String(link || "").trim();
  if (!/^https?:\/\//i.test(pageUrl)) {
    throw new Error(BRAND + " getStream requires an absolute video URL, received: " + pageUrl);
  }

  var override = await providerContext.kvStore.get("baseUrlOverride");
  var baseUrl = resolveBaseUrl(override);
  var timeoutSecs = await readNumberSetting(providerContext, "requestTimeoutSecs", DEFAULT_TIMEOUT_SECS);
  var retries = await readNumberSetting(providerContext, "retryAttempts", DEFAULT_RETRIES);
  var includeHls = await readBoolSetting(providerContext, "includeHls", true);

  var manifest = "";
  try {
    var html = await requestHtml(providerContext, pageUrl, {
      timeoutMs: Math.round(timeoutSecs) * 1000,
      retries: Math.round(retries),
      signal: signal,
      headers: HTML_HEADERS,
    });
    var match = html.match(/https?:\/\/[^"'\s\\]+\.m3u8[^"'\s\\]*/i);
    if (match) manifest = match[0].replace(/\\u0026/gi, "&").replace(/\\\//g, "/");
  } catch (e) {
    manifest = "";
  }

  var streams = [];
  if (manifest && includeHls) {
    streams.push({ server: BRAND + "-HLS", link: manifest, type: "m3u8", tag: "Adaptive" });
  }

  streams.push({
    server: BRAND + "-Web",
    link: pageUrl || absUrl(baseUrl, pageUrl),
    type: "webview",
    tag: isDownload ? "Open in browser to download" : "Open in browser",
  });

  return streams;
};

exports.getStream = getStream;
