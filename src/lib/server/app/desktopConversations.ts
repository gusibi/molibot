import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { config } from "$lib/server/app/env.js";
import { getRuntime } from "$lib/server/app/runtime.js";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import { resolveDesktopWebProfiles } from "$lib/server/app/desktopProfiles.js";
import { buildDesktopChannelsSummary } from "$lib/server/app/desktopChannels.js";
import { listExternalSessionsFromContexts } from "$lib/server/app/externalSessionsFromContexts.js";
import { parseBotInstanceId, type ExternalSessionEntry } from "$lib/server/app/desktopExternalSessions.js";
import { getApprovalBroker } from "$lib/server/approval/approvalBroker.js";
import { deleteWebSession, type WebSessionDeletionResult } from "$lib/server/web/sessionLifecycle.js";
import type { RuntimeSettings } from "$lib/server/settings/index.js";
import type {
  DesktopConversationBotGroup,
  DesktopConversationChannel,
  DesktopConversationItem,
  DesktopConversationPurpose,
  DesktopSessionRun,
  DesktopSessionRunStatus
} from "$lib/shared/desktop.js";

/**
 * Shared desktop conversation query layer (plan §12). Aggregates ordinary
 * conversation sessions across all Web profiles and external Bot instances,
 * resolves Bot identity/names (including deleted Bots), and provides stable
 * cursor pagination + title/bot/preview search. Pagination, aggregation and
 * filtering live here — never in a Channel implementation (plan §12.3).
 */

const PREVIEW_MAX = 300;
const UNKNOWN_BOT_LABEL = "";

export type DesktopConversationLimit = number;

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
  entries: ReadonlyArray<{ conversation: { id: string; title: string; updatedAt: string; projectId?: string; origin?: string }; externalUserId: string; lastMessageText: string }>,
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
      latestMessagePreview: entry.lastMessageText || undefined
    };
  });
}

export function classifyWebPurpose(conversation: { id: string; projectId?: string; origin?: string }): DesktopConversationPurpose {
  if (conversation.projectId) return "project";
  if (conversation.origin?.startsWith("internal:")) return "diagnostic";
  if (conversation.origin === "automation") return "automation";
  if (conversation.id.startsWith("task-")) return "automation";
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
      latestMessagePreview: entry.preview || undefined
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

export function encodeCursor(item: DesktopConversationItem): string {
  return Buffer.from(`${item.updatedAt}|${item.sessionId}`, "utf8").toString("base64url");
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
  item: DesktopConversationItem,
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
 * Groups an already-collected item set by Bot (plan §5.2). Each group is sorted
 * newest-first, takes its first page, and carries its own cursor so the browser
 * can page a single Bot independently. Groups are ordered by the Bot's most
 * recent session activity.
 */
export function queryGroups(
  items: DesktopConversationItem[],
  options: { query?: string; groupLimit?: number }
): { groups: DesktopConversationBotGroup[] } {
  const groupLimit = clampLimit(options.groupLimit);
  let filtered = items;
  if (options.query) {
    const q = options.query;
    filtered = filtered.filter((item) => matchesQuery(item, q));
  }

  const byBot = new Map<string, DesktopConversationItem[]>();
  for (const item of filtered) {
    const key = item.botId;
    const list = byBot.get(key) ?? [];
    list.push(item);
    byBot.set(key, list);
  }

  const groups: DesktopConversationBotGroup[] = [];
  for (const [, list] of byBot) {
    const sorted = sortItems(list);
    const sample = sorted[0];
    if (!sample) continue;
    const slice = sorted.slice(0, groupLimit);
    const hasMore = sorted.length > groupLimit;
    const nextCursor = hasMore && slice.length > 0 ? encodeCursor(slice[slice.length - 1]) : null;
    groups.push({
      botId: sample.botId,
      botName: sample.botName,
      botDeleted: sample.botDeleted,
      readOnly: sample.readOnly,
      total: sorted.length,
      items: slice,
      nextCursor,
      hasMore
    });
  }

  groups.sort((a, b) => {
    const aAt = a.items[0]?.updatedAt ?? "";
    const bAt = b.items[0]?.updatedAt ?? "";
    return bAt.localeCompare(aAt);
  });
  return { groups };
}

/** Collects the raw item set for a channel using live runtime data. */
function collectItems(
  channel: DesktopConversationChannel,
  resolver: BotNameResolver
): DesktopConversationItem[] {
  let items: DesktopConversationItem[];
  if (channel === "web") {
    const entries = getRuntime().sessions.listAllWebConversations();
    items = buildWebItems(entries, resolver);
  } else {
    const entries = listExternalSessionsFromContexts(resolve(config.dataDir)).filter(
      (entry) => entry.channel === channel
    );
    items = buildExternalItems(entries, resolver);
  }
  // The sidebar / browser only show ordinary conversations (plan §7/§16):
  // project / automation / diagnostic / test sessions are excluded here, in
  // the shared query layer, rather than duplicated into channels or UI.
  return items.filter((item) => item.purpose === "conversation");
}

export function listDesktopConversations(input: {
  channel: DesktopConversationChannel;
  limit?: number;
  cursor?: string | null;
  query?: string;
  botId?: string;
}): { items: DesktopConversationItem[]; nextCursor: string | null; hasMore: boolean } {
  const resolver = buildBotNameResolver(getRuntime().getSettings());
  const items = collectItems(input.channel, resolver);
  return queryConversations(items, {
    limit: input.limit,
    cursor: input.cursor,
    query: input.query,
    botId: input.botId
  });
}

export function listDesktopConversationGroups(input: {
  channel: DesktopConversationChannel;
  query?: string;
  groupLimit?: number;
}): { groups: DesktopConversationBotGroup[] } {
  const resolver = buildBotNameResolver(getRuntime().getSettings());
  const items = collectItems(input.channel, resolver);
  return queryGroups(items, { query: input.query, groupLimit: input.groupLimit });
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
