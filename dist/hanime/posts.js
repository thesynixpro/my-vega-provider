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

async function requestJson(providerContext, url, options) {
  options = options || {};
  var merged = {};
  for (var key in options) merged[key] = options[key];
  merged.responseType = "json";
  merged.headers = options.headers || JSON_HEADERS;
  return request(providerContext, url, merged);
}

// Hanime listing scraper (search + catalog browse).
//
//   Browse : https://hanime.tv/browse/trending[/?page=<n>]
//   Tags   : https://hanime.tv/browse/tags/<tag>[?page=<n>]
//   Search : https://hanime.tv/search?q=<q> renders client-side, so the
//            searchable index is pulled from the guest API and filtered:
//            GET https://guest.freeanimehentai.net/api/v11/search_hvs
//
// Helpers below are inlined from providers/hanime/common.ts at build time.

var SEARCH_INDEX_URL = "https://guest.freeanimehentai.net/api/v11/search_hvs";
var PAGE_SIZE = 24;

function titleFromAnchor($, anchor) {
  return normalizeTitle(
    firstNonEmpty([
      anchor.find("h3").first().text(),
      anchor.find("img").first().attr("alt"),
      anchor.attr("title"),
      anchor.text(),
    ]),
  ).replace(/^Watch\s+/i, "");
}

function imageFromAnchor(anchor) {
  return firstNonEmpty([
    anchor.find("img").first().attr("src"),
    anchor.find("img").first().attr("data-src"),
    anchor.find("img").first().attr("data-lazy-src"),
  ]);
}

function parseListing($, baseUrl) {
  var posts = [];
  $('a[href*="/videos/hentai/"]').each(function () {
    var anchor = $(this);
    var href = String(anchor.attr("href") || "").trim();
    if (!/\/videos\/hentai\/[a-z0-9-]+/i.test(href)) return;

    var title = decodeEntities(titleFromAnchor($, anchor));
    if (!title) return;

    var link = absUrl(baseUrl, href.split("?")[0]);
    var image = imageFromAnchor(anchor);
    posts.push({ title: title, link: link, image: image ? absUrl(baseUrl, image) : "" });
  });
  return dedupePosts(posts);
}

function filterIndex(items, query) {
  var terms = normalizeTitle(query).toLowerCase().split(" ").filter(Boolean);
  if (!terms.length) return [];

  var scored = [];
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    if (!item || !item.slug) continue;
    var name = String(item.name || "").toLowerCase();
    var titles = String(item.search_titles || "").toLowerCase();
    var score = 0;
    var matched = true;
    for (var t = 0; t < terms.length; t++) {
      var term = terms[t];
      var inName = name.indexOf(term) !== -1;
      var inTitles = titles.indexOf(term) !== -1;
      if (!inName && !inTitles) {
        matched = false;
        break;
      }
      if (inName) score += 2;
      if (inTitles) score += 1;
    }
    if (matched) scored.push({ item: item, score: score });
  }

  scored.sort(function (a, b) {
    return b.score - a.score;
  });
  return scored.map(function (entry) {
    return entry.item;
  });
}

function indexToPosts(items, baseUrl, page) {
  var safePage = clampPage(page);
  var start = (safePage - 1) * PAGE_SIZE;
  var slice = items.slice(start, start + PAGE_SIZE);
  var posts = [];
  for (var i = 0; i < slice.length; i++) {
    var item = slice[i];
    var slug = normalizeTitle(item.slug);
    if (!slug) continue;
    var title = decodeEntities(normalizeTitle(item.name));
    if (!title) continue;
    var image = firstNonEmpty([item.cover_url, item.poster_url]);
    var post = { title: title, link: baseUrl + "/videos/hentai/" + slug, image: image ? absUrl(baseUrl, image) : "" };
    if (item.brand) post.tag = normalizeTitle(item.brand);
    posts.push(post);
  }
  return posts;
}

function buildBrowseUrl(baseUrl, filter, page) {
  var clean = String(filter || "").trim();
  var path = clean ? (clean.charAt(0) === "/" ? clean : "/" + clean) : "/browse/trending";
  var safePage = clampPage(page);
  if (safePage <= 1) return baseUrl + path;
  return baseUrl + path + (path.indexOf("?") === -1 ? "?page=" : "&page=") + safePage;
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
  var query = normalizeTitle(searchQuery);
  if (!query) return [];

  var context = await readContext(providerContext);
  var payload = await requestJson(providerContext, SEARCH_INDEX_URL, {
    timeoutMs: context.timeoutMs,
    retries: context.retries,
    signal: signal,
    headers: JSON_HEADERS,
  });

  var items = payload && Array.isArray(payload.data) ? payload.data : [];
  return indexToPosts(filterIndex(items, query), context.baseUrl, clampPage(page));
};

exports.parseListing = parseListing;
exports.filterIndex = filterIndex;
exports.getPosts = getPosts;
exports.getSearchPosts = getSearchPosts;
