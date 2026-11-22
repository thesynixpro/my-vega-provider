import { Info, Post, Stream } from "../types";
import { PROVIDER_DISPLAY_NAME } from "./config";

export interface ApiRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * Official xHamster API adapter contract.
 *
 * xHamster and the Vega owner have held discussions, but the official API and
 * playback specifications have NOT been supplied yet. Verbal discussions are
 * not treated as technical API authorization.
 *
 * When the official documentation arrives, implement each method using the
 * injected `providerContext.axios` and `providerContext.commonHeaders`,
 * keeping config validation and settings in ./config. Until then every method
 * stays a placeholder that fails loudly: the provider never fabricates API
 * endpoints, stream URLs, or mock playback data, and never bypasses access
 * controls or DRM.
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
 * Thrown by every feature that depends on the official API until xHamster
 * supplies its API/playback documentation and authorized integration is built.
 */
export function apiNotAvailable(feature: string): never {
  throw new Error(
    `${PROVIDER_DISPLAY_NAME}: the official API/playback specification for "${feature}" has not been supplied by xHamster yet, so this feature is disabled.`,
  );
}
