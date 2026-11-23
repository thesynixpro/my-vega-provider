// @vega-provider xvideos
// @vega-version 1.0.0
"use strict";
// XVideos video detail scraper.
//
// The page exposes Open Graph tags (og:title, og:image, og:duration in seconds)
// and a div.video-metadata.video-tags-list block with tags and the uploader.
// Playback resolution lives in stream.js.
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

function parseDurationSeconds(raw) {
  var text = String(raw == null ? "" : raw).trim();
  var direct = Number(text);
  if (Number.isFinite(direct) && direct > 0) return Math.round(direct);

  var clock = text.match(/(\d+):(\d{2})(?::(\d{2}))?/);
  if (clock) {
    var parts = clock[0].split(":").map(function (value) {
      return Number(value);
    });
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return parts[0] * 60 + parts[1];
  }

  var hours = text.match(/(\d+)\s*h/i);
  var minutes = text.match(/(\d+)\s*min/i);
  if (hours || minutes) {
    return (hours ? Number(hours[1]) : 0) * 3600 + (minutes ? Number(minutes[1]) : 0) * 60;
  }
  return 0;
}

function formatDuration(seconds) {
  if (!seconds) return "";
  var hours = Math.floor(seconds / 3600);
  var minutes = Math.floor((seconds % 3600) / 60);
  var secs = seconds % 60;
  if (hours) return hours + "h " + String(minutes).padStart(2, "0") + "m";
  return minutes + "m " + String(secs).padStart(2, "0") + "s";
}

function metaContent($, property) {
  var node = $('meta[property="' + property + '"]').first();
  if (node.attr("content")) return String(node.attr("content"));
  var named = $('meta[name="' + property + '"]').first();
  return named.attr("content") ? String(named.attr("content")) : "";
}

function collectTags($) {
  var tags = [];
  var links = $('.video-tags-list a[href*="/c/"], .video-metadata a[href*="/c/"]');
  links.each(function () {
    var tag = normalizeTitle($(this).text());
    if (tag && tag.length < 40) {
      for (var i = 0; i < tags.length; i++) {
        if (tags[i].toLowerCase() === tag.toLowerCase()) return;
      }
      tags.push(tag);
    }
  });
  return tags;
}

function collectCast($) {
  var cast = [];
  var uploader = firstNonEmpty([
    normalizeTitle($(".video-metadata .name").first().text()),
    normalizeTitle($(".main-uploader .name").first().text()),
    normalizeTitle($('a[href^="/channels/"], a[href^="/pornstars/"], a[href^="/profiles/"]').first().text()),
  ]);
  if (uploader && uploader.length < 60) cast.push(uploader);
  return cast;
}

function synopsisFrom($, tags, duration) {
  var jsonLd = $('script[type="application/ld+json"]').first().text();
  if (jsonLd) {
    try {
      var parsed = JSON.parse(jsonLd);
      var description = normalizeTitle(parsed && parsed.description);
      if (description) return description;
    } catch (e) {
      // Ignore malformed JSON-LD.
    }
  }

  var parts = [];
  if (tags.length) parts.push("Tags: " + tags.slice(0, 8).join(", "));
  if (duration) parts.push("Duration: " + duration);
  if (!parts.length) parts.push("XVideos video. Open the source page for full details.");
  return parts.join(" | ");
}

var getMeta = async function ({ link, providerContext }) {
  var cheerio = providerContext.cheerio;
  var pageUrl = String(link || "").trim();
  if (!/^https?:\/\//i.test(pageUrl)) {
    throw new Error("XVideos getMeta requires an absolute video URL, received: " + pageUrl);
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
  var image = absUrl(baseUrl, metaContent($, "og:image"));
  var title = normalizeTitle(
    firstNonEmpty([
      metaContent($, "og:title"),
      $("h2.page-title").first().text(),
      $("title").first().text(),
    ]),
  );
  if (!title) {
    throw new Error("XVideos getMeta could not read a title from " + pageUrl);
  }

  var durationSeconds = parseDurationSeconds(metaContent($, "og:duration"));
  var duration = formatDuration(durationSeconds);
  var tags = collectTags($);
  var cast = collectCast($);

  return {
    title: title.replace(/\s*-\s*XVIDEOS\.COM.*$/i, "").trim(),
    image: image,
    synopsis: synopsisFrom($, tags, duration),
    imdbId: "",
    type: "movie",
    tags: tags,
    cast: cast,
    linkList: [
      {
        title: "XVideos",
        directLinks: [
          {
            title: "Play",
            link: pageUrl,
            type: "movie",
            image: image,
          },
        ],
      },
    ],
    webUrl: pageUrl,
  };
};

exports.getMeta = getMeta;
