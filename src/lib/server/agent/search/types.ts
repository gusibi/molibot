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
  siteName?: string;
  favicon?: string;
  displayUrl?: string;
  citationId?: string;
  providerRefId?: string | number;
}

export interface WebSearchCitation {
  id: string;
  index: number;
  title: string;
  url: string;
  snippet?: string;
  siteName?: string;
  publishedAt?: string;
  source?: string;
  providerRefId?: string | number;
}

export interface WebSearchUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  credits?: number;
  costUsd?: number;
}

export interface WebSearchMetadata {
  searchedAt: string;
  resultCount: number;
  summarySource: "provider" | "generated" | "fallback" | "none";
  providerRequestId?: string;
  usage?: WebSearchUsage;
}

export interface WebSearchAttempt {
  engine: WebSearchEngine;
  route: WebSearchRouteMode;
  ok: boolean;
  skipped?: boolean;
  error?: string;
  resultCount?: number;
  timeoutMs?: number;
  request?: WebSearchRequestLog;
}

export interface WebSearchRequestLog {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface WebSearchResponse {
  id: string;
  engine: WebSearchEngine | null;
  route: WebSearchRouteMode;
  query: string;
  results: WebSearchResult[];
  citations: WebSearchCitation[];
  summary: string;
  metadata: WebSearchMetadata;
  diagnostics: {
    attempts: WebSearchAttempt[];
    fallbackOrder: WebSearchEngine[];
  };
}

export interface WebSearchProviderContext {
  settings: WebSearchSettings;
  fetch: typeof fetch;
  signal?: AbortSignal;
  requests?: WebSearchRequestLog[];
}

export interface WebSearchProviderResult {
  results: WebSearchResult[];
  answer?: string;
  requestId?: string;
  usage?: WebSearchUsage;
}

export interface WebSearchProvider {
  id: WebSearchEngine;
  search(input: Required<Pick<WebSearchInput, "query">> & WebSearchInput, context: WebSearchProviderContext): Promise<WebSearchProviderResult>;
}
