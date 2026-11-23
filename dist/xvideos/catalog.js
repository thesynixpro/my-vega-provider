// @vega-provider xvideos
// @vega-version 1.0.0
"use strict";
// XVideos catalog.
//
// Filter values are public XVideos category paths (relative to
// https://www.xvideos.com). Category listings paginate as "/c/<Name-ID>/<n>"
// where n is the zero-based page index, which posts.js handles.
var catalog = [
  { title: "Amateur", filter: "/c/Amateur-65" },
  { title: "Big Tits", filter: "/c/Big_Tits-23" },
  { title: "Milf", filter: "/c/Milf-19" },
  { title: "Asian", filter: "/c/Asian_Woman-32" }
];
var genres = [
  { title: "Teen", filter: "/c/Teen-13" },
  { title: "Anal", filter: "/c/Anal-12" },
  { title: "Indian", filter: "/c/Indian-89" },
  { title: "Latina", filter: "/c/Latina-16" },
  { title: "Lesbian", filter: "/c/Lesbian-26" },
  { title: "Ebony", filter: "/c/Black_Woman-30" },
  { title: "Mature", filter: "/c/Mature-38" },
  { title: "BBW", filter: "/c/bbw-51" }
];
exports.catalog = catalog;
exports.genres = genres;
