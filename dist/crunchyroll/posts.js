// @vega-provider crunchyroll
// @vega-version 1.0.0
"use strict";
var item = { title: "Open Crunchyroll – official anime streaming", link: "https://www.crunchyroll.com/", image: "https://www.google.com/s2/favicons?domain=crunchyroll.com&sz=128", tag: "Official service" };
exports.getPosts = async function() { return [item]; };
exports.getSearchPosts = async function(args) { return /crunchyroll|anime|dub/i.test(String(args.searchQuery || "")) ? [item] : []; };
