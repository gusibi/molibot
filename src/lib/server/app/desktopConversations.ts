import fs from "node:fs";
import path, { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "$lib/server/app/env.js";
import { getRuntime } from "$lib/server/app/runtime.js";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import { resolveDesktopWebProfiles } from "$lib/server/app/desktopProfiles.js";
import { buildDesktopChannelsSummary } from "$lib/server/app/desktopChannels.js";
import { listExternalSessionsFromContexts, listExternalSessionMetaFromContexts, decodeExternalSessionId } from "$lib/server/app/externalSessionsFromContexts.js";
import { TASK_CHANNEL_ROOTS } from "$lib/server/agent/commands/taskChannels.js";
import { revealAbsolutePath, revealSupported } from "$lib/server/web/revealFile.js";
import { isTaskSessionId } from "$lib/server/agent/session/ids.js";
import { parseBotInstanceId, type ExternalSessionEntry } from "$lib/server/app/desktopExternalSessions.js";
import { getApprovalBroker } from "$lib/server/approval/approvalBroker.js";
import { deleteWebSession, type WebSessionDeletionResult } from "$lib/server/web/sessionLifecycle.js";
import { getSessionLifecycleStore } from "$lib/server/sessions/sessionLifecycleStore.js";
import { getProjectStore } from "$lib/server/projects/store.js";
import { retentionCapabilities, type TurnRetentionPolicy } from "$lib/server/sessions/retentionPolicy.js";
import type { RuntimeSettings } from "$lib/server/settings/index.js";
import type { SessionStore } from "$lib/server/sessions/store.js";
import type {
  DesktopConversationChannel,
  DesktopConversationItem,
  DesktopConversationPurpose,
  DesktopConversationSearchGroup,
  DesktopConversationSearchItem,
  DesktopConversationSearchScope,
  DesktopConversationSearchSource,
  DesktopSessionRun,
  DesktopSessionRunStatus
} from "$lib/shared/desktop.js";

/**
 * Shared desktop conversation query layer (plan §12). Aggregates ordinary
 * conversation sessions across all Web profiles and external Bot instances,
 * resolves Bot identity/names (including deleted Bots), and provides stable
 * cursor pagination + title/bot/preview search. Pagination, aggregation and
 * filtering live here — never in a Channel implementation (plan §12.3).
 *
 * Ordinary enumeration reads Session metadata only: Web conversations through
 * `listAllWebConversationMeta` and external conversations through the Session
 * metadata sidecar. Message previews (and the Agent Context parses they need)
 * are collected only for explicit search, so opening a list never loads chat
 * transcripts.
 */

const PREVIEW_MAX = 300;
const UNKNOWN_BOT_LABEL = "";
const SEARCH_SOURCES: DesktopConversationSearchSource[] = ["web", "project", "telegram", "feishu", "qq", "weixin"];
const EXTERNAL_SEARCH_SOURCES: DesktopConversationSearchSource[] = ["telegram", "feishu", "qq", "weixin"];

export type DesktopConversationLimit = number;

/** Session access needed by the list/search paths, injected so tests use a real store. */
export type DesktopConversationSessions = Pick<
  SessionStore,
  "listAllWebConversations" | "listAllWebConversationMeta" | "listProjectConversations" | "listMessages"
>;

/**
 * Data sources for one query. Production builds it from the live runtime;
 * tests pass a temp-backed store and data root so the read boundary can be
 * probed without replacing the collection logic itself.
 */
export interface DesktopConversationQueryContext {
  sessions: DesktopConversationSessions;
  settings: RuntimeSettings;
  dataRoot: string;
  isActive: (conversationId: string) => boolean;
}

function runtimeQueryContext(): DesktopConversationQueryContext {
  const runtime = getRuntime();
  return {
    sessions: runtime.sessions,
    settings: runtime.getSettings(),
    dataRoot: resolve(config.dataDir),
    isActive: isActiveLifecycleSession
  };
}

/** Caps a caller-supplied limit to the supported range (plan §5.3: 10/page). */
export function clampLimit(raw: number | undefined | null, fallback = 10): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, 100);
}

