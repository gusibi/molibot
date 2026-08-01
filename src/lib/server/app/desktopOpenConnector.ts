import type { RuntimeSettings } from "$lib/server/settings/schema.js";
import { config as runtimeConfig } from "$lib/server/app/env.js";
import { readJsonFile, writeJsonFile } from "$lib/server/infra/db/storage.js";
import { resolve } from "node:path";

const DEFAULT_BASE_URL = "https://opc.eztoolab.com";
const REQUEST_TIMEOUT_MS = 12_000;
const CACHE_VERSION = 1;
const DEFAULT_CACHE_FILE = resolve(runtimeConfig.dataDir, "cache", "open-connector-catalog.json");

type JsonRecord = Record<string, unknown>;

interface OpenConnectorCatalogCache {
  version: number;
  baseUrl: string;
  providers: ReturnType<typeof providerItem>[];
  connections: Array<Omit<NonNullable<ReturnType<typeof connectionItem>>, "active">>;
  refreshedAt: string;
}

const googleIconNames: Record<string, string> = {
  google_analytics: "google-analytics",
  gmail: "google-gmail",
  googlephotos: "google-photos",
  google_search_console: "google-search-console",
  google_cloud_sts: "google-cloud",
  googledrive: "google-drive",
  googlecalendar: "google-calendar",
  google_address_validation: "google-maps",
  google_routes: "google-maps"
};

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function arrayPayload(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const root = record(value);
  if (Array.isArray(root.data)) return root.data;
  if (Array.isArray(root.items)) return root.items;
  const data = record(root.data);
  for (const key of ["providers", "connections", "apps", "items"]) {
    if (Array.isArray(data[key])) return data[key];
    if (Array.isArray(root[key])) return root[key] as unknown[];
  }
  return [];
}

export function normalizeOpenConnectorUrl(value: unknown, fallback = DEFAULT_BASE_URL): string {
  const raw = String(value ?? fallback).trim().replace(/\/+$/, "");
  const url = new URL(raw);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error("OpenConnector URL must use HTTPS (HTTP is allowed only for localhost).");
  }
  if (url.username || url.password) throw new Error("OpenConnector URL must not contain credentials.");
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/$/, "");
}

function safeConsoleUrl(value: unknown, baseUrl: string): string {
  const fallback = `${baseUrl}/providers`;
  const url = new URL(String(value ?? "").trim() || fallback);
  if (url.origin !== new URL(baseUrl).origin) throw new Error("OpenConnector Console URL must use the same origin as the runtime.");
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/$/, "");
}

function providerItem(value: unknown) {
  const item = record(value);
  const service = String(item.service ?? item.id ?? "").trim();
  if (!service) return null;
  const actions = Array.isArray(item.actions) ? item.actions : [];
  return {
    service,
    displayName: String(item.displayName ?? item.name ?? service).trim() || service,
    description: String(item.description ?? "").trim(),
    categories: Array.isArray(item.categories) ? item.categories.map((entry) => {
      const category = record(entry);
      return String(category.displayName ?? category.id ?? entry).trim();
    }).filter(Boolean) : [],
    authTypes: Array.isArray(item.authTypes) ? item.authTypes.map(String).map((entry) => entry.trim()).filter(Boolean) : [],
    iconUrl: providerIconUrl(service, item.iconUrl, item.homepageUrl),
    homepageUrl: /^https?:\/\//.test(String(item.homepageUrl ?? "")) ? String(item.homepageUrl) : "",
    actionCount: actions.length,
    locallyExecutableActionCount: actions.filter((action) => record(action).execution && record(record(action).execution).locallyExecutable !== false).length
  };
}

