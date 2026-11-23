// @vega-provider eporner
// @vega-version 1.0.0
"use strict";
// Eporner playback resolver.
//
// Eporner embeds a 32-character hex `hash` in the video page. The player asks
// its own public endpoint for the sources:
//
//   GET /xhr/video/<id>?hash=<base36(hash)>&device=generic
//       &domain=www.eporner.com&fallback=false
//
// which returns { available, sources: { hls: {...}, mp4: {...} } }. As a
// fallback the served /dload/<id>/<height>/<file>.mp4 links are read straight
// from the page. When nothing resolves, the original page URL is returned.
var DEFAULT_BASE_URL = "https://www.eporner.com";
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
      if (text.length < 100) throw new Error("Empty or truncated response body");
      return text;
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await sleep(400 * (attempt + 1));
      }
    }
  }

  var message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error("Eporner request failed for " + url + ": " + message);
}

async function requestHtml(providerContext, url, options) {
  return request(providerContext, url, options);
}

// Encodes an integer as a base-N string (lowercase), matching the hash scheme
// used by Eporner's own player. Implemented manually to avoid any third-party
// dependency inside the sandbox.
function encodeBaseN(value, base) {
  var digits = "0123456789abcdefghijklmnopqrstuvwxyz";
  var n = Math.floor(Math.abs(value));
  if (n === 0) return "0";
  var out = "";
  while (n > 0) {
    var remainder = n % base;
    out = digits.charAt(remainder) + out;
    n = Math.floor(n / base);
  }
  return out;
}

// Eporner's public player derives a base-36 hash from the 32 hex chars in the
// page (hash = <32 hex>). Four chunks of 8 hex chars are each converted to
// base 36 and concatenated.
function calcHash(hexHash) {
  var clean = String(hexHash || "").trim();
  if (!/^[\da-fA-F]{32}$/.test(clean)) return "";
  var out = "";
  for (var i = 0; i < 32; i += 8) {
    var chunk = clean.substring(i, i + 8);
    out += encodeBaseN(parseInt(chunk, 16), 36);
  }
  return out;
}

function pageHashFromHtml(html) {
  var match = html.match(/hash\s*[:=]\s*["']([\da-fA-F]{32})["']/);
  return match ? match[1] : "";
}

function videoIdFromUrl(url) {
  var match = String(url || "").match(/eporner\.com\/(?:(?:hd-porn|embed)\/|video-)([A-Za-z0-9]+)/i);
  return match ? match[1] : "";
}

function heightFromText(text) {
  var match = String(text || "").match(/(\d{3,4})\s*p?/i);
  return match ? Number(match[1]) : 0;
}

function heightFromUrl(url) {
  var named = url.match(/-(\d{3,4})p\.mp4/i) || url.match(/(\d{3,4})p?\/[^/]*\.mp4/i);
  return named ? Number(named[1]) : 0;
}

function collectCandidates(html, payload) {
  var candidates = [];
  var seen = {};

  var push = function (url, type, height) {
    var clean = normalizeTitle(url);
    if (!clean || !/^https?:\/\//i.test(clean)) return;
    if (seen[clean]) return;
    seen[clean] = true;
    candidates.push({
      link: clean,
      type: type,
      height: height || (type === "m3u8" ? 0 : heightFromUrl(clean)),
    });
  };

  // 1. Prefer the structured sources from the player endpoint.
  var sources = payload && payload.sources ? payload.sources : null;
  if (sources && typeof sources === "object") {
    var kinds = Object.keys(sources);
    for (var k = 0; k < kinds.length; k++) {
      var kind = kinds[k];
      var group = sources[kind];
      if (!group || typeof group !== "object") continue;
      var type = /m3u8|hls/i.test(kind) ? "m3u8" : "mp4";

      if (typeof group.src === "string") {
        push(group.src, type, heightFromText(kind));
        continue;
      }

      var formatIds = Object.keys(group);
      for (var f = 0; f < formatIds.length; f++) {
        var formatId = formatIds[f];
        var entry = group[formatId];
        if (!entry || typeof entry.src !== "string") continue;
        var isHls = /m3u8|hls/i.test(formatId) || !/\.mp4/i.test(entry.src);
        push(entry.src, isHls ? "m3u8" : "mp4", heightFromText(formatId));
      }
    }
  }

  // 2. Fall back to any .m3u8 / .mp4 URL visible in the page.
  var mp4Pattern = /https?:\/\/[^"'\s\\]+\.mp4[^"'\s\\]*/gi;
  var match = mp4Pattern.exec(html);
  while (match) {
    push(match[0].replace(/\\u0026/gi, "&").replace(/\\\//g, "/"), "mp4", 0);
    match = mp4Pattern.exec(html);
  }

  var hlsPattern = /https?:\/\/[^"'\s\\]+\.m3u8[^"'\s\\]*/gi;
  match = hlsPattern.exec(html);
  while (match) {
    push(match[0].replace(/\\u0026/gi, "&").replace(/\\\//g, "/"), "m3u8", 0);
    match = hlsPattern.exec(html);
  }

  return candidates;
}

async function fetchPlayerSources(providerContext, videoId, hash, pageUrl, timeoutMs, retries, signal) {
  var calculated = calcHash(hash);
  if (!videoId || !calculated) return null;

  var endpoint =
    "http://www.eporner.com/xhr/video/" +
    videoId +
    "?hash=" +
    calculated +
    "&device=generic&domain=www.eporner.com&fallback=false";

  return request(providerContext, endpoint, {
    timeoutMs: timeoutMs,
    retries: retries,
    signal: signal,
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

var getStream = async function ({ link, type, signal, providerContext, isDownload }) {
  var pageUrl = String(link || "").trim();
  if (!/^https?:\/\//i.test(pageUrl)) {
    throw new Error("Eporner getStream requires an absolute video URL, received: " + pageUrl);
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

  var timeoutMs = Math.round(timeoutSecs) * 1000;
  var attempts = Math.round(retries);

  var html = await requestHtml(providerContext, pageUrl, {
    timeoutMs: timeoutMs,
    retries: attempts,
    signal: signal,
    headers: HTML_HEADERS,
  });

  var videoId = videoIdFromUrl(pageUrl);
  var hash = pageHashFromHtml(html);

  var payload = null;
  try {
    payload = await fetchPlayerSources(providerContext, videoId, hash, pageUrl, timeoutMs, attempts, signal);
  } catch (e) {
    payload = null;
  }

  var candidates = collectCandidates(html, payload);
  var streams = [];
  var seenLinks = {};

  for (var i = 0; i < candidates.length; i++) {
    var candidate = candidates[i];
    if (candidate.type === "m3u8" && !includeHls) continue;
    if (seenLinks[candidate.link]) continue;
    seenLinks[candidate.link] = true;

    var quality = candidate.height ? String(candidate.height) : undefined;
    if (quality && allowedList.length && allowedList.indexOf(quality) === -1) continue;

    var stream = {
      server: candidate.type === "m3u8" ? "Eporner-HLS" : "Eporner",
      link: candidate.link,
      type: candidate.type,
    };
    if (quality) stream.quality = quality;
    if (stream.type === "m3u8") stream.tag = "Adaptive";
    streams.push(stream);
  }

  streams.sort(function (a, b) {
    var aq = Number(a.quality) || 0;
    var bq = Number(b.quality) || 0;
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

exports.getStream = getStream;