/**
 * Recovers the Web profile id from a Web externalUserId (`web:<profileId>:<userId>`).
 * Returns "" for anything that doesn't match, so callers fall back cleanly.
 */
export function parseWebProfileId(externalUserId: string): string {
  const parts = String(externalUserId ?? "").split(":");
  if (parts.length >= 3 && parts[0] === "web") return parts[1];
  return "";
}

/** Bot identity/name resolver built from current settings (plan §3.5 / §3.6). */
export interface BotNameResolver {
  webName(profileId: string): { name: string; deleted: boolean };
  externalName(
    channel: DesktopConversationChannel,
    botId: string,
    fallback?: string
  ): { name: string; deleted: boolean };
}

export function buildBotNameResolver(settings: RuntimeSettings): BotNameResolver {
  const webProfiles = resolveDesktopWebProfiles(settings);
  const webMap = new Map(webProfiles.map((profile) => [profile.id, profile.name || profile.id]));

  const channelsSummary = buildDesktopChannelsSummary(settings);
  const externalMap = new Map<string, Map<string, string>>();
  for (const group of channelsSummary.groups) {
    const inner = new Map<string, string>();
    for (const instance of group.instances) inner.set(instance.id, instance.name || instance.id);
    externalMap.set(group.channel, inner);
  }

  return {
    webName(profileId: string) {
      const name = webMap.get(profileId);
      if (name !== undefined) return { name, deleted: false };
      // Deleted Web profile: the conversation record does not persist the
      // profile name, so fall back to the profile id (plan §3.6).
      return { name: profileId || UNKNOWN_BOT_LABEL, deleted: Boolean(profileId) };
    },
    externalName(
      channel: DesktopConversationChannel,
      botId: string,
      fallback?: string
    ) {
      const inner = externalMap.get(channel);
      const name = inner?.get(botId);
      if (name) return { name, deleted: false };
      if (!botId) return { name: UNKNOWN_BOT_LABEL, deleted: false };
      // Deleted external Bot: surface the saved fallback name or the instance id.
      return { name: fallback || botId, deleted: true };
    }
  };
}

export function buildWebItems(
  entries: ReadonlyArray<{ conversation: { id: string; title: string; updatedAt: string; projectId?: string; origin?: string; parentSessionId?: string }; externalUserId: string; lastMessageText?: string }>,
  resolver: BotNameResolver
): DesktopConversationItem[] {
  return entries.map((entry) => {
    const profileId = parseWebProfileId(entry.externalUserId);
    const { name, deleted } = resolver.webName(profileId);
    const purpose = classifyWebPurpose(entry.conversation);
    return {
      sessionId: entry.conversation.id,
      title: entry.conversation.title || "New Session",
      updatedAt: entry.conversation.updatedAt,
      botId: profileId,
      botName: name,
      botDeleted: deleted,
      channel: "web",
      purpose,
      readOnly: false,
      // Ordinary lists omit the field entirely; only search collects a preview.
      ...(entry.lastMessageText ? { latestMessagePreview: entry.lastMessageText } : {}),
      ...(entry.conversation.parentSessionId
        ? { parentSessionId: entry.conversation.parentSessionId }
        : {})
    };
  });
}

export function classifyWebPurpose(conversation: { id: string; projectId?: string; origin?: string }): DesktopConversationPurpose {
  if (conversation.projectId) return "project";
  if (conversation.origin?.startsWith("internal:")) return "diagnostic";
  if (conversation.origin === "automation") return "automation";
  if (isTaskSessionId(conversation.id)) return "automation";
  return "conversation";
}

