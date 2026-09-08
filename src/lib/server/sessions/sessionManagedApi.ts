import type {
  BulkOperationResult,
  BulkTarget,
  ManagedSessionFilters,
  ManagedSessionItem
} from "$lib/server/sessions/sessionQueryService.js";
import type { BulkOperationKind } from "$lib/server/sessions/sessionBulkStore.js";

export interface ParsedManagedQuery extends ManagedSessionFilters {
  state: "active" | "archived" | "trashed";
  limit: number;
  offset: number;
}

const STATES = new Set(["active", "archived", "trashed"]);
const SOURCES = new Set(["local", "project", "external"]);
const LENGTHS = new Set(["empty", "short", "normal"]);
const BULK_KINDS: BulkOperationKind[] = ["archive", "restore", "delete"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidCalendarDate(dateStr: string): boolean {
  if (!DATE_RE.test(dateStr)) return false;
  const [year, month, day] = dateStr.split("-").map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const roundTrip = new Date(Date.UTC(year, month - 1, day));
  return (
    roundTrip.getUTCFullYear() === year && roundTrip.getUTCMonth() === month - 1 && roundTrip.getUTCDate() === day
  );
}

function splitList(raw: string | null): string[] {
  return String(raw ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * API adapter: parses + validates managed-list query params. Throws 400-style
 * Errors on bad input so routes can project them without touching services.
 */
export function parseManagedQuery(params: URLSearchParams): ParsedManagedQuery {
  const state = params.get("state")?.trim() || "active";
  if (!STATES.has(state)) throw new Error(`Invalid state: ${state}`);
  const limitRaw = params.get("limit");
  const offsetRaw = params.get("offset");
  const limit = limitRaw === null ? 20 : Math.floor(Number(limitRaw));
  if (!Number.isFinite(limit) || limit <= 0 || limit > 100) throw new Error(`Invalid limit: ${String(limitRaw)}`);
  const offset = offsetRaw === null ? 0 : Math.floor(Number(offsetRaw));
  if (!Number.isFinite(offset) || offset < 0) throw new Error(`Invalid offset: ${String(offsetRaw)}`);

  const botIds = splitList(params.get("botIds") ?? params.get("botId"));
  const sources = splitList(params.get("sources")).filter((item) => {
    if (!SOURCES.has(item)) throw new Error(`Invalid source: ${item}`);
    return true;
  }) as ParsedManagedQuery["sources"];
  const projectIds = splitList(params.get("projectIds"));
  const lengths = splitList(params.get("lengths")).filter((item) => {
    if (!LENGTHS.has(item)) throw new Error(`Invalid length: ${item}`);
    return true;
  }) as ParsedManagedQuery["lengths"];

  const inactiveRaw = params.get("inactiveDays");
  let inactiveDays: number | undefined;
  if (inactiveRaw !== null && inactiveRaw.trim() !== "") {
    inactiveDays = Math.floor(Number(inactiveRaw));
    if (!Number.isFinite(inactiveDays) || inactiveDays < 0) throw new Error(`Invalid inactiveDays: ${inactiveRaw}`);
  }
  const activityFromDate = params.get("activityFromDate")?.trim() || undefined;
  const activityToDate = params.get("activityToDate")?.trim() || undefined;
  for (const dateStr of [activityFromDate, activityToDate]) {
    if (dateStr !== undefined && !isValidCalendarDate(dateStr)) throw new Error(`Invalid date (expected YYYY-MM-DD): ${dateStr}`);
  }
  if (activityFromDate && activityToDate && activityFromDate > activityToDate) {
    throw new Error("activityFromDate must not be after activityToDate");
  }
  const keyword = params.get("keyword")?.trim() || undefined;
  const timeZone = params.get("timeZone")?.trim() || undefined;
  if (timeZone) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date(0));
    } catch {
      throw new Error(`Invalid timeZone: ${timeZone}`);
    }
  }
  return {
    state: state as ParsedManagedQuery["state"],
    limit,
    offset,
    botIds: botIds.length > 0 ? botIds : undefined,
    sources: sources && sources.length > 0 ? sources : undefined,
    projectIds: projectIds.length > 0 ? projectIds : undefined,
    lengths: lengths && lengths.length > 0 ? lengths : undefined,
    inactiveDays,
    activityFromDate,
    activityToDate,
    keyword,
    timeZone
  };
}

