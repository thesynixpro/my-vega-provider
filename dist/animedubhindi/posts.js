// @vega-provider animedubhindi
// @vega-version 1.0.0
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSearchPosts = exports.getPosts = void 0;
exports.parseListing = parseListing;
const common_1 = (() => { const exports = {};
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HTML_HEADERS = exports.DEFAULT_RETRIES = exports.DEFAULT_TIMEOUT_SECS = exports.DEFAULT_BASE_URL = exports.BRAND = void 0;
exports.normalize = normalize;
exports.absolute = absolute;
exports.sameOrigin = sameOrigin;
exports.pageNumber = pageNumber;
exports.cleanText = cleanText;
exports.getBase = getBase;
exports.fetchHtml = fetchHtml;
exports.BRAND = "AnimeDubHindi";
exports.DEFAULT_BASE_URL = "https://www.animedubhindi.link";
exports.DEFAULT_TIMEOUT_SECS = 25;
exports.DEFAULT_RETRIES = 2;
exports.HTML_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9,hi;q=0.8",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};
function normalize(value) {
    return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
}
function absolute(base, value) {
    const raw = normalize(value);
    if (!raw)
        return "";
    try {
        return new URL(raw, base).toString();
    }
    catch (e) {
        return "";
    }
}
function sameOrigin(base, candidate) {
    try {
        return new URL(base).origin === new URL(candidate).origin;
    }
    catch (e) {
        return false;
    }
}
function pageNumber(value) {
    const n = Math.floor(Number(value));
    return Number.isFinite(n) && n > 0 ? Math.min(n, 1000) : 1;
}
function cleanText(value) {
    return normalize(String(value == null ? "" : value).replace(/<[^>]*>/g, " "))
        .replace(/&amp;/g, "&").replace(/&nbsp;/g, " ")
        .replace(/&#8217;|&rsquo;/g, "’").replace(/&#8211;|&ndash;/g, "–")
        .replace(/&#038;/g, "&").replace(/&quot;/g, '"');
}
async function getBase(providerContext) {
    try {
        const override = await providerContext.kvStore.get("baseUrlOverride");
        if (typeof override === "string" && /^https?:\/\//i.test(override.trim()))
            return override.trim().replace(/\/+$/, "");
    }
    catch (e) { }
    return exports.DEFAULT_BASE_URL;
}
async function fetchHtml(providerContext, url, signal) {
    let last;
    for (let attempt = 0; attempt <= exports.DEFAULT_RETRIES; attempt++) {
        try {
            const response = await providerContext.axios.get(url, {
                headers: exports.HTML_HEADERS, timeout: exports.DEFAULT_TIMEOUT_SECS * 1000, signal,
            });
            if (typeof response.data !== "string" || response.data.length < 30)
                throw new Error("Empty HTML response");
            return response.data;
        }
        catch (error) {
            last = error;
            if (attempt < exports.DEFAULT_RETRIES)
                await new Promise(resolve => setTimeout(resolve, 350 * (attempt + 1)));
        }
    }
    throw new Error(exports.BRAND + " request failed: " + String(last));
}

return exports; })();
function listingUrl(base, filter, page) {
    const path = filter || "/";
    if (page <= 1)
        return (0, common_1.absolute)(base, path);
    if (path === "/" || path === "")
        return (0, common_1.absolute)(base, "/page/" + page + "/");
    return (0, common_1.absolute)(base, path.replace(/\/$/, "") + "/page/" + page + "/");
}
function parseListing($, base) {
    const results = [];
    const seen = {};
    $("article a[href], .post a[href], .bs a[href], .item a[href], .anime a[href], a[href]").each(function () {
        const a = $(this);
        const href = String(a.attr("href") || "").trim();
        if (!href || href.charAt(0) === "#" || /^(mailto:|javascript:|tel:)/i.test(href))
            return;
        const link = (0, common_1.absolute)(base, href);
        if (!link || !(0, common_1.sameOrigin)(base, link) || link === base + "/" || seen[link])
            return;
        const imageEl = a.find("img").first().length ? a.find("img").first() : a.closest("article, .post, .bs, .item, .anime").find("img").first();
        const image = (0, common_1.absolute)(base, imageEl.attr("data-src") || imageEl.attr("data-lazy-src") || imageEl.attr("src") || imageEl.attr("data-original") || "");
        const title = (0, common_1.cleanText)(a.attr("title") || imageEl.attr("alt") || a.find("h2,h3,h4,.tt,.title").first().text() || a.text());
        if (!title || title.length < 2 || title.length > 180)
            return;
        if (/^(home|watch now|watchlist|info|login|register|next|previous|view more|read more)$/i.test(title))
            return;
        // Require a poster or an anime/article-like container to avoid collecting navigation links.
        const containerClass = String(a.closest("article, .post, .bs, .item, .anime").attr("class") || "");
        if (!image && !containerClass && !/\/(anime|category|[a-z0-9-]+)\/?$/i.test(new URL(link).pathname))
            return;
        seen[link] = true;
        results.push({ title, link, image });
    });
    return results.slice(0, 60);
}
const getPosts = async function ({ filter, page, signal, providerContext }) {
    const base = await (0, common_1.getBase)(providerContext);
    const html = await (0, common_1.fetchHtml)(providerContext, listingUrl(base, filter, (0, common_1.pageNumber)(page)), signal);
    return parseListing(providerContext.cheerio.load(html), base);
};
exports.getPosts = getPosts;
const getSearchPosts = async function ({ searchQuery, page, signal, providerContext }) {
    const query = String(searchQuery || "").trim();
    if (!query)
        return [];
    const base = await (0, common_1.getBase)(providerContext);
    const url = (0, common_1.absolute)(base, "/?s=" + encodeURIComponent(query) + ((0, common_1.pageNumber)(page) > 1 ? "&paged=" + (0, common_1.pageNumber)(page) : ""));
    const html = await (0, common_1.fetchHtml)(providerContext, url, signal);
    return parseListing(providerContext.cheerio.load(html), base);
};
exports.getSearchPosts = getSearchPosts;
