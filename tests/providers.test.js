// Offline unit tests for the xnxx / xvideos / eporner / pornhub / hanime /
// hentaiheaven / cosxplay providers.
//
// These tests never touch the network: every request goes through a stubbed
// `axios.get` that replays small HTML/JSON fixtures shaped like the real pages.
// They validate the parts that are easy to regress:
//   - listing URL shapes for page 1 vs page N
//   - listing parsing (title / link / image / HD tag)
//   - stream candidate extraction, sorting and resolution filtering
//   - the Eporner page-hash -> base-36 player endpoint conversion
//   - meta extraction (title / image / duration / linkList)
//   - the dist/ contract consumed by the app (expected files + exports)
//
// Run with:  npm run test:unit
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const cheerio = require("cheerio");

const rootDir = path.join(__dirname, "..");
const distPath = (provider, module) =>
  path.join(rootDir, "dist", provider, `${module}.js`);
const loadDist = (provider, module) => require(distPath(provider, module));

// Builds a providerContext whose axios.get is fully stubbed. `handler(url)`
// returns the response body (string for HTML, object for JSON). Every requested
// URL is recorded in `calls.urls` so tests can assert the URL shape.
function makeContext(handler, settings) {
  const urls = [];
  const store = Object.assign({}, settings);
  return {
    providerContext: {
      axios: {
        get: async (url) => {
          urls.push(url);
          const data = handler(url);
          if (data === undefined) throw new Error("Unexpected request: " + url);
          return { data };
        },
      },
      cheerio,
      commonHeaders: {},
      openWebView: async () => {
        throw new Error("openWebView is not available in unit tests");
      },
      kvStore: {
        get: async (key) => store[key],
        set: async (key, value) => {
          store[key] = value;
        },
        delete: async (key) => delete store[key],
        keys: async () => Object.keys(store),
        clear: async () => {
          Object.keys(store).forEach((k) => delete store[k]);
        },
      },
    },
    calls: { urls },
  };
}

// --- fixtures -------------------------------------------------------------
// The markup below is trimmed from real listing/detail pages; only the fields
// the parsers read are kept.

const XNXX_CARD_1 =
  '<div id="video_z2fuj40" data-id="58900411" class="thumb-block  with-uploader">' +
  '<div class="thumb-inside"><div class="thumb">' +
  '<a href="/video-z2fuj40/step_sister_wants_your_seed_-_s5_e2">' +
  '<img src="https://assets-cdn77.xnxx-cdn.com/img/lightbox/lightbox-blank.gif" ' +
  'data-src="https://thumb-cdn77.xnxx-cdn.com/aaaaaaaa/0/xn_18_t.jpg" ' +
  'data-mzl="https://thumb-cdn77.xnxx-cdn.com/aaaaaaaa/0/mozaique_listing.jpg" ' +
  'data-sfwthumb="https://thumb-cdn77.xnxx-cdn.com/aaaaaaaa/0/xv_14_t.jpg" /></a>' +
  "</div></div>" +
  '<div class="thumb-under"><p><a href="/video-z2fuj40/step_sister_wants_your_seed_-_s5_e2" ' +
  'title="Step Sister Wants Your Seed">Step Sister Wants Your Seed</a></p>' +
  '<p class="metadata">36.8M<span class="superfluous">100%</span>12min' +
  '<span class="video-hd"><span class="superfluous"> - </span>720p</span></p></div></div>';

const XNXX_CARD_2 =
  '<div id="video_hqi1v6b" data-id="29789923" class="thumb-block  with-uploader">' +
  '<div class="thumb-inside"><div class="thumb">' +
  '<a href="/video-hqi1v6b/enema_pump_test_-_first_fill">' +
  '<img src="https://assets-cdn77.xnxx-cdn.com/img/lightbox/lightbox-blank.gif" ' +
  'data-sfwthumb="https://thumb-cdn77.xnxx-cdn.com/bbbbbbbb/0/xv_3_t.jpg" /></a>' +
  "</div></div>" +
  '<div class="thumb-under"><p>' +
  '<a href="/video-hqi1v6b/enema_pump_test_-_first_fill" title="Enema Pump Test - First Fill">' +
  "Enema Pump Test - First Fill</a></p>" +
  '<p class="metadata">10min<span class="video-hd-mark">1080p</span></p></div></div>';

const XNXX_LISTING =
  "<html><body><div class=\"mozaique\">" +
  XNXX_CARD_1 +
  XNXX_CARD_2 +
  "</div></body></html>";

const XNXX_DETAIL_HTML =
  "<html><head>" +
  '<meta property="og:title" content="Enema Pump Test - First Fill">' +
  '<meta property="og:image" content="https://thumb-cdn77.xnxx-cdn.com/48a60b15/0/xn_20_t.jpg">' +
  '<meta property="og:duration" content="261">' +
  "</head><body>" +
  "<script>html5player.setVideoUrlLow('https://mp4-cdn77.xnxx-cdn.com/48a60b15/0/video_240p.mp4?secure=abc,1795426000');</script>" +
  "<script>html5player.setVideoUrlHigh('https://mp4-cdn77.xnxx-cdn.com/48a60b15/0/video_360p.mp4?secure=def,1795426000');</script>" +
  "<script>html5player.setVideoHLS('https://hls-cdn77.xnxx-cdn.com/xyz==,1795426000/48a60b15/0/hls.m3u8');</script>" +
  "</body></html>";

const XV_PROFILE =
  '<div id="profile_moreno" class="thumb-block thumb-block-profile ">' +
  '<div class="thumb-inside"><div class="thumb"><a href="/moreno_do_norte_official">' +
  '<img data-sfwthumb="https://thumb-cdn77.xvideos-cdn.com/eeee/0/xv_1_t.jpg" /></a>' +
  "</div></div>" +
  '<div class="thumb-under"><p class="title">' +
  '<a href="/moreno_do_norte_official" title="Some Profile">Some Profile</a>' +
  "</p></div></div>";

const XV_CARD_HREF =
  "/video.kpoavfk9237/deutsche_frau_doktor_testet_viagra_potenzmittel_beim_patienten";

