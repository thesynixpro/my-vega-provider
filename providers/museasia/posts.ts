import { ProviderContext, Post } from "../types";
import { readChannelFeed } from "../youtubeOfficial";
import { config } from "./config";
export const getPosts = async function({ signal, providerContext }: { filter: string; page: number; providerValue: string; signal: AbortSignal; providerContext: ProviderContext }): Promise<Post[]> { return readChannelFeed(config, providerContext, signal); };
export const getSearchPosts = async function({ searchQuery, signal, providerContext }: { searchQuery: string; page: number; providerValue: string; signal: AbortSignal; providerContext: ProviderContext }): Promise<Post[]> { const q = String(searchQuery || "").toLowerCase().trim(); if (!q) return []; const posts = await readChannelFeed(config, providerContext, signal); return posts.filter(p => p.title.toLowerCase().includes(q)); };
