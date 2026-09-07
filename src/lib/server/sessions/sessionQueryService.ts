import type { Conversation } from "$lib/shared/types/message.js";
import type { AuthorizedConversationSource } from "$lib/server/sessions/conversationAuthorization.js";
import type { ConversationSearchIndex } from "$lib/server/sessions/conversationSearch.js";
import type { SessionLifecycleRow, SessionLifecycleState, SessionLifecycleStore } from "$lib/server/sessions/sessionLifecycleStore.js";

export type ManagedSessionSource = "local" | "project" | "external";
export type ManagedSessionLength = "empty" | "short" | "normal";

export interface ManagedSessionFilters {
  requesterExternalUserId?: string;
  state?: SessionLifecycleState;
  botIds?: string[];
  sources?: ManagedSessionSource[];
  projectIds?: string[];
  keyword?: string;
  inactiveDays?: number;
  activityFromDate?: string;
  activityToDate?: string;
  timeZone?: string;
  lengths?: ManagedSessionLength[];
  limit?: number;
  offset?: number;
}

export interface ManagedSessionItem {
  conversationId: string;
  title: string;
  source: ManagedSessionSource;
  channel: string;
  botId: string;
  projectId?: string;
  ownerExternalUserId: string | null;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string | null;
  userTurnCount: number;
  assistantTurnCount: number;
  state: SessionLifecycleState;
  version: number;
  retain: boolean;
  archivedAt: string | null;
  trashedAt: string | null;
}

export interface ManagedSessionCounts {
  active: number;
  archived: number;
  trashed: number;
}

export interface ManagedSessionResult {
  items: ManagedSessionItem[];
  total: number;
  counts: ManagedSessionCounts;
  limit: number;
  offset: number;
}

export interface ExternalManagedCandidate {
  conversation: Conversation;
  botId: string;
  channel: string;
}

export interface SessionQuerySessionsPort {
  listAllWebConversationMeta(): Array<{ conversation: Conversation; externalUserId: string }>;
  listProjectIds(): string[];
  listProjectConversations(projectId: string): Conversation[];
  listMessageMetadata(conversationId: string): Array<{ role: string; createdAt?: string }>;
}

export interface SessionQueryDeps {
  sessions: SessionQuerySessionsPort;
  lifecycle: SessionLifecycleStore;
  clock?: () => Date;
  search?: { index: Pick<ConversationSearchIndex, "search">; botId: string };
  listExternal?: () => ExternalManagedCandidate[];
}

interface Candidate {
  conversation: Conversation;
  ownerExternalUserId: string | null;
  source: ManagedSessionSource;
  botId: string;
  channel: string;
  projectId?: string;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const DAY_MS = 86_400_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseManagedBotId(ownerExternalUserId: string): string {
  const parts = String(ownerExternalUserId ?? "").split(":");
  if (parts.length >= 3 && parts[0] === "web") return parts[1];
  return "";
}

function normalizeLimit(raw: unknown): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

function normalizeOffset(raw: unknown): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function effectiveActivity(row: SessionLifecycleRow | null, conversation: Conversation): string | null {
  return row?.lastActivityAt ?? conversation.createdAt ?? null;
}

function tzOffsetMs(timeZone: string, utcMs: number): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  const parts = dtf.formatToParts(new Date(utcMs));
  const get = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? "0");
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - utcMs;
}

/**
 * Start of a YYYY-MM-DD day in the user's timezone, returned as a UTC ISO
 * string. Throws on malformed dates or unknown zones so API adapters can
 * surface a 400 instead of silently querying the wrong day.
 */
export function zonedDayStartUtc(dateStr: string, timeZone: string): string {
  if (!DATE_RE.test(dateStr)) throw new Error(`Invalid date (expected YYYY-MM-DD): ${dateStr}`);
  // Throws RangeError for unknown zones.
  new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date(0));
  const [year, month, day] = dateStr.split("-").map(Number);
  const wallUtc = Date.UTC(year, month - 1, day);
  let start = wallUtc;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    start = wallUtc - tzOffsetMs(timeZone, start);
  }
  return new Date(start).toISOString();
}

function resolveCustomRange(filters: ManagedSessionFilters): { fromIso: string | null; toExclusiveIso: string | null } {
  const timeZone = filters.timeZone?.trim() || "UTC";
  let fromIso: string | null = null;
  let toExclusiveIso: string | null = null;
  if (filters.activityFromDate?.trim()) {
    fromIso = zonedDayStartUtc(filters.activityFromDate.trim(), timeZone);
  }
  if (filters.activityToDate?.trim()) {
    const start = zonedDayStartUtc(filters.activityToDate.trim(), timeZone);
    toExclusiveIso = new Date(Date.parse(start) + DAY_MS).toISOString();
  }
  if (fromIso && toExclusiveIso && fromIso > toExclusiveIso) {
    throw new Error("activityFromDate must not be after activityToDate");
  }
  return { fromIso, toExclusiveIso };
}

