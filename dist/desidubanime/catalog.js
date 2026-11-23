// @vega-provider desidubanime
// @vega-version 1.0.0
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.genres = exports.catalog = void 0;
// Public browse routes. Sites may rename category slugs; the Latest catalog remains the fallback.
exports.catalog = [
    { title: "Latest", filter: "/" },
    { title: "All Anime", filter: "/anime/" },
    { title: "Hindi Dub", filter: "/anime_attribute/hindi-dub/" },
    { title: "Latest Episodes", filter: "/" },
];
exports.genres = [
    { title: "Action", filter: "/genre/action/" },
    { title: "Adventure", filter: "/genre/adventure/" },
    { title: "Fantasy", filter: "/genre/fantasy/" },
    { title: "Romance", filter: "/genre/romance/" },
];
