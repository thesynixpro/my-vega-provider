// @vega-provider pornhub
// @vega-version 1.0.1
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

var JSON_HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept-Language": "en-US,en;q=0.9",
  Accept: "application/json, text/plain, */*",
};

function clampPage(page) {
  var value = Math.floor(Number(page));
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function resolveBaseUrl(override) {
  if (typeof override === "string" && /^https?:\/\//i.test(override.trim())) {
    return override.trim().replace(/\/+$/, "");
  }
  return DEFAULT_BASE_URL;
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

function dedupePosts(posts) {
  var seen = {};
  var out = [];
  for (var i = 0; i < posts.length; i++) {
    var link = posts[i].link;
    if (!link || seen[link]) continue;
    seen[link] = true;
    out.push(posts[i]);
  }
  return out;
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

async function requestJson(providerContext, url, options) {
  options = options || {};
  var merged = {};
  for (var key in options) merged[key] = options[key];
  merged.responseType = "json";
  merged.headers = options.headers || JSON_HEADERS;
  return request(providerContext, url, merged);
}

function parseDurationSeconds(value) {
  var text = normalizeTitle(value);
  if (!text) return 0;
  var clock = text.match(/(\d{1,3}):(\d{2})(?::(\d{2}))?/);
  if (clock) {
    var parts = clock[0].split(":").map(function (part) {
      return Number(part);
    });
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return parts[0] * 60 + parts[1];
  }
  var hours = text.match(/(\d+)\s*h(?:our|r)?\b/i);
  var minutes = text.match(/(\d+)\s*mi?n(?:ute)?\b/i);
  var secs = text.match(/(\d+)\s*s(?:ec|econd)?\b/i);
  if (hours || minutes || secs) {
    return (
      (hours ? Number(hours[1]) : 0) * 3600 +
      (minutes ? Number(minutes[1]) : 0) * 60 +
      (secs ? Number(secs[1]) : 0)
    );
  }
  var direct = Number(text);
  return Number.isFinite(direct) && direct > 0 ? Math.round(direct) : 0;
}

function durationLabel(seconds) {
  if (!seconds) return "";
  if (seconds >= 3600) return Math.round((seconds / 3600) * 10) / 10 + " h";
  return Math.max(1, Math.round(seconds / 60)) + " min";
}

// Pornhub listing scraper (search + catalog browse).
//
// Pornhub's video grid is rendered client-side, so listing/search data comes
// from the public webmasters JSON API instead of the HTML:
//
//   GET /webmasters/search?search=<q>&page=<n>&thumbsize=large
//   GET /webmasters/search?ordering=<mostviewed|newest|rating>&page=<n>
//   GET /webmasters/search?category=<slug>&page=<n>
//
// Helpers below are inlined from providers/pornhub/common.ts at build time.

function parseListing(payload, baseUrl) {
  baseUrl = baseUrl || DEFAULT_BASE_URL;
  var videos = [];
  if (Array.isArray(payload)) videos = payload;
  else if (payload && Array.isArray(payload.videos)) videos = payload.videos;
  else if (payload && payload.data && Array.isArray(payload.data.videos)) videos = payload.data.videos;
  else if (payload && payload.response && Array.isArray(payload.response.videos)) videos = payload.response.videos;
  else if (payload && payload.data && Array.isArray(payload.data)) videos = payload.data;

  var posts = [];
  for (var i = 0; i < videos.length; i++) {
    var video = videos[i];
    if (!video) continue;
    var title = decodeEntities(normalizeTitle(video.title || video.video_title || video.name || video.alt));
    var rawLink = normalizeTitle(video.url || video.video_url || video.link || video.videoUrl ||
      (video.viewkey ? "/view_video.php?viewkey=" + video.viewkey : ""));
    if (!title || !rawLink) continue;
    var link = /^https?:\/\//i.test(rawLink) ? rawLink :
      rawLink.indexOf("//") === 0 ? "https:" + rawLink :
      baseUrl + (rawLink.charAt(0) === "/" ? rawLink : "/" + rawLink);
    var thumb = normalizeTitle(video.default_thumb || video.thumb || video.thumbnail || video.image || video.preview);
    var image = thumb ? (/^https?:\/\//i.test(thumb) ? thumb :
      thumb.indexOf("//") === 0 ? "https:" + thumb :
      baseUrl + (thumb.charAt(0) === "/" ? thumb : "/" + thumb)) : "";
    var post = { title: title, link: link, image: image };
    var label = durationLabel(parseDurationSeconds(video.duration || video.length || video.video_duration));
    if (label) post.tag = label;
    posts.push(post);
  }
  return dedupePosts(posts);
}

function parseHtmlListing($, baseUrl) {
  var posts = [];
  var anchors = $('a[href*="/view_video.php?viewkey="], a[href*="/video?viewkey="]');
  anchors.each(function () {
    var anchor = $(this);
    var href = normalizeTitle(anchor.attr("href"));
    if (!href) return;
    var card = anchor.closest("li, .pcVideoListItem, .videoBox, .thumbnail, .wrap");
    var scope = card && card.length ? card : anchor;
    var img = scope.find("img").first();
    var title = decodeEntities(normalizeTitle(anchor.attr("title") || img.attr("alt") ||
      scope.find("[title]").first().attr("title") || anchor.text()));
    if (!title) return;
    var rawImage = normalizeTitle(img.attr("data-src") || img.attr("data-thumb_url") || img.attr("src"));
    var link = /^https?:\/\//i.test(href) ? href : baseUrl + (href.charAt(0) === "/" ? href : "/" + href);
    var image = rawImage ? (/^https?:\/\//i.test(rawImage) ? rawImage :
      rawImage.indexOf("//") === 0 ? "https:" + rawImage :
      baseUrl + (rawImage.charAt(0) === "/" ? rawImage : "/" + rawImage)) : "";
    var post = { title: title, link: link, image: image };
    var duration = normalizeTitle(scope.find(".duration, .videoDuration, [class*='duration']").first().text());
    if (duration) post.tag = duration;
    posts.push(post);
  });
  return dedupePosts(posts);
}

function appendFilter(filter, params) {
  var clean = String(filter || "").trim();
  var separator = clean.indexOf(":");
  if (separator > 0) {
    var key = clean.slice(0, separator).trim().toLowerCase();
    var value = clean.slice(separator + 1).trim();
    if (
      value &&
      (key === "ordering" || key === "category" || key === "search" || key === "tags")
    ) {
      params.push(key + "=" + encodeURIComponent(value).replace(/%20/g, "+"));
      return;
    }
  }
  params.push("ordering=mostviewed");
}

async function readContext(providerContext) {
  var override = await providerContext.kvStore.get("baseUrlOverride");
  var timeoutSecs = await readNumberSetting(providerContext, "requestTimeoutSecs", DEFAULT_TIMEOUT_SECS);
  var retries = await readNumberSetting(providerContext, "retryAttempts", DEFAULT_RETRIES);
  return {
    baseUrl: resolveBaseUrl(override),
    timeoutMs: Math.round(timeoutSecs) * 1000,
    retries: Math.round(retries),
  };
}

var getPosts = async function ({ filter, page, providerValue, signal, providerContext }) {
  var context = await readContext(providerContext);
  var params = ["thumbsize=large", "page=" + clampPage(page)];
  appendFilter(filter, params);

  var url = context.baseUrl + "/webmasters/search?" + params.join("&");
  try {
    var payload = await requestJson(providerContext, url, {
      timeoutMs: context.timeoutMs,
      retries: context.retries,
      signal: signal,
      headers: JSON_HEADERS,
    });
    var parsed = parseListing(payload, context.baseUrl);
    if (parsed.length) return parsed;
  } catch (error) {
    // Continue with the public HTML listing when the JSON endpoint is blocked.
  }
  var html = await requestHtml(providerContext, context.baseUrl + "/video", {
    timeoutMs: context.timeoutMs,
    retries: context.retries,
    signal: signal,
    headers: HTML_HEADERS,
  });
  return parseHtmlListing(providerContext.cheerio.load(html), context.baseUrl);
};

var getSearchPosts = async function ({ searchQuery, page, providerValue, signal, providerContext }) {
  var query = normalizeTitle(searchQuery);
  if (!query) return [];

  var context = await readContext(providerContext);
  var params = [
    "thumbsize=large",
    "page=" + clampPage(page),
    "search=" + encodeURIComponent(query).replace(/%20/g, "+"),
  ];

  var url = context.baseUrl + "/webmasters/search?" + params.join("&");
  try {
    var payload = await requestJson(providerContext, url, {
      timeoutMs: context.timeoutMs,
      retries: context.retries,
      signal: signal,
      headers: JSON_HEADERS,
    });
    var parsed = parseListing(payload, context.baseUrl);
    if (parsed.length) return parsed;
  } catch (error) {
    // Continue with the public HTML search when the JSON endpoint is blocked.
  }
  var htmlUrl = context.baseUrl + "/video/search?search=" +
    encodeURIComponent(query).replace(/%20/g, "+");
  var html = await requestHtml(providerContext, htmlUrl, {
    timeoutMs: context.timeoutMs,
    retries: context.retries,
    signal: signal,
    headers: HTML_HEADERS,
  });
  return parseHtmlListing(providerContext.cheerio.load(html), context.baseUrl);
};

exports.parseListing = parseListing;
exports.getPosts = getPosts;
exports.getSearchPosts = getSearchPosts;
