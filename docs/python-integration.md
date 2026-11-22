# Python integration design (separate service)

This document describes how the extracted Python project
(`unofficial-api-for-xhamster` v3.0.0) **could** be integrated behind a
separately deployed HTTP service, and what that service's contract looks like.

> ## Status: design only — NOT deployed
>
> - The Python project is an **unofficial scraper**. Using it to serve the
>   public Vega provider would bypass xHamster's anti-bot/access controls, which
>   this project explicitly does not do.
> - The provider's mission is **authorized video streaming only**.
> - The Python project is **AGPL-3.0-only**; any deployed service that uses it
>   must comply (see `docs/license-review.md`).
>
> Therefore: **playback and live data stay disabled** until (a) xHamster
> supplies official API/playback authorization and (b) the legal review of the
> AGPL deployment model is completed. This document is the blueprint for that
> future service.

## Why a separate service

- Vega providers run in a sandboxed JS runtime (Web Worker/JavaScriptCore) with
  only `providerContext` (axios, cheerio, commonHeaders, kvStore, openWebView)
  available. Python cannot run inside the provider.
- The extracted project is a library/CLI, not an HTTP API. A thin HTTP service
  is required to bridge it.
- Keeping the service separate keeps the AGPL-covered code out of the ISC
  provider repo and lets the provider stay independently licensed.

## Architecture

```
Vega App
   │
   ├── xhamster provider (TypeScript, sandboxed)
   │      uses providerContext.axios → HTTPS → authorized backend base URL
   │      settings: apiBaseUrl, apiKey (Bearer token issued by the service)
   │
   ▼
HTTP service (FastAPI + uvicorn, separate repo/deployment, AGPL)
   │      validates Bearer token, enforces timeouts & rate limits
   ▼
xhamster_api library (AGPL) / future official authorized backend
   │
   ▼
xhamster.com (only with official authorization)
```

## HTTP contract

All endpoints are `application/json`. Authentication: `Authorization: Bearer
<apiKey>`. The provider sends this header; the service token never contains the
library's own credentials.

### Common query parameters

| Param | Type | Notes |
|---|---|---|
| `page` | int ≥ 1 | One-based, mirrors the library's pagination contract |
| `page_size` | int 1..50 | Default 20 |

### Listings

```
GET /videos/popular?page=&page_size=
GET /videos/latest?page=&page_size=
GET /videos?category=<slug>&sort=views|newest|best|longest&page=
GET /channels/{slug}/videos?page=          (creator/channel/pornstar listings)
```

### Search

```
GET /search?q=<query>&min_quality=720p|1080p|2160p&sort=views|newest|best|longest&page=
```

### Metadata

```
GET /videos/{id_or_hash}        → full Video payload (see schema below)
GET /videos/{url}?type=movie    → same, keyed by canonical xHamster URL
```

### Playback (authorized only)

```
GET /videos/{id_or_hash}/stream?quality=auto|360|480|720|1080|2160
   → { sources: [{ server, link, type, quality, headers }] }
```

`link` is an HLS (`m3u8`) or progressive (`mp4`) URL supplied by the authorized
backend. `headers` are the playback headers required to fetch the manifest /
segments (referer, user-agent, cookies, expiry handling). The service must
refresh expired URLs before returning them and must not return DRM sources when
the provider's `includeDrmStreams` setting is false.

### Errors

```
{ "error": "<code>", "message": "<human readable>" }
```

| Code | HTTP | Meaning |
|---|---|---|
| `missing_auth` | 401 | Missing/invalid service token |
| `not_found` | 404 | Video/profile not found |
| `playback_unavailable` | 403 | Playback not authorized for this item |
| `rate_limited` | 429 | Backend or service rate limit |
| `upstream_error` | 502 | Authorized backend failed |
| `timeout` | 504 | Upstream did not answer in time |

## Response schema (grounded in the analyzed data model)

### `Video` payload

```jsonc
{
  "url": "https://xhamster.com/videos/...",
  "video_id": 123456789,
  "video_hash": "xh...",
  "title": "...",
  "description": "...",
  "duration": 123,            // seconds
  "views": 12345,
  "comments_count": 3,
  "created_timestamp": "1730000000",
  "date_ago": "2 months ago",
  "rating_percentage": 90,
  "likes": 1200,
  "dislikes": 12,
  "is_vr": false,
  "is_hd": true,
  "max_resolution": "1080p",
  "orientation": "straight",
  "uploader_name": "...",
  "uploader_subscribers": 1000,
  "categories": ["milf"],
  "tags": ["...", "..."],
  "pornstars": ["..."],
  "thumbnail": "https://...",
  "preview_thumbnail": "https://...",
  "m3u8_base_url": "https://..." // playback URL when authorized
}
```

This exactly mirrors the `Video` dataclass fields analyzed in
`docs/xhamster-api-analysis.md`; the Vega `Post`/`Info` types are derived from
it by the provider (title → `title`, thumbnail → `image`, duration/views →
`synopsis` line, categories → `tags`, uploader → `cast`, etc.).

## Service requirements (security & quality)

- **Credentials**: library credentials (login/session/backend secrets) live only
  in service environment variables — never in the public provider or its
  settings. The provider holds only a service-issued token (`apiKey`).
- **Validation**: validate every request (query/path params, token) with
  pydantic before touching the library.
- **Timeouts**: per-request upstream timeout (default 15 s, max 120 s) and an
  overall request deadline; abort downstream work on client disconnect.
- **Rate limiting**: the service must throttle requests to respect xHamster's
  terms and the library's own guidance (request delays, bounded concurrency,
  caching).
- **Data minimization**: return only the fields needed by the provider; never
  expose session cookies, login data, or library internals.
- **No bypass**: the service must not defeat DRM, access controls, anti-bot
  systems, or rate limits; it only relays what the authorized backend permits.

## Deployment requirements (when authorized)

- Separate repository and CI, distinct from this provider repo.
- Container: `python:3.12-slim`, install the library + `fastapi` + `uvicorn` +
  `pydantic`. **Ship the service's source with the image** (AGPL §13).
- TLS via reverse proxy (e.g. Caddy/Traefik/nginx); bind the service to a
  private network or token-protected public endpoint.
- Health endpoint (`/healthz`), structured logging, metrics, and startup checks
  that the authorized backend is reachable.
- Document in that repo: `AGENTS.md`/README with the contract above, env var
  table, and AGPL notice.

## What this repo contains for integration

- `providers/xhamster/api.ts` — the adapter contract + documented response
  types matching this schema (not wired: `apiNotAvailable` guards keep playback
  and data disabled).
- `providers/xhamster/config.ts` — `apiBaseUrl`/`apiKey` settings point at the
  service base URL / token once one exists.
- This document — the contract the future service must implement.

## Explicit non-goals (until authorization + legal review)

- No scraping-based listing/search/meta in the provider.
- No download sources (downloads always return an empty list).
- No stream URLs, DRM configurations, or mocked playback data.
