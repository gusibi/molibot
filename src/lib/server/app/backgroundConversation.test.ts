import test from "node:test";
import assert from "node:assert/strict";
import { runBackgroundConversation } from "./backgroundConversation.js";

test("approval continuation stores one sourced answer and structured tool activity", async () => {
  const saved: unknown[][] = [];
  await runBackgroundConversation({ run: async (ctx) => {
    await ctx.respond("→ Read other blog files", false);
    await ctx.replaceMessage("draft");
    await ctx.respondInThread("tool diagnostic");
    assert.equal(saved.length, 0);
    await ctx.onRunnerEvent!({ type: "tool_execution_start", toolCallId: "read-1", toolName: "read", label: "Read blog" });
    await ctx.onRunnerEvent!({ type: "tool_execution_end", toolCallId: "read-1", toolName: "read", isError: false, summary: "content" });
    await ctx.replaceMessage("Build passed");
    return { stopReason: "stop", assistantSourceEntryId: "answer-1" };
  } }, {
    channel: "web", workspaceDir: "/workspace", chatDir: "/chat",
    message: { chatId: "chat", chatType: "private", messageId: 1, userId: "user", text: "", ts: "1", attachments: [], imageContents: [], sessionId: "session", isEvent: true }
  }, { appendMessage: (...args) => { saved.push(args); return {} as never; } });
  assert.equal(saved.length, 1);
  assert.equal(saved[0][2], "Build passed");
  const options = saved[0][3] as { contextBacked: boolean; sourceEntryId: string; activities: { state: string }[] };
  assert.equal(options.contextBacked, true);
  assert.equal(options.sourceEntryId, "answer-1");
  assert.equal(options.activities[0].state, "success");
});

test("both approval entry points use the background conversation recorder", async () => {
  const { readFileSync } = await import("node:fs");
  for (const path of ["../../../routes/api/chat/+server.ts", "../channels/shared/brokerApprovalResume.ts"]) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.match(source, /runBackgroundConversation\(pool\.get\(scopeId, sessionId\)/);
    assert.doesNotMatch(source, /respond:\s*async\s*\(text: string\)\s*=>\s*\{\s*if\s*\(text\.trim\(\)\)\s*\{\s*(getRuntime\(\)\.sessions|sessions)\.appendMessage/);
  }
});