function countTurns(
  sessions: SessionQuerySessionsPort,
  conversationId: string,
  cache: Map<string, { user: number; assistant: number }>
): { user: number; assistant: number } {
  const cached = cache.get(conversationId);
  if (cached) return cached;
  let user = 0;
  let assistant = 0;
  for (const message of sessions.listMessageMetadata(conversationId)) {
    if (message.role === "user") user += 1;
    else if (message.role === "assistant") assistant += 1;
  }
  const counts = { user, assistant };
  cache.set(conversationId, counts);
  return counts;
}

function lengthOf(counts: { user: number; assistant: number }): ManagedSessionLength {
  if (counts.user === 0 && counts.assistant === 0) return "empty";
  if (counts.user >= 1 && counts.user <= 2) return "short";
  return "normal";
}

function keywordHitIds(
  deps: SessionQueryDeps,
  candidates: Candidate[],
  keyword: string
): Set<string> | null {
  const search = deps.search;
  if (!search) return null;
  const sources: AuthorizedConversationSource[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (candidate.source === "external") continue;
    const source: AuthorizedConversationSource =
      candidate.source === "project"
        ? { botId: search.botId, channel: candidate.channel, projectId: candidate.projectId, purpose: "project" }
        : { botId: search.botId, channel: candidate.channel, chatId: candidate.ownerExternalUserId ?? "", purpose: "chat" };
    const key = JSON.stringify(source);
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push(source);
  }
  if (sources.length === 0) return new Set();
  const hits = search.index.search({ query: keyword, authorizedSources: sources, limit: 50 });
  return new Set(hits.map((hit) => hit.conversationId));
}

/**
 * Shared management query (spec Page/query). Enumerates local Web, Project and
 * injected external candidates, rechecks ownership per row, applies keyword
 * through the existing authorized search projection (restricted turns never
 * become searchable here), interprets custom dates in the user's timezone,
 * and returns server-side pagination plus per-state counts. Result items
 * carry display metadata only — never transcript content.
 */