export function buildExternalItems(
  entries: ReadonlyArray<ExternalSessionEntry>,
  resolver: BotNameResolver
): DesktopConversationItem[] {
  return entries.map((entry) => {
    const botId = parseBotInstanceId(entry.externalUserId) ?? "";
    const channel = entry.channel as DesktopConversationChannel;
    const { name, deleted } = resolver.externalName(channel, botId, botId);
    return {
      sessionId: entry.conversation.id,
      title: entry.conversation.title || "New Session",
      updatedAt: entry.conversation.updatedAt,
      botId,
      botName: name,
      botDeleted: deleted,
      channel,
      purpose: "conversation",
      readOnly: true,
      ...(entry.preview ? { latestMessagePreview: entry.preview } : {})
    };
  });
}

/** Sorts newest-first by `updatedAt`, tie-broken by `sessionId` (plan §3.1). */
export function sortItems(items: DesktopConversationItem[]): DesktopConversationItem[] {
  return [...items].sort((a, b) => {
    if (a.updatedAt !== b.updatedAt) return b.updatedAt.localeCompare(a.updatedAt);
    return b.sessionId.localeCompare(a.sessionId);
  });
}

export function encodeCursor(item: { updatedAt: string; sessionId: string }): string {
  return Buffer.from(`${item.updatedAt}|${item.sessionId}`, "utf8").toString("base64url");
}

function searchSourcesForScope(scope: DesktopConversationSearchScope): DesktopConversationSearchSource[] {
  if (scope === "all") return SEARCH_SOURCES;
  if (scope === "channels") return EXTERNAL_SEARCH_SOURCES;
  return [scope];
}

export function matchesConversationSearch(item: DesktopConversationSearchItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    item.title.toLowerCase().includes(q) ||
    item.contextName.toLowerCase().includes(q) ||
    (item.latestMessagePreview ?? "").toLowerCase().includes(q)
  );
}

/** Filters and cursor-pages one source without mixing source-specific ordering. */
export function queryConversationSearchGroup(
  source: DesktopConversationSearchSource,
  items: DesktopConversationSearchItem[],
  options: { query?: string; limit?: number; cursor?: string | null }
): DesktopConversationSearchGroup {
  const limit = clampLimit(options.limit);
  let filtered = [...items]
    .filter((item) => !options.query || matchesConversationSearch(item, options.query))
    .sort((a, b) => a.updatedAt === b.updatedAt
      ? b.sessionId.localeCompare(a.sessionId)
      : b.updatedAt.localeCompare(a.updatedAt));
  const total = filtered.length;
  const cursor = options.cursor ? decodeCursor(options.cursor) : null;
  if (cursor) filtered = filtered.filter((item) => comesAfter(item, cursor));
  const page = filtered.slice(0, limit);
  const hasMore = filtered.length > limit;
  return {
    source,
    total,
    items: page,
    nextCursor: hasMore && page.length > 0 ? encodeCursor(page[page.length - 1]) : null,
    hasMore
  };
}

export function decodeCursor(cursor: string): { updatedAt: string; sessionId: string } | null {
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const separator = decoded.lastIndexOf("|");
    if (separator <= 0) return null;
    const updatedAt = decoded.slice(0, separator);
    const sessionId = decoded.slice(separator + 1);
    if (!updatedAt || !sessionId) return null;
    return { updatedAt, sessionId };
  } catch {
    return null;
  }
}

/**
 * True when `item` sorts strictly after the cursor in the newest-first order.
 * Used for stable cursor pagination that survives new sessions being inserted
 * (plan §5.3: no offset, no duplicate/omit on insert).
 */
function comesAfter(
  item: { updatedAt: string; sessionId: string },
  cursor: { updatedAt: string; sessionId: string }
): boolean {
  if (item.updatedAt !== cursor.updatedAt) return item.updatedAt < cursor.updatedAt;
  return item.sessionId < cursor.sessionId;
}

export function matchesQuery(item: DesktopConversationItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    item.title.toLowerCase().includes(q) ||
    item.botName.toLowerCase().includes(q) ||
    (item.latestMessagePreview ?? "").toLowerCase().includes(q)
  );
}

