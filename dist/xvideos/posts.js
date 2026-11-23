// @vega-provider xvideos
// @vega-version 1.0.0
"use strict";
// XVideos listing scraper (search + catalog browse).
//
//   Search : https://www.xvideos.com/?k=<query>&p=<page-1>
//   Browse : https://www.xvideos.com/c/<Name-ID>[/<page-1>]
//
// Each video is a div.thumb-block with the title, duration and HD badge in
// .thumb-under. div.thumb-block-profile cards are ignored.
//
// Helpers below are inlined from providers/xvideos/common.ts at build time.
var DEFAULT_BASE_URL = "https://www.xvideos.com";
var DEFAULT_TIMEOUT_SECS = 20;
var DEFAULT_RETRIES = 2;
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
  throw new Error("XVideos request failed for " + url + ": " + message);
}

function nearestBlock($, anchor) {
  var node = anchor;
  for (var i = 0; i < 6 && node && node.length; i++) {
    var className = String(node.attr("class") || "");
    if (/thumb-block|video-thumb|video-block|thumb-block-wrap/i.test(className)) {
      return node;
    }
    node = node.parent();
  }
  return anchor.parent();
}

function imageFromItem($, item) {
  var img = item.find("img").first();
  return firstNonEmpty([
    img.attr("data-sfwthumb"),
    img.attr("data-src"),
    img.attr("data-mzl"),
    img.attr("src"),
  ]);
}

function hdFromItem($, item) {
  var mark = normalizeTitle(item.find(".video-hd-mark").first().text());
  if (!mark) return "";
  var digits = mark.match(/(\d{3,4})\s*p?/i);
  return digits ? digits[1] : "";
}

function parseListing($, baseUrl) {
  var posts = [];
  var anchors = $('.thumb-under p.title a[href^="/video."]');

  anchors.each(function () {
    var anchor = $(this);
    var href = String(anchor.attr("href") || "").trim();
    if (!/^\/video\.[0-9a-z]+/i.test(href)) return;

    var item = nearestBlock($, anchor);
    var duration = normalizeTitle(item.find(".duration").first().text());
    var title = normalizeTitle(anchor.attr("title"));
    if (!title) {
      title = normalizeTitle(anchor.text());
      if (duration && title.indexOf(duration) !== -1) {
        title = normalizeTitle(title.replace(duration, ""));
      }
    }
    if (!title) return;

    var link = absUrl(baseUrl, href);
    for (var i = 0; i < posts.length; i++) {
      if (posts[i].link === link) return;
    }

    var image = imageFromItem($, item);
    var hd = hdFromItem($, item);
    var post = {
      title: title,
      link: link,
      image: image ? absUrl(baseUrl, image) : "",
    };
    if (hd) post.tag = hd + "p";
    posts.push(post);
  });

  return posts;
}

function buildSearchUrl(baseUrl, query, page) {
  var encoded = encodeURIComponent(query).replace(/%20/g, "+");
  var safePage = clampPage(page);
  if (safePage <= 1) return baseUrl + "/?k=" + encoded;
  return baseUrl + "/?k=" + encoded + "&p=" + (safePage - 1);
}

function buildBrowseUrl(baseUrl, path, page) {
  var clean = path ? "/" + String(path).replace(/^\/+|\/+$/g, "") : "";
  var safePage = clampPage(page);
  if (!clean) {
    return safePage <= 1 ? baseUrl + "/" : baseUrl + "/?p=" + (safePage - 1);
  }
  if (safePage <= 1) return baseUrl + clean;
  return baseUrl + clean + "/" + (safePage - 1);
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

exports.getPosts = getPosts;
exports.getSearchPosts = getSearchPosts;
