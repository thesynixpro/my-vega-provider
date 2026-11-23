// @vega-provider hentaiheaven
// @vega-version 1.0.0
"use strict";
// HentaiHeaven catalog.
//
// Filter values are public hentaihaven.xxx paths (the site serves English
// pages at the root and translated pages under /es, /de, /pt, /ru).
var catalog = [
  { title: "Recently Updated", filter: "/watch/?sort=latest" },
  { title: "Trending", filter: "/browse/trending" },
  { title: "Uncensored", filter: "/series/uncensored" },
  { title: "Rule 34", filter: "/rule34" },
];

var genres = [
  { title: "Anal", filter: "/series/anal" },
  { title: "Harem", filter: "/series/harem" },
  { title: "Incest", filter: "/series/incest" },
  { title: "Milf", filter: "/series/milf" },
  { title: "Tentacle", filter: "/series/tentacle" },
  { title: "Futanari", filter: "/series/futanari" },
  { title: "Yuri", filter: "/series/yuri" },
  { title: "3D Hentai", filter: "/series/3d-hentai" },
];
exports.catalog = catalog;
exports.genres = genres;
