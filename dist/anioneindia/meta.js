// @vega-provider anioneindia
// @vega-version 1.0.0
"use strict";

var CHANNEL_NAME = "Ani-One India";
var CHANNEL_URL = "https://www.youtube.com/@AniOneIN";
exports.getMeta = async function(args) {
 var link = String(args.link || ""); var m = link.match(/[?&]v=([A-Za-z0-9_-]{6,})|youtu\.be\/([A-Za-z0-9_-]{6,})/); var id = m ? (m[1] || m[2]) : "";
 var safeLink = id ? "https://www.youtube.com/watch?v=" + id : CHANNEL_URL;
 var image = id ? "https://i.ytimg.com/vi/" + id + "/hqdefault.jpg" : "https://www.google.com/s2/favicons?domain=youtube.com&sz=128";
 return { title: id ? "Official anime video – " + CHANNEL_NAME : CHANNEL_NAME, image: image, synopsis: "Official upload from " + CHANNEL_NAME + ". Availability and language tracks depend on the publisher and your region.", imdbId: "", type: "movie", tags: ["Anime","Official","YouTube"], cast: [], linkList: [{ title: CHANNEL_NAME, directLinks: [{ title: "Watch on YouTube", link: safeLink, type: "movie", image: image }] }], webUrl: safeLink };
};