/**
 * Pure query over an already-collected item set: filter (botId/query) → stable
 * cursor pagination. Exported so the runtime-backed wrappers stay thin and the
 * pagination/search logic is testable without a data dir.
 */
export function queryConversations(
  items: DesktopConversationItem[],
  options: {
    limit?: number;
    cursor?: string | null;
    query?: string;
    botId?: string;
  }
): { items: DesktopConversationItem[]; nextCursor: string | null; hasMore: boolean } {
  const limit = clampLimit(options.limit);
  let filtered = sortItems(items);
  if (options.botId) filtered = filtered.filter((item) => item.botId === options.botId);
  if (options.query) {
    const q = options.query;
    filtered = filtered.filter((item) => matchesQuery(item, q));
  }

  let page = filtered;
  const cursor = options.cursor ? decodeCursor(options.cursor) : null;
  if (cursor) {
    page = filtered.filter((item) => comesAfter(item, cursor));
  }

  const slice = page.slice(0, limit);
  const hasMore = page.length > limit;
  const nextCursor = hasMore && slice.length > 0 ? encodeCursor(slice[slice.length - 1]) : null;
  return { items: slice, nextCursor, hasMore };
}

/**
 * Daily lists show ordinary active sessions only. Archived and trashed
 * sessions stay reachable through the management views, never the sidebar.
 * Missing rows (pre-lifecycle history) count as active; lookup failures fail
 * open so a lifecycle outage cannot empty the daily list.
 */
export function isActiveLifecycleSession(conversationId: string): boolean {
  try {
    const row = getSessionLifecycleStore().get(conversationId);
    return !row || row.state === "active";
  } catch {
    return true;
  }
}

/** Collects the raw item set for a channel; previews only when actually searching. */
function collectItems(
  ctx: DesktopConversationQueryContext,
  channel: DesktopConversationChannel,
  withPreview: boolean
): DesktopConversationItem[] {
  const resolver = buildBotNameResolver(ctx.settings);
  let items: DesktopConversationItem[];
  if (channel === "web") {
    const entries = withPreview
      ? ctx.sessions.listAllWebConversations()
      : ctx.sessions.listAllWebConversationMeta();
    items = buildWebItems(entries, resolver);
  } else {
    const entries = (withPreview
      ? listExternalSessionsFromContexts(ctx.dataRoot)
      : listExternalSessionMetaFromContexts(ctx.dataRoot)
    ).filter((entry) => entry.channel === channel);
    items = buildExternalItems(entries, resolver);
  }
  // The sidebar / browser only show ordinary conversations (plan §7/§16):
  // project / automation / diagnostic / test sessions are excluded here, in
  // the shared query layer, rather than duplicated into channels or UI.
  // Session management archiving is enforced at the same layer: only active
  // sessions appear in daily lists.
  return items.filter((item) => item.purpose === "conversation" && ctx.isActive(item.sessionId));
}

function channelSearchItems(
  ctx: DesktopConversationQueryContext,
  source: DesktopConversationChannel
): DesktopConversationSearchItem[] {
  return collectItems(ctx, source, true).map((item) => ({
    source,
    sessionId: item.sessionId,
    title: item.title,
    updatedAt: item.updatedAt,
    channel: item.channel,
    contextId: item.botId,
    contextName: item.botName,
    contextDeleted: item.botDeleted,
    readOnly: item.readOnly,
    latestMessagePreview: item.latestMessagePreview,
    botId: item.botId
  }));
}

function latestConversationPreview(messages: ReadonlyArray<{ role: string; content: string; retention?: TurnRetentionPolicy }>): string | undefined {
  const message = [...messages].reverse().find((item) =>
    (item.role === "user" || item.role === "assistant") && retentionCapabilities(item.retention).searchable
  );
  const preview = String(message?.content ?? "").replace(/\s+/g, " ").trim().slice(0, PREVIEW_MAX);
  return preview || undefined;
}

