// @vega-provider animehindidub
// @vega-version 1.0.0
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.genres = exports.catalog = void 0;
// Public browse routes. Sites may rename category slugs; the Latest catalog remains the fallback.
exports.catalog = [
    { title: "Latest", filter: "/" },
    { title: "Hindi Dubbed", filter: "/category/hindi-dub/" },
    { title: "Anime Times", filter: "/category/anime-times-hindi-dubbed/" },
    { title: "Movies", filter: "/category/anime-movie/" },
];
exports.genres = [
    { title: "Action", filter: "/category/action/" },
    { title: "Adventure", filter: "/category/adventure/" },
    { title: "Isekai", filter: "/category/isekai/" },
];
