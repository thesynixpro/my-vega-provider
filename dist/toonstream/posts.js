// @vega-provider toonstream
// @vega-version 1.0.0
"use strict";
var item = { title: "Open ToonStream website", link: "https://toonstream.us/home", image: "https://www.google.com/s2/favicons?domain=toonstream.us&sz=128", tag: "External website" };
exports.getPosts = async function() { return [item]; };
exports.getSearchPosts = async function(args) { return /toonstream|anime|cartoon|movie|dub/i.test(String(args.searchQuery || "")) ? [item] : []; };
