import type { RuntimeSettings } from "$lib/server/settings/schema.js";
import { DEFAULT_AGENT_ID } from "$lib/server/settings/schema.js";
import { agentIdForSession } from "$lib/server/sessions/executionIdentity.js";
import type { SessionStore } from "$lib/server/sessions/store.js";
import { nextCronOccurrence } from "$lib/server/agent/events.js";
import type { ApprovalRequest } from "$lib/server/approval/approvalTypes.js";
import type { EventExecutionLease, EventExecutionLeaseStore } from "$lib/server/agent/eventsLeaseStore.js";
import type { SqliteTraceStore, TraceFactRecord } from "$lib/server/agent/hooks/traceStore.js";
import type { DurableExecutionCoordinator } from "$lib/server/agent/durable/coordinator.js";
import type { PlanService } from "$lib/server/agent/plans/service.js";
import type { DurableExecutionStatus, PlanDetail } from "$lib/server/agent/durable/types.js";
import type { DesktopSessionRun } from "$lib/shared/desktop.js";
import type {
  DesktopHandover,
  DesktopHomeMemoryReview,
  DesktopHandoverCounts,
  DesktopHandoverCrossChannel,
  DesktopHandoverDetailCode,
  DesktopHandoverItem,
  DesktopHandoverItemKind,
  DesktopHandoverNextScheduled,
  DesktopHandoverPending,
  DesktopHandoverSnapshot
} from "$lib/shared/desktop.js";
import { normalizeDeliveryDisplay, normalizeDeliveryReceipt } from "./taskDelivery.js";

/**
 * Agent Handover read model (PA-HD1–13).
 *
 * This is the only place that decides what counts as one item, which evidence
 * wins a duplicate, how items are ordered and where the window starts. Routes
 * pass raw evidence in; the client renders the result without recomputing any
 * of it. Counting unit is an entry: runs, retries and notice rows that belong to
 * one task execution collapse into a single item.
 */

/** A quick return to the home may still show the generation the user just saw. */
const PREVIOUS_GENERATION_VISIBLE_MS = 60 * 60 * 1000;
/** Fresh installs and clock skew fall back to a bounded window instead of all history. */
const DEFAULT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ITEMS = 20;

const COMPLETED_LEASE_STATUSES = new Set(["completed", "failed", "aborted", "interrupted"]);
const ATTENTION_EXECUTION_STATUSES = new Set<DurableExecutionStatus>(["planned", "waiting_for_user", "waiting_for_approval", "recovery_required"]);
/** A parked run older than this is dead state left by a killed process, not a live wait. */
const WAITING_RUN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const DETAIL_LIMIT = 220;
const RESULT_LIMIT = 260;

export interface HandoverTaskInput {
  taskId?: string;
  type: string;
  enabled: boolean;
  text: string;
  scheduleText: string;
  channel: string;
  botId: string;
  projectId?: string;
  managed?: { by?: string };
}

export interface HandoverEvidence {
  runs: TraceFactRecord[];
  notices: TraceFactRecord[];
  leases: EventExecutionLease[];
  pending: DesktopHandoverPending[];
  schedules: DesktopHandoverNextScheduled[];
  memoryReview?: DesktopHomeMemoryReview;
}

export interface BuildHandoverInput {
  now: Date;
  settings: RuntimeSettings;
  evidence: HandoverEvidence;
  projectSessionIds?: ReadonlySet<string>;
  /** Delivered text of a Session, used for a result preview. */
  previewOf?: (sessionId: string) => string;
}

export interface HandoverReadDeps {
  settings: RuntimeSettings;
  sessions: Pick<SessionStore, "getConversationProjectId">;
  traceStore: Pick<SqliteTraceStore, "listHandoverFactsSince">;
  leaseStore: Pick<EventExecutionLeaseStore, "listFinishedSince">;
  hostBashStore: Pick<HostBashPendingReader, "listPending">;
  brokerPending: () => ApprovalRequest[];
  sessionRuns: () => DesktopSessionRun[];
  /** Title or last message of a Session, so a waiting run never shows a blank row. */
  sessionSummary?: (sessionId: string) => { title?: string; preview?: string };
  /**
   * Whether a Session still exists. A pending decision whose source was deleted
   * is not a decision the user can make, so it must not reach the page.
   */
  sessionResolves?: (sessionId: string) => boolean;
  /** The route owns the write; the read model only reports the orphan. */
  onOrphanedApproval?: (requestId: string) => void;
  plans: Pick<PlanService, "read">;
  coordinator: Pick<DurableExecutionCoordinator, "list">;
  tasks: HandoverTaskInput[];
  memoryReview?: () => DesktopHomeMemoryReview;
  now?: Date;
}

