const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { providerContext, kvStore } = require("./provider-test-context");

const rootDir = path.join(__dirname, "..");
const dist = (provider, moduleName) =>
  path.join(rootDir, "dist", provider, `${moduleName}.js`);

const load = (provider, moduleName) => {
  const modulePath = dist(provider, moduleName);
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
};

test("manifest.json registers xhamster with the required schema", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(rootDir, "manifest.json"), "utf-8"),
  );
  const entry = manifest.find((p) => p.value === "xhamster");
  assert.ok(entry, "xhamster entry missing from manifest");
  assert.equal(entry.display_name, "xHamster");
  assert.equal(entry.version, "1.0");
  assert.equal(entry.type, "global");
  assert.equal(entry.hasSettings, true);
  assert.equal(entry.disabled, false);
});

test("catalog exports non-empty catalog and genres with title/filter", () => {
  const mod = load("xhamster", "catalog");
  assert.ok(Array.isArray(mod.catalog) && mod.catalog.length > 0);
  assert.ok(Array.isArray(mod.genres) && mod.genres.length > 0);
  for (const item of [...mod.catalog, ...mod.genres]) {
    assert.equal(typeof item.title, "string");
    assert.equal(typeof item.filter, "string");
  }
});

test("getPosts returns an empty list when the official API is not configured", async () => {
  await kvStore.clear();
  const mod = load("xhamster", "posts");
  const posts = await mod.getPosts({
    filter: "/latest",
    page: 1,
    providerValue: "xhamster",
    signal: new AbortController().signal,
    providerContext,
  });
  assert.deepEqual(posts, []);
});

test("getSearchPosts returns an empty list when the official API is not configured", async () => {
  await kvStore.clear();
  const mod = load("xhamster", "posts");
  const posts = await mod.getSearchPosts({
    searchQuery: "test",
    page: 1,
    providerValue: "xhamster",
    signal: new AbortController().signal,
    providerContext,
  });
  assert.deepEqual(posts, []);
});

test("getStream returns an empty list for download requests", async () => {
  const mod = load("xhamster", "stream");
  const streams = await mod.getStream({
    link: "https://xhamster.com/video/placeholder",
    type: "movie",
    signal: new AbortController().signal,
    providerContext,
    isDownload: true,
  });
  assert.deepEqual(streams, []);
});

test("getStream throws a clear error for playback without API configuration", async () => {
  await kvStore.clear();
  const mod = load("xhamster", "stream");
  await assert.rejects(
    mod.getStream({
      link: "https://xhamster.com/video/placeholder",
      type: "movie",
      signal: new AbortController().signal,
      providerContext,
    }),
    /API configuration is missing/,
  );
});

test("getMeta throws a clear error without API configuration", async () => {
  await kvStore.clear();
  const mod = load("xhamster", "meta");
  await assert.rejects(
    mod.getMeta({
      link: "https://xhamster.com/video/placeholder",
      providerContext,
    }),
    /API configuration is missing/,
  );
});

test("settings schema exposes the required settings fields", async () => {
  const mod = load("xhamster", "settings");
  const schema = await mod.getSettingsSchema({ providerContext });
  const keys = schema.map((field) => field.key);
  for (const key of [
    "preferredQuality",
    "autoQuality",
    "apiBaseUrl",
    "apiKey",
    "requestTimeoutSecs",
    "includeDrmStreams",
  ]) {
    assert.ok(keys.includes(key), `missing settings key: ${key}`);
  }
});
