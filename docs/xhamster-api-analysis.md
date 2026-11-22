# Analysis: `unofficial-api-for-xhamster` (v3.0.0)

Source of this analysis: `api/unofficial-api-for-xhamster-main/` — the extracted
Python project. It is **read-only reference material**. No code was copied from it
into this repository.

- Author: Johannes Habel (`EchterAlsFake@proton.me`)
- License: **AGPL-3.0-only** (see `LICENSE` and `docs/license-review.md`)
- Runtime: Python >= 3.12, async (`asyncio`)
- Distribution: `pip install unofficial-api-for-xhamster`

## What it is

An **asynchronous Python API wrapper and scraper** for `xhamster.com`. It is
explicitly **unofficial and unaffiliated** with xHamster. It provides a library
interface and a small CLI (`xhamster_api --download <url>`); it does **not** ship
an HTTP service that third parties can call.

## Architecture

The project is a thin provider layer over the reusable networking package
[`eaf_base_api`](https://github.com/EchterAlsFake/eaf_base_api) (`BaseCore`,
`RuntimeConfig`):

| Layer | Technology | Role |
|---|---|---|
| HTTP client | `curl_cffi.AsyncSession` | Browser fingerprint impersonation (defaults to Chrome), optional custom JA3 fingerprint, HTTP/1.1-3, proxy support (HTTP/HTTPS/SOCKS), bandwidth limiting, DNS-over-HTTPS, SSL toggle |
| HTML parsing | `selectolax.lexbor.LexborHTMLParser` | Fast DOM parsing of listing/detail pages |
| JS-object parsing | `chompjs` | Parses `window.initials=` JSON embedded in page scripts |
| HLS | `m3u8` | Manifest handling for HLS-based downloads |
| Caching | `eaf_base_api` | Automatic response caching with configurable limits |

`RuntimeConfig` also supports request delays, and separate video/page
concurrency controls — i.e. it is built to be polite to the source site but still
performs page scraping.

## Public entry points

### `Client`

| Method | Purpose |
|---|---|
| `get_video(url)` | Full metadata + HLS base URL for one video |
| `get_short(url)` | Metadata for a short/moment |
| `get_pornstar(url)` / `get_creator(url)` / `get_channel(url)` | Profile metadata + paginated video/short listings |
| `get_user(url)` | Alias for `get_creator` |
| `search_videos(query, minimum_quality, sort_by, category, vr, full_length_only, min_duration, date, production, fps, pages, start_page)` | Filtered video search |
| `login(username, password, cookies)` | Site login (via `https://xhamster.com/x-api`), returns `Account` |

### `Account`

| Method | Purpose |
|---|---|
| `get_liked_videos(pages, start_page)` | Liked videos for a logged-in account |
| `get_account_playlist(url, pages, start_page)` | A private account playlist |

### Profile models

`Channel`, `Pornstar`, `Creator` expose `name`, `subscribers_count`,
`videos_count`, `total_views_count`, `avatar_url`, `pornstar_information`, and
paginated `videos(...)` / `get_shorts(...)` listings.

### Downloading

`Video.download(config)` and `Short.download(config)` with
`DownloadConfigHLS(quality="best"|"half"|"worst", path=..., no_title=...)`.

## Data model — `Video` dataclass (mirrors the site's fields)

```
url, video_id, video_hash, title, rating_percentage, likes, dislikes,
uploader_name, uploader_subscribers, tags, categories, pornstars,
thumbnail, preview_thumbnail, m3u8_base_url, description, duration, views,
comments_count, created_timestamp, date_ago, is_vr, is_hd, max_resolution,
orientation
```

## Data model — `Short` dataclass

```
url, title, tags, thumbnail, video_id, comment_count, duration, created_at,
poster_url, author_link, author_logo, m3u8_base_url, likes, views,
author_subscribers, author, preview_video
```

## Listing & search behavior

- Listings (home feeds, categories, channels, search) are extracted from the
  `window.initials=` JSON blob with a DOM fallback (`extractor_videos`,
  `extractor_shorts`).
- Pagination contract (3.0.0): one-based pages; `pages=N` consumes at most N
  source pages; `pages="all"` follows navigation to exhaustion; invalid page
  values are rejected. This mirrors the site's own pagination links.
- Search supports: quality (`720p`/`1080p`/`2160p`), sort (`views`, `newest`,
  `best`, `longest`), category, VR format, full-length, minimum duration, date
  window, production type, and FPS.

## Error model

Rethrown from `eaf_base_api`: `NotFound`, `NetworkError`, `BotDetection`,
`ProxyError`, `UnknownNetworkError`, `DownloadFailed`, `LoginFailed`. The
presence of a `BotDetection` error confirms the source site employs anti-bot
protection.

## Dependencies

```
selectolax, chompjs, eaf-base-api>=4.3.0, m3u8, curl_cffi   # required
av                                                                  # optional
```

Dev: `pytest`, `pytest-asyncio`.

## Tests

`tests/`: `test_account_extraction.py`, `test_edge_cases.py`,
`test_url_handling.py`; `xhamster_api/tests/`: `test_channel.py`,
`test_cli.py`, `test_creator.py`, `test_login.py`, `test_pornstar.py`,
`test_search.py`, `test_short.py`, `test_video.py`.

## Implications for the Vega provider

1. **No HTTP service to call.** The project is a library/CLI; a Vega provider
   cannot reach it over the network as-is. Any integration requires a separately
   deployed HTTP service that wraps it (see `docs/python-integration.md`).
2. **Unofficial and scraping-based.** It impersonates a browser, parses page
   HTML, and interacts directly with xhamster.com. This conflicts with the
   provider's mission of **authorized video streaming only** and with this
   project's rule against bypassing access controls, DRM, anti-bot protection,
   or rate limits. It may **not** be deployed for the public provider until
   xHamster authorizes the integration.
3. **AGPL-3.0 obligations.** Any modified version deployed as a network service
   must offer its Corresponding Source to network users (see
   `docs/license-review.md`).
4. **Useful reference.** The data model (video fields, quality, HLS base URLs,
   categories/tags, uploader info) grounds the provider's documented adapter
   contract in `providers/xhamster/api.ts` and is the basis for the designed
   service contract.