export function queryManagedSessions(deps: SessionQueryDeps, filters: ManagedSessionFilters = {}): ManagedSessionResult {
  const state = filters.state ?? "active";
  if (state !== "active" && state !== "archived" && state !== "trashed") {
    throw new Error(`Invalid state: ${String(state)}`);
  }
  const limit = normalizeLimit(filters.limit);
  const offset = normalizeOffset(filters.offset);
  const clock = deps.clock ?? (() => new Date());
  const botIds = (filters.botIds ?? []).map((item) => String(item ?? "").trim()).filter(Boolean);
  const botIdSet = new Set(botIds);
  const sources = filters.sources?.length ? new Set(filters.sources) : null;
  const projectIds = (filters.projectIds ?? []).map((item) => String(item ?? "").trim()).filter(Boolean);
  const projectIdSet = projectIds.length > 0 ? new Set(projectIds) : null;
  const lengths = filters.lengths?.length ? new Set(filters.lengths) : null;
  const keyword = filters.keyword?.trim() ? filters.keyword.trim() : "";
  const inactiveDays = filters.inactiveDays ?? null;
  if (inactiveDays !== null && (!Number.isFinite(inactiveDays) || inactiveDays < 0)) {
    throw new Error(`Invalid inactiveDays: ${String(filters.inactiveDays)}`);
  }
  const { fromIso, toExclusiveIso } = resolveCustomRange(filters);
  const inactiveThresholdIso =
    inactiveDays !== null ? new Date(clock().getTime() - inactiveDays * DAY_MS).toISOString() : null;

  const requester = filters.requesterExternalUserId?.trim() || null;

  const candidates: Candidate[] = [];
  for (const entry of deps.sessions.listAllWebConversationMeta()) {
    if (requester && entry.externalUserId !== requester) continue;
    candidates.push({
      conversation: entry.conversation,
      ownerExternalUserId: entry.externalUserId,
      source: "local",
      botId: parseManagedBotId(entry.externalUserId),
      channel: entry.conversation.channel
    });
  }
  for (const projectId of deps.sessions.listProjectIds()) {
    if (projectIdSet && !projectIdSet.has(projectId)) continue;
    for (const conversation of deps.sessions.listProjectConversations(projectId)) {
      candidates.push({
        conversation,
        ownerExternalUserId: null,
        source: "project",
        botId: "",
        channel: conversation.channel,
        projectId
      });
    }
  }
  for (const external of deps.listExternal?.() ?? []) {
    candidates.push({
      conversation: external.conversation,
      ownerExternalUserId: null,
      source: "external",
      botId: external.botId,
      channel: external.channel
    });
  }

  const scoped = candidates.filter((candidate) => {
    if (sources && !sources.has(candidate.source)) return false;
    if (botIdSet.size > 0 && candidate.source !== "project" && !botIdSet.has(candidate.botId)) return false;
    if (candidate.conversation.origin === "automation" || candidate.conversation.origin?.startsWith("internal:")) return false;
    return true;
  });

  const rows = new Map<string, SessionLifecycleRow>();
  for (const candidate of scoped) {
    const existing = deps.lifecycle.get(candidate.conversation.id);
    if (existing) {
      rows.set(candidate.conversation.id, existing);
      continue;
    }
    // Historical evidence backfills activity without fabricating a recent
    // date; live appends advance through the activity sink instead.
    let latest: string | null = null;
    if (candidate.source !== "external") {
      for (const message of deps.sessions.listMessageMetadata(candidate.conversation.id)) {
        if (message.role !== "user" && message.role !== "assistant") continue;
        if (!message.createdAt) continue;
        if (latest === null || message.createdAt > latest) latest = message.createdAt;
      }
    }
    rows.set(
      candidate.conversation.id,
      deps.lifecycle.ensureRow(candidate.conversation.id, {
        createdAt: candidate.conversation.createdAt,
        lastActivityAt: latest
      })
    );
  }

  const keywordLower = keyword.toLowerCase();
  const hitIds = keyword ? keywordHitIds(deps, scoped, keyword) : null;

  const turnCache = new Map<string, { user: number; assistant: number }>();
  const matching = scoped.filter((candidate) => {
    const row = rows.get(candidate.conversation.id);
    if (!row) return false;
    const activity = effectiveActivity(row, candidate.conversation);
    if (inactiveThresholdIso && !(activity !== null && activity <= inactiveThresholdIso)) return false;
    if (fromIso && !(activity !== null && activity >= fromIso)) return false;
    if (toExclusiveIso && !(activity !== null && activity < toExclusiveIso)) return false;
    if (keyword) {
      const titleHit = candidate.conversation.title?.toLowerCase().includes(keywordLower) ?? false;
      // Restricted turns never become searchable through preview: external
      // candidates match titles only, local/project content matches come
      // solely from the authorized search projection above.
      const contentHit = candidate.source === "external" ? false : (hitIds?.has(candidate.conversation.id) ?? false);
      if (!titleHit && !contentHit) return false;
    }
    if (lengths) {
      const counts =
        candidate.source === "external"
          ? { user: 0, assistant: 0 }
          : countTurns(deps.sessions, candidate.conversation.id, turnCache);
      if (candidate.source === "external") {
        // External transcripts live in contexts/; the list path must not fan
        // out per-row transcript reads, so length filters only apply to
        // locally stored sessions.
        if (!lengths.has("normal")) return false;
      } else if (!lengths.has(lengthOf(counts))) return false;
    }
    return true;
  });

  const counts: ManagedSessionCounts = { active: 0, archived: 0, trashed: 0 };
  for (const candidate of matching) {
    const rowState = rows.get(candidate.conversation.id)?.state ?? "active";
    counts[rowState] += 1;
  }

  const inState = matching.filter((candidate) => (rows.get(candidate.conversation.id)?.state ?? "active") === state);
  inState.sort((a, b) => {
    const activityA = effectiveActivity(rows.get(a.conversation.id) ?? null, a.conversation) ?? "";
    const activityB = effectiveActivity(rows.get(b.conversation.id) ?? null, b.conversation) ?? "";
    if (activityA !== activityB) return activityB.localeCompare(activityA);
    return a.conversation.id.localeCompare(b.conversation.id);
  });

  const page = inState.slice(offset, offset + limit);
  const items: ManagedSessionItem[] = page.map((candidate) => {
    const row = rows.get(candidate.conversation.id);
    const countsForItem =
      candidate.source === "external"
        ? { user: 0, assistant: 0 }
        : countTurns(deps.sessions, candidate.conversation.id, turnCache);
    return {
      conversationId: candidate.conversation.id,
      title: candidate.conversation.title,
      source: candidate.source,
      channel: candidate.channel,
      botId: candidate.botId,
      projectId: candidate.projectId,
      ownerExternalUserId: candidate.ownerExternalUserId,
      createdAt: candidate.conversation.createdAt,
      updatedAt: candidate.conversation.updatedAt,
      lastActivityAt: row?.lastActivityAt ?? null,
      userTurnCount: countsForItem.user,
      assistantTurnCount: countsForItem.assistant,
      state: row?.state ?? "active",
      version: row?.version ?? 1,
      retain: row?.retain ?? false,
      archivedAt: row?.archivedAt ?? null,
      trashedAt: row?.trashedAt ?? null
    };
  });

  return { items, total: inState.length, counts, limit, offset };
}
