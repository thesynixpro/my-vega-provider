// @vega-provider cosxplay
// @vega-version 1.0.2
"use strict";
var DEFAULT_BASE_URL = "https://cosxplay.com";

var DEFAULT_TIMEOUT_SECS = 20;

var DEFAULT_RETRIES = 2;

var BRAND = "CosXplay";

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

var ENTITIES = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#039;": "'",
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
  "&hellip;": "...",
  "&mdash;": "-",
  "&ndash;": "-",
  "&rsquo;": "'",
  "&lsquo;": "'",
  "&ldquo;": '"',
  "&rdquo;": '"',
};

function decodeEntities(value) {
  return String(value == null ? "" : value)
    .replace(/&#(\d+);/g, function (_match, digits) {
      return String.fromCharCode(Number(digits));
    })
    .replace(/&#x([0-9a-f]+);/gi, function (_match, hex) {
      return String.fromCharCode(parseInt(hex, 16));
    })
    .replace(/&[a-z#0-9]+;/gi, function (match) {
      var mapped = ENTITIES[match.toLowerCase()];
      return mapped === undefined ? match : mapped;
    });
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

// CosXplay playback resolver.
//
// Detail pages embed a `VideoObject` in their JSON-LD `@graph` with a direct
// progressive MP4 in `contentUrl` and an `/embed/<id>` page in `embedUrl`.
// The MP4 is a plain CDN URL (no signature), so it is returned directly; the
// embed page is offered as a secondary source and the original page is the
// webview fallback. Helpers below are inlined from
// providers/cosxplay/common.ts at build time.

function scoreHeight(url) {
  var match = url.match(/[_-](\d{3,4})[_.-]/) || url.match(/(\d{3,4})p\./i);
  return match ? Number(match[1]) : 0;
}

function collectCandidates(html) {
  var candidates = [];
  var seen = {};

  var push = function (value, type) {
    var clean = normalizeTitle(decodeEntities(value));
    if (!clean || !/^https?:\/\//i.test(clean)) return;
    if (/(?:trailer|preview|teaser|hover)/i.test(clean)) return;
    if (seen[clean]) return;
    seen[clean] = true;
    candidates.push({
      link: clean,
      type: /\.m3u8/i.test(clean) ? "m3u8" : type,
      height: scoreHeight(clean),
    });
  };

  // JSON-LD contentUrl / embedUrl.
  var blocks = html.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi);
  if (blocks) {
    for (var i = 0; i < blocks.length; i++) {
      var inner = blocks[i].replace(/^[\s\S]*?>/, "").replace(/<\/script>$/i, "");
      try {
        var parsed = JSON.parse(inner);
        var list = Array.isArray(parsed) ? parsed : [parsed];
        for (var j = 0; j < list.length; j++) {
          var entry = list[j];
          var graph = entry && Array.isArray(entry["@graph"]) ? entry["@graph"] : [entry];
          for (var g = 0; g < graph.length; g++) {
            var node = graph[g];
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

  // Ignore hover trailer / preview URLs: these are often only five seconds.
  var mp4Pattern = /https?:\\?\/\\?\/[^"'\s\\]+\.mp4[^"'\s\\]*/gi;
  var match = mp4Pattern.exec(html);
  while (match) {
    var candidate = match[0].replace(/\\\//g, "/");
    if (!/(?:trailer|preview|teaser|thumb|hover)/i.test(candidate)) push(candidate, "mp4");
    match = mp4Pattern.exec(html);
  }

  return candidates;
}

function embedUrl(html) {
  var match = html.match(/https?:\/\/(?:[a-z0-9-]+\.)*cosxplay\.com\/embed\/[0-9]+/i);
  return match ? match[0] : "";
}

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
  var embed = embedUrl(html);

  // Prefer the site's own player because page metadata may expose only a
  // short preview clip instead of the complete video.
  if (embed && !isDownload) {
    streams.push({
      server: BRAND + "-Embed",
      link: embed,
      type: "webview",
      tag: "Full video player",
    });
  }

  for (var i = 0; i < candidates.length; i++) {
    var candidate = candidates[i];
    if (candidate.type === "m3u8" && !includeHls) continue;
    if (seenLinks[candidate.link]) continue;
    seenLinks[candidate.link] = true;

    var quality = candidate.height ? String(candidate.height) : undefined;
    if (quality && allowedList.length && allowedList.indexOf(quality) === -1) continue;

    var stream = {
      server: candidate.type === "m3u8" ? BRAND + "-HLS" : BRAND,
      link: candidate.link,
      type: candidate.type,
    };
    if (quality) stream.quality = quality;
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
        server: BRAND + "-Web",
        link: pageUrl || absUrl(baseUrl, pageUrl),
        type: "webview",
        tag: "Open in browser",
      },
    ];
  }

  return streams;
};

exports.collectCandidates = collectCandidates;
exports.getStream = getStream;
