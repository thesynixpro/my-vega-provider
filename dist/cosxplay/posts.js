// @vega-provider cosxplay
// @vega-version 1.0.0
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

function firstNonEmpty(values) {
  for (var i = 0; i < values.length; i++) {
    var value = values[i];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
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

async function requestHtml(providerContext, url, options) {
  return request(providerContext, url, options);
}

// CosXplay listing scraper (search + catalog browse).
//
//   Browse : https://cosxplay.com/[/page/<n>/]
//            https://cosxplay.com/<tag-path>/[/page/<n>/]
//   Search : https://cosxplay.com/search/<query>/[/page/<n>/]
//
// Every result is a `.video-block` card holding `a.thumb[href]` (the video URL),
// `img.video-img` (thumbnail + alt title), `span.title`, `span.duration` and
// `span.views-number`. Helpers below are inlined from
// providers/cosxplay/common.ts at build time.

function parseListing($, baseUrl) {
  var posts = [];
  $(".video-block").each(function () {
    var card = $(this);
    var anchor = firstNonEmpty([
      String(card.find("a.thumb").first().attr("href") || ""),
      String(card.find("a.infos").first().attr("href") || ""),
    ]);
    if (!anchor || !/^https?:\/\//i.test(anchor)) return;

    var img = card.find("img.video-img").first();
    var title = decodeEntities(normalizeTitle(card.find("span.title").first().text()));
    if (!title) title = decodeEntities(normalizeTitle(img.attr("alt")));
    if (!title) title = decodeEntities(normalizeTitle(card.find("a.thumb").first().attr("aria-label")));
    if (!title) return;

    var image = firstNonEmpty([img.attr("src"), img.attr("data-src")]);
    var post = { title: title, link: absUrl(baseUrl, anchor), image: image ? absUrl(baseUrl, image) : "" };

    var duration = normalizeTitle(card.find("span.duration").first().text());
    if (duration) post.tag = decodeEntities(duration);

    posts.push(post);
  });
  return dedupePosts(posts);
}

function buildBrowseUrl(baseUrl, filter, page) {
  var clean = String(filter || "").trim().replace(/^\/+|\/+$/g, "");
  var safePage = clampPage(page);
  var base = clean ? baseUrl + "/" + clean : baseUrl;
  if (safePage <= 1) return base + "/";
  return base + "/page/" + safePage + "/";
}

function buildSearchUrl(baseUrl, query, page) {
  var safePage = clampPage(page);
  var encoded = encodeURIComponent(query).replace(/%20/g, "-");
  var base = baseUrl + "/search/" + encoded;
  if (safePage <= 1) return base + "/";
  return base + "/page/" + safePage + "/";
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
  var cheerio = providerContext.cheerio;
  var context = await readContext(providerContext);
  var url = buildBrowseUrl(context.baseUrl, filter || "", clampPage(page));

  var html = await requestHtml(providerContext, url, {
    timeoutMs: context.timeoutMs,
    retries: context.retries,
    signal: signal,
    headers: HTML_HEADERS,
  });
  return parseListing(cheerio.load(html), context.baseUrl);
};

var getSearchPosts = async function ({ searchQuery, page, providerValue, signal, providerContext }) {
  var cheerio = providerContext.cheerio;
  var query = normalizeTitle(searchQuery);
  if (!query) return [];

  var context = await readContext(providerContext);
  var url = buildSearchUrl(context.baseUrl, query, clampPage(page));

  var html = await requestHtml(providerContext, url, {
    timeoutMs: context.timeoutMs,
    retries: context.retries,
    signal: signal,
    headers: HTML_HEADERS,
  });
  return parseListing(cheerio.load(html), context.baseUrl);
};

exports.parseListing = parseListing;
exports.getPosts = getPosts;
exports.getSearchPosts = getSearchPosts;
