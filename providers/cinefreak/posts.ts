import { ProviderContext, Post } from "../types";
const item: Post = { title: "Open CineFreak website", link: "https://cinefreak.net/", image: "https://www.google.com/s2/favicons?domain=cinefreak.net&sz=128", tag: "External website" };
export const getPosts = async function(): Promise<Post[]> { return [item]; };
export const getSearchPosts = async function({ searchQuery }: { searchQuery: string; page: number; providerValue: string; signal: AbortSignal; providerContext: ProviderContext }): Promise<Post[]> { return /cinefreak|anime|cartoon|movie|dub/i.test(String(searchQuery || "")) ? [item] : []; };
