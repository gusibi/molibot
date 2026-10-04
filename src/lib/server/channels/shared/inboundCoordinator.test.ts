import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { InboundTaskCoordinator } from "$lib/server/channels/shared/inboundCoordinator.js";

test("InboundTaskCoordinator exposes queue command operations", async () => {
  const current = { release: null as (() => void) | null };
  let coordinator: InboundTaskCoordinator<{ text: string }, { scopeId: string }>;
  coordinator = new InboundTaskCoordinator<{ text: string }, { scopeId: string }>({
    channel: "test",
    instanceId: "bot-1",
    dbFile: ":memory:",
    process: async (payload) => {
      if (payload.text === "current") {
        await new Promise<void>((resolve) => {
          current.release = resolve;
        });
      }
    },
    enqueueFrontFromCommand: async (input, text) => {
      return coordinator.enqueue(input.scopeId, { text }, { front: true, preview: text });
    }
  });

  const currentId = coordinator.enqueue("chat-1", { text: "current" }, { preview: "current" });
  const pendingId = coordinator.enqueue("chat-1", { text: "later" }, { preview: "later" });
  const commandOptions = coordinator.toCommandOptions();
  const frontId = await commandOptions.enqueueFront?.(
    { chatId: "chat-1", scopeId: "chat-1", text: "/queue front urgent", target: { scopeId: "chat-1" } },
    "urgent"
  );

  assert.equal(commandOptions.getQueueSize?.("chat-1"), 3);
  assert.deepEqual((await commandOptions.listQueue?.("chat-1"))?.map((item) => item.id), [currentId, frontId, pendingId]);
  assert.deepEqual(await commandOptions.getQueuedPreview?.("chat-1", pendingId), {
    status: "pending",
    preview: "later"
  });
  assert.equal(await commandOptions.deleteQueued?.("chat-1", pendingId), "deleted");
  assert.deepEqual(await commandOptions.cancelQueuedPending?.("chat-1"), { cleared: 1, stale: false });
  assert.deepEqual((await commandOptions.listQueue?.("chat-1"))?.map((item) => item.id), [currentId]);
  if (current.release) {
    current.release();
  }
  await delay(10);
  coordinator.close();
});

test("queued admission policy survives changed defaults and a fresh decision store", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { TurnOrchestrator, resolveTurnDecisionPolicy } = await import("$lib/server/agent/core/turnOrchestrator.js");
  const { defaultRuntimeSettings } = await import("$lib/server/settings/defaults.js");
  const directory = mkdtempSync(join(tmpdir(), "molibot-admission-"));
  const database = join(directory, "decisions.sqlite");
  const settings = structuredClone(defaultRuntimeSettings);
  settings.adaptiveThinking.defaultStrategy = "auto";
  const admitted = new TurnOrchestrator(undefined, database);
  let release!: () => void;
  const seen: string[] = [];
  const coordinator = new InboundTaskCoordinator<{ runId: string }, unknown>({
    channel: "test", instanceId: "admission", dbFile: join(directory, "queue.sqlite"),
    prepareAdmission: (_scope, payload) => { admitted.beginTurnDecision(payload.runId, resolveTurnDecisionPolicy(settings)); },
    process: async (payload) => {
      if (payload.runId === "running") await new Promise<void>((resolve) => { release = resolve; });
      else {
        const recovered = new TurnOrchestrator(undefined, database);
        seen.push(recovered.beginTurnDecision(payload.runId, resolveTurnDecisionPolicy(settings)).policy.strategy);
        recovered.close();
      }
    }
  });
  try {
    coordinator.enqueue("chat", { runId: "running" });
    coordinator.enqueue("chat", { runId: "queued" });
    settings.adaptiveThinking.defaultStrategy = "fixed";
    release();
    for (let count = 0; count < 50 && seen.length === 0; count++) await delay(10);
    assert.deepEqual(seen, ["auto"]);
  } finally {
    coordinator.close();
    admitted.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