interface HostBashPendingReader {
  listPending(): Array<{
    id: string;
    category?: string;
    displayName: string;
    command: string;
    reason: string;
    channel: string;
    sessionId?: string;
    requestedAt: string;
    scopeId: string;
    owner?: { kind: string; id: string };
  }>;
}

function handoverWindowStart(settings: RuntimeSettings, now: Date): Date {
  const acknowledged = Date.parse(String(settings.desktopNavigation?.lastAcknowledgedAt ?? ""));
  const nowMs = now.getTime();
  const fallback = nowMs - DEFAULT_WINDOW_MS;
  if (!Number.isFinite(acknowledged) || acknowledged > nowMs) return new Date(fallback);
  return new Date(Math.max(acknowledged, nowMs - MAX_WINDOW_MS));
}


function isoOf(value: string | undefined, fallback: string): string {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

function durationMs(startedAt?: string, finishedAt?: string): number | undefined {
  const start = Date.parse(String(startedAt ?? ""));
  const end = Date.parse(String(finishedAt ?? ""));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return undefined;
  return end - start;
}

function eventPayloadOf(lease: EventExecutionLease): Record<string, unknown> {
  try {
    const parsed = JSON.parse(lease.eventPayloadJson) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function taskTextOf(payload: Record<string, unknown>): string {
  return typeof payload.text === "string" ? payload.text.trim() : "";
}

function clip(text: string, limit: number): string {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit - 1).trimEnd()}…`;
}

function clipPreview(text: string, limit: number): string {
  const normalized = String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/^#{1,6}\s+/, "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit - 1).trimEnd()}…`;
}

/**
 * Turns a provider diagnostic into a short line a person can act on.
 *
 * Runs store `Run failed after model attempts: provider=…, error=<provider JSON>`
 * — useful for debugging, unreadable on the home. The code carries the meaning
 * so the page can phrase it in its own language; the clipped message stays as
 * the supporting detail.
 */
export function summarizeFailure(raw: string | undefined): { detail?: string; detailCode?: DesktopHandoverDetailCode } {
  const text = String(raw ?? "").trim();
  if (!text) return {};
  const lower = text.toLowerCase();
  const code: DesktopHandoverDetailCode =
    /auth_unavailable|api_key_expired|api key expired|invalid api key|incorrect api key|no auth available|unauthorized|"code"\s*:\s*"?401|status code: 401/.test(lower)
      ? "model_auth"
      : /insufficient balance|insufficient_quota|billing|payment required|status code: 402/.test(lower)
        ? "account_balance"
        : /model_not_found|unknown provider|invalid model|status code: 404/.test(lower)
          ? "model_missing"
          : /run budget exceeded|too many model failures/.test(lower)
            ? "run_budget"
            : "other";
  return { detail: clip(firstMeaningfulMessage(text), DETAIL_LIMIT), detailCode: code };
}

function firstMeaningfulMessage(text: string): string {
  const message = text.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (message) return message[1].replace(/\\"/g, "\"").replace(/\\n/g, " ").replace(/\\\\/g, "\\");
  const segments = text.split("error=");
  const last = segments[segments.length - 1] ?? text;
  return last.split(" | ")[0];
}

function noticeDetailOf(notice: TraceFactRecord): string {
  const message = notice.payload.message;
  if (typeof message === "string" && message.trim()) return message.trim();
  if (typeof notice.name === "string" && notice.name.trim()) return notice.name.trim();
  return notice.errorPreview ?? "";
}

function resultTextOf(result: unknown): string {
  if (typeof result === "string") return result.trim();
  if (!result || typeof result !== "object") return "";
  const record = result as Record<string, unknown>;
  for (const key of ["text", "notificationText", "message", "summary"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function itemFromLease(
  lease: EventExecutionLease,
  noticesByRun: Map<string, string>,
  projectSessionIds: ReadonlySet<string>,
  defaultAgentId: string,
  previewOf: (sessionId: string) => string
): DesktopHandoverItem | null {
  if (!COMPLETED_LEASE_STATUSES.has(lease.status)) return null;
  if (projectSessionIds.has(lease.sessionId)) return null;
  const scopeAgent = lease.leaseScope.startsWith("agent:") ? lease.leaseScope.slice("agent:".length) : "";
  const agentId = scopeAgent || agentIdForSession(lease.sessionId) || "";
  if (agentId !== defaultAgentId) return null;
  const payload = eventPayloadOf(lease);
  const failed = lease.status !== "completed";
  const kind: DesktopHandoverItemKind = failed
    ? "task-failed"
    : lease.attempt > 1
      ? "task-recovered"
      : "task-completed";
  const duration = durationMs(lease.startedAt, lease.finishedAt);
  const failure = failed ? summarizeFailure(lease.lastError || noticesByRun.get(lease.runId)) : {};
  const resultPreview = failed
    ? ""
    : clipPreview(resultTextOf(lease.result) || previewOf(lease.sessionId), RESULT_LIMIT);
  const resultRecord = lease.result && typeof lease.result === "object" && !Array.isArray(lease.result)
    ? lease.result as Record<string, unknown>
    : undefined;
  const display = failed
    ? undefined
    : normalizeDeliveryDisplay(resultRecord?.display) ?? normalizeDeliveryDisplay(payload.display);
  const delivery = failed ? undefined : normalizeDeliveryReceipt(resultRecord?.delivery);
  return {
    id: `task:${lease.id}`,
    kind,
    occurredAt: isoOf(lease.finishedAt, lease.lastHeartbeatAt),
    agentId,
    ...(lease.sessionId ? { sessionId: lease.sessionId } : {}),
    ...(lease.channel ? { channel: lease.channel } : {}),
    runId: lease.runId,
    ...(lease.taskId ? { taskId: lease.taskId } : {}),
    ...(lease.triggerSlot ? { periodSlot: lease.triggerSlot } : {}),
    title: taskTextOf(payload),
    ...(failure.detail !== undefined ? { detail: failure.detail } : {}),
    ...(failure.detailCode ? { detailCode: failure.detailCode } : {}),
    ...(resultPreview ? { resultPreview } : {}),
    ...(display ? { display } : {}),
    ...(delivery ? { delivery } : {}),
    ...(duration !== undefined ? { durationMs: duration } : {}),
    attempts: Math.max(1, lease.attempt)
  };
}

/**
 * A periodic task produces one current period, not a card per day. Retries
 * share the planned slot; a newer slot replaces the previous one, and the
 * older periods remain available through the task's execution history. A
 * one-shot or immediate run keeps its own identity per trigger.
 */
function latestPeriodLeases(leases: EventExecutionLease[]): EventExecutionLease[] {
  const latest = new Map<string, EventExecutionLease>();
  const standalone: EventExecutionLease[] = [];
  for (const lease of leases) {
    if (!lease.taskId) {
      standalone.push(lease);
      continue;
    }
    const key = lease.eventType === "periodic"
      ? `periodic:${lease.taskId}`
      : `run:${lease.taskId}:${lease.triggerSlot}`;
    const existing = latest.get(key);
    const at = Date.parse(String(lease.finishedAt ?? lease.startedAt ?? ""));
    const existingAt = Date.parse(String(existing?.finishedAt ?? existing?.startedAt ?? ""));
    if (!existing || at > existingAt) latest.set(key, lease);
  }
  return [...latest.values(), ...standalone];
}

function countsOf(items: DesktopHandoverItem[], pending: DesktopHandoverPending[]): DesktopHandoverCounts {
  const failed = items.filter((item) => item.kind === "task-failed" || item.kind === "run-failed").length;
  const recovered = items.filter((item) => item.kind === "task-recovered").length;
  return {
    completed: items.length - failed,
    failed,
    pending: pending.length,
    recovered
  };
}

/** A channel other than the app itself means the owner already saw the reply there. */
function isExternalChannel(channel: string | undefined): boolean {
  const value = String(channel ?? "").trim();
  return Boolean(value) && value !== "web";
}

function runAgentId(fact: TraceFactRecord): string {
  const payloadAgent = typeof fact.payload.agentId === "string" ? fact.payload.agentId.trim() : "";
  return payloadAgent || agentIdForSession(fact.sessionId) || "";
}

/**
 * Ad-hoc replies on another channel are conversations, not work the Agent did
 * on its own. They are collapsed into one line so the page stops claiming the
 * owner missed answers they already read in WeChat or Feishu.
 */
function buildCrossChannel(
  runs: TraceFactRecord[],
  projectSessionIds: ReadonlySet<string>,
  defaultAgentId: string
): DesktopHandoverCrossChannel | undefined {
  const external = runs.filter((fact) =>
    fact.factType === "run" &&
    fact.status === "success" &&
    isExternalChannel(fact.channel) &&
    !projectSessionIds.has(fact.sessionId) &&
    runAgentId(fact) === defaultAgentId
  );
  if (external.length === 0) return undefined;
  const channels: string[] = [];
  let latest = 0;
  for (const fact of external) {
    const channel = String(fact.channel ?? "").trim();
    if (channel && !channels.includes(channel)) channels.push(channel);
    const at = Date.parse(String(fact.finishedAt ?? fact.updatedAt ?? ""));
    if (Number.isFinite(at) && at > latest) latest = at;
  }
  return {
    count: external.length,
    channels,
    latestAt: new Date(latest || Date.now()).toISOString()
  };
}

/**
 * Merges raw evidence into the one page projection.
 *
 * Failed promises sort first (story 12); everything else is newest first. Task
 * executions win their run's trace facts so a retried or failed task is not
 * counted twice.
 */
export function buildDesktopHandover(input: BuildHandoverInput): DesktopHandover {
  const nowIso = input.now.toISOString();
  const defaultAgentId = String(input.settings.defaultAgentId || DEFAULT_AGENT_ID);
  const previewOf = input.previewOf ?? (() => "");
  const noticesByRun = new Map<string, string>();
  for (const notice of input.evidence.notices) {
    if (!noticesByRun.has(notice.runId)) noticesByRun.set(notice.runId, noticeDetailOf(notice));
  }

  const leaseItems = latestPeriodLeases(input.evidence.leases)
    .map((lease) => itemFromLease(lease, noticesByRun, input.projectSessionIds ?? new Set(), defaultAgentId, previewOf))
    .filter((item): item is DesktopHandoverItem => Boolean(item));
  const leaseRunIds = new Set(leaseItems.map((item) => item.runId).filter(Boolean));
  const adHocRuns = input.evidence.runs.filter((fact) => !leaseRunIds.has(fact.runId));
  // Ad-hoc chat replies are conversations, not work the Agent did on its own.
  // They stay in the recent-conversation list; only other-channel replies get
  // one aggregate card so the page acknowledges them without repeating them.
  const crossChannel = buildCrossChannel(adHocRuns, input.projectSessionIds ?? new Set(), defaultAgentId);

  const nextRunByTask = new Map<string, string>();
  for (const schedule of input.evidence.schedules) {
    if (!schedule.taskId || Date.parse(schedule.at) <= input.now.getTime()) continue;
    const existing = nextRunByTask.get(schedule.taskId);
    if (!existing || Date.parse(schedule.at) < Date.parse(existing)) nextRunByTask.set(schedule.taskId, schedule.at);
  }

  const items = [...leaseItems]
    .map((item) => {
      const nextRunAt = item.taskId ? nextRunByTask.get(item.taskId) : undefined;
      return nextRunAt ? { ...item, nextRunAt } : item;
    })
    .sort((left, right) => {
      // Failures first; inside finished work a promised delivery outranks an
      // ad-hoc reply, because the promise is the part the owner could not see.
      const leftRank = left.kind.endsWith("failed") ? 0 : left.taskId ? 1 : 2;
      const rightRank = right.kind.endsWith("failed") ? 0 : right.taskId ? 1 : 2;
      return leftRank - rightRank || Date.parse(right.occurredAt) - Date.parse(left.occurredAt);
    })
    .slice(0, MAX_ITEMS);

  const seen = new Set<string>();
  const pending = [...input.evidence.pending]
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
    .filter((entry) => {
      const key = entry.requestId ? `approval:${entry.requestId}` : entry.kind === "decision" ? `decision:${entry.decisionId}` : `item:${entry.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  const nextScheduled = input.evidence.schedules
    .filter((entry) => Date.parse(entry.at) > input.now.getTime())
    .sort((left, right) => Date.parse(left.at) - Date.parse(right.at))[0];
  const counts = countsOf(items, pending);
  const lastAcknowledgedAt = String(input.settings.desktopNavigation?.lastAcknowledgedAt ?? "").trim() || undefined;
  const memoryReview = input.evidence.memoryReview;
  const state = memoryReview && (memoryReview.items.length > 0 || memoryReview.skillDraftCount || memoryReview.unavailable)
    ? "active"
    : !lastAcknowledgedAt && items.length === 0 && pending.length === 0 && !nextScheduled && !crossChannel
    ? "first-run"
    : items.length === 0 && pending.length === 0 && !crossChannel
      ? "quiet"
      : "active";

  const previous = visiblePreviousGeneration(input.settings.desktopNavigation?.previousHandover, input.now, items.length === 0);

  return {
    state,
    generatedAt: nowIso,
    ...(lastAcknowledgedAt ? { lastAcknowledgedAt } : {}),
    counts,
    items,
    pending,
    ...(memoryReview ? { memoryReview } : {}),
    ...(nextScheduled ? { nextScheduled, nextScheduledItems: input.evidence.schedules.filter(entry => Date.parse(entry.at) > input.now.getTime()).sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).slice(0, 3) } : {}),
    ...(crossChannel ? { crossChannel } : {}),
    ...(previous ? { previous } : {})
  };
}

function visiblePreviousGeneration(
  snapshot: DesktopHandoverSnapshot | undefined,
  now: Date,
  currentEmpty: boolean
): DesktopHandoverSnapshot | undefined {
  if (!snapshot || !currentEmpty || snapshot.items.length === 0) return undefined;
  const capturedAt = Date.parse(snapshot.capturedAt);
  if (!Number.isFinite(capturedAt) || now.getTime() - capturedAt > PREVIOUS_GENERATION_VISIBLE_MS) return undefined;
  return snapshot;
}

/** Freezes the current rendering as the single previous generation (PA-HD13). */
export function compactHandoverSnapshot(handover: DesktopHandover, capturedAt: string): DesktopHandoverSnapshot {
  return {
    capturedAt,
    itemCount: handover.items.length,
    pendingCount: handover.pending.length,
    counts: handover.counts,
    items: handover.items.slice(0, MAX_ITEMS).map(({ detail: _detail, display: _display, ...item }) => item)
  };
}

/**
 * Collects every evidence source for the page. Tasks are passed in because the
 * settings task route owns file scanning; the rest are read from their stores.
 */
export function readDesktopHandover(deps: HandoverReadDeps): DesktopHandover {
  const now = deps.now ?? new Date();
  const since = handoverWindowStart(deps.settings, now).toISOString();
  const sessions = deps.sessions;
  const facts = deps.traceStore.listHandoverFactsSince(since);
  const runs = facts.filter((fact) => fact.factType === "run");
  const notices = facts.filter((fact) => fact.factType === "runtime_notice");
  const leases = deps.leaseStore.listFinishedSince(since);
  const summaries = new Map<string, { title?: string; preview?: string }>();
  const previewOf = (sessionId: string): string => {
    if (!sessionId || !deps.sessionSummary) return "";
    if (!summaries.has(sessionId)) summaries.set(sessionId, deps.sessionSummary(sessionId) ?? {});
    return summaries.get(sessionId)?.preview ?? "";
  };

  const projectSessionIds = new Set(
    [...new Set([...runs.map((fact) => fact.sessionId), ...leases.map((lease) => lease.sessionId)])]
      .filter((sessionId) => Boolean(sessionId) && Boolean(sessions.getConversationProjectId(sessionId)))
  );

  const pending = collectPending(deps, now);

  const executionSchedules = deps.coordinator.list({ ownerId: "owner", limit: 200 })
    .map(({ execution }) => execution)
    .filter((execution) => execution.nextRunAt && Date.parse(execution.nextRunAt) > now.getTime())
    .map<DesktopHandoverNextScheduled>((execution) => ({
      at: execution.nextRunAt!,
      title: execution.goal,
      source: "durable",
      ...(execution.sourceUiSessionId ? { sessionId: execution.sourceUiSessionId } : {})
    }));

  const taskSchedules = deps.tasks.flatMap<DesktopHandoverNextScheduled>((task) => {
    if (!task.enabled || task.channel === "system" || task.projectId) return [];
    if (task.managed?.by === "molibot") return [];
    if (task.type === "periodic") {
      const at = nextCronOccurrence(task.scheduleText, now);
      return at ? [{ at, title: task.text, source: "task" as const, ...(task.botId ? { agentId: task.botId } : {}), ...(task.taskId ? { taskId: task.taskId } : {}) }] : [];
    }
    if (task.type === "one-shot") {
      const at = Date.parse(task.scheduleText);
      return Number.isFinite(at) && at > now.getTime()
        ? [{ at: new Date(at).toISOString(), title: task.text, source: "task" as const, ...(task.botId ? { agentId: task.botId } : {}), ...(task.taskId ? { taskId: task.taskId } : {}) }]
        : [];
    }
    return [];
  });

  return buildDesktopHandover({
    now,
    settings: deps.settings,
    projectSessionIds,
    previewOf,
    evidence: {
      runs,
      notices,
      leases,
      pending,
      ...(deps.memoryReview ? { memoryReview: deps.memoryReview() } : {}),
      schedules: [...taskSchedules, ...executionSchedules]
    }
  });
}

function collectPending(deps: HandoverReadDeps, now: Date): DesktopHandoverPending[] {
  const pending: DesktopHandoverPending[] = [];
  const coveredSessions = new Set<string>();

  const resolves = deps.sessionResolves ?? (() => true);
  for (const record of deps.hostBashStore.listPending()) {
    if (!record.category) continue;
    if (record.sessionId && !resolves(record.sessionId)) {
      // The Session was deleted; the approval can never be consumed again.
      deps.onOrphanedApproval?.(record.id);
      continue;
    }
    if (record.sessionId) coveredSessions.add(record.sessionId);
    pending.push({
      id: `approval:${record.id}`,
      kind: "approval",
      title: record.displayName,
      detail: record.command || record.reason,
      createdAt: isoOf(record.requestedAt, new Date().toISOString()),
      agentId: record.owner?.kind === "agent" ? record.owner.id : agentIdForSession(record.sessionId) ?? "",
      ...(record.sessionId ? { sessionId: record.sessionId } : {}),
      ...(record.channel ? { channel: record.channel } : {}),
      requestId: record.id,
      ...(record.reason ? { scope: record.reason } : {}),
      actionable: record.scopeId.startsWith("web:")
    });
  }

  // Broker approvals are executable from their source Session, not from the
  // home: the operator endpoint only knows Host Bash and Durable records.
  for (const request of deps.brokerPending()) {
    if (request.capability?.startsWith("bash:")) continue;
    if (request.sessionId && !resolves(request.sessionId)) continue;
    if (request.sessionId) coveredSessions.add(request.sessionId);
    pending.push({
      id: `broker:${request.id}`,
      kind: "approval",
      title: request.action?.toolName || request.capability || request.id,
      detail: request.reason,
      createdAt: isoOf(request.createdAt, new Date().toISOString()),
      agentId: request.requestedBy?.agentId || agentIdForSession(request.sessionId) || "",
      ...(request.sessionId ? { sessionId: request.sessionId } : {}),
      requestId: request.id,
      ...(request.reason ? { scope: request.reason } : {}),
      actionable: false
    });
  }

  for (const { execution } of deps.coordinator.list({
    ownerId: "owner",
    statuses: [...ATTENTION_EXECUTION_STATUSES],
    limit: 200
  })) {
    if (!ATTENTION_EXECUTION_STATUSES.has(execution.status)) continue;
    let detail: PlanDetail;
    try {
      detail = deps.plans.read("owner", execution.id);
    } catch {
      continue;
    }
    const sessionId = detail.binding?.sessionId ?? detail.execution.sourceUiSessionId;
    const channel = String(detail.execution.sourceChannel ?? "").trim() || undefined;
    const agentId = detail.agentId || agentIdForSession(sessionId) || "";
    if (sessionId) coveredSessions.add(sessionId);
    const approvals = detail.approvals.filter((approval) => approval.status === "pending");
    const decisions = detail.decisions.filter((decision) => decision.status === "open");
    for (const approval of approvals) {
      pending.push({
        id: `durable-approval:${approval.requestId}`,
        kind: "approval",
        title: approval.title,
        detail: approval.summary,
        createdAt: isoOf(approval.requestedAt, new Date().toISOString()),
        agentId,
        ...(sessionId ? { sessionId } : {}),
        ...(channel ? { channel } : {}),
        requestId: approval.requestId,
        approvalId: approval.id,
        executionId: detail.execution.id,
        expectedVersion: detail.execution.version,
        goal: detail.execution.goal,
        ...(approval.summary ? { scope: approval.summary } : {}),
        actionable: true
      });
    }
    for (const decision of decisions) {
      pending.push({
        id: `decision:${decision.id}`,
        kind: "decision",
        title: decision.question,
        createdAt: isoOf(decision.createdAt, new Date().toISOString()),
        agentId,
        ...(sessionId ? { sessionId } : {}),
        ...(channel ? { channel } : {}),
        executionId: detail.execution.id,
        decisionId: decision.id,
        expectedVersion: detail.execution.version,
        options: decision.options,
        goal: detail.execution.goal,
        ...(detail.meta.summary ? { scope: detail.meta.summary } : {}),
        actionable: true
      });
    }
    if (approvals.length === 0 && decisions.length === 0) {
      if (detail.execution.status === "planned") {
        pending.push({
          id: `plan:${detail.execution.id}`,
          kind: "plan",
          title: detail.meta.title,
          detail: detail.meta.summary,
          createdAt: isoOf(detail.execution.createdAt, new Date().toISOString()),
          agentId,
          ...(sessionId ? { sessionId } : {}),
          ...(channel ? { channel } : {}),
          planId: detail.execution.id,
          executionId: detail.execution.id,
          expectedVersion: detail.execution.version,
          options: ["manual", "accept_edits"],
          goal: detail.execution.goal,
          ...(detail.meta.summary ? { scope: detail.meta.summary } : {}),
          actionable: true
        });
      } else {
        pending.push({
          id: `run:${detail.execution.id}`,
          kind: "run",
          title: detail.meta.title,
          detail: detail.execution.waitingReason ?? detail.meta.summary,
          createdAt: isoOf(detail.execution.updatedAt, new Date().toISOString()),
          agentId,
          ...(sessionId ? { sessionId } : {}),
          ...(channel ? { channel } : {}),
          executionId: detail.execution.id,
          goal: detail.execution.goal,
          ...(detail.meta.summary ? { scope: detail.meta.summary } : {}),
          actionable: false
        });
      }
    }
  }

  for (const run of deps.sessionRuns()) {
    if (!run.waitingApproval && run.status !== "recovery_review") continue;
    if (coveredSessions.has(run.sessionId)) continue;
    if (!resolves(run.sessionId)) continue;
    const startedAt = Date.parse(String(run.startedAt ?? ""));
    // A run parked by a killed process keeps its row forever; six-week-old rows
    // are not something the user can still decide, so they are not a handover.
    if (!Number.isFinite(startedAt) || now.getTime() - startedAt > WAITING_RUN_MAX_AGE_MS) continue;
    coveredSessions.add(run.sessionId);
    const summary = deps.sessionSummary?.(run.sessionId) ?? {};
    const title = (summary.title ?? "").trim() || (summary.preview ?? "").trim();
    pending.push({
      id: `session-run:${run.runId}`,
      kind: "run",
      title,
      createdAt: isoOf(run.startedAt, now.toISOString()),
      agentId: agentIdForSession(run.sessionId) ?? "",
      sessionId: run.sessionId,
      runId: run.runId,
      waitKind: run.waitingApproval ? "approval" : "recovery",
      actionable: false
    });
  }

  return pending;
}
