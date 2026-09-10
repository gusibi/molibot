import assert from "node:assert/strict";
import test from "node:test";
import type { DesktopActivityEntry } from "../api";
import type { ConversationHost, ConversationController } from "./conversationController.svelte";

type ControllerHarness = {
  liveSteps: Array<{ kind: string; activity?: DesktopActivityEntry }>;
  bufferLiveText(kind: "text" | "thinking", delta: string): void;
  flushStreamBuffers(): void;
  upsertLiveActivity(activity: DesktopActivityEntry): void;
};

async function createControllerHarness(overrides: Partial<ConversationHost> = {}): Promise<ControllerHarness & Pick<ConversationController, "resolveApproval" | "sending" | "turnSessionId" | "pendingApproval">> {
  // `tsx --test` does not run the Svelte rune transform. These identity shims
  // are enough for this controller-level ordering test; no reactive subscriber
  // is involved.
  const runtime = globalThis as unknown as Record<string, unknown>;
  runtime.$state = Object.assign((value: unknown) => value, { raw: (value: unknown) => value });
  runtime.$derived = (value: unknown) => value;

  const { ConversationController } = await import("./conversationController.svelte");
  const controller = new ConversationController({
    endpoint: () => "",
    profileId: () => "profile",
    sessionId: () => "session",
    thinkingLevel: () => "off",
    labels: () => ({
      working: "Working",
      uploading: "Uploading",
      recognizingImage: "Recognizing",
      stopped: "Stopped",
      idle: "Idle",
      resuming: "Resuming"
    }),
    appendUserMessage: () => undefined,
    reload: async () => undefined,
    setError: () => undefined,
    clearError: () => undefined,
    ...overrides
  });
  return controller as unknown as ControllerHarness & Pick<ConversationController, "resolveApproval" | "sending" | "turnSessionId" | "pendingApproval">;
}

test("a tool boundary cannot overtake buffered thinking in the live transcript", async () => {
  const controller = await createControllerHarness();
  controller.bufferLiveText("thinking", "Inspect the project");

  controller.upsertLiveActivity({
    key: "read-1",
    kind: "tool",
    tool: "read",
    label: "Read",
    state: "running"
  });
  controller.flushStreamBuffers();

  assert.deepEqual(controller.liveSteps.map((step) => step.kind), ["thinking", "activity"]);
});

test("answer text cannot overtake buffered thinking in the live transcript", async () => {
  const controller = await createControllerHarness();
  controller.bufferLiveText("thinking", "Finish reasoning");
  controller.bufferLiveText("text", "Final answer");

  controller.flushStreamBuffers();

  assert.deepEqual(controller.liveSteps.map((step) => step.kind), ["thinking", "text"]);
});

test("a tool completion updates its original step without swallowing later thinking", async () => {
  const controller = await createControllerHarness();
  controller.bufferLiveText("thinking", "Before tool");
  controller.upsertLiveActivity({
    key: "read-1",
    kind: "tool",
    tool: "read",
    label: "Read",
    state: "running"
  });
  controller.bufferLiveText("thinking", "After tool");

  controller.upsertLiveActivity({
    key: "read-1",
    kind: "tool",
    tool: "read",
    label: "Read",
    state: "success"
  });

  assert.deepEqual(controller.liveSteps.map((step) => step.kind), ["thinking", "activity", "thinking"]);
  assert.equal(controller.liveSteps[1].activity?.state, "success");
});


test("approval polling uses the selected session and follows server completion despite new progress rows", async () => {
  const oldFetch = globalThis.fetch;
  const oldTimeout = globalThis.setTimeout;
  let statusChecks = 0;
  let reloads = 0;
  const decisions: Array<{ sessionId: string }> = [];
  try {
    globalThis.setTimeout = ((callback: (...args: unknown[]) => void) => oldTimeout(callback, 0)) as typeof setTimeout;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      let payload: unknown;
      if (String(input).endsWith("/session-runs")) {
        payload = { ok: true, runs: ++statusChecks <= 20 ? [{ sessionId: "selected", status: "running" }] : [] };
      } else {
        const body = JSON.parse(String(init?.body));
        if (body.action === "resolve_approval") {
          decisions.push(body);
          payload = { ok: true, response: "executed", approval: { status: "executed" } };
        } else payload = { ok: true, approvals: [] };
      }
      return new Response(JSON.stringify(payload), { status: 200 });
    }) as typeof fetch;
    const controller = await createControllerHarness({
      endpoint: () => "http://localhost:9999", sessionId: () => "selected",
      reload: async () => { reloads++; },
      setError: (message) => assert.fail(message)
    });
    controller.turnSessionId = "previous-session";
    // The rune shim does not recompute derived fields, so set the card directly.
    controller.pendingApproval = { requestId: "approval-1" } as NonNullable<typeof controller.pendingApproval>;
    await controller.resolveApproval("approve_once");
    assert.equal(decisions.length, 1);
    assert.equal(decisions[0].sessionId, "selected");
    assert.equal(statusChecks, 22);
    assert.equal(reloads, 23);
    assert.equal(controller.sending, false);
  } finally {
    globalThis.fetch = oldFetch;
    globalThis.setTimeout = oldTimeout;
  }
});

