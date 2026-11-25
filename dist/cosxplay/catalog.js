// @vega-provider cosxplay
// @vega-version 1.0.1
"use strict";
// CosXplay catalog.
//
// Filter values are public cosxplay.com paths. The front page (`""`) lists the
// latest uploads; tag listings use `/tag/<id>-<slug>`. posts.ts handles the
// `/page/<n>/` suffix.
var catalog = [
  { title: "Latest", filter: "" },
  { title: "Cosplay", filter: "/tag/31-cosplay" },
  { title: "FemBoy", filter: "/tag/19514-femboy" },
  { title: "Hentai", filter: "/tag/19888-hentai" },
];

var genres = [
  { title: "2B", filter: "/tag/19987-2b" },
  { title: "Naruto", filter: "/tag/4-naruto" },
  { title: "Genshin", filter: "/tag/20960-genshin" },
  { title: "Anal", filter: "/tag/2-anal" },
  { title: "Anime", filter: "/tag/6-anime" },
  { title: "Maid", filter: "/tag/163-maid" },
  { title: "Lesbian", filter: "/tag/16-lesbian" },
  { title: "Cosplay Girls", filter: "/category/cosplay-girls" },
];
exports.catalog = catalog;
exports.genres = genres;
