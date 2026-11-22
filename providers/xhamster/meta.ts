import { Info, ProviderContext } from "../types";
import { apiNotAvailable } from "./api";
import { readSettings, requireApiConfig } from "./config";

export const getMeta = async function ({
  link,
  providerContext,
}: {
  link: string;
  providerContext: ProviderContext;
}): Promise<Info> {
  const settings = await readSettings(providerContext);

  // Never return fabricated metadata. Without official API credentials the
  // request fails loudly with an actionable message.
  requireApiConfig(settings);

  return apiNotAvailable("video metadata");
};