const XV_CARD =
  '<div id="video_kpoavfk9237" data-id="56994291" class="frame-block thumb-block  ">' +
  '<div class="thumb-inside"><div class="thumb">' +
  '<a href="' + XV_CARD_HREF + '">' +
  '<img src="https://assets-cdn77.xvideos-cdn.com/img/lightbox/lightbox-blank.gif" ' +
  'data-sfwthumb="https://thumb-cdn77.xvideos-cdn.com/50fae6ac/0/xv_3_t.jpg" />' +
  '<span class="top-right-tags"><span class="video-hd-mark">1080p</span></span></a>' +
  "</div></div>" +
  '<div class="thumb-under"><p class="title">' +
  '<a href="' + XV_CARD_HREF + '" ' +
  'title="Deutsche Frau Doktor testet Viagra Potenzmittel beim Patienten">' +
  "Deutsche Frau Doktor testet Viagra Potenzmittel beim Patienten " +
  '<span class="duration">29 min</span></a></p></div></div>';

const XV_LISTING =
  '<html><body><div id="content">' + XV_PROFILE + XV_CARD + "</div></body></html>";

const XV_DETAIL_HTML =
  "<html><head>" +
  '<meta property="og:title" content="Some Video Title - XVIDEOS.COM">' +
  '<meta property="og:image" content="https://thumb-cdn77.xvideos-cdn.com/50fae6ac/0/xn_20_t.jpg">' +
  '<meta property="og:duration" content="1745">' +
  "</head><body>" +
  "<script>html5player.setVideoUrlLow('https://mp4-gcore.xvideos-cdn.com/50fae6ac/0/video_240p.mp4?secure=abc,1795427546');</script>" +
  "<script>html5player.setVideoUrlHigh('https://mp4-gcore.xvideos-cdn.com/50fae6ac/0/video_360p.mp4?secure=def,1795427546');</script>" +
  "<script>html5player.setVideoHLS('https://hls-gcore.xvideos-cdn.com/ri5s==,1795427546/50fae6ac/0/hls.m3u8');</script>" +
  "</body></html>";

const EP_CARD =
  '<div class="mb">' +
  '<a href="/video-jEYmjUZVMRE/test-title/"><img ' +
  'data-src="https://static-ca-cdn.eporner.com/thumb/1.jpg" /></a>' +
  '<a href="/video-jEYmjUZVMRE/test-title/" title="Test Title">Test Title</a>' +
  '<span class="mvp-quality">1080p</span></div>';

const EP_LISTING =
  '<html><body><div id="content">' + EP_CARD + "</div></body></html>";

const EP_HASH = "0f4a07f5b0a1c2d3e4f5a6b7c8d9e0f1";
const EP_PAGE_URL = "https://www.eporner.com/video-jEYmjUZVMRE/test-title/";

const EP_DETAIL_HTML =
  "<html><head>" +
  '<meta property="og:title" content="Some Video Title - EPORNER">' +
  '<meta property="og:image" content="https://static-ca-cdn.eporner.com/thumb/1.jpg">' +
  '<meta property="og:duration" content="900">' +
  "</head><body>" +
  '<script>var hash = "' + EP_HASH + '";</script>' +
  '<a href="https://www.eporner.com/dload/jEYmjUZVMRE/480/18627724-480p.mp4">480p download</a>' +
  '<div class="padding">padding padding padding padding padding padding padding</div>' +
  "</body></html>";

const EP_SOURCES = {
  sources: {
    hls: { auto: { src: "https://cdn.eporner.com/videos/hls/master.m3u8" } },
    mp4: { "1080p": { src: "https://cdn.eporner.com/videos/1080.mp4" } },
  },
};

// Mirror of the provider's encodeBaseN, used to compute the expected hash
// independently of the implementation under test.
function encodeBase36(value) {
  const digits = "0123456789abcdefghijklmnopqrstuvwxyz";
  let n = Math.floor(Math.abs(value));
  if (n === 0) return "0";
  let out = "";
  while (n > 0) {
    out = digits.charAt(n % 36) + out;
    n = Math.floor(n / 36);
  }
  return out;
}
function expectedCalcHash(hex) {
  let out = "";
  for (let i = 0; i < 32; i += 8) {
    out += encodeBase36(parseInt(hex.substring(i, i + 8), 16));
  }
  return out;
}

// --- dist contract --------------------------------------------------------

test("dist contains the required provider modules and exports", () => {
  for (const id of ["xnxx", "xvideos", "eporner", "pornhub", "hanime", "hentaiheaven", "cosxplay"]) {
    for (const module of ["catalog", "posts", "meta", "stream", "settings"]) {
      assert.ok(
        fs.existsSync(distPath(id, module)),
        `missing dist/${id}/${module}.js`,
      );
    }
    const catalog = loadDist(id, "catalog");
    assert.ok(Array.isArray(catalog.catalog) && catalog.catalog.length > 0);
    assert.equal(typeof loadDist(id, "posts").getPosts, "function");
    assert.equal(typeof loadDist(id, "posts").getSearchPosts, "function");
    assert.equal(typeof loadDist(id, "meta").getMeta, "function");
    assert.equal(typeof loadDist(id, "stream").getStream, "function");
    assert.equal(typeof loadDist(id, "settings").getSettingsSchema, "function");
  }
  assert.ok(fs.existsSync(path.join(rootDir, "dist", "headers.js")));
});

test("built files carry the vega provider stamp", () => {
  for (const id of ["xnxx", "xvideos", "eporner", "pornhub", "hanime", "hentaiheaven", "cosxplay"]) {
    const head = fs.readFileSync(distPath(id, "posts.js"), "utf8").split("\n", 2);
    assert.equal(head[0], `// @vega-provider ${id}`);
    assert.equal(head[1], "// @vega-version 1.0.0");
  }
});

