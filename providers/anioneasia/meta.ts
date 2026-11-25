import { ProviderContext, Info } from "../types";
import { makeMeta } from "../youtubeOfficial";
import { config } from "./config";
export const getMeta = async function({ link, providerContext }: { link: string; providerContext: ProviderContext }): Promise<Info> { return makeMeta(config, link, providerContext); };