function projectSearchItems(ctx: DesktopConversationQueryContext): DesktopConversationSearchItem[] {
  const sessions = ctx.sessions;
  const items: DesktopConversationSearchItem[] = [];
  for (const project of getProjectStore().list()) {
    const conversations = sessions.listProjectConversations(project.id)
      .filter((conversation) => conversation.origin !== "automation" && !conversation.origin?.startsWith("internal:"))
      .filter((conversation) => ctx.isActive(conversation.id));
    for (const conversation of conversations) {
      const channel = SEARCH_SOURCES.includes(conversation.channel as DesktopConversationSearchSource)
        ? conversation.channel as DesktopConversationChannel
        : "web";
      items.push({
        source: "project",
        sessionId: conversation.id,
        title: conversation.title || "New Session",
        updatedAt: conversation.updatedAt,
        channel,
        contextId: project.id,
        contextName: project.name,
        contextDeleted: false,
        readOnly: false,
        latestMessagePreview: latestConversationPreview(sessions.listMessages(conversation.id, 20)),
        projectId: project.id
      });
    }
  }
  return items;
}

/** Owner-level Desktop search across ordinary Web, Project and external conversations. */
export function searchDesktopConversations(
  input: {
    scope?: DesktopConversationSearchScope;
    query?: string;
    limit?: number;
    cursor?: string | null;
    isActive?: (conversationId: string) => boolean;
  },
  ctx: DesktopConversationQueryContext = runtimeQueryContext()
): { scope: DesktopConversationSearchScope; groups: DesktopConversationSearchGroup[] } {
  const scope = input.scope ?? "all";
  const effective = input.isActive ? { ...ctx, isActive: input.isActive } : ctx;
  // Search always pays for previews: matching must keep working against the
  // last message, and the dialog renders the preview line.
  const groups = searchSourcesForScope(scope).map((source) => queryConversationSearchGroup(
    source,
    source === "project"
      ? projectSearchItems(effective)
      : channelSearchItems(effective, source),
    { query: input.query, limit: input.limit, cursor: input.cursor }
  )).filter((group) => group.total > 0);
  return { scope, groups };
}

export function listDesktopConversations(
  input: {
    channel: DesktopConversationChannel;
    limit?: number;
    cursor?: string | null;
    query?: string;
    botId?: string;
    isActive?: (conversationId: string) => boolean;
  },
  ctx: DesktopConversationQueryContext = runtimeQueryContext()
): { items: DesktopConversationItem[]; nextCursor: string | null; hasMore: boolean } {
  const effective = input.isActive ? { ...ctx, isActive: input.isActive } : ctx;
  // Plain enumeration stays metadata-only. A caller that still passes a query
  // here is searching, so it keeps the preview-backed path rather than silently
  // degrading to title-only matching.
  const hasQuery = Boolean(input.query && input.query.trim());
  const items = collectItems(effective, input.channel, hasQuery);
  return queryConversations(items, {
    limit: input.limit,
    cursor: input.cursor,
    query: input.query,
    botId: input.botId
  });
}

/**
 * Renames a Web conversation from the desktop sidebar. Only Web sessions are
 * writable here — external channels are read-only mirrors. The owning
 * `externalUserId` is resolved from the Web index by session id, so the
 * caller only needs the session id. Returns the sanitized title, or `null`
 * if the session is not a known Web conversation.
 */
export function renameDesktopConversation(sessionId: string, title: string): { title: string } | null {
  const sessions = getRuntime().sessions;
  const owner = sessions.getWebConversationOwner(sessionId);
  if (!owner) return null;
  const conversation = sessions.renameConversation(sessionId, "web", owner, title);
  return conversation ? { title: conversation.title } : null;
}

/**
 * Deletes a Web conversation from the desktop sidebar (Web-only, same
 * ownership resolution as {@link renameDesktopConversation}). The shared
 * lifecycle also rejects running sessions and removes their Agent context.
 */
export function deleteDesktopConversation(sessionId: string): WebSessionDeletionResult {
  return deleteWebSession({ conversationId: sessionId });
}

