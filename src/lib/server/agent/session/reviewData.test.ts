import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { listAgentWorkspaces, readRunHistory, readSkillDrafts } from "$lib/server/agent/session/reviewData.js";

test("readSkillDrafts reads one bot-level draft directory only once even with multiple chats", () => {
  const root = join(process.cwd(), "src/lib/server/agent/testdata/review-drafts");
  const filePath = join(
    root,
    "moli-t",
    "bots",
    "molifin_bot",
    "skill-drafts",
    "2026-04-11-event.md"
  );

  const { items, diagnostics } = readSkillDrafts(root);

  assert.deepEqual(diagnostics, []);
  assert.equal(items.length, 1);
  assert.equal(items[0]?.filePath, filePath);
  assert.equal(items[0]?.botId, "molifin_bot");
});

test("listAgentWorkspaces and readRunHistory discover multi-channel and project workspaces while skipping non-chat dirs", () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "molibot-review-data-test-"));
  try {
    // 1. Web / Desktop bot
    const webChatDir = join(tmpRoot, "moli-w", "bots", "personal", "web-session-1");
    mkdirSync(webChatDir, { recursive: true });
    mkdirSync(join(tmpRoot, "moli-w", "bots", "personal", "skills"), { recursive: true });
    mkdirSync(join(tmpRoot, "moli-w", "bots", "personal", "skill-drafts"), { recursive: true });
    mkdirSync(join(tmpRoot, "moli-w", "bots", "personal", "events"), { recursive: true });
    writeFileSync(join(webChatDir, "run-summaries.jsonl"), JSON.stringify({
      runId: "run-web-1",
      stopReason: "stop",
      durationMs: 1200,
      finalText: "Hello from Web",
      toolNames: ["webSearch"],
      failedToolNames: [],
      reflection: { outcome: "success", summary: "Web search succeeded", nextAction: "" },
      createdAt: "2026-08-18T10:00:00.000Z"
    }) + "\n", "utf8");

    // 2. Feishu bot
    const feishuChatDir = join(tmpRoot, "moli-f", "bots", "feishu-momo", "oc_123");
    mkdirSync(feishuChatDir, { recursive: true });
    writeFileSync(join(feishuChatDir, "run-summaries.jsonl"), JSON.stringify({
      runId: "run-feishu-1",
      stopReason: "stop",
      durationMs: 2500,
      finalText: "Feishu response",
      toolNames: ["bash"],
      failedToolNames: [],
      reflection: { outcome: "success", summary: "Feishu task completed", nextAction: "" },
      createdAt: "2026-08-18T11:00:00.000Z"
    }) + "\n", "utf8");

    // 3. Project runtime
    const projectChatDir = join(tmpRoot, "projects", "my-app", "runtime", "chat-project-1");
    mkdirSync(projectChatDir, { recursive: true });
    writeFileSync(join(projectChatDir, "run-summaries.jsonl"), JSON.stringify({
      runId: "run-project-1",
      stopReason: "stop",
      durationMs: 3400,
      finalText: "Project code written",
      toolNames: ["editFile"],
      failedToolNames: [],
      reflection: { outcome: "success", summary: "Code updated", nextAction: "" },
      createdAt: "2026-08-18T12:00:00.000Z"
    }) + "\n", "utf8");

    const workspaces = listAgentWorkspaces(tmpRoot);
    assert.equal(workspaces.length, 3);
    assert.deepEqual(workspaces.map(w => w.botId), ["feishu-momo", "personal", "project:my-app"]);

    const history = readRunHistory(tmpRoot, 10);
    assert.equal(history.items.length, 3);
    assert.equal(history.items[0]?.runId, "run-project-1");
    assert.equal(history.items[1]?.runId, "run-feishu-1");
    assert.equal(history.items[2]?.runId, "run-web-1");
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

