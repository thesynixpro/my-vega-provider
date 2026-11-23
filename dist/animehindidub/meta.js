// @vega-provider animehindidub
// @vega-version 1.0.0
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMeta = void 0;
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
exports.BRAND = "AnimeHindiDub";
exports.DEFAULT_BASE_URL = "https://animehindidub.com";
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
function meta($, key) {
    return String($(`meta[property="${key}"]`).attr("content") || $(`meta[name="${key}"]`).attr("content") || "");
}
const getMeta = async function ({ link, providerContext }) {
    const base = await (0, common_1.getBase)(providerContext);
    const pageUrl = (0, common_1.absolute)(base, link);
    if (!pageUrl || !(0, common_1.sameOrigin)(base, pageUrl))
        throw new Error("Invalid " + "AnimeHindiDub" + " anime URL");
    const html = await (0, common_1.fetchHtml)(providerContext, pageUrl);
    const $ = providerContext.cheerio.load(html);
    const title = (0, common_1.cleanText)(meta($, "og:title") || $("h1").first().text() || $("title").first().text());
    const image = (0, common_1.absolute)(base, meta($, "og:image") || $("article img, .poster img, .cover img").first().attr("src") || "");
    const synopsis = (0, common_1.cleanText)(meta($, "og:description") || $("meta[name='description']").attr("content") || $(".entry-content, .description, .synopsis").first().text());
    const episodes = [];
    const seen = {};
    $("a[href]").each(function () {
        const a = $(this);
        const href = (0, common_1.absolute)(base, a.attr("href"));
        const label = (0, common_1.cleanText)(a.attr("title") || a.text());
        if (!href || !(0, common_1.sameOrigin)(base, href) || href === pageUrl || seen[href])
            return;
        if (!/(episode|ep\.?\s*\d+|watch|part\s*\d+)/i.test(label + " " + href))
            return;
        seen[href] = true;
        episodes.push({ title: label || "Open episode", link: href, image: (0, common_1.absolute)(base, a.find("img").attr("src") || image) });
    });
    return {
        title: title || "Anime",
        image,
        synopsis: synopsis || "Open the original source page for anime information and episode availability.",
        imdbId: "",
        type: episodes.length ? "series" : "movie",
        tags: [],
        cast: [],
        linkList: episodes.length ? [{ title: "Episodes", directLinks: episodes.slice(0, 100).map(ep => ({ title: ep.title, link: ep.link, type: "series", image: ep.image })) }] : [{ title: "Source", directLinks: [{ title: "Open source page", link: pageUrl, type: "movie", image }] }],
        webUrl: pageUrl,
    };
};
exports.getMeta = getMeta;
