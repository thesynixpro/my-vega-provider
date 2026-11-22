import { Stream, ProviderContext } from "../types";
import { apiNotAvailable } from "./api";
import { readSettings, requireApiConfig } from "./config";

export const getStream = async function ({
  link,
  type,
  signal,
  providerContext,
  isDownload,
}: {
  link: string;
  type: string;
  signal?: AbortSignal;
  providerContext: ProviderContext;
  isDownload?: boolean;
}): Promise<Stream[]> {
  // Authorized video streaming only. Downloads are unsupported until official
  // playback is implemented and tested, so download requests always return an
  // empty list.
  if (isDownload === true) {
    return [];
  }

  const settings = await readSettings(providerContext);

  // Without official API credentials the request fails loudly. When the
  // authorized playback spec arrives, resolve HLS/MP4 sources here, apply
  // `settings.preferredQuality` / `settings.autoQuality`, set the required
  // playback headers, refresh expired URLs, and omit DRM streams when
  // `settings.includeDrmStreams` is false.
  requireApiConfig(settings);

  return apiNotAvailable("authorized playback");
};
