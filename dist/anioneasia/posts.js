// @vega-provider anioneasia
// @vega-version 1.0.0
"use strict";

var CHANNEL_NAME = "Ani-One Asia";
var CHANNEL_ID = "UC0wNSTMWIL3qaorLx0jie6A";
var CHANNEL_URL = "https://www.youtube.com/@AniOneAsia";
async function readFeed(providerContext, signal) {
  var feedUrl = "https://www.youtube.com/feeds/videos.xml?channel_id=" + encodeURIComponent(CHANNEL_ID);
  var response = await providerContext.axios.get(feedUrl, { timeout: 20000, signal: signal, headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/atom+xml,application/xml,text/xml,*/*" } });
  var xml = typeof response.data === "string" ? response.data : String(response.data || "");
  if (!xml || xml.length < 40) throw new Error(CHANNEL_NAME + " returned an empty YouTube feed");
  var $ = providerContext.cheerio.load(xml, { xmlMode: true });
  var results = [], seen = {};
  $("entry").each(function() { var entry = $(this); var id = String(entry.find("yt\\:videoId").first().text() || "").trim(); var title = String(entry.find("title").first().text() || "").replace(/\s+/g," ").trim(); if (!id || !title || seen[id]) return; seen[id] = true; var image = String(entry.find("media\\:thumbnail").first().attr("url") || "https://i.ytimg.com/vi/" + id + "/hqdefault.jpg"); results.push({ title: title, link: "https://www.youtube.com/watch?v=" + id, image: image, provider: CHANNEL_NAME }); });
  return results;
}
exports.getPosts = async function(args) { return readFeed(args.providerContext, args.signal); };
exports.getSearchPosts = async function(args) { var q = String(args.searchQuery || "").toLowerCase().trim(); if (!q) return []; return (await readFeed(args.providerContext, args.signal)).filter(function(p) { return p.title.toLowerCase().includes(q); }); };
exports.parseFeed = readFeed;
