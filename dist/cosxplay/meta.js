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

function stripTags(value) {
  return decodeEntities(String(value == null ? "" : value).replace(/<[^>]*>/g, " "));
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

function parseIsoDuration(value) {
  var text = String(value == null ? "" : value).trim();
  if (!text) return 0;
  var match = text.match(
    /P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?/i,
  );
  if (!match) return 0;
  var total =
    Number(match[1] || 0) * 86400 +
    Number(match[2] || 0) * 3600 +
    Number(match[3] || 0) * 60 +
    Math.round(Number(match[4] || 0));
  return total > 0 ? total : 0;
}

function formatDuration(seconds) {
  if (!seconds) return "";
  var hours = Math.floor(seconds / 3600);
  var minutes = Math.floor((seconds % 3600) / 60);
  var secs = Math.floor(seconds % 60);
  if (hours) return hours + "h " + String(minutes).padStart(2, "0") + "m";
  return minutes + "m " + String(secs).padStart(2, "0") + "s";
}

function metaContent($, property) {
  var node = $('meta[property="' + property + '"]').first();
  if (node.attr("content")) return String(node.attr("content"));
  var named = $('meta[name="' + property + '"]').first();
  return named.attr("content") ? String(named.attr("content")) : "";
}

// CosXplay video detail scraper.
//
// Detail pages carry a JSON-LD `@graph` with a `VideoObject` (name,
// description, ISO-8601 duration, thumbnail, embed URL, actor list), a
// `Person` for the actor and `about[]` tags, plus standard Open Graph tags.
// Helpers below are inlined from providers/cosxplay/common.ts at build time.

function jsonLdGraph($) {
  var nodes = [];
  $('script[type="application/ld+json"]').each(function () {
    var raw = $(this).text();
    if (!raw) return;
    try {
      var parsed = JSON.parse(raw);
      var list = Array.isArray(parsed) ? parsed : [parsed];
      for (var i = 0; i < list.length; i++) {
        var entry = list[i];
        if (!entry) continue;
        if (Array.isArray(entry["@graph"])) {
          for (var g = 0; g < entry["@graph"].length; g++) nodes.push(entry["@graph"][g]);
        } else {
          nodes.push(entry);
        }
      }
    } catch (e) {
      // Ignore malformed JSON-LD.
    }
  });
  return nodes;
}

function findNode(nodes, type) {
  for (var i = 0; i < nodes.length; i++) {
    if (nodes[i] && nodes[i]["@type"] === type) return nodes[i];
  }
  return null;
}

function cleanTitle(value) {
  return normalizeTitle(value)
    .replace(/\s*\|\s*CosXplay\.com.*$/i, "")
    .trim();
}

function collectTags(nodes, video) {
  var tags = [];
  var push = function (value) {
    var tag = decodeEntities(normalizeTitle(value));
    if (!tag || tag.length > 40) return;
    for (var i = 0; i < tags.length; i++) {
      if (tags[i].toLowerCase() === tag.toLowerCase()) return;
    }
    tags.push(tag);
  };

  if (video && typeof video.keywords === "string") {
    var parts = video.keywords.split(",");
    for (var i = 0; i < parts.length; i++) push(parts[i]);
  }
  if (video && Array.isArray(video.about)) {
    for (var a = 0; a < video.about.length; a++) {
      push((video.about[a] && video.about[a].name) || "");
    }
  }
  return tags;
}

function collectCast(nodes, video) {
  var cast = [];
  var push = function (value) {
    var name = decodeEntities(normalizeTitle(value));
    if (!name || name.length > 60) return;
    for (var i = 0; i < cast.length; i++) {
      if (cast[i].toLowerCase() === name.toLowerCase()) return;
    }
    cast.push(name);
  };

  if (video && Array.isArray(video.actor)) {
    for (var i = 0; i < video.actor.length; i++) {
      push(video.actor[i] && video.actor[i].name);
    }
  }
  var person = findNode(nodes, "Person");
  if (person && person.name) push(person.name);
  return cast;
}

var getMeta = async function ({ link, providerContext }) {
  var cheerio = providerContext.cheerio;
  var pageUrl = String(link || "").trim();
  if (!/^https?:\/\//i.test(pageUrl)) {
    throw new Error(BRAND + " getMeta requires an absolute video URL, received: " + pageUrl);
  }

  var override = await providerContext.kvStore.get("baseUrlOverride");
  var baseUrl = resolveBaseUrl(override);
  var timeoutSecs = await readNumberSetting(providerContext, "requestTimeoutSecs", DEFAULT_TIMEOUT_SECS);
  var retries = await readNumberSetting(providerContext, "retryAttempts", DEFAULT_RETRIES);

  var html = await requestHtml(providerContext, pageUrl, {
    timeoutMs: Math.round(timeoutSecs) * 1000,
    retries: Math.round(retries),
    headers: HTML_HEADERS,
  });

  var $ = cheerio.load(html);
  var nodes = jsonLdGraph($);
  var video = findNode(nodes, "VideoObject");

  var thumbnail = video
    ? Array.isArray(video.thumbnailUrl)
      ? video.thumbnailUrl[0]
      : video.thumbnailUrl
    : "";
  var image = absUrl(
    baseUrl,
    firstNonEmpty([decodeEntities(metaContent($, "og:image")), thumbnail]),
  );
  var title = cleanTitle(
    firstNonEmpty([
      video && video.name,
      decodeEntities(metaContent($, "og:title")),
      $("title").first().text(),
    ]),
  );
  if (!title) {
    throw new Error(BRAND + " getMeta could not read a title from " + pageUrl);
  }

  var durationSeconds = parseIsoDuration(video && video.duration);
  var duration = formatDuration(durationSeconds);
  var tags = collectTags(nodes, video);
  var cast = collectCast(nodes, video);

  var parts = [];
  var description = stripTags(
    firstNonEmpty([
      video && video.description,
      decodeEntities(metaContent($, "description")),
      decodeEntities(metaContent($, "og:description")),
    ]),
  );
  if (description) parts.push(description);
  if (duration) parts.push("Duration: " + duration);
  if (tags.length) parts.push("Tags: " + tags.slice(0, 8).join(", "));
  if (cast.length) parts.push("Starring: " + cast.slice(0, 4).join(", "));
  if (!parts.length) {
    parts.push(BRAND + " video. Open the source page for the full description.");
  }

  return {
    title: title,
    image: image,
    synopsis: parts.join(" | "),
    imdbId: "",
    type: "movie",
    tags: tags,
    cast: cast,
    linkList: [
      {
        title: BRAND,
        directLinks: [{ title: "Play", link: pageUrl, type: "movie", image: image }],
      },
    ],
    webUrl: pageUrl,
  };
};

exports.getMeta = getMeta;