function approvalCard(requestId: string): NonNullable<ConversationController["pendingApproval"]> {
  return {
    requestId,
    command: "git push",
    displayName: "git",
    options: [{ id: "approve_once", label: "Once" }, { id: "reject", label: "Reject" }]
  } as NonNullable<ConversationController["pendingApproval"]>;
}

test("a failed decision submission keeps the card and a retry records the decision", async () => {
  const oldFetch = globalThis.fetch;
  const oldTimeout = globalThis.setTimeout;
  let resolveAttempts = 0;
  const errors: string[] = [];
  try {
    globalThis.setTimeout = ((callback: (...args: unknown[]) => void) => oldTimeout(callback, 0)) as typeof setTimeout;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith("/session-runs")) {
        return new Response(JSON.stringify({ ok: true, runs: [] }), { status: 200 });
      }
      const body = JSON.parse(String(init?.body));
      if (body.action === "resolve_approval") {
        resolveAttempts += 1;
        if (resolveAttempts === 1) {
          return new Response(JSON.stringify({ error: "network unreachable" }), { status: 503 });
        }
        return new Response(JSON.stringify({ ok: true, response: "executed", approval: { status: "executed" } }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true, approvals: [] }), { status: 200 });
    }) as typeof fetch;
    const controller = await createControllerHarness({
      endpoint: () => "http://localhost:9999",
      sessionId: () => "session",
      setError: (message) => errors.push(message)
    });
    (controller as any).pendingApprovals = [approvalCard("approval-1")];
    (controller as any).pendingApproval = approvalCard("approval-1");

    // First submission fails at the transport level…
    await controller.resolveApproval("approve_once");
    assert.equal(resolveAttempts, 1);
    assert.equal(errors.length, 1, "the failure is reported to the user");
    assert.equal((controller as any).pendingApprovals.length, 1, "the card is NOT removed on failure");
    assert.equal((controller as any).resolvingApprovalId, null, "the submitting state clears so retry is possible");

    // …and the same decision can be resubmitted.
    await controller.resolveApproval("approve_once");
    assert.equal(resolveAttempts, 2);
    assert.equal((controller as any).pendingApprovals.length, 0, "the card leaves only after the server confirms");
    assert.equal((controller as any).resolvingApprovalId, null);
  } finally {
    globalThis.fetch = oldFetch;
    globalThis.setTimeout = oldTimeout;
  }
});

test("a second activation while a decision is in flight does not submit twice", async () => {
  const oldFetch = globalThis.fetch;
  const oldTimeout = globalThis.setTimeout;
  let resolveAttempts = 0;
  let releaseFetch: (() => void) | undefined;
  const firstRequest = new Promise<void>((resolve) => { releaseFetch = resolve; });
  try {
    globalThis.setTimeout = ((callback: (...args: unknown[]) => void) => oldTimeout(callback, 0)) as typeof setTimeout;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith("/session-runs")) {
        return new Response(JSON.stringify({ ok: true, runs: [] }), { status: 200 });
      }
      const body = JSON.parse(String(init?.body));
      if (body.action === "resolve_approval") {
        resolveAttempts += 1;
        if (resolveAttempts === 1) await firstRequest;
        return new Response(JSON.stringify({ ok: true, response: "executed", approval: { status: "executed" } }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true, approvals: [] }), { status: 200 });
    }) as typeof fetch;
    const controller = await createControllerHarness({
      endpoint: () => "http://localhost:9999",
      sessionId: () => "session"
    });
    (controller as any).pendingApprovals = [approvalCard("approval-1")];
    (controller as any).pendingApproval = approvalCard("approval-1");

    const first = controller.resolveApproval("approve_once");
    // Double-click / keyboard repeat while the first request is in flight.
    void controller.resolveApproval("approve_once");
    void controller.resolveApproval("reject");
    assert.equal(resolveAttempts, 1, "exactly one request is in flight");
    releaseFetch!();
    await first;
    await new Promise((resolve) => oldTimeout(resolve, 0));
    assert.equal(resolveAttempts, 1, "the duplicate activations never reach the server");
    assert.equal((controller as any).pendingApprovals.length, 0);
  } finally {
    globalThis.fetch = oldFetch;
    globalThis.setTimeout = oldTimeout;
  }
});

