// @vega-provider xnxx
// @vega-version 1.0.0
"use strict";
// XNXX playback resolver.
//
// XNXX loads its player from html5player.setVideoUrlLow() / setVideoUrlHigh() /
// setVideoHLS() and mirrors the progressive MP4 in the page's JSON-LD as
// contentUrl. The signed secure=<sig>,<expiry> links are time limited, so this
// function always re-fetches the page instead of caching raw stream URLs. If
// nothing can be extracted, the original page URL is returned as a webview
// fallback rather than inventing a link.
var DEFAULT_BASE_URL = "https://www.xnxx.com";
var DEFAULT_TIMEOUT_SECS = 20;
var DEFAULT_RETRIES = 2;
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

function normalizeTitle(value) {
  return String(value == null ? "" : value)
    .replace(/\s+/g, " ")
    .trim();
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

async function requestHtml(providerContext, url, options) {
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
      var data = typeof response.data === "string" ? response.data : String(response.data);
      if (!data || data.length < 100) {
        throw new Error("Empty or truncated response body");
      }
      return data;
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await sleep(400 * (attempt + 1));
      }
    }
  }

  var message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error("XNXX request failed for " + url + ": " + message);
}

function scoreHeightFromUrl(url) {
  var named = url.match(/(\d{3,4})p?\.[a-z0-9]+(?:\?|$)/i);
  if (named) return Number(named[1]);
  var inline = url.match(/[_-](\d{3,4})[_.-]/);
  if (inline) return Number(inline[1]);
  return 0;
}

function collectCandidates(html) {
  var candidates = [];
  var seen = {};

  var push = function (url, type) {
    var clean = normalizeTitle(url);
    if (!clean || !/^https?:\/\//i.test(clean)) return;
    if (seen[clean]) return;
    seen[clean] = true;
    candidates.push({ link: clean, type: type, height: scoreHeightFromUrl(clean) });
  };

  var patterns = [
    { regex: /html5player\.setVideoHLS\(\s*'([^']+)'\s*\)/gi, type: "m3u8" },
    { regex: /html5player\.setVideoUrlHigh\(\s*'([^']+)'\s*\)/gi, type: "mp4" },
    { regex: /html5player\.setVideoUrlLow\(\s*'([^']+)'\s*\)/gi, type: "mp4" },
    { regex: /"(?:contentUrl|videoUrl)"\s*:\s*"([^"]+\.(?:mp4|m3u8)[^"]*)"/gi, type: "mp4" },
    { regex: /https?:\/\/[^"'\s\\]+\.m3u8[^"'\s\\]*/gi, type: "m3u8" },
  ];

  for (var i = 0; i < patterns.length; i++) {
    var pattern = patterns[i];
    var match = pattern.regex.exec(html);
    while (match) {
      var value = match[1] !== undefined ? match[1] : match[0];
      var decoded = String(value)
        .replace(/\\u0026/gi, "&")
        .replace(/\\\//g, "/")
        .replace(/\\/g, "");
      var type = /\.m3u8/i.test(decoded) || pattern.type === "m3u8" ? "m3u8" : "mp4";
      push(decoded, type);
      match = pattern.regex.exec(html);
    }
  }

  return candidates;
}

function qualityLabel(height) {
  if (height) return String(height);
  return undefined;
}

var getStream = async function ({ link, type, signal, providerContext, isDownload }) {
  var pageUrl = String(link || "").trim();
  if (!/^https?:\/\//i.test(pageUrl)) {
    throw new Error("XNXX getStream requires an absolute video URL, received: " + pageUrl);
  }

  var override = await providerContext.kvStore.get("baseUrlOverride");
  var baseUrl = resolveBaseUrl(override);
  var timeoutSecs = await readNumberSetting(providerContext, "requestTimeoutSecs", DEFAULT_TIMEOUT_SECS);
  var retries = await readNumberSetting(providerContext, "retryAttempts", DEFAULT_RETRIES);
  var includeHls = await readBoolSetting(providerContext, "includeHls", true);
  var allowed = await providerContext.kvStore.get("allowedResolutions");
  var allowedList = Array.isArray(allowed)
    ? allowed.map(function (value) {
        return String(value);
      })
    : [];

  var html = await requestHtml(providerContext, pageUrl, {
    timeoutMs: Math.round(timeoutSecs) * 1000,
    retries: Math.round(retries),
    signal: signal,
    headers: HTML_HEADERS,
  });

  var candidates = collectCandidates(html);
  var streams = [];
  var seenLinks = {};

  for (var i = 0; i < candidates.length; i++) {
    var candidate = candidates[i];
    if (candidate.type === "m3u8" && !includeHls) continue;
    if (seenLinks[candidate.link]) continue;
    seenLinks[candidate.link] = true;

    var quality = qualityLabel(candidate.height);
    if (quality && allowedList.length && allowedList.indexOf(quality) === -1) continue;

    var server = candidate.type === "m3u8" ? "XNXX-HLS" : "XNXX";
    var stream = {
      server: server,
      link: candidate.link,
      type: candidate.type,
    };
    if (quality) stream.quality = quality;
    streams.push(stream);
  }

  // Sort high quality first for streaming; small files first for downloads.
  streams.sort(function (a, b) {
    var aq = Number(a.quality) || 0;
    var bq = Number(b.quality) || 0;
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

exports.getStream = getStream;
