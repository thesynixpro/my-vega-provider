import { ProviderContext, SettingsField } from "../types";

export const getSettingsSchema = async function ({
  providerContext,
}: {
  providerContext: ProviderContext;
}): Promise<SettingsField[]> {
  return [
    {
      key: "preferredQuality",
      type: "select",
      label: "Preferred Quality",
      description: "Preferred resolution order used when several streams exist",
      options: [
        { label: "Auto (best available)", value: "auto" },
        { label: "1080p", value: "1080" },
        { label: "720p", value: "720" },
        { label: "480p", value: "480" },
        { label: "360p", value: "360" },
      ],
      defaultValue: "auto",
    },
    {
      key: "allowedResolutions",
      type: "multiselect",
      label: "Allowed Resolutions",
      description: "Only return streams in these resolutions",
      options: [
        { label: "1080p", value: "1080" },
        { label: "720p", value: "720" },
        { label: "480p", value: "480" },
        { label: "360p", value: "360" },
      ],
      defaultValue: ["1080", "720", "480", "360"],
    },
    {
      key: "includeHls",
      type: "toggle",
      label: "Include HLS (m3u8) streams",
      description: "Add adaptive HLS playlists when the page exposes them",
      defaultValue: true,
    },
    {
      key: "baseUrlOverride",
      type: "text",
      label: "Custom Domain / Mirror URL",
      description: "Override the default domain if it is blocked in your region",
      placeholder: "https://www.pornhub.com",
      defaultValue: "",
    },
    {
      key: "requestTimeoutSecs",
      type: "number",
      label: "Request Timeout (seconds)",
      description: "Maximum time to wait for a page response",
      defaultValue: 20,
      min: 5,
      max: 60,
    },
    {
      key: "retryAttempts",
      type: "number",
      label: "Retry Attempts",
      description: "How many times a failed request is retried",
      defaultValue: 2,
      min: 0,
      max: 5,
    },
  ];
};
