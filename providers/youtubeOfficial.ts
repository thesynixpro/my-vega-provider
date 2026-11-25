import { ProviderContext, Post, Info, Stream } from "./types";

export interface ChannelConfig { name: string; channelId: string; channelUrl: string; logo: string; }
export const YOUTUBE_LOGO = "https://www.google.com/s2/favicons?domain=youtube.com&sz=128";

export async function readChannelFeed(config: ChannelConfig, providerContext: ProviderContext, signal?: AbortSignal): Promise<Post[]> {
  const url = "https://www.youtube.com/feeds/videos.xml?channel_id=" + encodeURIComponent(config.channelId);
  const response = await providerContext.axios.get(url, {
    timeout: 20000, signal,
    headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/atom+xml,application/xml,text/xml,*/*" },
  });
  const xml = typeof response.data === "string" ? response.data : String(response.data || "");
  if (!xml || xml.length < 40) throw new Error(config.name + " returned an empty YouTube feed");
  const $ = providerContext.cheerio.load(xml, { xmlMode: true });
  const posts: Post[] = [];
  const seen: Record<string, boolean> = {};
  $("entry").each(function(this: any) {
    const entry = $(this);
    const id = String(entry.find("yt\\:videoId").first().text() || "").trim();
    const title = String(entry.find("title").first().text() || "").replace(/\\s+/g, " ").trim();
    if (!id || !title || seen[id]) return;
    seen[id] = true;
    const thumb = String(entry.find("media\\:thumbnail").first().attr("url") || "https://i.ytimg.com/vi/" + id + "/hqdefault.jpg");
    posts.push({ title, link: "https://www.youtube.com/watch?v=" + id, image: thumb, provider: config.name });
  });
  return posts;
}

export function makeMeta(config: ChannelConfig, link: string, providerContext: ProviderContext): Info {
  const idMatch = String(link || "").match(/[?&]v=([A-Za-z0-9_-]{6,})|youtu\.be\/([A-Za-z0-9_-]{6,})/);
  const id = idMatch ? (idMatch[1] || idMatch[2]) : "";
  const safeLink = id ? "https://www.youtube.com/watch?v=" + id : config.channelUrl;
  const image = id ? "https://i.ytimg.com/vi/" + id + "/hqdefault.jpg" : config.logo;
  const title = id ? "Official anime video – " + config.name : config.name;
  return {
    title, image, synopsis: "Official upload from " + config.name + ". Video playback is handled by YouTube; availability and language tracks depend on the publisher and your region.",
    imdbId: "", type: "movie", tags: ["Anime", "Official", "YouTube"], cast: [],
    linkList: [{ title: config.name, directLinks: [{ title: "Watch on YouTube", link: safeLink, type: "movie", image }] }], webUrl: safeLink,
  };
}

export function makeStream(config: ChannelConfig, link: string): Stream[] {
  const idMatch = String(link || "").match(/[?&]v=([A-Za-z0-9_-]{6,})|youtu\.be\/([A-Za-z0-9_-]{6,})/);
  const id = idMatch ? (idMatch[1] || idMatch[2]) : "";
  if (!id) return [{ server: config.name, link: config.channelUrl, type: "webview", tag: "Open official channel" }];
  return [{ server: config.name + " – YouTube", link: "https://www.youtube.com/watch?v=" + id, type: "webview", tag: "Official YouTube player" }];
}
