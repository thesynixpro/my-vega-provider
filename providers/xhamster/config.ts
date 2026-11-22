import { ProviderContext } from "../types";

export const PROVIDER_ID = "xhamster";
export const PROVIDER_DISPLAY_NAME = "xHamster";
export const PROVIDER_VERSION = "1.0";
export const PROVIDER_WEBSITE = "https://xhamster.com";

export const DEFAULT_REQUEST_TIMEOUT_SECS = 15;
export const MIN_REQUEST_TIMEOUT_SECS = 5;
export const MAX_REQUEST_TIMEOUT_SECS = 120;
export const DEFAULT_PREFERRED_QUALITY = "auto";

export interface ProviderSettings {
  apiBaseUrl: string;
  apiKey: string;
  preferredQuality: string;
  autoQuality: boolean;
  requestTimeoutSecs: number;
  includeDrmStreams: boolean;
}

export const DEFAULT_SETTINGS: ProviderSettings = {
  apiBaseUrl: "",
  apiKey: "",
  preferredQuality: DEFAULT_PREFERRED_QUALITY,
  autoQuality: true,
  requestTimeoutSecs: DEFAULT_REQUEST_TIMEOUT_SECS,
  includeDrmStreams: true,
};

function clamp(value: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

/**
 * Reads user settings from the provider kvStore and merges them with defaults.
 * Values configured in the Vega Provider Settings UI are stored by key.
 */
export async function readSettings(
  providerContext: ProviderContext,
): Promise<ProviderSettings> {
  const kvStore = providerContext.kvStore;

  const [apiBaseUrl, apiKey, preferredQuality, autoQuality, requestTimeoutSecs, includeDrmStreams] =
    await Promise.all([
      kvStore.get<string>("apiBaseUrl"),
      kvStore.get<string>("apiKey"),
      kvStore.get<string>("preferredQuality"),
      kvStore.get<boolean>("autoQuality"),
      kvStore.get<number>("requestTimeoutSecs"),
      kvStore.get<boolean>("includeDrmStreams"),
    ]);

  return {
    apiBaseUrl: (apiBaseUrl ?? DEFAULT_SETTINGS.apiBaseUrl).trim().replace(/\/+$/, ""),
    apiKey: (apiKey ?? DEFAULT_SETTINGS.apiKey).trim(),
    preferredQuality: preferredQuality ?? DEFAULT_SETTINGS.preferredQuality,
    autoQuality: autoQuality ?? DEFAULT_SETTINGS.autoQuality,
    requestTimeoutSecs: clamp(
      requestTimeoutSecs,
      MIN_REQUEST_TIMEOUT_SECS,
      MAX_REQUEST_TIMEOUT_SECS,
      DEFAULT_REQUEST_TIMEOUT_SECS,
    ),
    includeDrmStreams: includeDrmStreams ?? DEFAULT_SETTINGS.includeDrmStreams,
  };
}

export function hasApiConfig(settings: ProviderSettings): boolean {
  return settings.apiBaseUrl.length > 0 && settings.apiKey.length > 0;
}

export function requireApiConfig(settings: ProviderSettings): void {
  if (!hasApiConfig(settings)) {
    throw new Error(
      `${PROVIDER_DISPLAY_NAME}: official API configuration is missing. Open the provider settings and enter the API base URL and API key supplied by xHamster.`,
    );
  }
}
