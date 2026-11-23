// @vega-provider hentaiheaven
// @vega-version 1.0.0
"use strict";
var DEFAULT_BASE_URL = "https://hentaihaven.xxx";

var DEFAULT_TIMEOUT_SECS = 20;

var DEFAULT_RETRIES = 2;

var BRAND = "HentaiHeaven";

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

// HentaiHeaven listing scraper (search + catalog browse).
//
//   Browse : https://hentaihaven.xxx/<filter>[/page/<n>/]
//   Search : the on-site search page resolves client-side, so the WordPress
//            content API is used instead:
//            GET https://cms.hentaihaven.xxx/wp-json/wp/v2/wp-manga
//                ?search=<q>&page=<n>&per_page=24&_fields=id,slug,link,title,meta
//
// Helpers below are inlined from providers/hentaiheaven/common.ts at build time.

var CMS_BASE_URL = "https://cms.hentaihaven.xxx";
var IMAGE_BASE_URL = "https://img.hentaihaven.xxx";
var PER_PAGE = 24;

function cardTitle($, anchor) {
  return decodeEntities(
    normalizeTitle(
      firstNonEmpty([
        anchor.find("img").first().attr("alt"),
        anchor.attr("aria-label"),
        anchor.attr("title"),
        anchor.find("h3").first().text(),
        anchor.text(),
      ]),
    ),
  );
}

function cardImage(anchor) {
  var img = anchor.find("img").first();
  return firstNonEmpty([img.attr("src"), img.attr("data-src"), img.attr("data-lazy-src")]);
}

function isWatchHref(href) {
  return /^\/(?:[a-z]{2}\/)?watch\/[a-z0-9-]+\/?$/i.test(href) || /\/watch\/[a-z0-9-]+\/?$/i.test(href);
}

function parseListing($, baseUrl) {
  var posts = [];
  $('a[href*="/watch/"]').each(function () {
    var anchor = $(this);
    var href = String(anchor.attr("href") || "").trim();
    if (!isWatchHref(href)) return;
    if (/\/episode-\d+\/?$/i.test(href)) return;

    var title = cardTitle($, anchor);
    if (!title) return;

    var link = absUrl(baseUrl, href.split("?")[0]);
    var image = cardImage(anchor);
    posts.push({ title: title, link: link, image: image ? absUrl(baseUrl, image) : "" });
  });
  return dedupePosts(posts);
}

function imageFromCmsMeta(meta) {
  if (!meta || typeof meta !== "object") return "";
  var rel = normalizeTitle(meta.vraven_remote_thumbnail);
  if (!rel) return "";
  return IMAGE_BASE_URL + "/" + rel.replace(/^\/+/, "");
}

function parseCmsResults(payload, baseUrl) {
  var items = Array.isArray(payload) ? payload : [];
  var posts = [];
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    if (!item || !item.slug) continue;
    var title = decodeEntities(normalizeTitle(item.title && (item.title.rendered || item.title)));
    if (!title) continue;
    posts.push({
      title: title,
      link: baseUrl + "/watch/" + normalizeTitle(item.slug) + "/",
      image: imageFromCmsMeta(item.meta),
    });
  }
  return dedupePosts(posts);
}

function buildBrowseUrl(baseUrl, filter, page) {
  var clean = String(filter || "").trim();
  var path = clean ? (clean.charAt(0) === "/" ? clean : "/" + clean) : "/watch/";
  var safePage = clampPage(page);
  if (safePage <= 1) return baseUrl + path;
  var split = path.split("?");
  var withPage = split[0].replace(/\/+$/, "") + "/page/" + safePage + "/";
  return baseUrl + withPage + (split[1] ? "?" + split[1] : "");
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
  var url =
    CMS_BASE_URL +
    "/wp-json/wp/v2/wp-manga?search=" +
    encodeURIComponent(query) +
    "&page=" +
    clampPage(page) +
    "&per_page=" +
    PER_PAGE +
    "&_fields=id,slug,link,title,meta";

  var payload = await requestJson(providerContext, url, {
    timeoutMs: context.timeoutMs,
    retries: context.retries,
    signal: signal,
    headers: JSON_HEADERS,
  });
  return parseCmsResults(payload, context.baseUrl);
};

exports.parseListing = parseListing;
exports.parseCmsResults = parseCmsResults;
exports.getPosts = getPosts;
exports.getSearchPosts = getSearchPosts;
