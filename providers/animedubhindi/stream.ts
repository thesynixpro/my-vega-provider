import { Stream, ProviderContext } from "../types";
import { getBase, BRAND, sameOrigin } from "./common";

// The source page is opened as-is. This provider does not extract third-party file-host URLs.
export const getStream = async function({ link, providerContext, isDownload }: {
  link: string; type: string; signal?: AbortSignal; providerContext: ProviderContext; isDownload?: boolean;
}): Promise<Stream[]> {
  const base = await getBase(providerContext);
  let target = "";
  try { target = new URL(String(link || ""), base).toString(); } catch (e) { throw new Error(BRAND + " received an invalid page URL"); }
  if (!sameOrigin(base, target)) throw new Error(BRAND + " only opens pages from its configured domain");
  return [{ server: BRAND + "-Web", link: target, type: "webview", tag: isDownload ? "Open source page" : "Watch on source website" }];
};
