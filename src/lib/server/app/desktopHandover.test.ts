import assert from "node:assert/strict";
import test from "node:test";
import { buildDesktopHandover, compactHandoverSnapshot, readDesktopHandover, type HandoverEvidence, type HandoverReadDeps } from "./desktopHandover.js";
import { defaultRuntimeSettings } from "$lib/server/settings/defaults.js";
import type { RuntimeSettings } from "$lib/server/settings/schema.js";
import type { DesktopHandoverNextScheduled, DesktopHandoverPending } from "$lib/shared/desktop.js";
import type { PlanDetail } from "$lib/server/agent/durable/types.js";
import type { EventExecutionLease } from "$lib/server/agent/eventsLeaseStore.js";
import type { TraceFactRecord } from "$lib/server/agent/hooks/traceStore.js";

function settings(overrides: Partial<RuntimeSettings> = {}): RuntimeSettings {
  return {
    ...structuredClone(defaultRuntimeSettings),
    defaultAgentId: "default",
    agents: [{ id: "default", name: "Momo", description: "", enabled: true }, { id: "writer", name: "Writer", description: "", enabled: true }],
    desktopNavigation: { expandedAgentIds: [], page: "agent", agentId: "default", sessionId: "" },
    ...overrides
  };
}

function runFact(overrides: Partial<TraceFactRecord> = {}): TraceFactRecord {
  return {
    id: "fact-run",
    factType: "run",
    runId: "run-1",
    factId: "run-1",
    channel: "web",
    botId: "default",
    chatId: "chat",
    sessionId: "session-1",
    status: "success",
    payload: { agentId: "default", taskPreview: "Summarised the invoices" },
    createdAt: "2026-10-22T08:00:00.000Z",
    updatedAt: "2026-10-22T08:05:00.000Z",
    startedAt: "2026-10-22T08:00:00.000Z",
    finishedAt: "2026-10-22T08:05:00.000Z",
    durationMs: 300_000,
    ...overrides
  };
}

function lease(overrides: Partial<EventExecutionLease> = {}): EventExecutionLease {
  return {
    id: "lease-1",
    leaseScope: "agent:default",
    eventFile: "task-1.json",
    eventType: "periodic",
    triggerSlot: "2026-10-22T08:00",
    chatId: "chat",
    sessionId: "session-task",
    channel: "web",
    taskId: "task-1",
    runId: "task-run-1",
    status: "completed",
    attempt: 1,
    maxAttempts: 3,
    timeoutMs: 60_000,
    startedAt: "2026-10-22T07:00:00.000Z",
    lastHeartbeatAt: "2026-10-22T07:01:00.000Z",
    finishedAt: "2026-10-22T07:01:00.000Z",
    eventPayloadJson: JSON.stringify({ text: "Morning briefing" }),
    ...overrides
  };
}

function pending(overrides: Partial<DesktopHandoverPending> = {}): DesktopHandoverPending {
  return {
    id: "approval:req-1",
    kind: "approval",
    title: "Run a shell command",
    createdAt: "2026-10-22T09:00:00.000Z",
    agentId: "default",
    requestId: "req-1",
    sessionId: "session-1",
    actionable: true,
    ...overrides
  };
}

function schedule(overrides: Partial<DesktopHandoverNextScheduled> = {}): DesktopHandoverNextScheduled {
  return { at: "2026-10-23T08:00:00.000Z", title: "Morning briefing", source: "task", ...overrides };
}

function evidence(overrides: Partial<HandoverEvidence> = {}): HandoverEvidence {
  return { runs: [], notices: [], leases: [], pending: [], schedules: [], ...overrides };
}

const NOW = new Date("2026-10-23T00:00:00.000Z");

