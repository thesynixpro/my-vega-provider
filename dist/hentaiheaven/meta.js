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

// HentaiHeaven video detail scraper.
//
// Watch pages (`/watch/<slug>/`) are server-rendered by a Next.js app and carry
// Open Graph tags plus a JSON-LD `VideoObject`. Episode links on the page
// (`/watch/<slug>/episode-<n>/`) are exposed as a season. Helpers below are
// inlined from providers/hentaiheaven/common.ts at build time.

function slugFromUrl(url) {
  var match = String(url || "").match(/\/watch\/([a-z0-9-]+)(?:\/|$)/i);
  return match ? match[1].toLowerCase() : "";
}

function episodeNumber(href) {
  var match = String(href || "").match(/\/episode-(\d+)\/?$/i);
  return match ? Number(match[1]) : 0;
}

function jsonLdVideo($) {
  var blocks = $('script[type="application/ld+json"]');
  var found = null;
  blocks.each(function () {
    if (found) return;
    var raw = $(this).text();
    if (!raw) return;
    try {
      var parsed = JSON.parse(raw);
      var list = Array.isArray(parsed) ? parsed : [parsed];
      for (var i = 0; i < list.length; i++) {
        var entry = list[i];
        if (entry && entry["@type"] === "VideoObject") found = entry;
        if (entry && Array.isArray(entry["@graph"])) {
          for (var g = 0; g < entry["@graph"].length; g++) {
            var node = entry["@graph"][g];
            if (node && node["@type"] === "VideoObject") found = node;
          }
        }
      }
    } catch (e) {
      // Ignore malformed JSON-LD.
    }
  });
  return found;
}

function cleanTitle(value) {
  return normalizeTitle(value)
    .replace(/\s*[-–]\s*Hentai Haven.*$/i, "")
    .replace(/\s*\|\s*Watch free Hentai HD.*$/i, "")
    .trim();
}

function pushTag(tags, value) {
  var tag = decodeEntities(normalizeTitle(value));
  if (!tag || tag.length > 40) return;
  for (var i = 0; i < tags.length; i++) {
    if (tags[i].toLowerCase() === tag.toLowerCase()) return;
  }
  tags.push(tag);
}

function collectTags($, video) {
  var tags = [];
  if (video && typeof video.keywords === "string") {
    var parts = video.keywords.split(",");
    for (var i = 0; i < parts.length; i++) pushTag(tags, parts[i]);
  }
  $('a[href*="/series/"], a[href*="/tag/"]').each(function () {
    pushTag(tags, $(this).text());
  });
  return tags;
}

function collectCast(video) {
  var cast = [];
  if (video && video.actor) {
    var list = Array.isArray(video.actor) ? video.actor : [video.actor];
    for (var i = 0; i < list.length; i++) {
      var name = decodeEntities(normalizeTitle(list[i] && list[i].name));
      if (name && name.length < 60) cast.push(name);
    }
  }
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
  var video = jsonLdVideo($);

  var image = absUrl(
    baseUrl,
    firstNonEmpty([decodeEntities(metaContent($, "og:image")), video && video.thumbnailUrl]),
  );
  var title = cleanTitle(
    firstNonEmpty([
      decodeEntities(metaContent($, "og:title")),
      video && video.name,
      $("title").first().text(),
    ]),
  );
  if (!title) {
    throw new Error(BRAND + " getMeta could not read a title from " + pageUrl);
  }

  var durationSeconds = parseIsoDuration(video && video.duration);
  var duration = formatDuration(durationSeconds);
  var tags = collectTags($, video);
  var cast = collectCast(video);

  var seriesSlug = slugFromUrl(pageUrl);
  var episodes = [];
  var seen = {};
  $('a[href*="/episode-"]').each(function () {
    var href = String($(this).attr("href") || "").split("?")[0];
    var number = episodeNumber(href);
    if (!number) return;
    if (seriesSlug && slugFromUrl(href) !== seriesSlug) return;
    var absolute = absUrl(baseUrl, href);
    if (seen[absolute]) return;
    seen[absolute] = true;
    episodes.push({ number: number, link: absolute });
  });

  var isSeries = episodes.length >= 2;
  var parts = [];
  var description = stripTags(
    firstNonEmpty([decodeEntities(metaContent($, "og:description")), video && video.description]),
  );
  if (description) parts.push(description);
  if (duration) parts.push("Duration: " + duration);
  if (tags.length) parts.push("Tags: " + tags.slice(0, 8).join(", "));
  if (isSeries) parts.push(episodes.length + " episodes available");
  if (!parts.length) {
    parts.push(BRAND + " video. Open the source page for the full description.");
  }

  var linkList;
  if (isSeries) {
    linkList = [
      {
        title: "Episodes",
        directLinks: episodes
          .sort(function (a, b) {
            return a.number - b.number;
          })
          .map(function (episode) {
            return { title: "Episode " + episode.number, link: episode.link, type: "series", image: image };
          }),
      },
    ];
  } else {
    linkList = [
      {
        title: BRAND,
        directLinks: [{ title: "Play", link: pageUrl, type: "movie", image: image }],
      },
    ];
  }

  return {
    title: title,
    image: image,
    synopsis: parts.join(" | "),
    imdbId: "",
    type: isSeries ? "series" : "movie",
    tags: tags,
    cast: cast,
    linkList: linkList,
    webUrl: pageUrl,
  };
};

exports.slugFromUrl = slugFromUrl;
exports.getMeta = getMeta;