function normalizeRunStatus(status: string): DesktopSessionRunStatus {
  if (status === "running") return "running";
  if (status === "waiting_for_approval") return "waiting_for_approval";
  if (status === "completed") return "completed";
  if (status === "aborted") return "aborted";
  return "failed";
}

/**
 * Lists active session runs (running / waiting-for-approval) from the runtime
 * `runs` table, cross-referenced with the approval broker's pending requests
 * (plan §11.3). Status comes from persisted runtime state, never from Desktop
 * process memory. The `runs` table is created lazily by the turn orchestrator,
 * so a missing table is treated as "no active runs".
 */
export function listDesktopSessionRuns(): { runs: DesktopSessionRun[] } {
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(storagePaths.settingsDbFile);
  } catch {
    return { runs: [] };
  }

  let rows: Array<{
    id: string;
    session_id: string;
    channel_id: string;
    status: string;
    started_at: string;
    error: string | null;
  }> = [];
  try {
    rows = db
      .prepare(
        "SELECT id, session_id, channel_id, status, started_at, error FROM runs WHERE status IN ('running','waiting_for_approval')"
      )
      .all() as typeof rows;
  } catch {
    // runs table not created yet — no active runs.
  } finally {
    db.close();
  }

  const pendingSessions = new Set<string>();
  for (const request of getApprovalBroker().listPendingRequests()) {
    if (request.sessionId) pendingSessions.add(request.sessionId);
  }

  const sessions = getRuntime().sessions;
  const runs: DesktopSessionRun[] = rows.map((row) => {
    const owner = sessions.getWebConversationOwner(row.session_id);
    const profileId = owner ? parseWebProfileId(owner) : "";
    const status = normalizeRunStatus(row.status);
    return {
      profileId,
      sessionId: row.session_id,
      runId: row.id,
      status,
      startedAt: row.started_at,
      waitingApproval: pendingSessions.has(row.session_id) || status === "waiting_for_approval",
      errorCode: row.error ?? null
    };
  });

  return { runs };
}

/**
 * Resolves the filesystem path where a session file is stored.
 * Handles Project sessions, Web sessions, and External channel sessions.
 */
export function resolveDesktopSessionFilePath(sessionId: string, projectId?: string): string | null {
  const cleanSessionId = String(sessionId ?? "").trim();
  if (!cleanSessionId) return null;

  const external = decodeExternalSessionId(cleanSessionId);
  if (external) {
    const root = TASK_CHANNEL_ROOTS.find((entry) => entry.channel === external.channel);
    if (!root) return null;
    const contexts = path.resolve(config.dataDir, root.dir, "bots", external.botId, external.chatId, "contexts");
    const jsonl = path.join(contexts, `${external.sessionId}.jsonl`);
    const json = path.join(contexts, `${external.sessionId}.json`);
    if (fs.existsSync(jsonl)) return jsonl;
    if (fs.existsSync(json)) return json;
    return jsonl;
  }

  const sessions = getRuntime().sessions;
  return sessions.getSessionFilePath(cleanSessionId, projectId);
}

/**
 * Reveals the session's file in macOS Finder (using `open -R`).
 * If the file exists, it will be selected in Finder.
 * If the file does not exist yet but its containing directory exists, the directory will be opened.
 */
export function revealDesktopSessionPath(sessionId: string, projectId?: string): { ok: boolean; path?: string; error?: string } {
  const filePath = resolveDesktopSessionFilePath(sessionId, projectId);
  if (!filePath) {
    return { ok: false, error: "Session file path not found" };
  }
  if (!revealSupported()) {
    return { ok: false, path: filePath, error: "Revealing files is only supported on macOS." };
  }

  const targetToReveal = fs.existsSync(filePath)
    ? filePath
    : fs.existsSync(path.dirname(filePath))
      ? path.dirname(filePath)
      : null;

  if (targetToReveal) {
    revealAbsolutePath(targetToReveal, "reveal");
    return { ok: true, path: filePath };
  }
  return { ok: false, path: filePath, error: "Session location does not exist" };
}