test("settings schemas expose the documented keys", async () => {
  for (const id of ["xnxx", "xvideos", "eporner", "pornhub", "hanime", "hentaiheaven", "cosxplay"]) {
    const schema = await loadDist(id, "settings").getSettingsSchema({
      providerContext: {},
    });
    const keys = schema.map((field) => field.key);
    for (const key of [
      "preferredQuality",
      "allowedResolutions",
      "includeHls",
      "baseUrlOverride",
      "requestTimeoutSecs",
      "retryAttempts",
    ]) {
      assert.ok(keys.includes(key), `${id} settings missing ${key}`);
    }
    const allowed = schema.find((f) => f.key === "allowedResolutions");
    assert.equal(allowed.type, "multiselect");
    assert.ok(Array.isArray(allowed.defaultValue));
  }
});

// --- XNXX -----------------------------------------------------------------

test("xnxx builds browse and search listing URLs with page suffix", async () => {
  const { getPosts, getSearchPosts } = loadDist("xnxx", "posts");

  const browse1 = makeContext(() => XNXX_LISTING);
  await getPosts({
    filter: "/hits",
    page: 1,
    providerValue: "xnxx",
    signal: undefined,
    providerContext: browse1.providerContext,
  });
  assert.equal(browse1.calls.urls[0], "https://www.xnxx.com/hits");

  const browse2 = makeContext(() => XNXX_LISTING);
  await getPosts({
    filter: "/hits",
    page: 3,
    providerValue: "xnxx",
    signal: undefined,
    providerContext: browse2.providerContext,
  });
  assert.equal(browse2.calls.urls[0], "https://www.xnxx.com/hits/3");

  const search1 = makeContext(() => XNXX_LISTING);
  await getSearchPosts({
    searchQuery: "test",
    page: 1,
    providerValue: "xnxx",
    signal: undefined,
    providerContext: search1.providerContext,
  });
  assert.equal(search1.calls.urls[0], "https://www.xnxx.com/search/test");

  const search2 = makeContext(() => XNXX_LISTING);
  await getSearchPosts({
    searchQuery: "test",
    page: 2,
    providerValue: "xnxx",
    signal: undefined,
    providerContext: search2.providerContext,
  });
  assert.equal(search2.calls.urls[0], "https://www.xnxx.com/search/test/2");
});

test("xnxx parses the mozaique listing and dedupes title anchors", async () => {
  const { getPosts } = loadDist("xnxx", "posts");
  const ctx = makeContext(() => XNXX_LISTING);
  const posts = await getPosts({
    filter: "/hits",
    page: 1,
    providerValue: "xnxx",
    signal: undefined,
    providerContext: ctx.providerContext,
  });

  assert.equal(posts.length, 2);
  assert.equal(posts[0].title, "Step Sister Wants Your Seed");
  assert.equal(
    posts[0].link,
    "https://www.xnxx.com/video-z2fuj40/step_sister_wants_your_seed_-_s5_e2",
  );
  assert.equal(
    posts[0].image,
    "https://thumb-cdn77.xnxx-cdn.com/aaaaaaaa/0/xv_14_t.jpg",
  );
  assert.equal(posts[0].tag, "720p");
  assert.equal(posts[1].title, "Enema Pump Test - First Fill");
  assert.equal(posts[1].tag, "1080p");
});

test("xnxx resolves player candidates and orders them by quality", async () => {
  const { getStream } = loadDist("xnxx", "stream");
  const ctx = makeContext(() => XNXX_DETAIL_HTML);
  const streams = await getStream({
    link: "https://www.xnxx.com/video-hqi1v6b/enema_pump_test_-_first_fill",
    type: "movie",
    signal: undefined,
    providerContext: ctx.providerContext,
  });

  assert.equal(streams.length, 3);
  assert.equal(streams[0].quality, "360");
  assert.equal(streams[0].type, "mp4");
  assert.equal(streams[1].quality, "240");
  assert.equal(streams[2].type, "m3u8");
  assert.equal(streams[2].server, "XNXX-HLS");
});

test("xnxx sorts lowest-first for downloads", async () => {
  const { getStream } = loadDist("xnxx", "stream");
  const ctx = makeContext(() => XNXX_DETAIL_HTML);
  const streams = await getStream({
    link: "https://www.xnxx.com/video-hqi1v6b/enema_pump_test_-_first_fill",
    type: "movie",
    signal: undefined,
    providerContext: ctx.providerContext,
    isDownload: true,
  });
  const mp4 = streams.filter((stream) => stream.type === "mp4");
  assert.equal(mp4[0].quality, "240");
});

test("xnxx falls back to a webview entry when resolutions filter all out", async () => {
  const { getStream } = loadDist("xnxx", "stream");
  const ctx = makeContext(() => XNXX_DETAIL_HTML, {
    allowedResolutions: ["720"],
    includeHls: false,
  });
  const pageUrl = "https://www.xnxx.com/video-hqi1v6b/enema_pump_test_-_first_fill";
  const streams = await getStream({
    link: pageUrl,
    type: "movie",
    signal: undefined,
    providerContext: ctx.providerContext,
  });
  assert.equal(streams.length, 1);
  assert.equal(streams[0].type, "webview");
  assert.equal(streams[0].link, pageUrl);
});

test("xnxx meta reads open graph tags and routes the page to getStream", async () => {
  const { getMeta } = loadDist("xnxx", "meta");
  const pageUrl = "https://www.xnxx.com/video-hqi1v6b/enema_pump_test_-_first_fill";
  const ctx = makeContext(() => XNXX_DETAIL_HTML);
  const info = await getMeta({ link: pageUrl, providerContext: ctx.providerContext });

  assert.equal(info.title, "Enema Pump Test - First Fill");
  assert.equal(
    info.image,
    "https://thumb-cdn77.xnxx-cdn.com/48a60b15/0/xn_20_t.jpg",
  );
  assert.equal(info.type, "movie");
  assert.equal(info.imdbId, "");
  assert.match(info.synopsis, /Duration: 4m 21s/);
  assert.equal(info.linkList.length, 1);
  assert.equal(info.linkList[0].directLinks[0].link, pageUrl);
  assert.equal(info.linkList[0].directLinks[0].type, "movie");
});

// --- XVideos --------------------------------------------------------------

