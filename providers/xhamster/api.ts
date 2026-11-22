import { Info, Post, Stream } from "../types";
import { PROVIDER_DISPLAY_NAME } from "./config";

export interface ApiRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * Documented response shape of the authorized integration service.
 *
 * Grounded in the real data model of the analyzed Python project
 * (`unofficial-api-for-xhamster` v3.0.0, `Video` dataclass) and in the
 * service contract in docs/python-integration.md. Every field here is one the
 * analyzed source can actually produce. Nothing is invented.
 */
export interface BackendVideo {
  url: string;
  video_id: number | null;
  video_hash: string | null;
  title: string | null;
  description: string | null;
  duration: number | null;
  views: number | null;
  comments_count: number | null;
  created_timestamp: string | number | null;
  date_ago: string | null;
  rating_percentage: number | null;
  likes: number | null;
  dislikes: number | null;
  is_vr: boolean | null;
  is_hd: boolean | null;
  max_resolution: string | null;
  orientation: string | null;
  uploader_name: string | null;
  uploader_subscribers: number | null;
  categories: string[] | null;
  tags: string[] | null;
  pornstars: string[] | null;
  thumbnail: string | null;
  preview_thumbnail: string | null;
  m3u8_base_url: string | null;
}

export interface BackendListResponse {
  items: BackendVideo[];
  page: number;
  page_size: number;
  has_more: boolean;
}

export interface BackendStreamSource {
  server: string;
  link: string;
  type: "hls" | "mp4";
  quality?: string;
  headers?: Record<string, string>;
}

export interface BackendErrorResponse {
  error: string;
  message: string;
}

/**
 * Authorized integration-service adapter contract.
 *
 * xHamster and the Vega owner have held discussions, but the official API and
 * playback specifications have NOT been supplied yet. Verbal discussions are
 * not treated as technical API authorization. Until a real, authorized backend
 * exists (see docs/python-integration.md), no method is wired: the provider
 * never fabricates API endpoints, stream URLs, or mock playback data, and never
 * bypasses access controls, DRM, anti-bot protection, or rate limits.
 *
 * When an authorized backend exists, implement each method with the injected
 * `providerContext.axios` against `settings.apiBaseUrl`, authenticating with
 * `settings.apiKey`, mapping `BackendVideo` → `Post`/`Info` and
 * `BackendStreamSource` → `Stream`. Config validation and settings live in
 * ./config.
 */
export interface XhamsterApiAdapter {
  getPopularVideos(page: number, options?: ApiRequestOptions): Promise<Post[]>;
  getLatestVideos(page: number, options?: ApiRequestOptions): Promise<Post[]>;
  getVideosByFilter(filter: string, page: number, options?: ApiRequestOptions): Promise<Post[]>;
  searchVideos(query: string, page: number, options?: ApiRequestOptions): Promise<Post[]>;
  getVideoInfo(link: string, options?: ApiRequestOptions): Promise<Info>;
  resolvePlayback(link: string, type: string, options?: ApiRequestOptions): Promise<Stream[]>;
}

/**
 * Thrown by every feature that depends on the authorized integration backend
 * until xHamster supplies its API/playback documentation and the authorized
 * service is deployed and tested.
 */
export function apiNotAvailable(feature: string): never {
  throw new Error(
    `${PROVIDER_DISPLAY_NAME}: the official API/playback specification for "${feature}" has not been supplied by xHamster yet, so this feature is disabled.`,
  );
}