test("Handover counts one entry per task execution and prefers it over its derived run fact", () => {
  const handover = buildDesktopHandover({
    now: NOW,
    settings: settings(),
    evidence: evidence({
      leases: [lease()],
      runs: [
        runFact({ runId: "task-run-1", sessionId: "session-task", payload: { agentId: "default" } }),
        runFact({ runId: "run-2", sessionId: "session-2", payload: { agentId: "default", taskPreview: "Wrote the report" }, finishedAt: "2026-10-22T10:00:00.000Z" })
      ]
    })
  });

  assert.equal(handover.state, "active");
  assert.equal(handover.items.length, 2);
  assert.deepEqual(handover.items.map((item) => item.id), ["run:run-2", "task:lease-1"]);
  assert.equal(handover.counts.completed, 2);
  assert.equal(handover.counts.failed, 0);
  assert.equal(handover.counts.pending, 0);
});

test("Handover puts failed promises first and reports a recovered retry once", () => {
  const handover = buildDesktopHandover({
    now: NOW,
    settings: settings(),
    evidence: evidence({
      leases: [
        lease({ id: "ok", runId: "run-ok", taskId: "task-ok", attempt: 2, finishedAt: "2026-10-22T10:00:00.000Z", eventPayloadJson: JSON.stringify({ text: "Retried sync" }) }),
        lease({ id: "bad", runId: "run-bad", taskId: "task-bad", status: "failed", lastError: "network down", finishedAt: "2026-10-22T09:00:00.000Z", eventPayloadJson: JSON.stringify({ text: "Failed sync" }) })
      ]
    })
  });

  assert.deepEqual(handover.items.map((item) => item.kind), ["task-failed", "task-recovered"]);
  assert.equal(handover.counts.failed, 1);
  assert.equal(handover.counts.completed, 1);
  assert.equal(handover.counts.recovered, 1);
  assert.equal(handover.items[0].detail, "network down");
});

test("Handover attributes completed work to its producing Agent but lists every pending decision", () => {
  const handover = buildDesktopHandover({
    now: NOW,
    settings: settings(),
    evidence: evidence({
      runs: [runFact({ payload: { agentId: "writer", taskPreview: "Draft" } })],
      pending: [pending({ agentId: "writer", requestId: "req-writer", id: "approval:req-writer" })]
    })
  });

  assert.deepEqual(handover.items, []);
  assert.equal(handover.pending.length, 1);
  assert.equal(handover.pending[0].agentId, "writer");
  assert.equal(handover.state, "active");
});

test("Handover first-run, quiet and active states follow history, entries and the next schedule", () => {
  const firstRun = buildDesktopHandover({ now: NOW, settings: settings(), evidence: evidence() });
  assert.equal(firstRun.state, "first-run");

  const quiet = buildDesktopHandover({ now: NOW, settings: settings(), evidence: evidence({ schedules: [schedule()] }) });
  assert.equal(quiet.state, "quiet");
  assert.equal(quiet.nextScheduled?.title, "Morning briefing");

  const active = buildDesktopHandover({
    now: NOW,
    settings: settings({ desktopNavigation: { expandedAgentIds: [], page: "agent", agentId: "default", sessionId: "", lastAcknowledgedAt: "2026-10-22T00:00:00.000Z" } }),
    evidence: evidence({ runs: [runFact()] })
  });
  assert.equal(active.state, "active");
  assert.equal(active.lastAcknowledgedAt, "2026-10-22T00:00:00.000Z");
});

test("Pending decisions ignore the acknowledged window", () => {
  const handover = buildDesktopHandover({
    now: NOW,
    settings: settings({ desktopNavigation: { expandedAgentIds: [], page: "agent", agentId: "default", sessionId: "", lastAcknowledgedAt: NOW.toISOString() } }),
    evidence: evidence({ pending: [pending()] })
  });
  assert.equal(handover.pending.length, 1);
  assert.equal(handover.counts.pending, 1);
});

test("A de-duplicated pending approval is listed once", () => {
  const handover = buildDesktopHandover({
    now: NOW,
    settings: settings(),
    evidence: evidence({ pending: [pending(), pending({ id: "duplicate" })] })
  });
  assert.equal(handover.pending.length, 1);
});

