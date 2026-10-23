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
  DesktopHandoverCounts,
  DesktopHandoverItem,
  DesktopHandoverItemKind,
  DesktopHandoverNextScheduled,
  DesktopHandoverPending,
  DesktopHandoverSnapshot
} from "$lib/shared/desktop.js";

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

export interface HandoverTaskInput {
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
}

export interface BuildHandoverInput {
  now: Date;
  settings: RuntimeSettings;
  evidence: HandoverEvidence;
  projectSessionIds?: ReadonlySet<string>;
}

export interface HandoverReadDeps {
  settings: RuntimeSettings;
  sessions: Pick<SessionStore, "getConversationProjectId">;
  traceStore: Pick<SqliteTraceStore, "listHandoverFactsSince">;
  leaseStore: Pick<EventExecutionLeaseStore, "listFinishedSince">;
  hostBashStore: Pick<HostBashPendingReader, "listPending">;
  brokerPending: () => ApprovalRequest[];
  sessionRuns: () => DesktopSessionRun[];
  plans: Pick<PlanService, "read">;
  coordinator: Pick<DurableExecutionCoordinator, "list">;
  tasks: HandoverTaskInput[];
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

function taskTextOf(lease: EventExecutionLease): string {
  try {
    const parsed = JSON.parse(lease.eventPayloadJson) as { text?: unknown };
    return typeof parsed.text === "string" ? parsed.text.trim() : "";
  } catch {
    return "";
  }
}

function noticeDetailOf(notice: TraceFactRecord): string {
  const message = notice.payload.message;
  if (typeof message === "string" && message.trim()) return message.trim();
  if (typeof notice.name === "string" && notice.name.trim()) return notice.name.trim();
  return notice.errorPreview ?? "";
}

function itemFromLease(
  lease: EventExecutionLease,
  noticesByRun: Map<string, string>,
  projectSessionIds: ReadonlySet<string>,
  defaultAgentId: string
): DesktopHandoverItem | null {
  if (!COMPLETED_LEASE_STATUSES.has(lease.status)) return null;
  if (projectSessionIds.has(lease.sessionId)) return null;
  const scopeAgent = lease.leaseScope.startsWith("agent:") ? lease.leaseScope.slice("agent:".length) : "";
  const agentId = scopeAgent || agentIdForSession(lease.sessionId) || "";
  if (agentId !== defaultAgentId) return null;
  const failed = lease.status !== "completed";
  const kind: DesktopHandoverItemKind = failed
    ? "task-failed"
    : lease.attempt > 1
      ? "task-recovered"
      : "task-completed";
  const duration = durationMs(lease.startedAt, lease.finishedAt);
  return {
    id: `task:${lease.id}`,
    kind,
    occurredAt: isoOf(lease.finishedAt, lease.lastHeartbeatAt),
    agentId,
    ...(lease.sessionId ? { sessionId: lease.sessionId } : {}),
    ...(lease.channel ? { channel: lease.channel } : {}),
    runId: lease.runId,
    ...(lease.taskId ? { taskId: lease.taskId } : {}),
    title: taskTextOf(lease),
    ...(failed ? { detail: lease.lastError ?? noticesByRun.get(lease.runId) ?? "" } : {}),
    ...(duration !== undefined ? { durationMs: duration } : {}),
    attempts: Math.max(1, lease.attempt)
  };
}

function itemFromRun(
  fact: TraceFactRecord,
  noticesByRun: Map<string, string>,
  projectSessionIds: ReadonlySet<string>,
  defaultAgentId: string
): DesktopHandoverItem | null {
  if (fact.factType !== "run") return null;
  if (!["success", "error", "aborted"].includes(fact.status)) return null;
  if (projectSessionIds.has(fact.sessionId)) return null;
  const payloadAgent = typeof fact.payload.agentId === "string" ? fact.payload.agentId.trim() : "";
  const agentId = payloadAgent || agentIdForSession(fact.sessionId) || "";
  if (agentId !== defaultAgentId) return null;
  const failed = fact.status !== "success";
  const taskPreview = typeof fact.payload.taskPreview === "string" ? fact.payload.taskPreview.trim() : "";
  return {
    id: `run:${fact.runId}`,
    kind: failed ? "run-failed" : "run-completed",
    occurredAt: isoOf(fact.finishedAt ?? fact.updatedAt, fact.updatedAt),
    agentId,
    sessionId: fact.sessionId,
    ...(fact.channel ? { channel: fact.channel } : {}),
    runId: fact.runId,
    title: taskPreview,
    ...(failed ? { detail: fact.errorPreview ?? noticesByRun.get(fact.runId) ?? "" } : {}),
    ...(fact.durationMs !== undefined ? { durationMs: fact.durationMs } : {})
  };
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
  const noticesByRun = new Map<string, string>();
  for (const notice of input.evidence.notices) {
    if (!noticesByRun.has(notice.runId)) noticesByRun.set(notice.runId, noticeDetailOf(notice));
  }

  const leaseItems = input.evidence.leases
    .map((lease) => itemFromLease(lease, noticesByRun, input.projectSessionIds ?? new Set(), defaultAgentId))
    .filter((item): item is DesktopHandoverItem => Boolean(item));
  const leaseRunIds = new Set(leaseItems.map((item) => item.runId).filter(Boolean));
  const runItems = input.evidence.runs
    .filter((fact) => !leaseRunIds.has(fact.runId))
    .map((fact) => itemFromRun(fact, noticesByRun, input.projectSessionIds ?? new Set(), defaultAgentId))
    .filter((item): item is DesktopHandoverItem => Boolean(item));

  const items = [...leaseItems, ...runItems]
    .sort((left, right) => {
      const leftFailed = left.kind.endsWith("failed") ? 0 : 1;
      const rightFailed = right.kind.endsWith("failed") ? 0 : 1;
      return leftFailed - rightFailed || Date.parse(right.occurredAt) - Date.parse(left.occurredAt);
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
  const state = !lastAcknowledgedAt && items.length === 0 && pending.length === 0 && !nextScheduled
    ? "first-run"
    : items.length === 0 && pending.length === 0
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
    ...(nextScheduled ? { nextScheduled } : {}),
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
    items: handover.items.slice(0, MAX_ITEMS).map(({ detail: _detail, ...item }) => item)
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

  const projectSessionIds = new Set(
    [...new Set([...runs.map((fact) => fact.sessionId), ...leases.map((lease) => lease.sessionId)])]
      .filter((sessionId) => Boolean(sessionId) && Boolean(sessions.getConversationProjectId(sessionId)))
  );

  const pending = collectPending(deps);

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
      return at ? [{ at, title: task.text, source: "task" as const, ...(task.botId ? { agentId: task.botId } : {}) }] : [];
    }
    if (task.type === "one-shot") {
      const at = Date.parse(task.scheduleText);
      return Number.isFinite(at) && at > now.getTime()
        ? [{ at: new Date(at).toISOString(), title: task.text, source: "task" as const, ...(task.botId ? { agentId: task.botId } : {}) }]
        : [];
    }
    return [];
  });

