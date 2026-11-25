// @vega-provider cinefreak
// @vega-version 1.0.0
"use strict";
var item = { title: "Open CineFreak website", link: "https://cinefreak.net/", image: "https://www.google.com/s2/favicons?domain=cinefreak.net&sz=128", tag: "External website" };
exports.getPosts = async function() { return [item]; };
exports.getSearchPosts = async function(args) { return /cinefreak|anime|cartoon|movie|dub/i.test(String(args.searchQuery || "")) ? [item] : []; };
