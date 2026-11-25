const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

for (const [id, url] of [["cinefreak", "https://cinefreak.net/"], ["toonstream", "https://toonstream.us/home"]]) {
  test(`${id} is a website-only Vega provider`, async () => {
    const base = path.join(__dirname, "..", "dist", id);
    const catalog = require(path.join(base, "catalog.js"));
    const posts = require(path.join(base, "posts.js"));
    const meta = require(path.join(base, "meta.js"));
    const stream = require(path.join(base, "stream.js"));
    assert.equal(catalog.catalog.length, 1);
    assert.match(catalog.catalog[0].title, /Open/);
    const items = await posts.getPosts({});
    assert.equal(items.length, 1);
    assert.equal(items[0].link, url);
    assert.match(items[0].image, /favicon/);
    const info = await meta.getMeta({ link: url });
    assert.equal(info.webUrl, url);
    assert.equal(info.linkList[0].directLinks[0].link, url);
    const streams = await stream.getStream({ link: url });
    assert.equal(streams[0].type, "webview");
    assert.equal(streams[0].link, url);
  });
}
