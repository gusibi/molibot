import type {
  DesktopBuiltinSkillState,
  DesktopSkillDetail,
  DesktopSkillFileEntry,
  DesktopSkillItem,
  DesktopSkillScope,
  DesktopSkillsSummary
} from "$lib/shared/desktop";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import type { Dirent } from "node:fs";
import { join, resolve, sep } from "node:path";
import type { RuntimeSettings } from "$lib/server/settings/schema";

const KNOWN_SCOPES: readonly DesktopSkillScope[] = ["global", "bot", "chat", "project"];

/** Preview cap for a Skill file. Larger text is truncated, never streamed whole. */
const MAX_PREVIEW_BYTES = 256 * 1024;
/** Bounds on the directory walk so an unexpected tree cannot stall the request. */
const MAX_DIR_ENTRIES = 1000;
const MAX_DIR_DEPTH = 8;

/**
 * The shape of a skill item produced by the shared skills route. Only the
 * fields the Desktop mappers read are declared; `filePath` and `baseDir`
 * (absolute on-disk paths) are present on the source item but dropped by the
 * list projection — the detail projection is the only reader of the path.
 */
export interface SharedSkillItem {
  name: string;
  description: string;
  scope: string;
  enabled: boolean;
  mcpServers?: string[];
  botId?: string;
  chatId?: string;
  filePath?: string;
  baseDir?: string;
}

/**
 * The slice of the shared skills route response the Desktop mappers consume.
 * `dataRoot`/`globalSkillsDir` (absolute paths), `diagnostics`, the raw
 * `searchProviders`, and the credential-bearing `skillSearch.api` key are
 * either dropped or reduced below.
 */
export interface SharedSkillsResponse {
  items?: SharedSkillItem[];
  skillSearch?: {
    local?: { enabled?: boolean };
    api?: { enabled?: boolean; provider?: string; model?: string; maxTokens?: number; temperature?: number; timeoutMs?: number; minConfidence?: number };
  };
  searchProviders?: Array<{ id: string; name: string; defaultModel: string; models: string[] }>;
}

export function desktopSkillId(filePath: string): string {
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
    id: desktopSkillId(item.filePath ?? `${item.scope}:${item.botId ?? ""}:${item.chatId ?? ""}:${item.name}`),
    name: item.name,
    description: item.description ?? "",
    scope: coerceScope(item.scope),
    enabled: item.enabled !== false,
    mcpServerCount: Array.isArray(item.mcpServers) ? item.mcpServers.length : 0,
    botId: item.botId ?? "",
    chatId: item.chatId ?? ""
  };
}

export function buildDesktopSkillsSummary(
  response: SharedSkillsResponse,
  /**
   * Built-in version state, supplied by the caller rather than read here: this
   * mapper is a pure projection of the shared route's payload, and the state
   * comes from the skills root on disk.
   */
  builtins: DesktopBuiltinSkillState[] = []
): DesktopSkillsSummary {
  const items = Array.isArray(response.items) ? response.items.map(buildDesktopSkillItem) : [];
  const search = response.skillSearch ?? {};
  return {
    items,
    builtins: builtins.map((builtin) => ({ ...builtin })),
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

/** The scanned source item behind an opaque Desktop skill id, or null. */
export function findDesktopSkillSource(response: SharedSkillsResponse, id: string): SharedSkillItem | null {
  return response.items?.find((candidate) => candidate.filePath && desktopSkillId(candidate.filePath) === id) ?? null;
}

export function resolveDesktopSkillPath(response: SharedSkillsResponse, id: string): string {
  const item = findDesktopSkillSource(response, id);
  if (!item?.filePath) throw new Error("Unknown skill");
  return item.filePath;
}

function formatFrontmatterValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map((entry) => (entry && typeof entry === "object" ? JSON.stringify(entry) : String(entry))).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * Frontmatter for display: nested maps are flattened to dotted keys so
 * `metadata.openclaw.emoji` is one readable row instead of a JSON blob.
 *
 * The shared frontmatter parser stringifies non-scalars (see
 * `parseSkillFrontmatter`), so a value that parses back as JSON is expanded
 * here; anything else stays a single scalar row.
 */
export function flattenSkillFrontmatter(flat: Record<string, string> | null): Array<{ key: string; value: string }> {
  const rows: Array<{ key: string; value: string }> = [];
  const walk = (prefix: string, value: unknown): void => {
    if (Array.isArray(value)) {
      rows.push({ key: prefix, value: formatFrontmatterValue(value) });
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) walk(prefix ? `${prefix}.${key}` : key, child);
      return;
    }
    rows.push({ key: prefix, value: formatFrontmatterValue(value) });
  };
  for (const [key, raw] of Object.entries(flat ?? {})) {
    const text = String(raw ?? "");
    const trimmed = text.trim();
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
      try {
        walk(key, JSON.parse(trimmed) as unknown);
        continue;
      } catch {
        // Not JSON after all — keep the literal text.
      }
    }
    rows.push({ key, value: text });
  }
  return rows;
}

