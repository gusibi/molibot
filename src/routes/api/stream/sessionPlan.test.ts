import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "molibot-session-plan-"));

test("approved plan streams through the original Session and feedback reuses that Session", async () => {
  const { getRuntime } = await import("$lib/server/app/runtime.js");
  const { resolveRuntimeContext } = await import("$lib/server/web/runtimeContext.js");
  const { POST } = await import("./+server.js");
  const runtime = getRuntime();
  const externalUserId = "web:personal:web-anonymous";
  const conversation = runtime.sessions.createWebConversation(externalUserId);
  runtime.sessions.appendMessage(conversation.id, "assistant", "Approved plan", { plan: {
    id: "p", title: "Build", summary: "Build then verify", status: "accepted", recommendedMode: "accept_edits", artifactPath: "plans/p.md",
    steps: [{ id: "a", text: "Build", status: "pending" }]
  } });
  const { pool } = resolveRuntimeContext({ profileId: "personal" });
  const runner = pool.get(externalUserId, conversation.id);
  const originalRun = runner.run;
  const inputs: string[] = [];
  runner.run = async (ctx) => {
    assert.equal(ctx.message.sessionId, conversation.id);
    assert.ok(ctx.sessionPlanProgress);
    inputs.push(ctx.message.text);
    await ctx.sessionPlanProgress.update({ steps: [{ id: "a", status: "in_progress" }], status: "executing", summary: "Building" });
    await ctx.respond("Changed the requested file.");
    await ctx.sessionPlanProgress.update({ steps: [{ id: "a", status: "completed" }], status: "completed", summary: "Verified the output" });
    return { stopReason: "stop" };
  };
  try {
    for (const body of [{ resumePlanId: "p" }, { message: "Change the heading too" }]) {
      const response = await POST({ request: new Request("http://localhost/api/stream", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: "personal", conversationId: conversation.id, ...body })
      }) } as Parameters<typeof POST>[0]);
      const stream = await response.text();
      assert.equal(response.status, 200);
      assert.match(stream, /event: plan_progress/);
      assert.match(stream, /Changed the requested file/);
      assert.doesNotMatch(stream, /durableExecution/);
      assert.equal(runtime.sessions.listMessages(conversation.id).find((message) => message.plan)?.plan?.status, "completed");
    }
    assert.match(inputs[0], /Build then verify/);
    assert.equal(inputs[1], "Change the heading too");
    assert.equal(runtime.sessions.listMessages(conversation.id).find((message) => message.plan)?.plan?.durableExecutionId, undefined);
  } finally {
    runner.run = originalRun;
  }
});
