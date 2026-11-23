// @vega-provider animedubhindi
// @vega-version 1.0.0
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStream = void 0;
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
// The source page is opened as-is. This provider does not extract third-party file-host URLs.
const getStream = async function ({ link, providerContext, isDownload }) {
    const base = await (0, common_1.getBase)(providerContext);
    let target = "";
    try {
        target = new URL(String(link || ""), base).toString();
    }
    catch (e) {
        throw new Error(common_1.BRAND + " received an invalid page URL");
    }
    if (!(0, common_1.sameOrigin)(base, target))
        throw new Error(common_1.BRAND + " only opens pages from its configured domain");
    return [{ server: common_1.BRAND + "-Web", link: target, type: "webview", tag: isDownload ? "Open source page" : "Watch on source website" }];
};
exports.getStream = getStream;
