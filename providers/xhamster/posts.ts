import { Post, ProviderContext } from "../types";
import { apiNotAvailable } from "./api";
import { hasApiConfig, readSettings } from "./config";

export const getPosts = async function ({
  filter,
  page,
  providerValue,
  signal,
  providerContext,
}: {
  filter: string;
  page: number;
  providerValue: string;
  signal: AbortSignal;
  providerContext: ProviderContext;
}): Promise<Post[]> {
  const settings = await readSettings(providerContext);

  // No official API credentials configured: return an empty list instead of
  // fabricating content. Once xHamster supplies its API spec, map `filter` to
  // the corresponding official endpoint and query it with `page` and `signal`.
  if (!hasApiConfig(settings)) {
    return [];
  }

  return apiNotAvailable("video listing");
};

export const getSearchPosts = async function ({
  searchQuery,
  page,
  providerValue,
  signal,
  providerContext,
}: {
  searchQuery: string;
  page: number;
  providerValue: string;
  signal: AbortSignal;
  providerContext: ProviderContext;
}): Promise<Post[]> {
  const settings = await readSettings(providerContext);

  if (!hasApiConfig(settings)) {
    return [];
  }

  return apiNotAvailable("video search");
};
