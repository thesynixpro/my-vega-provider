# my-vega-provider

A Vega App provider pack with three adult-tube providers:

| Provider | ID | Pages scraped |
| --- | --- | --- |
| XNXX | `xnxx` | `www.xnxx.com` |
| XVideos | `xvideos` | `www.xvideos.com` |
| Eporner | `eporner` | `www.eporner.com` |

Each provider is a plain scraper module consumed by the Vega App sandbox. It
only uses the injected `providerContext` (`axios`, `cheerio`, `kvStore`) — no
third-party packages and no Node built-ins.

## Layout

```
providers/
  <id>/
    catalog.ts   categories / genres shown in the app
    posts.ts     listing + search scraping
    meta.ts      video detail scraping
    stream.ts    playback resolution (.mp4 / .m3u8)
    settings.ts  user settings schema
    common.ts    shared helpers (inlined at build time, NOT a dist module)
dist/
  <id>/*.js      build output consumed by the app
tests/           CLI + integration test runner
manifest.json    provider registry (value + version must match the build stamp)
```

`common.ts` is a private helper module. esbuild bundles it into `posts.js`,
`meta.js` and `stream.js`, so it never becomes a runtime import.

## Manifest

`manifest.json` is the source of truth for provider IDs and versions. The build
stamps every emitted file with:

```
// @vega-provider <value>
// @vega-version <version>
```

Keep `value` identical to the folder name and bump `version` on every change,
otherwise `npm run build` throws.

## Building

The `dist/` folder in this repo was produced by hand because the authoring
device has no Node/JS toolchain. Regenerate it on a machine with Node.js 20+:

```bash
npm install
npm run build        # minified, production
npm run build:dev    # readable, no minification
```

`npm run build` overwrites `dist/` and is the canonical output. If the requested
APK build fails, run the build first — the app reads `dist/<id>/*.js`, not the
TypeScript sources.

> **Note on this repo's `dist/`:** `dist/<id>/*.js` and `dist/headers.js` were
> written by hand on a device with no JS toolchain. They follow the build output
> contract (vega stamp + `"use strict"` + direct `exports.<name>`) but are plain
> rather than byte-identical esbuild/minified output. `dist/providerContext.js`
> is the committed generated bundle and `providers/providerContext.ts` is
> unchanged from the framework, so the two stay consistent. Run
> `npm install && npm run build` on a Node.js 20+ machine to regenerate all of
> `dist/` from the TypeScript sources and confirm the output.

## Testing

```bash
npm run test:unit                       # offline unit tests
npm run test:provider -- xnxx getPosts  # interactive single function
npm test -- xnxx                        # end-to-end against the live site
npm test                                # every provider end to end
```

The end-to-end tests hit the real sites and need network access.

## Settings

Every provider exposes the same settings surface via `settings.ts`:

| Key | Type | Purpose |
| --- | --- | --- |
| `preferredQuality` | select | Preferred resolution |
| `allowedResolutions` | multiselect | Filter returned streams |
| `includeHls` | toggle | Include `.m3u8` streams |
| `baseUrlOverride` | text | Use a mirror / regional domain |
| `requestTimeoutSecs` | number | Per-request timeout |
| `retryAttempts` | number | Retries before failing |

`baseUrlOverride` only accepts absolute `http(s)` URLs; anything else falls back
to the built-in domain.

## Scraping notes

- **XNXX** — listings are `div.thumb-block` in the mozaique grid; the player
  exposes `html5player.setVideoUrlLow/High` and `setVideoHLS`. Signed
  `secure=<sig>,<expiry>` links are short lived, so `getStream` always refetches
  the page instead of caching raw URLs.
- **XVideos** — listings are `div.thumb-block`; the player exposes
  `setVideoUrlLow/High`, `setVideoHLS` and a JSON-LD `contentUrl`. Category
  pages paginate as `/c/<Name-ID>/<n>` (n = page − 1), search uses
  `?k=<q>&p=<page − 1>`.
- **Eporner** — listings are `.mb` boxes; `getStream` calls the public player
  endpoint `/xhr/video/<id>?hash=<hash>` and falls back to the `/dload/` MP4
  links embedded in the page. The page `hash` → base-36 conversion is done in
  pure JS (`common.ts`).

When a site is blocked, unreachable, or changes markup, `getStream` returns a
`type: "webview"` entry pointing at the original page rather than inventing a
URL.

## Legal / content notice

This pack contains scrapers for adult websites and 18+ content. Use it only in
jurisdictions where such content is legal and only for personal use. Respect
each site's terms of service, robots directives and copyright. The maintainers
do not host or redistribute any media.