test("xvideos paginates categories with page-1 and search with p", async () => {
  const { getPosts, getSearchPosts } = loadDist("xvideos", "posts");

  const browse1 = makeContext(() => XV_LISTING);
  await getPosts({
    filter: "/c/Teen-13",
    page: 1,
    providerValue: "xvideos",
    signal: undefined,
    providerContext: browse1.providerContext,
  });
  assert.equal(browse1.calls.urls[0], "https://www.xvideos.com/c/Teen-13");

  const browse2 = makeContext(() => XV_LISTING);
  await getPosts({
    filter: "/c/Teen-13",
    page: 2,
    providerValue: "xvideos",
    signal: undefined,
    providerContext: browse2.providerContext,
  });
  assert.equal(browse2.calls.urls[0], "https://www.xvideos.com/c/Teen-13/1");

  const search1 = makeContext(() => XV_LISTING);
  await getSearchPosts({
    searchQuery: "test",
    page: 1,
    providerValue: "xvideos",
    signal: undefined,
    providerContext: search1.providerContext,
  });
  assert.equal(search1.calls.urls[0], "https://www.xvideos.com/?k=test");

  const search2 = makeContext(() => XV_LISTING);
  await getSearchPosts({
    searchQuery: "test",
    page: 3,
    providerValue: "xvideos",
    signal: undefined,
    providerContext: search2.providerContext,
  });
  assert.equal(search2.calls.urls[0], "https://www.xvideos.com/?k=test&p=2");
});

test("xvideos parses video cards and ignores profile cards", async () => {
  const { getPosts } = loadDist("xvideos", "posts");
  const ctx = makeContext(() => XV_LISTING);
  const posts = await getPosts({
    filter: "/c/Amateur-65",
    page: 1,
    providerValue: "xvideos",
    signal: undefined,
    providerContext: ctx.providerContext,
  });

  assert.equal(posts.length, 1);
  assert.equal(
    posts[0].title,
    "Deutsche Frau Doktor testet Viagra Potenzmittel beim Patienten",
  );
  assert.equal(
    posts[0].link,
    "https://www.xvideos.com" + XV_CARD_HREF,
  );
  assert.equal(
    posts[0].image,
    "https://thumb-cdn77.xvideos-cdn.com/50fae6ac/0/xv_3_t.jpg",
  );
  assert.equal(posts[0].tag, "1080p");
});

test("xvideos resolves player candidates and orders by quality", async () => {
  const { getStream } = loadDist("xvideos", "stream");
  const ctx = makeContext(() => XV_DETAIL_HTML);
  const streams = await getStream({
    link: "https://www.xvideos.com/video.kpoavfk9237/some-title",
    type: "movie",
    signal: undefined,
    providerContext: ctx.providerContext,
  });

  assert.equal(streams.length, 3);
  assert.equal(streams[0].quality, "360");
  assert.equal(streams[2].server, "XVideos-HLS");
});

test("xvideos meta strips the site suffix from the title", async () => {
  const { getMeta } = loadDist("xvideos", "meta");
  const pageUrl = "https://www.xvideos.com/video.kpoavfk9237/some-title";
  const ctx = makeContext(() => XV_DETAIL_HTML);
  const info = await getMeta({ link: pageUrl, providerContext: ctx.providerContext });

  assert.equal(info.title, "Some Video Title");
  assert.match(info.synopsis, /Duration: 29m 05s/);
  assert.equal(info.linkList[0].directLinks[0].link, pageUrl);
});

// --- Eporner --------------------------------------------------------------

test("eporner builds browse and search listing URLs with trailing page/", async () => {
  const { getPosts, getSearchPosts } = loadDist("eporner", "posts");

  const browse1 = makeContext(() => EP_LISTING);
  await getPosts({
    filter: "/best-videos",
    page: 1,
    providerValue: "eporner",
    signal: undefined,
    providerContext: browse1.providerContext,
  });
  assert.equal(browse1.calls.urls[0], "https://www.eporner.com/best-videos/");

  const browse2 = makeContext(() => EP_LISTING);
  await getPosts({
    filter: "/best-videos",
    page: 2,
    providerValue: "eporner",
    signal: undefined,
    providerContext: browse2.providerContext,
  });
  assert.equal(browse2.calls.urls[0], "https://www.eporner.com/best-videos/2/");

  const search1 = makeContext(() => EP_LISTING);
  await getSearchPosts({
    searchQuery: "test",
    page: 1,
    providerValue: "eporner",
    signal: undefined,
    providerContext: search1.providerContext,
  });
  assert.equal(search1.calls.urls[0], "https://www.eporner.com/search/test/");

  const search2 = makeContext(() => EP_LISTING);
  await getSearchPosts({
    searchQuery: "test",
    page: 2,
    providerValue: "eporner",
    signal: undefined,
    providerContext: search2.providerContext,
  });
  assert.equal(search2.calls.urls[0], "https://www.eporner.com/search/test/2/");
});

test("eporner parses the .mb listing box", async () => {
  const { getPosts } = loadDist("eporner", "posts");
  const ctx = makeContext(() => EP_LISTING);
  const posts = await getPosts({
    filter: "/best-videos",
    page: 1,
    providerValue: "eporner",
    signal: undefined,
    providerContext: ctx.providerContext,
  });

  assert.equal(posts.length, 1);
  assert.equal(posts[0].title, "Test Title");
  assert.equal(posts[0].link, EP_PAGE_URL);
  assert.equal(
    posts[0].image,
    "https://static-ca-cdn.eporner.com/thumb/1.jpg",
  );
  assert.equal(posts[0].tag, "1080p");
});

test("eporner derives the base-36 hash and calls the player endpoint", async () => {
  const { getStream } = loadDist("eporner", "stream");
  const ctx = makeContext((url) =>
    url.includes("/xhr/video/") ? EP_SOURCES : EP_DETAIL_HTML,
  );
  const streams = await getStream({
    link: EP_PAGE_URL,
    type: "movie",
    signal: undefined,
    providerContext: ctx.providerContext,
  });

  const expectedHash = expectedCalcHash(EP_HASH);
  const endpoint = ctx.calls.urls.find((url) => url.includes("/xhr/video/"));
  assert.ok(endpoint, "player endpoint was not requested");
  assert.equal(
    endpoint,
    "http://www.eporner.com/xhr/video/jEYmjUZVMRE?hash=" +
      expectedHash +
      "&device=generic&domain=www.eporner.com&fallback=false",
  );

  // Highest quality first, and the HLS playlist is tagged Adaptive.
  assert.equal(streams[0].quality, "1080");
  const adaptive = streams.find((stream) => stream.type === "m3u8");
  assert.ok(adaptive, "expected an HLS stream");
  assert.equal(adaptive.tag, "Adaptive");
  // The /dload/ MP4 embedded in the page is kept as a fallback source.
  assert.ok(streams.some((stream) => stream.quality === "480"));
});

