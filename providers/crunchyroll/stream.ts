import { ProviderContext, Stream } from "../types";
export const getStream = async function(): Promise<Stream[]> { return [{ server: "Crunchyroll", link: "https://www.crunchyroll.com/", type: "webview", tag: "Open official service" }]; };
