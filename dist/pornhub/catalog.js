// @vega-provider pornhub
// @vega-version 1.0.0
"use strict";
// Pornhub catalog.
//
// Pornhub renders its video grid client-side, so listings come from the public
// webmasters JSON API. Filter values are "ordering:<x>" / "category:<slug>"
// pairs; posts.ts turns them into the matching query parameters.
var catalog = [
  { title: "Most Viewed", filter: "ordering:mostviewed" },
  { title: "Newest", filter: "ordering:newest" },
  { title: "Top Rated", filter: "ordering:rating" },
];

var genres = [
  { title: "Amateur", filter: "category:amateur" },
  { title: "Anal", filter: "category:anal" },
  { title: "Big Tits", filter: "category:big-tits" },
  { title: "Teen (18+)", filter: "category:teen" },
  { title: "MILF", filter: "category:milf" },
  { title: "Japanese", filter: "category:japanese" },
  { title: "Lesbian", filter: "category:lesbian" },
  { title: "Ebony", filter: "category:ebony" },
];
exports.catalog = catalog;
exports.genres = genres;
