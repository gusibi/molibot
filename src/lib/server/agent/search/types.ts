import type { WebSearchEngineId, WebSearchRoute, WebSearchSettings } from "$lib/server/settings/index.js";

export type WebSearchEngine = WebSearchEngineId;
export type WebSearchRouteMode = WebSearchRoute;

export interface WebSearchInput {
  query: string;
  maxResults?: number;
  engine?: WebSearchEngine | "auto";
  route?: WebSearchRouteMode;
  includeDomains?: string[];
  excludeDomains?: string[];
}

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  source?: string;
  publishedAt?: string;
}

export interface WebSearchAttempt {
  engine: WebSearchEngine;
  route: WebSearchRouteMode;
  ok: boolean;
  skipped?: boolean;
  error?: string;
  resultCount?: number;
  timeoutMs?: number;
}

export interface WebSearchResponse {
  engine: WebSearchEngine | null;
  route: WebSearchRouteMode;
  query: string;
  results: WebSearchResult[];
  summary: string;
  diagnostics: {
    attempts: WebSearchAttempt[];
    fallbackOrder: WebSearchEngine[];
  };
}

export interface WebSearchProviderContext {
  settings: WebSearchSettings;
  fetch: typeof fetch;
  signal?: AbortSignal;
}

export interface WebSearchProvider {
  id: WebSearchEngine;
  search(input: Required<Pick<WebSearchInput, "query">> & WebSearchInput, context: WebSearchProviderContext): Promise<WebSearchResult[]>;
}
