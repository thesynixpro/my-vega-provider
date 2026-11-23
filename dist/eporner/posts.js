// @vega-provider eporner
// @vega-version 1.0.0
"use strict";
// Eporner listing scraper (search + catalog browse).
//
//   Search : https://www.eporner.com/search/<query>/[<page>/]
//   Browse : https://www.eporner.com/<cat|best-videos|top-rated>/[<page>/]
//
// Each result is a .mb box containing a thumbnail anchor and a title anchor
// (a[title]). The exact class names have varied over time, so parsing walks up
// from the title anchor to the nearest box and reads fields defensively.
//
// Helpers below are inlined from providers/eporner/common.ts at build time.
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

function boxTokens(node) {
  return String(node.attr("class") || "").split(/\s+/);
}

function isListingBox(node) {
  var tokens = boxTokens(node);
  for (var i = 0; i < tokens.length; i++) {
    if (/^(mb|mbcontent|mbimg|vth|videobox|vidbox)$/i.test(tokens[i])) return true;
  }
  return false;
}

function nearestBox($, anchor) {
  var node = anchor;
  for (var i = 0; i < 6 && node && node.length; i++) {
    if (isListingBox(node)) return node;
    node = node.parent();
  }
  return anchor.parent();
}

function qualityFromText(text) {
  var match = text.match(/\b(\d{3,4})p\b/i);
  if (!match) return "";
  return match[1];
}

function parseListing($, baseUrl) {
  var posts = [];
  var anchors = $('a[href*="/video-"]');

  anchors.each(function () {
    var anchor = $(this);
    var href = String(anchor.attr("href") || "").trim();
    if (!/\/video-[A-Za-z0-9]+/i.test(href)) return;

    var title = normalizeTitle(firstNonEmpty([anchor.attr("title"), anchor.text()]));
    if (!title) return;

    var link = absUrl(baseUrl, href);
    for (var i = 0; i < posts.length; i++) {
      if (posts[i].link === link) return;
    }

    var box = nearestBox($, anchor);
    var img = box.find("img").first();
    var image = firstNonEmpty([img.attr("data-src"), img.attr("src"), img.attr("data-original")]);

    var quality = qualityFromText(normalizeTitle(box.find(".mvp-quality").first().text()));
    if (!quality) quality = qualityFromText(normalizeTitle(box.text()));

    var post = {
      title: title,
      link: link,
      image: image ? absUrl(baseUrl, image) : "",
    };
    if (quality) post.tag = quality + "p";
    posts.push(post);
  });

  return posts;
}

function buildSearchUrl(baseUrl, query, page) {
  var safePage = clampPage(page);
  var encoded = String(query).replace(/\s+/g, "-");
  if (safePage <= 1) return baseUrl + "/search/" + encoded + "/";
  return baseUrl + "/search/" + encoded + "/" + safePage + "/";
}

function buildBrowseUrl(baseUrl, path, page) {
  var clean = String(path || "").replace(/^\/+|\/+$/g, "");
  var safePage = clampPage(page);
  if (!clean) return baseUrl + "/" + (safePage <= 1 ? "" : safePage + "/");
  if (safePage <= 1) return baseUrl + "/" + clean + "/";
  return baseUrl + "/" + clean + "/" + safePage + "/";
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
