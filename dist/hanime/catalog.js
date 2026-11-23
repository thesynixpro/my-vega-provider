// @vega-provider hanime
// @vega-version 1.0.0
"use strict";
// Hanime catalog.
//
// Filter values are public hanime.tv browse/tag paths. `posts.ts` appends the
// `?page=<n>` query (or `&page=<n>` when a filter already carries a query).
var catalog = [
  { title: "Trending", filter: "/browse/trending" },
  { title: "Trending (Daily)", filter: "/browse/trending?timespan=daily" },
  { title: "Trending (Weekly)", filter: "/browse/trending?timespan=weekly" },
  { title: "Trending (Yearly)", filter: "/browse/trending?timespan=yearly" },
  { title: "Random", filter: "/browse/random" },
];

var genres = [
  { title: "Anal", filter: "/browse/tags/anal" },
  { title: "Creampie", filter: "/browse/tags/creampie" },
  { title: "Futanari", filter: "/browse/tags/futanari" },
  { title: "Incest", filter: "/browse/tags/incest" },
  { title: "Milf", filter: "/browse/tags/milf" },
  { title: "School Girl", filter: "/browse/tags/school%20girl" },
  { title: "Yuri", filter: "/browse/tags/yuri" },
  { title: "Same-Sex", filter: "/browse/tags/yaoi" },
];
exports.catalog = catalog;
exports.genres = genres;
