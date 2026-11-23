# my-vega-provider

A Vega App provider pack with seven adult video providers:

| Provider | ID | Site | Type |
| --- | --- | --- | --- |
| XNXX | `xnxx` | `www.xnxx.com` | tube |
| XVideos | `xvideos` | `www.xvideos.com` | tube |
| Eporner | `eporner` | `www.eporner.com` | tube |
| Pornhub | `pornhub` | `www.pornhub.com` | tube (webmasters JSON API) |
| Hanime | `hanime` | `hanime.tv` | hentai (SSR + guest index) |
| HentaiHeaven | `hentaiheaven` | `hentaihaven.xxx` | hentai (Next.js + CMS API) |
| CosXplay | `cosxplay` | `cosxplay.com` | cosplay tube |

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
tests/           CLI + offline unit tests
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
npm run test:unit                       # offline unit tests (no network)
npm run test:provider -- xnxx getPosts  # interactive single function
npm test -- xnxx                        # end-to-end against the live site
npm test                                # every provider end to end
```

`npm run test:unit` runs `tests/providers.test.js`, which replays small
hand-trimmed HTML/JSON fixtures through a stubbed `axios.get` for all seven
providers (URL shapes, listing parsing, stream resolution, meta extraction and
the `dist/` contract). The end-to-end tests hit the real sites and need network
access.

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
- **Pornhub** — the video grid is rendered client-side, so listings and search
  use the public webmasters JSON API (`/webmasters/search?…`), which returns
  `{ videos: [...] }`. Filter values are `ordering:<x>` / `category:<slug>`
  pairs. Detail pages are server-rendered: `og:title` / `og:image` /
  `og:description` plus a JSON-LD `VideoObject` give the title, poster, ISO-8601
  duration and keywords; `og:video` carries a signed progressive MP4.
- **Hanime** — browse pages (`/browse/trending`, `/browse/tags/<tag>`) are
  server-rendered; each card links to `/videos/hentai/<slug>`. On-site search is
  client-side, so `getSearchPosts` pulls the guest catalogue index
  (`guest.freeanimehentai.net/api/v11/search_hvs`) and filters it locally by
  name / search titles. Detail pages expose a JSON-LD `VideoObject` plus
  franchise episode links.
- **HentaiHeaven** — the `hentaiheaven` provider targets `https://hentaihaven.xxx`.
  Browse/trending/series pages are server-rendered (Next.js); search uses the
  WordPress content API (`cms.hentaihaven.xxx/wp-json/wp/v2/wp-manga`). Watch
  pages list `/watch/<slug>/episode-<n>/` links; episode pages embed the playable
  manifest in an indexable `<source>` element and in the JSON-LD `contentUrl`.
- **CosXplay** — a WordPress tube: listings are `.video-block` cards, search
  canonicalises to `/search/<q>/page/<n>/`, tag listings use `/tag/<id>-<slug>`.
  Detail pages carry a JSON-LD `@graph` whose `VideoObject` holds a direct MP4
  `contentUrl`, an `/embed/<id>` page and an ISO-8601 duration.

When a site is blocked, unreachable, or changes markup, `getStream` returns a
`type: "webview"` entry pointing at the original page rather than inventing a
URL.

## Site limitations

- **Pornhub** — listing/search data comes from the webmasters JSON API (the HTML
  grid is JS-rendered) and is rate limited. The `og:video` MP4 is signed and
  short lived, so `getStream` refetches the detail page on every call; the embed
  page is offered as a secondary webview entry.
- **Hanime** — playback requires a short-lived signed handshake
  (`/api/v11/handshake`) gated behind a browser challenge, so no direct stream
  can be resolved headlessly. `getStream` returns a single **webview** entry
  pointing at the original page. Search results all arrive in one request (the
  full index), then are filtered and paginated locally.
- **HentaiHeaven** — the literal `hentaiheaven.com` domain is a parked ad page
  and `hentaihaven.org` is unavailable, so the provider targets the live
  `hentaihaven.xxx`. Episode pages resolve the HLS manifest; plain series landing
  pages have no embedded manifest and fall back to a webview entry.
- **CosXplay** — search canonicalises `/?s=<q>` to `/search/<q>/`; the
  `/category/<slug>/` route sometimes returns a binary image response through
  the provider HTTP layer, so the catalog uses tag listings instead.

## Legal / content notice

This pack contains scrapers for adult websites and 18+ content. Use it only in
jurisdictions where such content is legal and only for personal use. Respect
each site's terms of service, robots directives and copyright. The maintainers
do not host or redistribute any media.