test("The previous generation is visible only for a quick return to an empty window", () => {
  const snapshot = compactHandoverSnapshot({
    state: "active",
    generatedAt: "2026-10-22T23:50:00.000Z",
    counts: { completed: 1, failed: 0, pending: 0, recovered: 0 },
    items: [{ id: "run:1", kind: "run-completed", occurredAt: "2026-10-22T23:00:00.000Z", agentId: "default", title: "Done", detail: "not kept" }],
    pending: []
  }, "2026-10-22T23:50:00.000Z");

  const quickReturn = buildDesktopHandover({
    now: NOW,
    settings: settings({ desktopNavigation: { expandedAgentIds: [], page: "agent", agentId: "default", sessionId: "", lastAcknowledgedAt: "2026-10-22T23:50:00.000Z", previousHandover: snapshot } }),
    evidence: evidence()
  });
  assert.equal(quickReturn.state, "quiet");
  assert.equal(quickReturn.previous?.items[0].title, "Done");
  assert.equal("detail" in (quickReturn.previous?.items[0] ?? {}), false);

  const stale = buildDesktopHandover({
    now: new Date("2026-10-23T03:00:00.000Z"),
    settings: settings({ desktopNavigation: { expandedAgentIds: [], page: "agent", agentId: "default", sessionId: "", lastAcknowledgedAt: "2026-10-22T23:50:00.000Z", previousHandover: snapshot } }),
    evidence: evidence()
  });
  assert.equal(stale.previous, undefined);
});

test("The frozen previous generation keeps at most twenty entries", () => {
  const items = Array.from({ length: 25 }, (_, index) => ({
    id: `run:${index}`,
    kind: "run-completed" as const,
    occurredAt: "2026-10-22T23:00:00.000Z",
    agentId: "default",
    title: `Item ${index}`,
    detail: "body"
  }));
  const snapshot = compactHandoverSnapshot({
    state: "active",
    generatedAt: "2026-10-22T23:59:00.000Z",
    counts: { completed: 25, failed: 0, pending: 0, recovered: 0 },
    items,
    pending: []
  }, "2026-10-22T23:59:00.000Z");
  assert.equal(snapshot.items.length, 20);
  assert.equal(snapshot.itemCount, 25);
  assert.equal("detail" in snapshot.items[0], false);
});

/** Minimal Plan detail: only the fields the pending assembly reads. */
function planDetail(overrides: { requestId?: string; approvalId?: string } = {}): PlanDetail {
  return {
    execution: {
      id: "exec-1",
      status: "waiting_for_approval",
      version: 7,
      createdAt: "2026-10-22T08:00:00.000Z",
      updatedAt: "2026-10-22T09:00:00.000Z",
      goal: "Send the report",
      nextRunAt: "2026-10-24T08:00:00.000Z"
    },
    meta: { title: "Send the report", summary: "Email the team once the numbers are approved" },
    agentId: "default",
    approvals: [{
      id: overrides.approvalId ?? "approval-row-1",
      requestId: overrides.requestId ?? "req-durable",
      title: "Send the report",
      summary: "Sends the email through the broker",
      status: "pending",
      requestedAt: "2026-10-22T08:59:00.000Z"
    }],
    decisions: []
  } as unknown as PlanDetail;
}

function readDeps(overrides: Partial<HandoverReadDeps> = {}): HandoverReadDeps {
  const detail = planDetail();
  return {
    settings: settings(),
    sessions: { getConversationProjectId: () => null },
    traceStore: { listHandoverFactsSince: () => [] },
    leaseStore: { listFinishedSince: () => [] },
    hostBashStore: { listPending: () => [] },
    brokerPending: () => [],
    sessionRuns: () => [],
    plans: { read: () => detail },
    coordinator: { list: (() => [detail]) as unknown as HandoverReadDeps["coordinator"]["list"] },
    tasks: [],
    now: NOW,
    ...overrides
  };
}

test("A Durable approval keeps the row id and version the home needs to resolve it in place", () => {
  const handover = readDesktopHandover(readDeps());
  const approval = handover.pending.find((entry) => entry.kind === "approval");

  assert.ok(approval, "the waiting approval must reach the home");
  assert.equal(approval.requestId, "req-durable");
  assert.equal(approval.approvalId, "approval-row-1");
  assert.equal(approval.executionId, "exec-1");
  assert.equal(approval.expectedVersion, 7);
  assert.equal(approval.actionable, true);
});