export interface ValidBulkExecute {
  kind: BulkOperationKind;
  targets?: BulkTarget[];
  selectionId?: string;
  idempotencyKey: string;
}

/** API adapter: validates bulk execute bodies (kind/targets/idempotency). */
export function validateBulkExecute(body: Record<string, unknown>): ValidBulkExecute {
  const kind = String((body.kind ?? "") as string).trim();
  if (!BULK_KINDS.includes(kind as BulkOperationKind)) throw new Error(`Unknown bulk operation: ${kind || "(missing)"}`);
  const idempotencyKey = String((body.idempotencyKey ?? "") as string).trim();
  if (!idempotencyKey) throw new Error("execute requires an idempotencyKey");
  const hasTargets = body.targets !== undefined;
  const hasSelection = body.selectionId !== undefined && String(body.selectionId ?? "").trim() !== "";
  if (hasTargets && hasSelection) throw new Error("execute accepts either targets or selectionId, not both");
  if (!hasTargets && !hasSelection) throw new Error("execute requires targets or selectionId");
  if (hasSelection) {
    const selectionId = String(body.selectionId ?? "").trim();
    if (!selectionId) throw new Error("execute requires targets or selectionId");
    return { kind: kind as BulkOperationKind, selectionId, idempotencyKey };
  }
  const raw = body.targets;
  if (!Array.isArray(raw) || raw.length === 0) throw new Error("execute requires at least one target");
  const seen = new Set<string>();
  const targets: BulkTarget[] = [];
  for (const entry of raw) {
    const conversationId =
      typeof entry === "string" ? entry.trim() : String((entry as BulkTarget)?.conversationId ?? "").trim();
    if (!conversationId || seen.has(conversationId)) continue;
    seen.add(conversationId);
    targets.push({
      conversationId,
      expectedVersion:
        typeof entry === "string" ? null : ((entry as BulkTarget).expectedVersion ?? null)
    });
  }
  if (targets.length === 0) throw new Error("execute requires at least one target");
  return { kind: kind as BulkOperationKind, targets, idempotencyKey };
}

/** API adapter: validates selection-create bodies (explicit current-page targets). */
export function validateSelectionCreate(body: Record<string, unknown>): { targetIds: string[] } {
  const raw = body.targets;
  if (!Array.isArray(raw) || raw.length === 0) throw new Error("createSelection requires at least one target");
  const seen = new Set<string>();
  const targetIds: string[] = [];
  for (const entry of raw) {
    const conversationId =
      typeof entry === "string" ? entry.trim() : String((entry as { conversationId?: unknown })?.conversationId ?? "").trim();
    if (!conversationId || seen.has(conversationId)) continue;
    seen.add(conversationId);
    targetIds.push(conversationId);
  }
  if (targetIds.length === 0) throw new Error("createSelection requires at least one target");
  return { targetIds };
}

/**
 * Per-item result projection: display metadata only — never transcript
 * content. Strips anything the service row might carry beyond the list card.
 */
export function projectManagedItem(item: ManagedSessionItem & Record<string, unknown>): ManagedSessionItem {
  return {
    conversationId: item.conversationId,
    title: item.title,
    source: item.source,
    channel: item.channel,
    botId: item.botId,
    projectId: item.projectId,
    ownerExternalUserId: item.ownerExternalUserId,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    lastActivityAt: item.lastActivityAt,
    userTurnCount: item.userTurnCount,
    assistantTurnCount: item.assistantTurnCount,
    state: item.state,
    version: item.version,
    retain: item.retain,
    archivedAt: item.archivedAt,
    trashedAt: item.trashedAt
  };
}

/** Bulk operation projection: operation identity, counts and per-item outcomes. */
export function projectBulkResult(result: BulkOperationResult): BulkOperationResult {
  return {
    operationId: result.operationId,
    kind: result.kind,
    counts: { ...result.counts },
    items: result.items.map((item) => ({
      conversationId: item.conversationId,
      expectedVersion: item.expectedVersion,
      status: item.status,
      reason: item.reason,
      detail: item.detail,
      state: item.state,
      version: item.version
    }))
  };
}
