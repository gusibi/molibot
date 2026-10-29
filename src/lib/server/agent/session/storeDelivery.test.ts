import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { MomRuntimeStore } from "$lib/server/agent/session/store.js";

function makeStore(): { store: MomRuntimeStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "molibot-delivery-"));
  return { store: new MomRuntimeStore(dir), dir };
}

function assistantMessage(text: string, stopReason?: string): AgentMessage {
  return { role: "assistant", content: [{ type: "text", text }], stopReason, timestamp: Date.now() } as unknown as AgentMessage;
}

const CHAT = "chat1";
const SID = "s-test";

test("delivery marks persist across reopen, stay out of model context, and stay idempotent", () => {
  const { store, dir } = makeStore();
  try {
    const narrationId = store.appendContextMessage(CHAT, assistantMessage("我先看下当前配置。", "toolUse"), SID, { delivery: "process" });
    const finalId = store.appendContextMessage(CHAT, assistantMessage("配置已改好。", "stop"), SID);

    store.markSessionMessageDelivery(CHAT, SID, finalId, "final");
    store.markSessionMessageDelivery(CHAT, SID, finalId, "final");

    const reopened = new MomRuntimeStore(dir);
    const entries = reopened.listSessionMessageEntries(CHAT, SID);
    assert.equal(entries.find(entry => entry.id === narrationId)?.delivery, "process");
    assert.equal(entries.find(entry => entry.id === finalId)?.delivery, "final");
    // Display bookkeeping only: the rebuilt model context is untouched.
    assert.deepEqual(
      reopened.loadContext(CHAT, SID).map(message => (message as { stopReason?: string }).stopReason),
      ["toolUse", "stop"]
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("marking an unknown entry is a no-op and never invents a deliverable", () => {
  const { store, dir } = makeStore();
  try {
    const id = store.appendContextMessage(CHAT, assistantMessage("部分答案", "aborted"), SID);
    store.markSessionMessageDelivery(CHAT, SID, "rotated-away", "partial");
    const entries = new MomRuntimeStore(dir).listSessionMessageEntries(CHAT, SID);
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.delivery, undefined);

    store.markSessionMessageDelivery(CHAT, SID, id, "partial");
    assert.equal(new MomRuntimeStore(dir).listSessionMessageEntries(CHAT, SID)[0]?.delivery, "partial");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
