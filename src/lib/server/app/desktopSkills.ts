import type {
  DesktopSkillItem,
  DesktopSkillScope,
  DesktopSkillsSummary
} from "$lib/shared/desktop";
import { createHash } from "node:crypto";
import type { RuntimeSettings } from "$lib/server/settings/schema";

const KNOWN_SCOPES: readonly DesktopSkillScope[] = ["global", "bot", "chat"];

/**
 * The shape of a skill item produced by the shared skills route. Only the
 * fields the Desktop mapper reads are declared; `filePath` and `baseDir`
 * (absolute on-disk paths) are present on the source item but intentionally
 * untyped here so they are dropped.
 */
interface SharedSkillItem {
  name: string;
  description: string;
  scope: string;
  enabled: boolean;
  mcpServers?: string[];
  botId?: string;
  chatId?: string;
  filePath?: string;
}

/**
 * The slice of the shared skills route response the Desktop mapper consumes.
 * `dataRoot`/`globalSkillsDir` (absolute paths), `diagnostics`, the raw
 * `searchProviders`, and the credential-bearing `skillSearch.api` key are
 * either dropped or reduced below.
 */
interface SharedSkillsResponse {
  items?: SharedSkillItem[];
  skillSearch?: {
    local?: { enabled?: boolean };
    api?: { enabled?: boolean; provider?: string; model?: string; maxTokens?: number; temperature?: number; timeoutMs?: number; minConfidence?: number };
  };
  searchProviders?: Array<{ id: string; name: string; defaultModel: string; models: string[] }>;
}

function skillId(filePath: string): string {
  return createHash("sha256").update(filePath).digest("hex").slice(0, 16);
}

function coerceScope(value: string): DesktopSkillScope {
  return (KNOWN_SCOPES as readonly string[]).includes(value) ? (value as DesktopSkillScope) : "global";
}

/**
 * Maps a shared skill item into a path-safe Desktop view. The skill `filePath`
 * and `baseDir` (absolute on-disk paths) are dropped; `mcpServers` is reduced
 * to a count. The desktop skills list only needs identity, scope, enabled
 * state, and ownership.
 */
export function buildDesktopSkillItem(item: SharedSkillItem): DesktopSkillItem {
  return {
    id: skillId(item.filePath ?? `${item.scope}:${item.botId ?? ""}:${item.chatId ?? ""}:${item.name}`),
    name: item.name,
    description: item.description ?? "",
    scope: coerceScope(item.scope),
    enabled: item.enabled !== false,
    mcpServerCount: Array.isArray(item.mcpServers) ? item.mcpServers.length : 0,
    botId: item.botId ?? "",
    chatId: item.chatId ?? ""
  };
}

export function buildDesktopSkillsSummary(response: SharedSkillsResponse): DesktopSkillsSummary {
  const items = Array.isArray(response.items) ? response.items.map(buildDesktopSkillItem) : [];
  const search = response.skillSearch ?? {};
  return {
    items,
    counts: {
      total: items.length,
      enabled: items.filter((item) => item.enabled).length,
      global: items.filter((item) => item.scope === "global").length,
      bot: items.filter((item) => item.scope === "bot").length,
      chat: items.filter((item) => item.scope === "chat").length
    },
    search: {
      localEnabled: search.local?.enabled === true,
      apiEnabled: search.api?.enabled === true,
      apiProvider: search.api?.provider ?? "",
      apiModel: search.api?.model ?? ""
      ,maxTokens: Number(search.api?.maxTokens ?? 400),
      temperature: Number(search.api?.temperature ?? 0),
      timeoutMs: Number(search.api?.timeoutMs ?? 8000),
      minConfidence: Number(search.api?.minConfidence ?? 0.6),
      providers: Array.isArray(response.searchProviders) ? response.searchProviders.map((provider) => ({ ...provider, models: [...provider.models] })) : []
    }
  };
}

export function resolveDesktopSkillPath(response: SharedSkillsResponse, id: string): string {
  const item = response.items?.find((candidate) => candidate.filePath && skillId(candidate.filePath) === id);
  if (!item?.filePath) throw new Error("Unknown skill");
  return item.filePath;
}

export function buildDesktopSkillSearchSettings(settings: RuntimeSettings, input: Extract<import("$lib/shared/desktop").DesktopSkillsUpdateRequest, { kind: "search" }>): RuntimeSettings["skillSearch"] {
  const provider = input.apiProvider.trim();
  const model = input.apiModel.trim();
  if (input.apiEnabled) {
    const configured = settings.customProviders.find((item) => item.id === provider && item.enabled !== false && item.models.some((candidate) => candidate.id === model));
    if (!configured) throw new Error("Select an enabled Provider and model");
  }
  return {
    local: { enabled: input.localEnabled },
    api: {
      ...settings.skillSearch.api,
      enabled: input.apiEnabled,
      provider,
      model,
      maxTokens: Math.min(4096, Math.max(128, Number(input.maxTokens) || 400)),
      temperature: Math.min(1, Math.max(0, Number(input.temperature) || 0)),
      timeoutMs: Math.min(60000, Math.max(1000, Number(input.timeoutMs) || 8000)),
      minConfidence: Math.min(1, Math.max(0, Number(input.minConfidence) || 0.6))
    }
  };
}
