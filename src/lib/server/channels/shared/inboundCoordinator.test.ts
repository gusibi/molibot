import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { InboundTaskCoordinator } from "./inboundCoordinator.js";

test("InboundTaskCoordinator exposes queue command operations", async () => {
  let releaseCurrent: (() => void) | null = null;
  let coordinator: InboundTaskCoordinator<{ text: string }, { scopeId: string }>;
  coordinator = new InboundTaskCoordinator<{ text: string }, { scopeId: string }>({
    channel: "test",
    instanceId: "bot-1",
    dbFile: ":memory:",
    process: async (payload) => {
      if (payload.text === "current") {
        await new Promise<void>((resolve) => {
          releaseCurrent = resolve;
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
  assert.equal(await commandOptions.deleteQueued?.("chat-1", pendingId), "deleted");
  if (releaseCurrent) {
    releaseCurrent();
  }
  await delay(10);
  coordinator.close();
});
