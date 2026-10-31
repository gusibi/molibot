import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { AgentStorageMigration } from "$lib/server/sessions/agentStorageMigration.js";
import { listAgentWorkspaces, readRunHistory, readSkillDrafts } from "$lib/server/agent/session/reviewData.js";

test("readSkillDrafts reads one Agent draft directory even without a Context", async () => {
  const root = mkdtempSync(join(tmpdir(), "molibot-review-drafts-"));
  try {
    const filePath = join(root, "sessions/assistant/skill-drafts/event.md");
    mkdirSync(join(root, "sessions/assistant/skill-drafts"), { recursive: true });
    writeFileSync(filePath, "---\nname: event\ndescription: draft\n---\ncontent");
    const { items, diagnostics } = readSkillDrafts(root);
    assert.deepEqual(diagnostics, []);
    assert.equal(items.length, 1);
    assert.equal(items[0]?.filePath, filePath);
    assert.equal(items[0]?.botId, "assistant");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("listAgentWorkspaces and readRunHistory discover multi-channel and project workspaces while skipping non-chat dirs", async () => {
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

    await new AgentStorageMigration(tmpRoot, { agents: ["personal", "feishu-momo"], bots: [{ channel: "web", botId: "personal", agentId: "personal" }, { channel: "feishu", botId: "feishu-momo", agentId: "feishu-momo" }] }).execute();
    const workspaces = listAgentWorkspaces(tmpRoot);
    assert.equal(workspaces.length, 3);
    assert.deepEqual(workspaces.map(w => w.botId), ["feishu-momo", "personal", "project:my-app"]);

    const history = await readRunHistory(tmpRoot, 10);
    assert.equal(history.items.length, 3);
    assert.equal(history.items[0]?.runId, "run-project-1");
    assert.equal(history.items[1]?.runId, "run-feishu-1");
    assert.equal(history.items[2]?.runId, "run-web-1");
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});


test("recent history resolves draft references only for returned rows and reads migration aliases once", async () => {
  const { mock } = await import('node:test');
  const fs = await import('node:fs');
  const { syncBuiltinESMExports } = await import('node:module');
  const root = mkdtempSync(join(tmpdir(), 'molibot-review-history-perf-'));
  const workspace = join(root, 'sessions', 'assistant');
  const manifestPath = join(root, 'runtime', 'agent-storage-migration', 'manifest.json');
  mkdirSync(workspace, { recursive: true });
  mkdirSync(join(root, 'runtime', 'agent-storage-migration'), { recursive: true });
  writeFileSync(manifestPath, JSON.stringify({ phase: 'completed', sessions: [], files: Array.from({ length: 1000 }, (_, i) => ({ source: `legacy/${i}`, target: `sessions/assistant/skill-drafts/${i}.md` })), published: {} }));
  writeFileSync(join(workspace, 'run-summaries.jsonl'), Array.from({ length: 1000 }, (_, i) => JSON.stringify({ runId: `run-${i}`, createdAt: new Date(i * 1000).toISOString(), finalText: 'x'.repeat(2048), skillDraft: { filePath: 'skill-drafts/test.md' } })).join('\n'));
  const originalRead = fs.readFileSync;
  let manifestReads = 0;
  const spy = mock.method(fs.default, 'readFileSync', (...args: Parameters<typeof fs.readFileSync>) => {
    if (String(args[0]) === manifestPath) manifestReads++;
    return (originalRead as Function)(...args);
  });
  syncBuiltinESMExports();
  try {
    let yielded = false;
    const tick = new Promise<void>(done => setImmediate(() => { yielded = true; done(); }));
    const start = performance.now();
    const history = await readRunHistory(root, 20);
    console.log(`history fixture: ${Math.round(performance.now() - start)}ms, migration manifest reads=${manifestReads}`);
    assert.equal(history.items.length, 20);
    assert.equal(history.items[0]?.runId, 'run-999');
    assert.equal(manifestReads, 1, 'migration manifest must not be reparsed for every historical run');
    assert.equal(yielded, true, 'history reading must yield so health and other requests can run');
    await tick;
  } finally {
    spy.mock.restore();
    syncBuiltinESMExports();
    rmSync(root, { recursive: true, force: true });
  }
});


test("history preserves global time ordering across unordered logs and skips corrupt lines", async () => {
  const root = mkdtempSync(join(tmpdir(), "molibot-review-order-"));
  try {
    for (const agent of ["alpha", "beta"]) {
      const workspace = join(root, "sessions", agent);
      mkdirSync(workspace, { recursive: true });
      const times = agent === "alpha" ? [8, 1, 6] : [2, 9, 4];
      writeFileSync(join(workspace, "run-summaries.jsonl"), times.map(time => JSON.stringify({ runId: `run-${time}`, createdAt: new Date(time * 1000).toISOString() })).join("\n") + "\ninvalid JSON\n");
    }
    const result = await readRunHistory(root, 3);
    assert.deepEqual(result.items.map(item => item.runId), ["run-9", "run-8", "run-6"]);
    assert.equal(result.diagnostics.length, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