test("One approval owned by both Host Bash and a Durable execution is listed once", () => {
  const handover = readDesktopHandover(readDeps({
    hostBashStore: {
      listPending: () => [{
        id: "req-durable",
        category: "agent-browser",
        displayName: "Agent Browser",
        command: "agent-browser --open",
        reason: "Needs browser IPC outside the sandbox.",
        channel: "web",
        sessionId: "session-1",
        requestedAt: "2026-10-22T08:58:00.000Z",
        scopeId: "web:personal:web-anonymous",
        owner: { kind: "agent", id: "default" }
      }]
    }
  }));

  assert.equal(handover.pending.length, 1, "PA-HD9 keeps one row per approval");
});


test("A provider failure reaches the page as a short reason instead of the raw diagnostic", () => {
  const raw = [
    "Run failed after model attempts:",
    `provider=cli-proxy-api, model=deepseek-v4.1-flash, baseUrl=https://example.invalid/v1, endpoint=https://example.invalid/v1/chat/completions, type=request_error, error=503: {"message":"auth_unavailable: no auth available","type":"server_error"}`,
    "provider=cli-proxy-api, model=deepseek-v4.1-flash, error=503: {\"message\":\"auth_unavailable: no auth available\",\"type\":\"server_error\"}",
    "Run budget exceeded: too many model failures (6/6)."
  ].join(" | ");
  const handover = buildDesktopHandover({
    now: NOW,
    settings: settings(),
    evidence: evidence({ runs: [runFact({ status: "error", errorPreview: raw })] })
  });

  const item = handover.items[0];
  assert.equal(item.detailCode, "model_auth", "the root cause wins over the budget line");
  assert.ok((item.detail ?? "").length <= 220, "the diagnostic is clipped before it reaches the page");
  assert.match(item.detail ?? "", /auth_unavailable/);
  assert.doesNotMatch(item.detail ?? "", /provider=cli-proxy-api/);
});

test("A finished task shows what it actually delivered", () => {
  const handover = readDesktopHandover(readDeps({
    sessionRuns: () => [],
    traceStore: { listHandoverFactsSince: () => [] },
    leaseStore: {
      listFinishedSince: () => [{
        ...lease({
          id: "lease-report",
          runId: "run-report",
          sessionId: "session-report",
          taskId: "task-report",
          eventPayloadJson: JSON.stringify({ text: "Morning briefing" })
        }),
        result: undefined
      }]
    },
    sessionSummary: (sessionId) => sessionId === "session-report" ? { preview: "Good morning — three invoices are due today." } : {}
  }));

  const item = handover.items.find((entry) => entry.taskId === "task-report");
  assert.ok(item, "the task execution must be listed");
  assert.equal(item?.resultPreview, "Good morning — three invoices are due today.");
});

test("A waiting run is shown by name and loses its row once the waiting state is dead", () => {
  const recent = readDesktopHandover(readDeps({
    sessionRuns: () => [{
      profileId: "personal",
      sessionId: "session-waiting",
      runId: "run-waiting",
      status: "recovery_review",
      startedAt: new Date(NOW.getTime() - 60 * 60_000).toISOString(),
      waitingApproval: false,
      errorCode: "stream_error"
    }],
    sessionSummary: (sessionId) => sessionId === "session-waiting" ? { preview: "Summarise the Q3 numbers" } : {}
  }));
  const item = recent.pending.find((entry) => entry.kind === "run");
  assert.ok(item, "a live wait is a decision the user still owns");
  assert.equal(item?.title, "Summarise the Q3 numbers");
  assert.equal(item?.waitKind, "recovery");

  const dead = readDesktopHandover(readDeps({
    sessionRuns: () => [{
      profileId: "personal",
      sessionId: "session-dead",
      runId: "run-dead",
      status: "waiting_for_approval",
      startedAt: new Date(NOW.getTime() - 30 * 24 * 60 * 60_000).toISOString(),
      waitingApproval: true,
      errorCode: null
    }]
  }));
  assert.equal(dead.pending.some((entry) => entry.kind === "run"), false, "a month-old parked run is residue, not a decision");
});
