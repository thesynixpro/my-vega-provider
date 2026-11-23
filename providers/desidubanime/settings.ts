import { ProviderContext, SettingsField } from "../types";
import { DEFAULT_BASE_URL } from "./common";

export const getSettingsSchema = async function({ providerContext }: { providerContext: ProviderContext }): Promise<SettingsField[]> {
  return [
    { key: "preferredQuality", type: "select", label: "Preferred Quality", description: "Preference used by the source website", options: [
      { label: "Auto", value: "auto" }, { label: "1080p", value: "1080" }, { label: "720p", value: "720" }, { label: "480p", value: "480" }
    ], defaultValue: "auto" },
    { key: "allowedResolutions", type: "multiselect", label: "Allowed Resolutions", description: "Resolution preference", options: [
      { label: "1080p", value: "1080" }, { label: "720p", value: "720" }, { label: "480p", value: "480" }
    ], defaultValue: ["1080", "720", "480"] },
    { key: "includeHls", type: "toggle", label: "Use source website player", description: "Open the original website player", defaultValue: true },
    { key: "baseUrlOverride", type: "text", label: "Custom Domain / Mirror URL", description: "Optional domain override", placeholder: DEFAULT_BASE_URL, defaultValue: "" },
    { key: "requestTimeoutSecs", type: "number", label: "Request Timeout (seconds)", defaultValue: 25, min: 5, max: 60 },
    { key: "retryAttempts", type: "number", label: "Retry Attempts", defaultValue: 2, min: 0, max: 5 }
  ];
};
