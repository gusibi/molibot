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
