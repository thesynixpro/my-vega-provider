// @vega-provider pornhub
// @vega-version 1.0.0
"use strict";
var DEFAULT_BASE_URL = "https://www.pornhub.com";

var DEFAULT_TIMEOUT_SECS = 20;

var DEFAULT_RETRIES = 2;

var BRAND = "Pornhub";

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

function metaContent($, property) {
  var node = $('meta[property="' + property + '"]').first();
  if (node.attr("content")) return String(node.attr("content"));
  var named = $('meta[name="' + property + '"]').first();
  return named.attr("content") ? String(named.attr("content")) : "";
}

// Pornhub playback resolver.
//
// The detail page exposes a signed progressive MP4 through `og:video` (and
// `og:video:secure_url`) plus the embed page URL in `og:video:url`; the JSON-LD
// `VideoObject.contentUrl` mirrors the MP4. The signature is time limited, so
// this function always re-fetches the page. Helpers below are inlined from
// providers/pornhub/common.ts at build time.

function scoreHeightFromUrl(url) {
  var named = url.match(/(\d{3,4})[pP][_.-]/) || url.match(/(\d{3,4})P_/);
  if (named) return Number(named[1]);
  var bare = url.match(/(\d{3,4})p\b/);
  return bare ? Number(bare[1]) : 0;
}

function collectCandidates(html, $) {
  var candidates = [];
  var seen = {};

  var push = function (value, type) {
    var clean = normalizeTitle(decodeEntities(value));
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

  var blocks = $('script[type="application/ld+json"]');
  blocks.each(function () {
    var raw = $(this).text();
    if (!raw || raw.indexOf("VideoObject") === -1) return;
    try {
      var parsed = JSON.parse(raw);
      var list = Array.isArray(parsed) ? parsed : [parsed];
      for (var i = 0; i < list.length; i++) {
        var entry = list[i];
        if (entry && entry["@type"] === "VideoObject" && entry.contentUrl) push(entry.contentUrl, "mp4");
        if (entry && Array.isArray(entry["@graph"])) {
          for (var g = 0; g < entry["@graph"].length; g++) {
            var node = entry["@graph"][g];
            if (node && node["@type"] === "VideoObject" && node.contentUrl) push(node.contentUrl, "mp4");
          }
        }
      }
    } catch (e) {
      // Ignore malformed JSON-LD.
    }
  });

  var mp4Pattern = /https?:\\?\/\\?\/[^"'\s\\]+\.mp4[^"'\s\\]*/gi;
  var match = mp4Pattern.exec(html);
  while (match) {
    push(match[0].replace(/\\\//g, "/"), "mp4");
    match = mp4Pattern.exec(html);
  }

  return candidates;
}

function embedUrl(html) {
  var match = html.match(/https?:\/\/(?:www\.|m\.)?pornhub\.com\/embed\/[A-Za-z0-9]+/i);
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

  var $ = providerContext.cheerio.load(html);
  var candidates = collectCandidates(html, $);
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

  var embed = embedUrl(html);
  if (embed && !isDownload) {
    streams.push({ server: BRAND + "-Embed", link: embed, type: "webview", tag: "Embed" });
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

exports.collectCandidates = collectCandidates;
exports.getStream = getStream;
