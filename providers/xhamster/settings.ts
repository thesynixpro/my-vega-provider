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
      label: "Preferred Playback Quality",
      description: "Default playback resolution when the official API returns multiple qualities",
      options: [
        { label: "Auto (Best Available)", value: "auto" },
        { label: "4K (2160p)", value: "2160" },
        { label: "1080p Full HD", value: "1080" },
        { label: "720p HD", value: "720" },
        { label: "480p SD", value: "480" },
      ],
      defaultValue: "auto",
    },
    {
      key: "autoQuality",
      type: "toggle",
      label: "Auto Quality Selection",
      description: "Automatically pick the best quality allowed by your connection and preferences",
      defaultValue: true,
    },
    {
      key: "apiBaseUrl",
      type: "text",
      label: "Authorized Backend Base URL",
      description:
        "Base URL of the authorized backend service (official xHamster API or the self-hosted integration service) provided after API authorization",
      placeholder: "https://backend.example.com/api",
      defaultValue: "",
    },
    {
      key: "apiKey",
      type: "text",
      label: "Authorized Backend API Key",
      description: "Access token issued by the authorized backend service",
      placeholder: "xxxx-xxxx-xxxx-xxxx",
      defaultValue: "",
    },
    {
      key: "requestTimeoutSecs",
      type: "number",
      label: "Request Timeout (seconds)",
      description: "Maximum time to wait for official API responses",
      defaultValue: 15,
      min: 5,
      max: 120,
    },
    {
      key: "includeDrmStreams",
      type: "toggle",
      label: "Include Officially Licensed (DRM) Sources",
      description: "Include DRM-protected playback sources when the authorized API provides them",
      defaultValue: true,
    },
  ];
};
