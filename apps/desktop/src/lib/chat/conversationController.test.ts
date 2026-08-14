import assert from "node:assert/strict";
import test from "node:test";
import type { DesktopActivityEntry } from "../api";

type ControllerHarness = {
  liveSteps: Array<{ kind: string; activity?: DesktopActivityEntry }>;
  bufferLiveText(kind: "text" | "thinking", delta: string): void;
  flushStreamBuffers(): void;
  upsertLiveActivity(activity: DesktopActivityEntry): void;
};

async function createControllerHarness(): Promise<ControllerHarness> {
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
    getMessages: () => [],
    appendUserMessage: () => undefined,
    reload: async () => undefined,
    setError: () => undefined,
    clearError: () => undefined
  });
  return controller as unknown as ControllerHarness;
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