  return buildDesktopHandover({
    now,
    settings: deps.settings,
    projectSessionIds,
    evidence: {
      runs,
      notices,
      leases,
      pending,
      schedules: [...taskSchedules, ...executionSchedules]
    }
  });
}

function collectPending(deps: HandoverReadDeps): DesktopHandoverPending[] {
  const pending: DesktopHandoverPending[] = [];
  const coveredSessions = new Set<string>();

  for (const record of deps.hostBashStore.listPending()) {
    if (!record.category) continue;
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
      actionable: record.scopeId.startsWith("web:")
    });
  }

  // Broker approvals are executable from their source Session, not from the
  // home: the operator endpoint only knows Host Bash and Durable records.
  for (const request of deps.brokerPending()) {
    if (request.capability?.startsWith("bash:")) continue;
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
          actionable: false
        });
      }
    }
  }

  for (const run of deps.sessionRuns()) {
    if (!run.waitingApproval && run.status !== "recovery_review") continue;
    if (coveredSessions.has(run.sessionId)) continue;
    coveredSessions.add(run.sessionId);
    pending.push({
      id: `session-run:${run.runId}`,
      kind: "run",
      title: "",
      createdAt: isoOf(run.startedAt, new Date().toISOString()),
      agentId: agentIdForSession(run.sessionId) ?? "",
      sessionId: run.sessionId,
      runId: run.runId,
      actionable: false
    });
  }

  return pending;
}
