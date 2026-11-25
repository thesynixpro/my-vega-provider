import { ProviderContext, Post } from "../types";
const item: Post = { title: "Open Crunchyroll – official anime streaming", link: "https://www.crunchyroll.com/", image: "https://www.google.com/s2/favicons?domain=crunchyroll.com&sz=128", tag: "Official service" };
export const getPosts = async function(): Promise<Post[]> { return [item]; };
export const getSearchPosts = async function({ searchQuery }: { searchQuery: string; page: number; providerValue: string; signal: AbortSignal; providerContext: ProviderContext }): Promise<Post[]> { return /crunchyroll|anime|dub/i.test(String(searchQuery || "")) ? [item] : []; };
