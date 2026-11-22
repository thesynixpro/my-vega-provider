# xHamster Vega Provider

A custom [Vega App](https://github.com/Zenda-Cross/vega) provider extension for **xHamster**
(`https://xhamster.com`), built on the official Vega Provider Template.

**Provider type:** Global
**Provider ID:** `xhamster`
**Version:** `1.0`

> ⚠️ **Status: awaiting official API authorization.**
> The xHamster site owner and the Vega owner have held discussions, but the official
> API documentation and playback specifications have **not** been supplied yet.
> Verbal discussions are **not** treated as technical API authorization. This provider
> is fully buildable and installable, but **streaming is disabled** until an officially
> authorized playback integration exists and is tested. It never fabricates API
> endpoints, stream URLs, or mock playback data, and it never bypasses access
> controls, DRM, or anti-bot protection.

---

## Project Overview

This repository builds and publishes a `xhamster` provider for the Vega App. A Vega
provider is a sandboxed script module that supplies catalog sections, post listings,
item metadata, and streaming sources. Providers execute inside a strict JS sandbox
(Web Worker / JavaScriptCore) with only the injected `providerContext` (axios,
cheerio, common headers, kvStore, openWebView) available.

The reference example provider from the template (`providers/example`) is kept intact
so the build and test tooling can be verified against a known-good provider.

## Provider Architecture

```
providers/
  xhamster/
    catalog.ts    Static browse sections and genre filters (adapter tokens)
    posts.ts      getPosts / getSearchPosts — list & search interfaces
    meta.ts       getMeta — video metadata & link list
    stream.ts     getStream — authorized playback resolution (disabled)
    settings.ts   getSettingsSchema — Vega Provider Settings UI
    config.ts     Shared settings reader + official-API validation
    api.ts        Official API adapter contract + placeholder guards
```

All public entry points import Vega types from `../types` and use only the injected
`providerContext`. No third-party libraries are imported into provider code; shared
modules (`config.ts`, `api.ts`) are inlined by esbuild during bundling.

## Documentation

- `docs/xhamster-api-analysis.md` — analysis of the extracted Python source
  (`unofficial-api-for-xhamster` v3.0.0): capabilities, data model, dependencies.
- `docs/license-review.md` — AGPL-3.0 license findings and derivative-work assessment.
- `docs/python-integration.md` — design of the separate authorized HTTP service.
- `docs/provider-drm.md` — Vega DRM stream reference (from the template).

## Implemented Features

- Provider registration in `manifest.json` (global, `hasSettings: true`, enabled).
- Static catalog of browse sections (Latest, Popular, Top Rated, Trending, HD,
  Verified Models, Recommended) and ~25 genre filters.
- Posts and search entry points that validate official API configuration and return
  an empty list when it is missing — they never emit fabricated content.
- Metadata entry point that fails with an actionable configuration error when the
  official API is not configured.
- Stream entry point that:
  - Always returns an **empty list for download requests** (`isDownload: true`).
  - Fails with a clear configuration error for playback when the official API is
    not configured.
  - Documents the quality selection, playback headers, and expired-URL handling
    required once the authorized API spec arrives.
- Professional settings interface (preferred quality, auto quality, official API
  base URL + key, request timeout, DRM-source preference).
- Strict TypeScript (compiles with `tsc --noEmit`), esbuild bundling, and a
  deterministic unit-test suite.

## Awaiting Official API Access

These features are **disabled** until xHamster supplies official API/playback
documentation and authorized access:

- Real catalog/post/search data.
- Real video metadata.
- Authorized HLS/MP4 playback resolution.
- Quality selection from real manifest data.
- DRM-aware playback sources.
- Any download sources (downloads are intentionally always empty).

The extracted `unofficial-api-for-xhamster` Python project was analyzed
(`docs/xhamster-api-analysis.md`) and informed the adapter contract, but it is an
**unofficial scraper** (browser impersonation, page scraping, HLS downloader).
It is **not** wired into the provider: doing so would bypass xHamster's
anti-bot/access controls and violate the "authorized streaming only" mission, and
its AGPL-3.0 license carries source-distribution obligations for any hosted
service (`docs/license-review.md`). The authorized-backend design is documented
in `docs/python-integration.md`.

## Installation

```sh
npm install
```

> If you are on a filesystem that does not support symlinks (e.g. Android
> `/sdcard` FUSE), use `npm install --no-bin-links`. Build and test scripts run
> through Node module resolution and do not require `.bin` links.

## Build

```sh
npm run build
```

Bundles every provider under `providers/` into `dist/<provider>/<module>.js` using
esbuild + terser, and stamps each bundle with its manifest ID/version header.
Manifest entries are validated before anything is published.

Type-check (no emit):

```sh
node node_modules/typescript/bin/tsc --noEmit
```

## Testing

```sh
# Deterministic structural tests (manifest schema, empty-list contracts, errors)
npm run test:unit

# Full integration test of all enabled providers (catalog → posts → meta → stream)
npm test

# Test a single provider function interactively
npm run test:provider -- xhamster getStream
```

**Expected results today:** `npm run test:unit` passes fully. The integration test
passes for the reference `example` provider. The `xhamster` provider passes its
catalog step and then stops at posts with the expected result: because the official
API is not configured, listing returns an empty array and metadata/streaming throw
clear configuration errors. This is the honest, by-design state until official API
authorization is available.

## Provider Configuration

In the Vega App, open **Provider Settings** for xHamster:

| Setting | Type | Purpose |
|---|---|---|
| Preferred Playback Quality | select | Default resolution when multiple are available |
| Auto Quality Selection | toggle | Pick the best quality automatically |
| Authorized Backend Base URL | text | Base URL of the authorized backend service |
| Authorized Backend API Key | text | Access token issued by the authorized backend |
| Request Timeout (seconds) | number | Max wait for authorized backend responses |
| Include Officially Licensed (DRM) Sources | toggle | Allow DRM sources from the authorized API |

Values are persisted per-provider in `providerContext.kvStore` and read at runtime.

## Python API Analysis & License

The project directory contains the extracted Python source
`api/unofficial-api-for-xhamster-main/` (**v3.0.0**, AGPL-3.0-only). It was
analyzed as read-only reference material; **no code was copied from it**.

Key findings (`docs/xhamster-api-analysis.md`):

- An async library/CLI scraping xhamster.com (browser impersonation via
  `curl_cffi`, HTML parsing, HLS downloader, login, caching). It exposes no HTTP
  service of its own.
- Rich video data model (title, description, duration, views, ratings,
  uploader, categories, tags, thumbnails, `max_resolution`, `is_hd`/`is_vr`,
  `m3u8_base_url`) that grounds the provider's documented adapter contract in
  `providers/xhamster/api.ts`.
- Because it is an **unofficial scraper**, it is not used as the live backend.
  Real listings/metadata/streaming stay disabled until official authorization.

License findings (`docs/license-review.md`):

- The TypeScript provider does not incorporate, link, or copy the AGPL code, so
  this repository does not become a derivative work and stays under the Vega
  template's ISC license. Attribution is preserved in the docs.
- Any **separately deployed service** that uses the Python library is a covered
  work: it must be AGPL-3.0, ship its source (AGPL §13 network clause), and keep
  notices intact.

## Python Integration (Design)

Because Vega providers run sandboxed JS, integrating the Python library requires
a **separately deployed HTTP service**. The full contract — endpoints, response
schemas, errors, auth, security requirements, and deployment steps — is designed
in `docs/python-integration.md`.

- Vega provider → HTTPS → authorized backend service → future official API.
- The provider holds only the service token (`apiKey`); library credentials stay
  in service environment variables.
- **Status: design only.** No service is deployed and playback remains disabled
  until xHamster authorization and the AGPL legal review are complete.

## Required Official API Credentials

To enable real features, the following must be obtained from xHamster through the
ongoing authorization discussions:

1. An **API base URL** (the official endpoint prefix).
2. An **API key / access token** for authorized requests.
3. **Playback specification**: HLS/MP4 response format, quality/variant layout,
   required playback headers, URL expiry/refresh behavior, and DRM/licensing details
   if applicable.

Until these are supplied and the integration is tested with real authorized
playback, this provider must not be considered operational.

## Vega Installation

1. Fork or clone this repository and build it (`npm install && npm run build`).
2. Commit and push the built `dist/` and `manifest.json` to a public GitHub
   repository (this repository is named `my-vega-provider`).
3. In the Vega app, open **Settings > Provider Manager > Available Providers** and
   add a provider source:
   - If the repository is named exactly `vega-providers`, enter your GitHub username.
   - Otherwise enter the full repository URL:
     `https://github.com/<your-username>/my-vega-provider`
4. Select the added source and install the `xHamster` provider.
5. The provider appears as **xHamster** (Global, `hasSettings: true`). Configure it
   via Provider Settings once official API credentials are available.

## License

- The Vega provider template is provided under the ISC license (see
  `package.json`).
- The analyzed `unofficial-api-for-xhamster` Python project is
  **AGPL-3.0-only** (author: Johannes Habel). No code from it is included in
  this repository; its analysis and attribution are documented in
  `docs/xhamster-api-analysis.md` and `docs/license-review.md`.
- Any future service deploying that Python library must comply with AGPL-3.0
  (source distribution for network users).
