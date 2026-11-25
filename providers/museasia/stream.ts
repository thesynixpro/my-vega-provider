import { ProviderContext, Stream } from "../types";
import { makeStream } from "../youtubeOfficial";
import { config } from "./config";
export const getStream = async function({ link }: { link: string; type: string; signal?: AbortSignal; providerContext: ProviderContext; isDownload?: boolean }): Promise<Stream[]> { return makeStream(config, link); };