test("eporner meta strips the EPORNER suffix and routes the page to getStream", async () => {
  const { getMeta } = loadDist("eporner", "meta");
  const ctx = makeContext(() => EP_DETAIL_HTML);
  const info = await getMeta({ link: EP_PAGE_URL, providerContext: ctx.providerContext });

  assert.equal(info.title, "Some Video Title");
  assert.match(info.synopsis, /Duration: 15m 00s/);
  assert.equal(info.type, "movie");
  assert.equal(info.linkList[0].directLinks[0].link, EP_PAGE_URL);
});

// --- Pornhub --------------------------------------------------------------

const PH_PAGE_URL = "https://www.pornhub.com/view_video.php?viewkey=69bfe19ed2e60";

const PH_JSON = {
  videos: [
    {
      duration: "12:44",
      video_id: "69bfe19ed2e60",
      title: "Test &amp; Sample Video",
      url: PH_PAGE_URL,
      default_thumb: "https://ei.phncdn.com/videos/1/2/3/thumb/1.jpg",
      thumb: "https://ei.phncdn.com/videos/1/2/3/thumb/1.jpg",
      tags: [{ tag_name: "Amateur" }],
    },
    {
      duration: "1:02:03",
      video_id: "abc123",
      title: "Another Clip",
      url: "https://www.pornhub.com/view_video.php?viewkey=abc123",
      default_thumb: "https://ei.phncdn.com/videos/4/5/6/thumb/2.jpg",
    },
  ],
};

const PH_DETAIL_HTML =
  "<html><head>" +
  '<meta property="og:title" content="Test &amp; Sample Video - Pornhub.com">' +
  '<meta property="og:image" content="https://ei.phncdn.com/videos/1/2/3/thumb/1.jpg">' +
  '<meta property="og:description" content="A short description.">' +
  '<meta property="og:video" content="https://ev-h.phncdn.com/videos/1/2/3/240P_1000K_69bfe19ed2e60.mp4?a=1&amp;b=2">' +
  '<meta property="og:video:secure_url" content="https://ev-h.phncdn.com/videos/1/2/3/240P_1000K_69bfe19ed2e60.mp4?a=1&amp;b=2">' +
  '<meta property="og:video:url" content="https://www.pornhub.com/embed/69bfe19ed2e60">' +
  "</head><body>" +
  '<script type="application/ld+json">{"@type":"VideoObject","name":"Test Sample Video",' +
  '"duration":"PT00H12M44S","keywords":"amateur, test",' +
  '"contentUrl":"https://ev-h.phncdn.com/videos/1/2/3/720P_2000K_69bfe19ed2e60.mp4"}</script>' +
  '<a href="/pornstar/testmodel">Test Model</a>' +
  "</body></html>";

const PLAIN_HTML = "<html><head><title>Empty</title></head><body>" + "y".repeat(80) + "</body></html>";

test("pornhub builds webmasters listing and search URLs", async () => {
  const { getPosts, getSearchPosts } = loadDist("pornhub", "posts");

  const browse1 = makeContext(() => PH_JSON);
  await getPosts({
    filter: "ordering:newest",
    page: 1,
    providerValue: "pornhub",
    signal: undefined,
    providerContext: browse1.providerContext,
  });
  assert.equal(
    browse1.calls.urls[0],
    "https://www.pornhub.com/webmasters/search?thumbsize=large&page=1&ordering=newest",
  );

  const browse2 = makeContext(() => PH_JSON);
  await getPosts({
    filter: "category:amateur",
    page: 3,
    providerValue: "pornhub",
    signal: undefined,
    providerContext: browse2.providerContext,
  });
  assert.equal(
    browse2.calls.urls[0],
    "https://www.pornhub.com/webmasters/search?thumbsize=large&page=3&category=amateur",
  );

  const search = makeContext(() => PH_JSON);
  await getSearchPosts({
    searchQuery: "test",
    page: 2,
    providerValue: "pornhub",
    signal: undefined,
    providerContext: search.providerContext,
  });
  assert.equal(
    search.calls.urls[0],
    "https://www.pornhub.com/webmasters/search?thumbsize=large&page=2&search=test",
  );
});

test("pornhub parses the webmasters JSON listing", async () => {
  const { getPosts } = loadDist("pornhub", "posts");
  const ctx = makeContext(() => PH_JSON);
  const posts = await getPosts({
    filter: "ordering:mostviewed",
    page: 1,
    providerValue: "pornhub",
    signal: undefined,
    providerContext: ctx.providerContext,
  });

  assert.equal(posts.length, 2);
  assert.equal(posts[0].title, "Test & Sample Video");
  assert.equal(posts[0].link, PH_PAGE_URL);
  assert.equal(posts[0].image, "https://ei.phncdn.com/videos/1/2/3/thumb/1.jpg");
  assert.equal(posts[0].tag, "13 min");
  assert.equal(posts[1].tag, "1 h");
});

test("pornhub resolves signed MP4 candidates and appends the embed", async () => {
  const { getStream } = loadDist("pornhub", "stream");
  const ctx = makeContext(() => PH_DETAIL_HTML);
  const streams = await getStream({
    link: PH_PAGE_URL,
    type: "movie",
    signal: undefined,
    providerContext: ctx.providerContext,
  });

  assert.equal(streams[0].quality, "720");
  assert.equal(streams[0].type, "mp4");
  assert.equal(streams[1].quality, "240");
  const embed = streams.find((stream) => stream.type === "webview");
  assert.ok(embed, "expected an embed webview entry");
  assert.equal(embed.link, "https://www.pornhub.com/embed/69bfe19ed2e60");
});