test("a stale card the server no longer knows about is retired with a notice", async () => {
  const oldFetch = globalThis.fetch;
  const oldTimeout = globalThis.setTimeout;
  const errors: string[] = [];
  try {
    globalThis.setTimeout = ((callback: (...args: unknown[]) => void) => oldTimeout(callback, 0)) as typeof setTimeout;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith("/session-runs")) {
        return new Response(JSON.stringify({ ok: true, runs: [] }), { status: 200 });
      }
      const body = JSON.parse(String(init?.body));
      if (body.action === "resolve_approval") {
        return new Response(JSON.stringify({ ok: true, response: "not found", approval: { status: "not_found" } }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true, approvals: [] }), { status: 200 });
    }) as typeof fetch;
    const controller = await createControllerHarness({
      endpoint: () => "http://localhost:9999",
      sessionId: () => "session",
      labels: () => ({
        working: "Working", uploading: "Uploading", recognizingImage: "Recognizing",
        stopped: "Stopped", idle: "Idle", resuming: "Resuming",
        approvalNotFound: "This approval is no longer pending"
      }),
      setError: (message) => errors.push(message)
    });
    (controller as any).pendingApprovals = [approvalCard("approval-stale")];
    (controller as any).pendingApproval = approvalCard("approval-stale");

    await controller.resolveApproval("approve_once");
    assert.equal((controller as any).pendingApprovals.length, 0, "a stale card is removed");
    assert.equal(errors.length, 1, "the user is told the approval is gone");
    assert.match(errors[0], /no longer pending/);
  } finally {
    globalThis.fetch = oldFetch;
    globalThis.setTimeout = oldTimeout;
  }
});

test("multiple pending approvals resolve in stable order without preempting the visible card", async () => {
  const oldFetch = globalThis.fetch;
  const oldTimeout = globalThis.setTimeout;
  const decisions: string[] = [];
  try {
    globalThis.setTimeout = ((callback: (...args: unknown[]) => void) => oldTimeout(callback, 0)) as typeof setTimeout;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith("/session-runs")) {
        return new Response(JSON.stringify({ ok: true, runs: [] }), { status: 200 });
      }
      const body = JSON.parse(String(init?.body));
      if (body.action === "resolve_approval") {
        decisions.push(body.requestId);
        return new Response(JSON.stringify({ ok: true, response: "executed", approval: { status: "executed" } }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true, approvals: [] }), { status: 200 });
    }) as typeof fetch;
    const controller = await createControllerHarness({
      endpoint: () => "http://localhost:9999",
      sessionId: () => "session"
    });
    (controller as any).pendingApprovals = [approvalCard("approval-1"), approvalCard("approval-2")];
    (controller as any).pendingApproval = approvalCard("approval-1");

    await controller.resolveApproval("approve_once");
    assert.deepEqual(decisions, ["approval-1"], "the visible card's decision is submitted");
    assert.deepEqual((controller as any).pendingApprovals.map((a: { requestId: string }) => a.requestId), ["approval-2"], "the next queued card is preserved, not overwritten");
  } finally {
    globalThis.fetch = oldFetch;
    globalThis.setTimeout = oldTimeout;
  }
});

test("re-opening a session adopts the server's pending approval exactly once", async () => {
  const oldFetch = globalThis.fetch;
  let pendingQueries = 0;
  try {
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      if (body.action === "list_pending") {
        pendingQueries += 1;
        return new Response(JSON.stringify({ ok: true, approvals: [approvalCard("approval-restored")] }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;
    const controller = await createControllerHarness({
      endpoint: () => "http://localhost:9999",
      sessionId: () => "session"
    });
    // The user leaves and re-opens the session: the card comes back from the
    // server's list, not from a local cache.
    const adopted = await (controller as unknown as { adoptPendingApproval(): Promise<boolean> }).adoptPendingApproval();
    assert.equal(adopted, true);
    assert.deepEqual((controller as unknown as { pendingApprovals: Array<{ requestId: string }> }).pendingApprovals.map((a) => a.requestId), ["approval-restored"]);
    // Re-adopting while the card is visible is a no-op (no duplicate cards).
    const again = await (controller as unknown as { adoptPendingApproval(): Promise<boolean> }).adoptPendingApproval();
    assert.equal(again, false);
    assert.equal(pendingQueries, 2, "the server list is the source of truth for restore");
  } finally {
    globalThis.fetch = oldFetch;
  }
});