/** Recursively list a Skill directory, relative POSIX paths, directories first. */
export function listSkillDirectory(baseDir: string): DesktopSkillFileEntry[] {
  const entries: DesktopSkillFileEntry[] = [];
  const walk = (dir: string, prefix: string, depth: number): void => {
    if (depth > MAX_DIR_DEPTH || entries.length >= MAX_DIR_ENTRIES) return;
    let children: Dirent[];
    try {
      children = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const child of children) {
      if (entries.length >= MAX_DIR_ENTRIES) return;
      const relativePath = prefix ? `${prefix}/${child.name}` : child.name;
      if (child.isDirectory()) {
        entries.push({ path: relativePath, kind: "dir", size: 0 });
        walk(join(dir, child.name), relativePath, depth + 1);
        continue;
      }
      if (!child.isFile()) continue;
      try {
        entries.push({ path: relativePath, kind: "file", size: statSync(join(dir, child.name)).size });
      } catch {
        entries.push({ path: relativePath, kind: "file", size: 0 });
      }
    }
  };
  walk(baseDir, "", 0);
  return entries.sort((a, b) => {
    if ((a.kind === "dir") !== (b.kind === "dir")) return a.kind === "dir" ? -1 : 1;
    return a.path.localeCompare(b.path);
  });
}

/**
 * Read one text file from a Skill directory. The path is resolved inside the
 * Skill directory and re-checked after symlink expansion, so a link planted in
 * a Skill cannot read the rest of the disk.
 */
export function readSkillFileContent(baseDir: string, relativePath: string): { content: string; truncated: boolean; binary: boolean } {
  const root = realpathSync(baseDir);
  let real: string;
  try {
    real = realpathSync(resolve(root, relativePath));
  } catch {
    throw new Error("File not found");
  }
  if (real !== root && !real.startsWith(root + sep)) throw new Error("Path escapes the Skill directory");
  const stat = statSync(real);
  if (!stat.isFile()) throw new Error("Not a file");
  const truncated = stat.size > MAX_PREVIEW_BYTES;
  const buffer = readFileSync(real);
  const slice = truncated ? buffer.subarray(0, MAX_PREVIEW_BYTES) : buffer;
  const binary = slice.includes(0);
  return { content: binary ? "" : slice.toString("utf8"), truncated, binary };
}

export interface SkillDetailSource {
  name: string;
  description: string;
  scope: string;
  enabled: boolean;
  mcpServers?: string[];
  botId?: string;
  chatId?: string;
  filePath: string;
  baseDir: string;
}

/**
 * Pure projection of the disk reads into the detail payload. Everything that
 * touches the filesystem (frontmatter, mtime, directory listing) is passed in,
 * so this stays testable without a temp tree.
 */
export function buildDesktopSkillDetail(input: {
  item: SkillDetailSource;
  frontmatter: Record<string, string> | null;
  updatedAt: string;
  files: DesktopSkillFileEntry[];
  builtin: DesktopBuiltinSkillState | null;
}): DesktopSkillDetail {
  const { item, frontmatter } = input;
  return {
    id: desktopSkillId(item.filePath),
    name: item.name,
    description: item.description ?? "",
    scope: coerceScope(item.scope),
    enabled: item.enabled !== false,
    botId: item.botId ?? "",
    chatId: item.chatId ?? "",
    mcpServers: Array.isArray(item.mcpServers) ? item.mcpServers.map((server) => String(server)) : [],
    filePath: item.filePath,
    baseDir: item.baseDir,
    frontmatter: flattenSkillFrontmatter(frontmatter),
    updatedAt: input.updatedAt,
    version: String(frontmatter?.version ?? "").trim(),
    builtin: input.builtin,
    files: input.files
  };
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