test("pornhub falls back to a webview entry when no source resolves", async () => {
  const { getStream } = loadDist("pornhub", "stream");
  const ctx = makeContext(() => PLAIN_HTML);
  const streams = await getStream({
    link: PH_PAGE_URL,
    type: "movie",
    signal: undefined,
    providerContext: ctx.providerContext,
  });
  assert.equal(streams.length, 1);
  assert.equal(streams[0].type, "webview");
  assert.equal(streams[0].link, PH_PAGE_URL);
});

test("pornhub meta reads open graph tags, duration and cast", async () => {
  const { getMeta } = loadDist("pornhub", "meta");
  const ctx = makeContext(() => PH_DETAIL_HTML);
  const info = await getMeta({ link: PH_PAGE_URL, providerContext: ctx.providerContext });

  assert.equal(info.title, "Test & Sample Video");
  assert.equal(info.image, "https://ei.phncdn.com/videos/1/2/3/thumb/1.jpg");
  assert.match(info.synopsis, /Duration: 12m 44s/);
  assert.equal(info.type, "movie");
  assert.ok(info.cast.includes("Test Model"));
  assert.equal(info.linkList[0].directLinks[0].link, PH_PAGE_URL);
});

// --- Hanime ---------------------------------------------------------------

const HANIME_PAGE_URL = "https://hanime.tv/videos/hentai/sister-breeder-1";

const HANIME_LISTING =
  "<html><body>" +
  '<a href="/videos/hentai/sister-breeder-1"><img src="https://hanime-cdn.com/images/covers/sb1.webp" ' +
  'alt="Sister Breeder 1"><h3>Sister Breeder 1</h3></a>' +
  '<a href="/videos/hentai/sister-breeder-2"><img src="https://hanime-cdn.com/images/covers/sb2.webp" ' +
  'alt="Sister Breeder 2"><h3>Sister Breeder 2</h3></a>' +
  "</body></html>";

const HANIME_DETAIL_HTML =
  "<html><head>" +
  '<meta property="og:title" content="Sister Breeder 1 Hentai Video in HD">' +
  '<meta property="og:image" content="https://hanime-cdn.com/images/covers/sb1.webp">' +
  "</head><body>" +
  '<script type="application/ld+json">{"@type":"VideoObject","name":"Sister Breeder 1",' +
  '"description":"Ep one.","thumbnailUrl":"https://hanime-cdn.com/images/covers/sb1.webp",' +
  '"duration":"PT16M21S","keywords":"anal, incest"}</script>' +
  '<a href="/videos/hentai/sister-breeder-1"><h3>Sister Breeder 1</h3></a>' +
  '<a href="/videos/hentai/sister-breeder-2"><h3>Sister Breeder 2</h3></a>' +
  '<a href="/videos/hentai/sister-breeder-3"><h3>Sister Breeder 3</h3></a>' +
  '<a href="/browse/tags/anal">Anal</a>' +
  "</body></html>";

const HANIME_INDEX = {
  data: [
    { slug: "sister-breeder-1", name: "Sister Breeder 1", brand: "Brand X",
      cover_url: "https://hanime-cdn.com/images/covers/sb1.webp" },
    { slug: "unrelated-title", name: "Unrelated Title", cover_url: "https://hanime-cdn.com/images/covers/u.webp" },
  ],
};

test("hanime builds browse URLs with query-style pagination", async () => {
  const { getPosts } = loadDist("hanime", "posts");

  const browse1 = makeContext(() => HANIME_LISTING);
  await getPosts({
    filter: "/browse/trending",
    page: 1,
    providerValue: "hanime",
    signal: undefined,
    providerContext: browse1.providerContext,
  });
  assert.equal(browse1.calls.urls[0], "https://hanime.tv/browse/trending");

  const browse2 = makeContext(() => HANIME_LISTING);
  await getPosts({
    filter: "/browse/trending?timespan=daily",
    page: 2,
    providerValue: "hanime",
    signal: undefined,
    providerContext: browse2.providerContext,
  });
  assert.equal(browse2.calls.urls[0], "https://hanime.tv/browse/trending?timespan=daily&page=2");
});

test("hanime parses server-rendered browse cards", async () => {
  const { getPosts } = loadDist("hanime", "posts");
  const ctx = makeContext(() => HANIME_LISTING);
  const posts = await getPosts({
    filter: "/browse/trending",
    page: 1,
    providerValue: "hanime",
    signal: undefined,
    providerContext: ctx.providerContext,
  });

  assert.equal(posts.length, 2);
  assert.equal(posts[0].title, "Sister Breeder 1");
  assert.equal(posts[0].link, "https://hanime.tv/videos/hentai/sister-breeder-1");
  assert.equal(posts[0].image, "https://hanime-cdn.com/images/covers/sb1.webp");
});

test("hanime search filters the guest index locally", async () => {
  const { getSearchPosts } = loadDist("hanime", "posts");
  const ctx = makeContext(() => HANIME_INDEX);
  const posts = await getSearchPosts({
    searchQuery: "breeder",
    page: 1,
    providerValue: "hanime",
    signal: undefined,
    providerContext: ctx.providerContext,
  });

  assert.equal(ctx.calls.urls[0], "https://guest.freeanimehentai.net/api/v11/search_hvs");
  assert.equal(posts.length, 1);
  assert.equal(posts[0].title, "Sister Breeder 1");
  assert.equal(posts[0].link, "https://hanime.tv/videos/hentai/sister-breeder-1");
  assert.equal(posts[0].tag, "Brand X");
});

test("hanime meta detects the franchise episode list", async () => {
  const { getMeta } = loadDist("hanime", "meta");
  const ctx = makeContext(() => HANIME_DETAIL_HTML);
  const info = await getMeta({ link: HANIME_PAGE_URL, providerContext: ctx.providerContext });

  assert.equal(info.title, "Sister Breeder 1");
  assert.match(info.synopsis, /Duration: 16m 21s/);
  assert.equal(info.type, "series");
  assert.equal(info.linkList[0].directLinks.length, 3);
  assert.equal(info.linkList[0].directLinks[0].title, "Episode 1");
});