function providerIconUrl(service: string, iconValue: unknown, homepageValue: unknown): string {
  const iconUrl = String(iconValue ?? "").trim();
  if (/^https?:\/\//.test(iconUrl)) return iconUrl;
  const googleIcon = googleIconNames[service] ?? (/google/i.test(String(homepageValue ?? "")) ? "google-icon" : "");
  if (googleIcon) return `https://api.iconify.design/logos/${googleIcon}.svg`;
  try {
    const hostname = new URL(String(homepageValue ?? "")).hostname;
    return hostname ? `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(hostname)}` : "";
  } catch {
    return "";
  }
}

function connectionItem(value: unknown) {
  if (typeof value === "string") {
    const service = value.trim();
    return service ? { service, connectionName: "default", authType: "", displayName: "", active: true } : null;
  }
  const item = record(value);
  const service = String(item.service ?? item.id ?? "").trim();
  if (!service) return null;
  const profile = record(item.profile);
  return {
    service,
    connectionName: String(item.connectionName ?? item.alias ?? "default").trim() || "default",
    authType: String(item.authType ?? "").trim(),
    displayName: String(item.displayName ?? item.accountLabel ?? profile.displayName ?? profile.accountId ?? "").trim(),
    active: item.status === undefined ? true : item.status === "active"
  };
}

async function runtimeGet(baseUrl: string, token: string, path: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: controller.signal
    });
    const text = await response.text();
    let payload: unknown;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
    if (!response.ok) {
      const message = String(record(record(payload).error).message ?? record(payload).message ?? `HTTP ${response.status}`);
      throw new Error(response.status === 401 ? "Runtime Token 无效或已失效。" : `OpenConnector request failed: ${message}`);
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

export function projectOpenConnectorConfig(settings: RuntimeSettings) {
  const config = settings.openConnector;
  return {
    enabled: config.enabled,
    baseUrl: config.baseUrl,
    consoleUrl: config.consoleUrl || `${config.baseUrl}/providers`,
    tokenConfigured: Boolean(config.runtimeToken)
  };
}

export async function buildDesktopOpenConnectorSummary(settings: RuntimeSettings, options: { refresh?: boolean; cacheFile?: string } = {}) {
  const config = projectOpenConnectorConfig(settings);
  if (!config.enabled || !config.tokenConfigured) {
    return { config, state: config.enabled ? "unconfigured" as const : "disabled" as const, providers: [], connections: [], error: "", refreshedAt: "" };
  }
  const cacheFile = options.cacheFile ?? DEFAULT_CACHE_FILE;
  const cached = readJsonFile<OpenConnectorCatalogCache | null>(cacheFile, null);
  if (!options.refresh) {
    const validCache = cached?.version === CACHE_VERSION && cached.baseUrl === config.baseUrl;
    return {
      config,
      state: "ready" as const,
      providers: validCache ? cached.providers.filter((item): item is NonNullable<typeof item> => Boolean(item)) : [],
      connections: validCache ? cached.connections : [],
      error: "",
      refreshedAt: validCache ? cached.refreshedAt : ""
    };
  }
  try {
    const [providersPayload, connectionsPayload] = await Promise.all([
      runtimeGet(config.baseUrl, settings.openConnector.runtimeToken, "/v1/providers"),
      runtimeGet(config.baseUrl, settings.openConnector.runtimeToken, "/v1/apps")
    ]);
    const providers = arrayPayload(providersPayload).map(providerItem).filter((item): item is NonNullable<ReturnType<typeof providerItem>> => Boolean(item));
    const connections = arrayPayload(connectionsPayload)
      .map(connectionItem)
      .filter((item): item is NonNullable<ReturnType<typeof connectionItem>> => Boolean(item?.active))
      .map(({ active: _active, ...item }) => item);
    const refreshedAt = new Date().toISOString();
    writeJsonFile(cacheFile, { version: CACHE_VERSION, baseUrl: config.baseUrl, providers, connections, refreshedAt } satisfies OpenConnectorCatalogCache);
    return { config, state: "ready" as const, providers, connections, error: "", refreshedAt };
  } catch (cause) {
    const error = cause instanceof Error && cause.name === "AbortError" ? "OpenConnector 请求超时。" : cause instanceof Error ? cause.message : String(cause);
    return { config, state: "error" as const, providers: [], connections: [], error, refreshedAt: new Date().toISOString() };
  }
}

export function saveOpenConnectorSettings(settings: RuntimeSettings, input: {
  enabled?: boolean;
  baseUrl?: string;
  consoleUrl?: string;
  runtimeToken?: string;
  clearRuntimeToken?: boolean;
}): RuntimeSettings["openConnector"] {
  const baseUrl = normalizeOpenConnectorUrl(input.baseUrl, settings.openConnector.baseUrl);
  const consoleUrl = safeConsoleUrl(input.consoleUrl, baseUrl);
  const replacementToken = String(input.runtimeToken ?? "").trim();
  return {
    enabled: input.enabled === undefined ? settings.openConnector.enabled : Boolean(input.enabled),
    baseUrl,
    consoleUrl,
    runtimeToken: input.clearRuntimeToken ? "" : replacementToken || settings.openConnector.runtimeToken
  };
}
