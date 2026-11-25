import { ProviderContext, Post } from "../types";
const item: Post = { title: "Open ToonStream website", link: "https://toonstream.us/home", image: "https://www.google.com/s2/favicons?domain=toonstream.us&sz=128", tag: "External website" };
export const getPosts = async function(): Promise<Post[]> { return [item]; };
export const getSearchPosts = async function({ searchQuery }: { searchQuery: string; page: number; providerValue: string; signal: AbortSignal; providerContext: ProviderContext }): Promise<Post[]> { return /toonstream|anime|cartoon|movie|dub/i.test(String(searchQuery || "")) ? [item] : []; };