test("hanime stream is webview-only (no direct URL is fabricated)", async () => {
  const { getStream } = loadDist("hanime", "stream");
  const ctx = makeContext(() => HANIME_DETAIL_HTML);
  const streams = await getStream({
    link: HANIME_PAGE_URL,
    type: "movie",
    signal: undefined,
    providerContext: ctx.providerContext,
  });

  assert.equal(streams.length, 1);
  assert.equal(streams[0].type, "webview");
  assert.equal(streams[0].link, HANIME_PAGE_URL);
});

// --- HentaiHeaven (targets hentaihaven.xxx) -------------------------------

const HH_PAGE_URL = "https://hentaihaven.xxx/watch/some-series/";
const HH_EPISODE_URL = "https://hentaihaven.xxx/watch/some-series/episode-1/";

const HH_LISTING =
  "<html><body>" +
  '<a class="group relative block aspect-[2/3]" href="/watch/some-series/">' +
  '<img alt="Some Series" src="https://img.hentaihaven.xxx/images/2023/01/s_abc.jpg"></a>' +
  '<a class="group relative block aspect-[2/3]" href="/watch/another-series/">' +
  '<img alt="Another Series" src="https://img.hentaihaven.xxx/images/2023/01/s_def.jpg"></a>' +
  "</body></html>";

const HH_CMS_JSON = [
  {
    id: 1,
    slug: "some-series",
    link: "https://cms.hentaihaven.xxx/watch/some-series/",
    title: { rendered: "Some Series" },
    meta: { vraven_remote_thumbnail: "images/c/z/i/s_abc.jpg" },
  },
];

const HH_DETAIL_HTML =
  "<html><head>" +
  '<meta property="og:title" content="Some Series - Hentai Haven">' +
  '<meta property="og:image" content="https://img.hentaihaven.xxx/images/2023/01/s_abc.jpg">' +
  "</head><body>" +
  '<a href="/watch/some-series/episode-1/">Episode 1</a>' +
  '<a href="/watch/some-series/episode-2/">Episode 2</a>' +
  "</body></html>";

const HH_EPISODE_HTML =
  "<html><head>" +
  '<meta property="og:title" content="Some Series Episode 1 - Hentai Haven">' +
  '<meta property="og:image" content="https://img.hentaihaven.xxx/images/2023/01/s_abc.jpg">' +
  "</head><body>" +
  '<video><source data-hhaven-indexable-source="true" ' +
  'src="https://octopusmanifest.org/abcdef/playlist.m3u8" type="application/vnd.apple.mpegurl"></video>' +
  '<script type="application/ld+json">{"@type":"VideoObject","name":"Some Series Episode 1",' +
  '"duration":"PT19M32S","contentUrl":"https://octopusmanifest.org/abcdef/playlist.m3u8"}</script>' +
  "</body></html>";

test("hentaiheaven builds browse URLs with /page/<n>/ pagination", async () => {
  const { getPosts } = loadDist("hentaiheaven", "posts");

  const browse1 = makeContext(() => HH_LISTING);
  await getPosts({
    filter: "/browse/trending",
    page: 1,
    providerValue: "hentaiheaven",
    signal: undefined,
    providerContext: browse1.providerContext,
  });
  assert.equal(browse1.calls.urls[0], "https://hentaihaven.xxx/browse/trending");

  const browse2 = makeContext(() => HH_LISTING);
  await getPosts({
    filter: "/watch/?sort=latest",
    page: 2,
    providerValue: "hentaiheaven",
    signal: undefined,
    providerContext: browse2.providerContext,
  });
  assert.equal(browse2.calls.urls[0], "https://hentaihaven.xxx/watch/page/2/?sort=latest");
});

test("hentaiheaven parses server-rendered browse cards", async () => {
  const { getPosts } = loadDist("hentaiheaven", "posts");
  const ctx = makeContext(() => HH_LISTING);
  const posts = await getPosts({
    filter: "/browse/trending",
    page: 1,
    providerValue: "hentaiheaven",
    signal: undefined,
    providerContext: ctx.providerContext,
  });

  assert.equal(posts.length, 2);
  assert.equal(posts[0].title, "Some Series");
  assert.equal(posts[0].link, "https://hentaihaven.xxx/watch/some-series/");
  assert.equal(posts[0].image, "https://img.hentaihaven.xxx/images/2023/01/s_abc.jpg");
});

test("hentaiheaven search uses the CMS WordPress API", async () => {
  const { getSearchPosts } = loadDist("hentaiheaven", "posts");
  const ctx = makeContext(() => HH_CMS_JSON);
  const posts = await getSearchPosts({
    searchQuery: "some",
    page: 1,
    providerValue: "hentaiheaven",
    signal: undefined,
    providerContext: ctx.providerContext,
  });

  assert.match(ctx.calls.urls[0], /^https:\/\/cms\.hentaihaven\.xxx\/wp-json\/wp\/v2\/wp-manga\?search=some/);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].link, "https://hentaihaven.xxx/watch/some-series/");
  assert.equal(posts[0].image, "https://img.hentaihaven.xxx/images/c/z/i/s_abc.jpg");
});

test("hentaiheaven meta exposes episodes from a watch page", async () => {
  const { getMeta } = loadDist("hentaiheaven", "meta");
  const ctx = makeContext(() => HH_DETAIL_HTML);
  const info = await getMeta({ link: HH_PAGE_URL, providerContext: ctx.providerContext });

  assert.equal(info.title, "Some Series");
  assert.equal(info.type, "series");
  assert.equal(info.linkList[0].directLinks.length, 2);
  assert.equal(info.linkList[0].directLinks[0].link, HH_EPISODE_URL);
});

