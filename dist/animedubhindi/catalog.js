// @vega-provider animedubhindi
// @vega-version 1.0.0
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.genres = exports.catalog = void 0;
// Public browse routes. Sites may rename category slugs; the Latest catalog remains the fallback.
exports.catalog = [
    { title: "Latest", filter: "/" },
    { title: "Anime", filter: "/category/anime/" },
    { title: "Hindi Dubbed", filter: "/category/hindi-dubbed/" },
    { title: "Movies", filter: "/category/anime-movies/" },
];
exports.genres = [
    { title: "Action", filter: "/genre/action/" },
    { title: "Adventure", filter: "/genre/adventure/" },
    { title: "Fantasy", filter: "/genre/fantasy/" },
];