test("hentaiheaven stream resolves the episode manifest and falls back elsewhere", async () => {
  const { getStream } = loadDist("hentaiheaven", "stream");

  const epCtx = makeContext(() => HH_EPISODE_HTML);
  const streams = await getStream({
    link: HH_EPISODE_URL,
    type: "movie",
    signal: undefined,
    providerContext: epCtx.providerContext,
  });
  assert.equal(streams.length, 1);
  assert.equal(streams[0].type, "m3u8");
  assert.equal(streams[0].link, "https://octopusmanifest.org/abcdef/playlist.m3u8");
  assert.equal(streams[0].server, "HentaiHeaven-HLS");

  const pageCtx = makeContext(() => HH_DETAIL_HTML);
  const fallback = await getStream({
    link: HH_PAGE_URL,
    type: "movie",
    signal: undefined,
    providerContext: pageCtx.providerContext,
  });
  assert.equal(fallback.length, 1);
  assert.equal(fallback[0].type, "webview");
  assert.equal(fallback[0].link, HH_PAGE_URL);
});

// --- CosXplay -------------------------------------------------------------

const CX_PAGE_URL = "https://cosxplay.com/48356-hinata-test/";

const CX_LISTING =
  "<html><body>" +
  '<div class="video-block video-with-trailer" data-post-id="48356">' +
  '<a class="thumb" href="https://cosxplay.com/48356-hinata-test/" aria-label="Hinata Test">' +
  '<img class="video-img img-fluid first-image" alt="Hinata Test" ' +
  'src="https://cosxplay.com/storage/2022/03/hinata-320x180.jpg"></a>' +
  '<a class="infos" href="https://cosxplay.com/48356-hinata-test/">' +
  '<span class="title">Hinata Test</span>' +
  '<div class="video-datas"><span class="duration notranslate">8 min</span></div></a></div>' +
  "</body></html>";

const CX_DETAIL_HTML =
  "<html><head>" +
  '<meta property="og:title" content="Hinata Test | CosXplay.com">' +
  '<meta property="og:image" content="https://cosxplay.com/storage/2022/03/hinata.jpg">' +
  "</head><body>" +
  '<script type="application/ld+json">{"@graph":[{"@type":"VideoObject","name":"Hinata Test",' +
  '"description":"A cosplay scene.","duration":"P0DT0H8M9S",' +
  '"contentUrl":"https://xcdn1.nosofiles.com/5/d/9/b/5/output_high.mp4",' +
  '"embedUrl":"https://cosxplay.com/embed/48356",' +
  '"thumbnailUrl":["https://cosxplay.com/storage/2022/03/hinata.jpg"],' +
  '"keywords":"cosplay, naruto","actor":[{"@type":"Person","name":"Actress One"}],' +
  '"about":[{"@type":"Thing","name":"Naruto"}]},{"@type":"Person","name":"Actress One"}]}</script>' +
  "</body></html>";

test("cosxplay builds browse and search URLs with /page/<n>/", async () => {
  const { getPosts, getSearchPosts } = loadDist("cosxplay", "posts");

  const browse1 = makeContext(() => CX_LISTING);
  await getPosts({
    filter: "",
    page: 1,
    providerValue: "cosxplay",
    signal: undefined,
    providerContext: browse1.providerContext,
  });
  assert.equal(browse1.calls.urls[0], "https://cosxplay.com/");

  const browse2 = makeContext(() => CX_LISTING);
  await getPosts({
    filter: "/tag/31-cosplay",
    page: 2,
    providerValue: "cosxplay",
    signal: undefined,
    providerContext: browse2.providerContext,
  });
  assert.equal(browse2.calls.urls[0], "https://cosxplay.com/tag/31-cosplay/page/2/");

  const search1 = makeContext(() => CX_LISTING);
  await getSearchPosts({
    searchQuery: "hinata",
    page: 1,
    providerValue: "cosxplay",
    signal: undefined,
    providerContext: search1.providerContext,
  });
  assert.equal(search1.calls.urls[0], "https://cosxplay.com/search/hinata/");

  const search2 = makeContext(() => CX_LISTING);
  await getSearchPosts({
    searchQuery: "hinata",
    page: 2,
    providerValue: "cosxplay",
    signal: undefined,
    providerContext: search2.providerContext,
  });
  assert.equal(search2.calls.urls[0], "https://cosxplay.com/search/hinata/page/2/");
});

test("cosxplay parses .video-block cards", async () => {
  const { getPosts } = loadDist("cosxplay", "posts");
  const ctx = makeContext(() => CX_LISTING);
  const posts = await getPosts({
    filter: "",
    page: 1,
    providerValue: "cosxplay",
    signal: undefined,
    providerContext: ctx.providerContext,
  });

  assert.equal(posts.length, 1);
  assert.equal(posts[0].title, "Hinata Test");
  assert.equal(posts[0].link, CX_PAGE_URL);
  assert.equal(posts[0].image, "https://cosxplay.com/storage/2022/03/hinata-320x180.jpg");
  assert.equal(posts[0].tag, "8 min");
});

test("cosxplay resolves the JSON-LD contentUrl and appends the embed", async () => {
  const { getStream } = loadDist("cosxplay", "stream");
  const ctx = makeContext(() => CX_DETAIL_HTML);
  const streams = await getStream({
    link: CX_PAGE_URL,
    type: "movie",
    signal: undefined,
    providerContext: ctx.providerContext,
  });

  assert.equal(streams[0].type, "mp4");
  assert.equal(streams[0].link, "https://xcdn1.nosofiles.com/5/d/9/b/5/output_high.mp4");
  const embed = streams.find((stream) => stream.type === "webview");
  assert.ok(embed, "expected an embed webview entry");
  assert.equal(embed.link, "https://cosxplay.com/embed/48356");
});

test("cosxplay meta reads the @graph VideoObject, tags and actor", async () => {
  const { getMeta } = loadDist("cosxplay", "meta");
  const ctx = makeContext(() => CX_DETAIL_HTML);
  const info = await getMeta({ link: CX_PAGE_URL, providerContext: ctx.providerContext });

  assert.equal(info.title, "Hinata Test");
  assert.equal(info.image, "https://cosxplay.com/storage/2022/03/hinata.jpg");
  assert.match(info.synopsis, /Duration: 8m 09s/);
  assert.match(info.synopsis, /Starring: Actress One/);
  assert.equal(info.type, "movie");
  assert.ok(info.tags.includes("cosplay"));
  assert.ok(info.cast.includes("Actress One"));
  assert.equal(info.linkList[0].directLinks[0].link, CX_PAGE_URL);
});
