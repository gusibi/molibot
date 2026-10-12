import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { AgentStorageMigration } from "./agentStorageMigration.js";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "molibot-agent-migration-"));
  const put = (name: string, content: string) => {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), content);
  };
  const migration = () => new AgentStorageMigration(root, {
    agents: ["default", "assistant"],
    bots: [
      { channel: "telegram", botId: "one", agentId: "assistant" },
      { channel: "qq", botId: "two", agentId: "assistant" }
    ]
  });
  return { root, put, migration, dispose: () => rmSync(root, { recursive: true, force: true }) };
}

test("preparation preserves two same-name contexts and source bytes across channels", () => {
  const f = fixture();
  try {
    const first = "[{\"role\":\"user\",\"content\":\"telegram\"}]\n";
    const second = '{"type":"session","id":"same"}\n';
    f.put("moli-t/bots/one/chat/contexts/same.json", first);
    f.put("moli-q/bots/two/chat/contexts/same.jsonl", second);
    const service = f.migration();
    assert.equal(service.status().sessions, 2);
    const prepared = service.prepare();
    assert.equal(prepared.phase, "prepared");
    const sessions = prepared.sessions;
    assert.equal(sessions.length, 2);
    assert.equal(new Set(sessions.map(s => s.targetId)).size, 2);
    for (const session of sessions) {
      const extension = session.source.channel === "telegram" ? "json" : "jsonl";
      const actual = readFileSync(join(prepared.stagingDir, "sessions", "assistant", "contexts", `${session.targetId}.${extension}`), "utf8");
      assert.equal(actual, session.source.channel === "telegram" ? first : second);
    }
    assert.equal(readFileSync(join(f.root, "moli-t/bots/one/chat/contexts/same.json"), "utf8"), first);
    assert.equal(readFileSync(join(f.root, "moli-q/bots/two/chat/contexts/same.jsonl"), "utf8"), second);
    assert.deepEqual(f.migration().prepare().sessions, sessions);
  } finally { f.dispose(); }
});

test("preparation pins Momo and existing Session ownership without changing original metadata", () => {
  const f = fixture();
  try {
    f.put("moli-w/bots/personal/web:user/contexts/a.json", "[]");
    f.put("moli-w/bots/personal/web:user/contexts/a.meta.json", '{"agentId":"assistant","origin":"chat"}\n');
    f.put("moli-w/bots/personal/web:user/contexts/b.json", "[]");
    const service = new AgentStorageMigration(f.root, {
      agents: ["default", "assistant"],
      bots: [{ channel: "web", botId: "personal" }]
    });
    const prepared = service.prepare();
    assert.deepEqual(prepared.sessions.map(s => s.agentId), ["assistant", "default"]);
    const metadata = JSON.parse(readFileSync(join(prepared.stagingDir, "sessions/default/contexts/b.meta.json"), "utf8"));
    assert.equal(metadata.agentId, "default");
    assert.deepEqual(metadata.source, { channel: "web", botId: "personal", chatId: "web:user", sessionId: "b" });
    assert.equal(readFileSync(join(f.root, "moli-w/bots/personal/web:user/contexts/a.meta.json"), "utf8"), '{"agentId":"assistant","origin":"chat"}\n');
  } finally { f.dispose(); }
});

test("unknown Bot is reported and prevents any staging writes", () => {
  const f = fixture();
  try {
    f.put("moli-t/bots/missing/chat/contexts/a.json", "[]");
    assert.match(f.migration().status().conflicts[0]!, /Unresolved Agent/);
    assert.throws(() => f.migration().prepare(), /Unresolved Agent/);
  } finally { f.dispose(); }
});

test("a failed preparation resumes verified copies and never overwrites a changed staged file", () => {
  const f = fixture();
  try {
    f.put("moli-t/bots/one/chat/contexts/a.json", "[]");
    f.put("moli-t/bots/one/chat/contexts/b.json", '[{"role":"user"}]');
    const first = f.migration().prepare();
    const target = join(first.stagingDir, "sessions/assistant/contexts/a.json");
    writeFileSync(target, "user edit");
    assert.throws(() => f.migration().prepare(), /Staged copy differs/);
    assert.equal(readFileSync(target, "utf8"), "user edit");
    writeFileSync(target, "[]");
    assert.equal(f.migration().prepare().phase, "prepared");
  } finally { f.dispose(); }
});

test("preparation reserves existing live target IDs without modifying live content", () => {
  const f = fixture();
  try {
    f.put("sessions/assistant/contexts/a.jsonl", "live conversation\n");
    f.put("moli-t/bots/one/chat/contexts/a.json", "[]");
    const prepared = f.migration().prepare();
    assert.notEqual(prepared.sessions[0]!.targetId, "a");
    assert.equal(readFileSync(join(f.root, "sessions/assistant/contexts/a.jsonl"), "utf8"), "live conversation\n");
  } finally { f.dispose(); }
});

test("source changes after preparation require reconciliation instead of silently replacing the manifest", () => {
  const f = fixture();
  try {
    f.put("moli-t/bots/one/chat/contexts/a.json", "[]");
    f.migration().prepare();
    f.put("moli-t/bots/one/chat/contexts/a.json", "[1]");
    assert.ok(f.migration().status().conflicts.some(item => item.includes("Source changed")));
    assert.throws(() => f.migration().prepare(), /Source changed/);
  } finally { f.dispose(); }
});

test("migration rejects symbolic links in source Context paths and staging parents", async () => {
  const { symlinkSync } = await import("node:fs");
  const f = fixture();
  try {
    f.put("outside/a.json", "private");
    mkdirSync(join(f.root, "moli-t/bots/one/chat"), { recursive: true });
    symlinkSync(join(f.root, "outside"), join(f.root, "moli-t/bots/one/chat/contexts"), "dir");
    assert.throws(() => f.migration().prepare(), /Symbolic link/);
    rmSync(join(f.root, "moli-t/bots/one/chat/contexts"));
    f.put("moli-t/bots/one/chat/contexts/a.json", "[]");
    mkdirSync(join(f.root, "runtime"), { recursive: true });
    symlinkSync(join(f.root, "outside"), join(f.root, "runtime/agent-storage-migration"), "dir");
    assert.throws(() => f.migration().prepare(), /Symbolic link/);
    assert.equal(readFileSync(join(f.root, "outside/a.json"), "utf8"), "private");
  } finally { f.dispose(); }
});

test("invalid persisted target paths cannot escape staging on retry", () => {
  const f = fixture();
  try {
    f.put("moli-t/bots/one/chat/contexts/a.json", "[]");
    const prepared = f.migration().prepare();
    prepared.sessions[0]!.targetId = "../../outside";
    writeFileSync(join(prepared.stagingDir, "manifest.json"), JSON.stringify(prepared));
    assert.throws(() => f.migration().prepare(), /Invalid migration manifest/);
  } finally { f.dispose(); }
});

test("preparation preserves attachment folders and original current Session routes", () => {
  const f = fixture();
  try {
    f.put("moli-t/bots/one/chat/contexts/same.json", "[]");
    f.put("moli-q/bots/two/chat/contexts/same.json", "[]");
    f.put("moli-t/bots/one/chat/active_session.txt", "same\n");
    f.put("moli-q/bots/two/chat/active_session.txt", "same\n");
    f.put("moli-t/bots/one/chat/attachments/photo.png", "first image");
    f.put("moli-q/bots/two/chat/attachments/photo.png", "second image");
    f.put("moli-t/bots/one/chat/scratch/report/index.md", "![chart](chart.png)");
    f.put("moli-t/bots/one/chat/scratch/report/chart.png", "chart");
    const prepared = f.migration().prepare();
    const attachmentCopies = prepared.files.filter(file => file.source?.endsWith("photo.png"));
    assert.equal(attachmentCopies.length, 2);
    assert.notEqual(attachmentCopies[0]!.target, attachmentCopies[1]!.target);
    assert.deepEqual(attachmentCopies.map(file => readFileSync(join(prepared.stagingDir, file.target), "utf8")).sort(), ["first image", "second image"]);
    const report = prepared.files.find(file => file.source?.endsWith("report/index.md"))!;
    assert.equal(readFileSync(join(prepared.stagingDir, dirname(report.target), "chart.png"), "utf8"), "chart");
    assert.equal(prepared.routes.length, 2);
    assert.equal(new Set(prepared.routes.map(route => route.sessionId)).size, 2);
    assert.equal(readFileSync(join(f.root, "moli-t/bots/one/chat/active_session.txt"), "utf8"), "same\n");
  } finally { f.dispose(); }
});

test("same Agent skills deduplicate only when their complete contents agree", () => {
  const f = fixture();
  try {
    f.put("moli-t/bots/one/chat/contexts/a.json", "[]");
    f.put("moli-q/bots/two/chat/contexts/b.json", "[]");
    f.put("moli-t/bots/one/skills/research/SKILL.md", "same skill");
    f.put("moli-q/bots/two/skills/research/SKILL.md", "same skill");
    const first = f.migration().prepare();
    assert.equal(readFileSync(join(first.stagingDir, "sessions/assistant/skills/research/SKILL.md"), "utf8"), "same skill");
    f.put("moli-q/bots/two/skills/research/SKILL.md", "custom skill");
    assert.ok(f.migration().status().conflicts.some(item => item.includes("Skill conflict")));
    assert.throws(() => f.migration().prepare(), /Skill conflict/);
  } finally { f.dispose(); }
});

test("prepared Event retains its reply destination and points at the mapped creator Session", () => {
  const f = fixture();
  try {
    f.put("moli-t/bots/one/chat__topic_7/contexts/same.json", "[]");
    f.put("moli-q/bots/two/chat/contexts/same.json", "[]");
    f.put("moli-t/bots/one/events/reminder.json", JSON.stringify({ type: "one-shot", at: "2030-01-01T00:00:00Z", chatId: "chat__topic_7", sessionId: "same", text: "remind" }));
    const prepared = f.migration().prepare();
    const file = prepared.files.find(file => file.source?.endsWith("events/reminder.json"))!;
    const event = JSON.parse(readFileSync(join(prepared.stagingDir, file.target), "utf8"));
    const session = prepared.sessions.find(session => session.source.channel === "telegram")!;
    assert.equal(event.agentId, "assistant");
    assert.equal(event.sessionId, session.targetId);
    assert.deepEqual(event.deliveryTarget, { channel: "telegram", instanceId: "one", chatId: "chat__topic_7" });
    assert.equal(JSON.parse(readFileSync(join(f.root, file.source!), "utf8")).sessionId, "same");
  } finally { f.dispose(); }
});

test("status discovers resource-only Bots and does not write the source or staging tree", async () => {
  const { existsSync, statSync } = await import("node:fs");
  const f = fixture();
  try {
    f.put("moli-t/bots/one/skills/research/SKILL.md", "skill");
    const source = join(f.root, "moli-t/bots/one/skills/research/SKILL.md");
    const before = statSync(source);
    assert.equal(f.migration().status().needed, true);
    assert.equal(existsSync(join(f.root, "runtime")), false);
    f.migration().prepare();
    const after = statSync(source);
    assert.equal(after.mtimeMs, before.mtimeMs);
    assert.equal(after.mode, before.mode);
    assert.equal(after.ino, before.ino);
  } finally { f.dispose(); }
});

test("old context.json is prepared as default without deleting its source", () => {
  const f = fixture();
  try {
    const raw = '[{"role":"user","content":"old format"}]\n';
    f.put("moli-t/bots/one/chat/context.json", raw);
    const prepared = f.migration().prepare();
    assert.equal(prepared.sessions.length, 1);
    assert.equal(prepared.sessions[0]!.targetId, "default");
    assert.equal(readFileSync(join(prepared.stagingDir, "sessions/assistant/contexts/default.json"), "utf8"), raw);
    assert.equal(readFileSync(join(f.root, "moli-t/bots/one/chat/context.json"), "utf8"), raw);
  } finally { f.dispose(); }
});

test("new source Sessions reuse existing mappings on a later preparation", () => {
  const f = fixture();
  try {
    f.put("moli-t/bots/one/chat/contexts/a.json", "[]");
    const first = f.migration().prepare();
    f.put("moli-q/bots/two/chat/contexts/a.json", "[1]");
    const second = f.migration().prepare();
    assert.equal(second.sessions.length, 2);
    assert.equal(second.sessions.find(session => session.source.channel === "telegram")!.targetId, first.sessions[0]!.targetId);
    assert.notEqual(second.sessions[0]!.targetId, second.sessions[1]!.targetId);
  } finally { f.dispose(); }
});

test("partial temporary copies recover on retry without requiring manual removal", () => {
  const f = fixture();
  try {
    f.put("moli-t/bots/one/chat/contexts/a.json", "complete source");
    f.put("runtime/agent-storage-migration/sessions/assistant/contexts/a.json.copying", "partial");
    const prepared = f.migration().prepare();
    assert.equal(readFileSync(join(prepared.stagingDir, "sessions/assistant/contexts/a.json"), "utf8"), "complete source");
  } finally { f.dispose(); }
});

test("orphaned attachments are discovered even without a Context", () => {
  const f = fixture();
  try {
    f.put("moli-t/bots/one/chat/attachments/photo.png", "image");
    assert.equal(f.migration().status().needed, true);
    const prepared = f.migration().prepare();
    const copy = prepared.files.find(file => file.source?.endsWith("photo.png"))!;
    assert.equal(readFileSync(join(prepared.stagingDir, copy.target), "utf8"), "image");
  } finally { f.dispose(); }
});

test("unknown Bot with only a run summary is reported instead of being treated as empty", () => {
  const f = fixture();
  try {
    f.put("moli-t/bots/missing/chat/run-summaries.jsonl", "run\n");
    const status = f.migration().status();
    assert.equal(status.needed, true);
    assert.ok(status.conflicts.some(item => item.includes("Unresolved resource Agent")));
    assert.throws(() => f.migration().prepare(), /Unresolved resource Agent/);
  } finally { f.dispose(); }
});

test("chat activity logs are copied even when no Context remains", () => {
  const f = fixture();
  try {
    f.put("moli-t/bots/one/chat/log.jsonl", "activity\n");
    const prepared = f.migration().prepare();
    const copy = prepared.files.find(file => file.source?.endsWith("chat/log.jsonl"))!;
    assert.equal(readFileSync(join(prepared.stagingDir, copy.target), "utf8"), "activity\n");
  } finally { f.dispose(); }
});

test("Channel profiles and auxiliary indexes copy without modifying the source", () => {
  const f = fixture();
  try {
    f.put("moli-t/bots/one/BOT.md", "custom rules");
    f.put("moli-w/ui-sessions/index.json", "{}");
    const status = f.migration().status();
    assert.equal(status.needed, true);
    assert.deepEqual(status.conflicts, []);
    const prepared = f.migration().prepare();
    assert.ok(prepared.files.some(file => file.target === "channels/telegram/bots/one/BOT.md"));
    assert.ok(prepared.files.some(file => file.target === "channels/web/ui-sessions/index.json"));
  } finally { f.dispose(); }
});

test("cutover publishes routes and files once, preserves subsequent changes, and discovers additional sources", async () => {
  const f = fixture();
  try {
    const body = '[{"role":"user","content":"history"}]\n';
    f.put("moli-t/bots/one/chat/contexts/same.json", body);
    f.put("moli-t/bots/one/chat/active_session.txt", "same");
    f.put("moli-t/bots/one/chat/attachments/photo.png", "original-image");
    const plan = await f.migration().execute();
    assert.equal(plan.phase, "completed");
    assert.equal(f.migration().status().needed, false);
    const context = plan.files.find(file => file.target.endsWith("/same.json"))!;
    f.put(context.target, "new conversation bytes");
    await f.migration().execute();
    assert.equal(readFileSync(join(f.root, context.target), "utf8"), "new conversation bytes");
    assert.equal(readFileSync(join(f.root, "moli-t/bots/one/chat/contexts/same.json"), "utf8"), body);
    f.put("moli-t/bots/one/chat/contexts/added.json", "[]");
    assert.equal(f.migration().status().needed, true);
    const next = await f.migration().execute();
    assert.equal(next.sessions.length, 2);
    assert.equal(readFileSync(join(f.root, context.target), "utf8"), "new conversation bytes");
  } finally { f.dispose(); }
});

test("Web display and Context pair, explicit event target and persisted queue references survive cutover", async () => {
  const f = fixture();
  const { DatabaseSync } = await import("node:sqlite");
  const { MomRuntimeStore } = await import("$lib/server/agent/session/store.js");
  const { agentFileAliases } = await import("./agentFileReferences.js");
  try {
    const migration = () => new AgentStorageMigration(f.root, { agents: ["default"], bots: [{ channel: "web", botId: "one" }] });
    const chatId = "web:one:viewer";
    f.put(`moli-w/bots/one/${chatId}/contexts/old.json`, '[{"role":"user","content":"hello"}]');
    f.put(`moli-w/ui-sessions/owners/viewer/old.json`, JSON.stringify({ conversation: { id: "old", externalUserId: chatId, channel: "web", title: "Old", createdAt: "2026-01-01", updatedAt: "2026-01-01" }, messages: [] }));
    f.put(`moli-w/bots/one/${chatId}/scratch/site/index.html`, "hello");
    f.put("moli-w/bots/one/events/reminder.json", JSON.stringify({ type: "one-shot", chatId, sessionId: "old", text: "reminder", at: "2099-01-01" }));
    mkdirSync(join(f.root, "db"));
    const db = new DatabaseSync(join(f.root, "db", "inbound-queue.sqlite"));
    db.exec("CREATE TABLE inbound_tasks (id INTEGER PRIMARY KEY, channel TEXT, instance_id TEXT, scope_id TEXT, payload_json TEXT)");
    db.prepare("INSERT INTO inbound_tasks VALUES (1, 'web', 'one', ?, ?)").run(chatId, JSON.stringify({ sessionId: "old", workspaceDir: join(f.root, "moli-w/bots/one"), text: "keep old paths in body" }));
    db.close();
    const plan = await migration().execute();
    assert.equal(migration().status().needed, false);
    const meta = JSON.parse(readFileSync(join(f.root, "sessions/default/contexts/old.meta.json"), "utf8"));
    assert.equal(meta.ui.conversation.agentId, "default");
    const eventFile = plan.files.find(file => file.target.includes("/events/"))!;
    const event = JSON.parse(readFileSync(join(f.root, eventFile.target), "utf8"));
    assert.deepEqual(event.deliveryTarget, { channel: "web", instanceId: "one", chatId });
    const store = new MomRuntimeStore(join(f.root, "sessions/default"), { source: { channel: "web", botId: "one" } });
    const history = store.loadContext(chatId, "old")[0];
    assert.ok("content" in history);
    assert.equal(history.content, "hello");
    assert.ok(agentFileAliases(store.getWorkspaceDir(), { channel: "web", chatId }).some(alias => alias.reference === "scratch/site/index.html"));
    const reopened = new DatabaseSync(join(f.root, "db", "inbound-queue.sqlite"));
    const payload = JSON.parse((reopened.prepare("SELECT payload_json FROM inbound_tasks").get() as { payload_json: string }).payload_json);
    reopened.close();
    assert.equal(payload.workspaceDir, join(f.root, "sessions/default"));
    assert.equal(payload.text, "keep old paths in body");
  } finally { f.dispose(); }
});

test("completed mapping stays pinned when its Bot is rebound and source snapshots are removed", async () => {
  const f = fixture();
  try {
    f.put("moli-t/bots/one/chat/contexts/old.json", "[]");
    f.put("moli-t/bots/one/skills/custom/SKILL.md", "custom skill");
    f.put("moli-t/bots/one/events/task.json", JSON.stringify({ type: "one-shot", chatId: "chat", text: "hello" }));
    await f.migration().execute();
    const rebound = new AgentStorageMigration(f.root, { agents: ["default", "assistant"], bots: [{ channel: "telegram", botId: "one", agentId: "default" }, { channel: "qq", botId: "two", agentId: "assistant" }] });
    assert.equal(rebound.status().needed, false);
    rmSync(join(f.root, "moli-t"), { recursive: true });
    assert.equal(rebound.status().needed, false);
  } finally { f.dispose(); }
});


test("historical file aliases distinguish the same Bot and Chat across Channels", async () => {
  const f = fixture();
  try {
    for (const [directory, content] of [["moli-t", "TELEGRAM"], ["moli-q", "QQ"]]) {
      f.put(`${directory}/bots/one/chat/contexts/same.json`, "[]");
      f.put(`${directory}/bots/one/chat/attachments/image.png`, content);
      f.put(`${directory}/bots/one/chat/scratch/report.txt`, content);
    }
    await new AgentStorageMigration(f.root, { agents: ["assistant"], bots: ["telegram", "qq"].map(channel => ({ channel, botId: "one", agentId: "assistant" })) }).execute();
    const { resolveAgentFileReference } = await import("./agentFileReferences.js");
    for (const [channel, content] of [["telegram", "TELEGRAM"], ["qq", "QQ"]]) {
      for (const reference of ["attachments/image.png", "scratch/report.txt"]) {
        const file = resolveAgentFileReference(join(f.root, "sessions/assistant"), reference, { channel, botId: "one", chatId: "chat" });
        assert.equal(readFileSync(file, "utf8"), content);
      }
    }
  } finally { f.dispose(); }
});

test("event execution leases retain filename semantics and move to the Agent watcher", async () => {
  const f = fixture();
  try {
    const { DatabaseSync } = await import("node:sqlite");
    f.put("moli-t/bots/one/events/reminder.json", JSON.stringify({ type: "periodic", chatId: "chat", text: "hello", schedule: "0 9 * * *", timezone: "UTC" }));
    mkdirSync(join(f.root, "db"), { recursive: true });
    const db = new DatabaseSync(join(f.root, "db/events.sqlite"));
    db.exec("CREATE TABLE event_execution_leases (run_id TEXT PRIMARY KEY, lease_scope TEXT, event_file TEXT, event_payload_json TEXT)");
    db.prepare("INSERT INTO event_execution_leases VALUES (?, ?, ?, ?)").run("run", "telegram:one", "reminder.json", "{}");
    const plan = await f.migration().execute();
    const event = plan.files.find(file => file.source?.endsWith("events/reminder.json"))!;
    const row = db.prepare("SELECT * FROM event_execution_leases").get()!;
    assert.equal(row.lease_scope, "agent:assistant");
    assert.equal(row.event_file, event.target.split("/").at(-1));
    assert.equal(JSON.parse(String(row.event_payload_json)).deliveryTarget.channel, "telegram");
    db.close();
  } finally { f.dispose(); }
});

test("historical summaries and attachments named events remain readable after cutover", async () => {
  const f = fixture();
  try {
    f.put("moli-t/bots/one/chat/contexts/same.json", "[]");
    f.put("moli-q/bots/two/chat/contexts/same.json", "[]");
    const summary = JSON.stringify({ sessionId: "same", createdAt: "2026-01-01", usage: { totalTokens: 42 } }) + "\n";
    f.put("moli-t/bots/one/chat/run-summaries.jsonl", summary);
    f.put("moli-t/bots/one/chat/attachments/events/image.png", "image");
    f.put("moli-t/bots/one/attachments/bot.txt", "bot asset");
    await f.migration().execute();
    const { MomRuntimeStore } = await import("$lib/server/agent/session/store.js");
    const { resolveAgentFileReference } = await import("./agentFileReferences.js");
    const workspace = join(f.root, "sessions/assistant");
    const store = new MomRuntimeStore(workspace, { source: { channel: "telegram", botId: "one" } });
    const id = store.listSessions("chat")[0]!;
    assert.equal(store.readLatestRunSummary("chat")?.sessionId, id);
    assert.equal(store.getSessionUsageSnapshot("chat", id).totalTokens, 42);
    assert.deepEqual(store.listRunSummaries("other"), []);
    const source = { channel: "telegram", botId: "one", chatId: "chat" };
    assert.equal(readFileSync(resolveAgentFileReference(workspace, "attachments/events/image.png", source), "utf8"), "image");
    assert.equal(readFileSync(resolveAgentFileReference(workspace, "attachments/bot.txt", source), "utf8"), "bot asset");
    assert.equal(readFileSync(join(f.root, "moli-t/bots/one/chat/run-summaries.jsonl"), "utf8"), summary);
  } finally { f.dispose(); }
});

test("Room Context stays in its independent runtime domain", async () => {
  const f = fixture();
  try {
    const local = "moli-w/rooms/room/runtime/chat/contexts/context.json";
    f.put(local, "[]");
    assert.deepEqual(f.migration().status().conflicts, []);
    await f.migration().execute();
    assert.equal(readFileSync(join(f.root, "channels/web/rooms/room/runtime/chat/contexts/context.json"), "utf8"), "[]");
    assert.equal(readFileSync(join(f.root, local), "utf8"), "[]");
  } finally { f.dispose(); }
});

test("scratch virtual environments are excluded before following their symbolic links", async () => {
  const { symlinkSync, lstatSync, existsSync } = await import("node:fs");
  const f = fixture();
  try {
    f.put("moli-t/bots/one/chat/contexts/a.json", "[]");
    f.put("moli-t/bots/one/chat/scratch/report.txt", "keep output");
    f.put("moli-t/bots/one/chat/scratch/.venv/pyvenv.cfg", "temporary environment");
    const python = join(f.root, "moli-t/bots/one/chat/scratch/.venv/bin/python");
    mkdirSync(dirname(python), { recursive: true });
    symlinkSync("/unavailable/python", python);
    f.put("outside/temporary.txt", "untouched");
    const botVenv = join(f.root, "moli-t/bots/one/scratch/.venv");
    mkdirSync(dirname(botVenv), { recursive: true });
    symlinkSync(join(f.root, "outside"), botVenv, "dir");
    assert.deepEqual(f.migration().status().conflicts, []);
    const prepared = await f.migration().execute();
    assert.equal(prepared.files.some(file => file.source?.split("/").includes(".venv")), false);
    const report = prepared.files.find(file => file.source?.endsWith("scratch/report.txt"))!;
    assert.equal(readFileSync(join(f.root, report.target), "utf8"), "keep output");
    assert.equal(lstatSync(python).isSymbolicLink(), true);
    assert.equal(lstatSync(botVenv).isSymbolicLink(), true);
    assert.equal(existsSync(join(f.root, "outside/temporary.txt")), true);
    assert.equal(f.migration().status().needed, false);
  } finally { f.dispose(); }
});

test("virtual environment names outside scratch do not bypass source validation", async () => {
  const { symlinkSync } = await import("node:fs");
  const f = fixture();
  try {
    f.put("moli-t/bots/one/chat/contexts/a.json", "[]");
    const attachment = join(f.root, "moli-t/bots/one/chat/attachments/.venv");
    mkdirSync(dirname(attachment), { recursive: true });
    symlinkSync("/unavailable/attachment", attachment);
    assert.throws(() => f.migration().prepare(), /Symbolic link/);
  } finally { f.dispose(); }
});

test("migration skips generated scratch dependencies and can exclude a conflicting resource explicitly", async () => {
  const { symlinkSync, existsSync, lstatSync } = await import("node:fs");
  const f = fixture();
  try {
    f.put("moli-t/bots/one/chat/contexts/a.json", "[]");
    f.put("moli-t/bots/one/chat/scratch/node_modules/package/index.js", "generated");
    const executable = join(f.root, "moli-t/bots/one/chat/scratch/node_modules/.bin/playwright");
    mkdirSync(dirname(executable), { recursive: true }); symlinkSync("../package/cli.js", executable);
    f.put("moli-t/bots/one/chat/scratch/__pycache__/module.pyc", "generated");
    f.put("moli-t/bots/one/chat/scratch/report.html", "output");
    const local = "moli-t/bots/one/chat/attachments/broken-link";
    mkdirSync(dirname(join(f.root, local)), { recursive: true });
    symlinkSync("/unavailable/asset", join(f.root, local));
    const pending = f.migration().status();
    assert.equal(pending.sessions, 1);
    assert.ok(pending.conflictItems.some(item => item.path === local));
    assert.ok(pending.automaticSkippedPaths.some(item => item.endsWith("node_modules")));
    const selected = new AgentStorageMigration(f.root, { agents: ["assistant"], bots: [{ channel: "telegram", botId: "one", agentId: "assistant" }] }, [local]);
    assert.deepEqual(selected.status().conflicts, []);
    selected.saveSelections();
    const result = await selected.execute();
    assert.equal(result.files.some(item => item.source?.includes("node_modules") || item.source === local), false);
    assert.ok(result.files.some(item => item.source?.endsWith("scratch/report.html")));
    assert.equal(lstatSync(join(f.root, local)).isSymbolicLink(), true);
    assert.equal(existsSync(join(f.root, "moli-t/bots/one/chat/contexts/a.json")), true);
    assert.equal(f.migration().status().needed, false);
    assert.deepEqual(f.migration().status().ignoredPaths, [local]);
  } finally { f.dispose(); }
});

test("ignore policy cannot exclude Context, identity, destination or traversal paths", () => {
  const f = fixture();
  try {
    for (const path of ["moli-t/bots/one/chat/contexts", "moli-t/bots/one", "sessions/assistant", "../scratch/node_modules", "moli-t/bots/one/scratch/../contexts", "/scratch/node_modules"]) {
      assert.throws(() => new AgentStorageMigration(f.root, { agents: ["assistant"], bots: [] }, [path]), /Only relative legacy resource paths/);
    }
  } finally { f.dispose(); }
});

test("explicitly skipped conflicting Skills leave other history available and preserve originals", async () => {
  const f = fixture();
  try {
    f.put("moli-t/bots/one/chat/contexts/a.json", "[]");
    f.put("moli-t/bots/one/skills/same/SKILL.md", "first");
    f.put("moli-q/bots/two/skills/same/SKILL.md", "second");
    const pending = f.migration().status();
    assert.ok(pending.conflictItems.some(item => item.path === "moli-q/bots/two/skills/same"));
    const selected = new AgentStorageMigration(f.root, { agents: ["assistant"], bots: [{ channel: "telegram", botId: "one", agentId: "assistant" }, { channel: "qq", botId: "two", agentId: "assistant" }] }, ["moli-q/bots/two/skills/same"]);
    selected.saveSelections();
    await selected.execute();
    assert.equal(readFileSync(join(f.root, "sessions/assistant/skills/same/SKILL.md"), "utf8"), "first");
    assert.equal(readFileSync(join(f.root, "moli-q/bots/two/skills/same/SKILL.md"), "utf8"), "second");
    assert.equal(f.migration().status().needed, false);
  } finally { f.dispose(); }
});

test("preview exclusions cannot admit Runtime or remove a prepared source-change guard without confirmation", async () => {
  const f = fixture();
  try {
    f.put("moli-t/bots/one/chat/contexts/a.json", "[]");
    const resource = "moli-t/bots/one/chat/scratch/report.txt";
    f.put(resource, "first");
    f.migration().prepare();
    f.put(resource, "changed");
    assert.ok(f.migration().status().conflicts.some(item => item.includes("Source changed")));
    const selected = new AgentStorageMigration(f.root, { agents: ["assistant"], bots: [{ channel: "telegram", botId: "one", agentId: "assistant" }] }, [resource]);
    assert.equal(selected.status().needed, true);
    assert.deepEqual(selected.status().conflicts, []);
    assert.deepEqual(f.migration().status().ignoredPaths, []);
    selected.saveSelections();
    await selected.execute();
    assert.equal(f.migration().status().needed, false);
    assert.equal(readFileSync(join(f.root, resource), "utf8"), "changed");
  } finally { f.dispose(); }
});

test("malformed Event conflicts expose the exact resource path for exclusion", async () => {
  const f = fixture();
  try {
    f.put("moli-t/bots/one/chat/contexts/a.json", "[]");
    const resource = "moli-t/bots/one/events/bad.json";
    f.put(resource, "{");
    assert.equal(f.migration().status().conflictItems[0]?.path, resource);
    const selected = new AgentStorageMigration(f.root, { agents: ["assistant"], bots: [{ channel: "telegram", botId: "one", agentId: "assistant" }] }, [resource]);
    assert.deepEqual(selected.status().conflicts, []);
    selected.saveSelections();
    await selected.execute();
    assert.equal(readFileSync(join(f.root, resource), "utf8"), "{");
    assert.equal(f.migration().status().needed, false);
  } finally { f.dispose(); }
});

test("ignored Events cannot strand recoverable leases or map missing sources to generated metadata", async () => {
  const f = fixture();
  const { DatabaseSync } = await import("node:sqlite");
  let db: InstanceType<typeof DatabaseSync> | undefined;
  try {
    f.put("moli-t/bots/one/chat/contexts/a.json", "[]");
    const resource = "moli-t/bots/one/events/reminder.json";
    f.put(resource, JSON.stringify({ type: "periodic", chatId: "chat", text: "hello" }));
    mkdirSync(join(f.root, "db"), { recursive: true });
    db = new DatabaseSync(join(f.root, "db/events.sqlite"));
    db.exec("CREATE TABLE event_execution_leases (run_id TEXT PRIMARY KEY, lease_scope TEXT, event_file TEXT, session_id TEXT, chat_id TEXT, status TEXT)");
    const selected = () => new AgentStorageMigration(f.root, { agents: ["assistant"], bots: [{ channel: "telegram", botId: "one", agentId: "assistant" }] }, [resource]);
    for (const status of ["running", "retry_wait", "waiting_approval", "interrupted"]) {
      db.exec("DELETE FROM event_execution_leases");
      db.prepare("INSERT INTO event_execution_leases VALUES (?, ?, ?, ?, ?, ?)").run("run", "telegram:one", "reminder.json", "a", "chat", status);
      assert.ok(selected().status().conflicts.some(item => item.includes("recoverable execution lease")));
      assert.throws(() => selected().prepare(), /recoverable execution lease/);
      assert.equal(db.prepare("SELECT event_file FROM event_execution_leases").get()!.event_file, "reminder.json");
    }
    db.exec("UPDATE event_execution_leases SET status='completed'");
    assert.deepEqual(selected().status().conflicts, []);
    selected().saveSelections();
    await selected().execute();
    const row = db.prepare("SELECT * FROM event_execution_leases").get()!;
    assert.equal(row.event_file, "reminder.json");
    assert.equal(row.lease_scope, "telegram:one");
    assert.equal(readFileSync(join(f.root, resource), "utf8").includes("hello"), true);
  } finally { db?.close(); f.dispose(); }
});


test("empty migration plans still reject ignored Events referenced by recoverable leases", async () => {
  const f = fixture();
  const { DatabaseSync } = await import("node:sqlite");
  let db: InstanceType<typeof DatabaseSync> | undefined;
  try {
    const resource = "moli-t/bots/one/events/reminder.json";
    f.put(resource, JSON.stringify({ type: "periodic", chatId: "chat", text: "hello" }));
    mkdirSync(join(f.root, "db"), { recursive: true });
    db = new DatabaseSync(join(f.root, "db/events.sqlite"));
    db.exec("CREATE TABLE event_execution_leases (run_id TEXT PRIMARY KEY, lease_scope TEXT, event_file TEXT, session_id TEXT, status TEXT)");
    db.prepare("INSERT INTO event_execution_leases VALUES (?, ?, ?, ?, ?)").run("run", "telegram:one", "reminder.json", "missing", "waiting_approval");
    const selected = new AgentStorageMigration(f.root, { agents: ["assistant"], bots: [{ channel: "telegram", botId: "one", agentId: "assistant" }] }, [resource]);
    assert.equal(selected.status().files, 0);
    assert.ok(selected.status().conflicts.some(item => item.includes("recoverable execution lease")));
    assert.throws(() => selected.prepare(), /recoverable execution lease/);
    selected.saveSelections();
    assert.ok(f.migration().status().conflicts.some(item => item.includes("recoverable execution lease")));
    assert.equal(f.migration().status().needed, true);
  } finally { db?.close(); f.dispose(); }
});

test("missing Bot diagnostics group dependent files and distinguish deleted Agent ownership", () => {
  const f = fixture();
  try {
    const scope = "moli-t/bots/removed/chat";
    f.put(`${scope}/contexts/a.json`, "[]");
    f.put(`${scope}/contexts/b.json`, "[]");
    f.put(`${scope}/attachments/report.txt`, "report");
    f.put(`${scope}/active_session.txt`, "b");
    f.put("moli-w/bots/personal/web:personal:user/contexts/web.json", "[]");
    f.put("moli-w/ui-sessions/web_personal_user/web.json", JSON.stringify({ conversation: { id: "web", externalUserId: "web:personal:user" } }));
    f.put("moli-t/bots/one/chat/contexts/pinned.json", "[]");
    f.put("moli-t/bots/one/chat/contexts/pinned.meta.json", JSON.stringify({ agentId: "deleted-agent" }));
    const status = f.migration().status();
    const telegram = status.conflictItems.filter(item => item.reason === "missing-bot" && item.botId === "removed");
    assert.equal(telegram.length, 1);
    assert.deepEqual(telegram[0]!.sessionIds, ["a", "b"]);
    assert.ok(telegram[0]!.details?.some(item => item.includes("Active Session not found")));
    assert.equal(telegram[0]!.path, undefined);
    assert.equal(status.conflictItems.filter(item => item.reason === "missing-bot" && item.botId === "personal").length, 1);
    const pinned = status.conflictItems.find(item => item.reason === "missing-agent" && item.agentId === "deleted-agent");
    assert.deepEqual(pinned?.sessionIds, ["pinned"]);
    assert.ok(status.conflicts.some(item => item.includes("Unresolved Agent")));
    assert.throws(() => f.migration().prepare(), /Unresolved Agent/);
    const grouped = status.conflictItems.flatMap(item => item.details ?? [item.message]);
    assert.ok(status.conflicts.every(message => grouped.includes(message)));
  } finally { f.dispose(); }
});

test("explicit missing-Bot assignments migrate history and resources without editing source ownership", async () => {
  const f = fixture();
  try {
    const scope = "moli-t/bots/removed/chat";
    f.put(`${scope}/contexts/a.json`, "[]");
    f.put(`${scope}/contexts/pinned.json`, "[]");
    const pinned = JSON.stringify({ agentId: "default" });
    f.put(`${scope}/contexts/pinned.meta.json`, pinned);
    f.put(`${scope}/active_session.txt`, "a");
    f.put(`${scope}/scratch/report.txt`, "output");
    f.put("moli-t/bots/removed/skills/tool/SKILL.md", "skill");
    f.put("moli-t/bots/removed/events/reminder.json", JSON.stringify({ type: "periodic", chatId: "chat", sessionId: "a", text: "hello" }));
    f.put("moli-w/bots/personal/web:personal:user/contexts/web.json", "[]");
    f.put("moli-w/ui-sessions/web_personal_user/web.json", JSON.stringify({ conversation: { id: "web", externalUserId: "web:personal:user" } }));
    const ownership = { agents: ["default", "assistant"], agentOptions: [{ id: "default", name: "Momo" }, { id: "assistant", name: "Assistant" }], bots: [] };
    const assignments = [{ channel: "telegram", botId: "removed", agentId: "assistant" }, { channel: "web", botId: "personal", agentId: "default" }];
    const selected = new AgentStorageMigration(f.root, ownership, [], assignments);
    assert.deepEqual(selected.status().conflicts, []);
    assert.equal(selected.status().sessions, 3);
    assert.equal(selected.status().availableAgents[0]?.name, "Momo");
    assert.deepEqual(new AgentStorageMigration(f.root, ownership).status().botAssignments, []);
    assert.ok(new AgentStorageMigration(f.root, ownership).status().conflicts.length);
    selected.saveSelections();
    const plan = await selected.execute();
    assert.equal(plan.sessions.find(item => item.source.sessionId === "a")?.agentId, "assistant");
    assert.equal(plan.sessions.find(item => item.source.sessionId === "pinned")?.agentId, "default");
    assert.equal(plan.routes.find(item => item.botId === "removed")?.agentId, "assistant");
    assert.ok(plan.files.some(item => item.target === "sessions/assistant/skills/tool/SKILL.md"));
    assert.ok(plan.files.some(item => item.target.startsWith("sessions/assistant/events/")));
    assert.ok(plan.files.some(item => item.target === "sessions/default/contexts/web.meta.json"));
    assert.equal(readFileSync(join(f.root, scope, "contexts/pinned.meta.json"), "utf8"), pinned);
    assert.equal(readFileSync(join(f.root, scope, "active_session.txt"), "utf8"), "a");
    const restarted = new AgentStorageMigration(f.root, ownership).status();
    assert.equal(restarted.needed, false);
    assert.deepEqual(restarted.botAssignments, selected.status().botAssignments);
  } finally { f.dispose(); }
});

test("migration assignments reject invalid identities and cannot rebind a configured Bot", () => {
  const f = fixture();
  try {
    const ownership = { agents: ["default"], bots: [{ channel: "telegram", botId: "one", agentId: "default" }] };
    for (const assignment of [
      { channel: "telegram", botId: "removed", agentId: "absent" },
      { channel: "unknown", botId: "removed", agentId: "default" },
      { channel: "telegram", botId: "../removed", agentId: "default" },
    ]) assert.throws(() => new AgentStorageMigration(f.root, ownership, [], [assignment]), /valid channel/);
    assert.throws(() => new AgentStorageMigration(f.root, ownership, [], [{ channel: "telegram", botId: "one", agentId: "default" }]), /Only missing Bots/);
    const assignment = { channel: "telegram", botId: "removed", agentId: "default" };
    assert.throws(() => new AgentStorageMigration(f.root, ownership, [], [assignment, assignment]), /Duplicate/);
  } finally { f.dispose(); }
});

test("prepared Bot assignments cannot be changed or removed during retry", () => {
  const f = fixture();
  try {
    f.put("moli-t/bots/removed/chat/contexts/a.json", "[]");
    const ownership = { agents: ["default", "assistant"], bots: [] };
    const assignment = { channel: "telegram", botId: "removed", agentId: "default" };
    const selected = new AgentStorageMigration(f.root, ownership, [], [assignment]);
    selected.saveSelections();
    selected.prepare();
    const restarted = new AgentStorageMigration(f.root, ownership);
    assert.deepEqual(restarted.status().fixedBotAssignments, [assignment]);
    assert.throws(() => new AgentStorageMigration(f.root, ownership, [], [{ ...assignment, agentId: "assistant" }]), /already prepared/);
    assert.throws(() => new AgentStorageMigration(f.root, ownership, [], []), /already prepared/);
    assert.equal(restarted.prepare().sessions[0]?.agentId, "default");
  } finally { f.dispose(); }
});

test("missing Bots can be excluded as whole scopes, including pinned sessions and Web UI copies", async () => {
  const f = fixture();
  try {
    f.put("moli-t/bots/removed/chat/contexts/a.json", "[]");
    f.put("moli-t/bots/removed/chat/contexts/a.meta.json", '{"agentId":"default"}');
    f.put("moli-t/bots/removed/chat/active_session.txt", "a");
    f.put("moli-t/bots/removed/chat/scratch/report.txt", "report");
    f.put("moli-t/bots/removed/events/reminder.json", '{"type":"periodic","sessionId":"a"}');
    f.put("moli-w/bots/personal/web:personal:user/contexts/web.json", "[]");
    const ui = JSON.stringify({ conversation: { id: "web", externalUserId: "web:personal:user", agentId: "default" } });
    f.put("moli-w/ui-sessions/web_personal_user/web.json", ui);
    f.put("sessions/web.json", ui);
    f.put("moli-t/bots/removed-other/chat/contexts/keep.json", "[]");
    const ownership = { agents: ["default"], bots: [{ channel: "telegram", botId: "removed-other", agentId: "default" }] };
    const choices = [{ channel: "telegram", botId: "removed", agentId: null }, { channel: "web", botId: "personal", agentId: null }];
    const selected = new AgentStorageMigration(f.root, ownership, [], choices);
    assert.deepEqual(selected.status().conflicts, []);
    assert.equal(selected.status().sessions, 1);
    assert.deepEqual(new AgentStorageMigration(f.root, ownership).status().botAssignments, []);
    selected.saveSelections();
    const plan = await selected.execute();
    assert.equal(plan.sessions[0]?.source.sessionId, "keep");
    assert.ok(plan.files.every(file => !file.source?.includes("/removed/") && !file.source?.includes("/personal/") && !file.source?.includes("web_personal_user") && file.source !== "sessions/web.json"));
    assert.equal(readFileSync(join(f.root, "moli-t/bots/removed/chat/contexts/a.json"), "utf8"), "[]");
    assert.equal(new AgentStorageMigration(f.root, ownership).status().needed, false);
    assert.throws(() => new AgentStorageMigration(f.root, ownership, [], []), /already prepared/);
    assert.throws(() => new AgentStorageMigration(f.root, ownership, [], [{ channel: "telegram", botId: "removed-other", agentId: null }]), /Only missing Bots/);
  } finally { f.dispose(); }
});

test("confirming an all-skipped selection admits an empty workspace without copying old files", async () => {
  const f = fixture();
  try {
    f.put("moli-t/bots/removed/chat/contexts/a.json", "[]");
    const ownership = { agents: ["default"], bots: [] };
    const selected = new AgentStorageMigration(f.root, ownership, [], [{ channel: "telegram", botId: "removed", agentId: null }]);
    assert.equal(selected.status().needed, true);
    assert.equal(selected.status().files, 0);
    selected.saveSelections();
    await selected.execute();
    assert.equal(new AgentStorageMigration(f.root, ownership).status().needed, false);
  } finally { f.dispose(); }
});

test("skipping a Bot blocks recoverable queue, run and Event references but preserves terminal history", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const f = fixture();
  try {
    f.put("moli-t/bots/removed/chat/contexts/a.json", "[]");
    mkdirSync(join(f.root, "db"));
    const db = new DatabaseSync(join(f.root, "db/tasks.sqlite"));
    try {
      db.exec("CREATE TABLE inbound_tasks(id TEXT PRIMARY KEY, channel TEXT, instance_id TEXT, status TEXT, payload_json TEXT); CREATE TABLE runs(id TEXT PRIMARY KEY, record TEXT); CREATE TABLE event_execution_leases(id TEXT PRIMARY KEY, lease_scope TEXT, event_file TEXT, status TEXT)");
      db.prepare("INSERT INTO inbound_tasks VALUES(?,?,?,?,?)").run("queue", "telegram", "removed", "pending", '{}');
      db.prepare("INSERT INTO runs VALUES(?,?)").run("run", JSON.stringify({ status: "waiting_for_approval", transport: { channel: "telegram", instanceId: "removed" } }));
      db.prepare("INSERT INTO event_execution_leases VALUES(?,?,?,?)").run("lease", "telegram:removed", "reminder.json", "interrupted");
      const selected = () => new AgentStorageMigration(f.root, { agents: ["default"], bots: [] }, [], [{ channel: "telegram", botId: "removed", agentId: null }]);
      for (const [table, status] of [["inbound_tasks", "pending"], ["runs", "waiting_for_approval"], ["event_execution_leases", "interrupted"]]) {
        assert.ok(selected().status().conflicts.some(item => item.includes(`${table}/`) && item.includes(status!)));
        if (table === "runs") db.prepare("UPDATE runs SET record=?").run(JSON.stringify({ status: "completed", transport: { channel: "telegram", instanceId: "removed" } }));
        else db.exec(`UPDATE ${table} SET status='completed'`);
      }
      const before = db.prepare("SELECT * FROM runs").all();
      const service = selected();
      assert.deepEqual(service.status().conflicts, []);
      service.saveSelections();
      await service.execute();
      assert.deepEqual(db.prepare("SELECT * FROM runs").all(), before);
    } finally { db.close(); }
  } finally { f.dispose(); }
});


test("whole-Bot exclusions guard every resumable Durable state and Bash approvals through structured ownership", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const f = fixture();
  try {
    f.put("moli-t/bots/removed/chat/contexts/a.json", "[]");
    mkdirSync(join(f.root, "db"));
    const db = new DatabaseSync(join(f.root, "db/recovery.sqlite"));
    try {
      db.exec("CREATE TABLE durable_executions(id TEXT PRIMARY KEY, status TEXT, record TEXT); CREATE TABLE approvals(id TEXT PRIMARY KEY, session_id TEXT, status TEXT, capability TEXT, action_json TEXT)");
      const record = JSON.stringify({ workspaceDir: join(f.root, "moli-t/bots/removed/chat") });
      db.prepare("INSERT INTO durable_executions VALUES(?,?,?)").run("durable", "planned", record);
      const migration = () => new AgentStorageMigration(f.root, { agents: ["default"], bots: [] }, [], [{ channel: "telegram", botId: "removed", agentId: null }]);
      for (const status of ["planned", "verifying", "waiting_for_user", "paused", "partial", "unknown_future_state"]) {
        db.prepare("UPDATE durable_executions SET status=?").run(status);
        assert.ok(migration().status().conflicts.some(item => item.includes(`(${status})`)));
      }
      db.exec("UPDATE durable_executions SET status='completed'");
      const action = JSON.stringify({ channel: "telegram", owner: { kind: "bot", id: "removed" }, command: "echo test" });
      db.prepare("INSERT INTO approvals VALUES(?,?,?,?,?)").run("approval", "a", "pending", "bash:echo", action);
      for (const status of ["pending", "approved", "executing"]) {
        db.prepare("UPDATE approvals SET status=?").run(status);
        assert.ok(migration().status().conflicts.some(item => item.includes("approvals/approval")));
      }
      db.exec("UPDATE approvals SET status='executed'");
      assert.deepEqual(migration().status().conflicts, []);
      const service = migration(); service.saveSelections(); await service.execute();
      assert.equal(db.prepare("SELECT action_json FROM approvals").get()?.action_json, action);
      assert.equal(db.prepare("SELECT record FROM durable_executions").get()?.record, record);
    } finally { db.close(); }
  } finally { f.dispose(); }
});

test("conflict actions expose exclusion only when recoverable references permit it", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const f = fixture();
  try {
    f.put("moli-t/bots/removed/chat/contexts/a.json", "[]");
    f.put("moli-t/bots/one/events/broken.json", "invalid JSON");
    mkdirSync(join(f.root, "db"));
    const db = new DatabaseSync(join(f.root, "db/actions.sqlite"));
    try {
      db.exec("CREATE TABLE inbound_tasks(id TEXT PRIMARY KEY, channel TEXT, instance_id TEXT, status TEXT, payload_json TEXT); CREATE TABLE event_execution_leases(run_id TEXT PRIMARY KEY, lease_scope TEXT, event_file TEXT, session_id TEXT, status TEXT)");
      db.prepare("INSERT INTO inbound_tasks VALUES(?,?,?,?,?)").run("queue", "telegram", "removed", "pending", '{}');
      db.prepare("INSERT INTO event_execution_leases VALUES(?,?,?,?,?)").run("event", "telegram:one", "broken.json", "a", "running");
      let items = f.migration().status().conflictItems;
      const bot = items.find(item => item.reason === "missing-bot" && item.botId === "removed");
      const resource = items.find(item => item.path === "moli-t/bots/one/events/broken.json");
      assert.equal(bot?.canSkip, false);
      assert.match(bot?.skipBlockedReason ?? "", /queue/);
      assert.equal(resource?.canSkip, false);
      assert.ok(resource?.skipBlockedReason);
      db.exec("UPDATE inbound_tasks SET status='cancelled'; UPDATE event_execution_leases SET status='completed'");
      items = f.migration().status().conflictItems;
      assert.equal(items.find(item => item.reason === "missing-bot" && item.botId === "removed")?.canSkip, true);
      assert.equal(items.find(item => item.path === "moli-t/bots/one/events/broken.json")?.canSkip, true);
    } finally { db.close(); }
  } finally { f.dispose(); }
});

test("non-SQLite databases and empty placeholders do not prohibit skipping an unrelated missing Bot", async () => {
  const f = fixture();
  try {
    f.put("moli-t/bots/removed/chat/contexts/a.json", "[]");
    f.put("db/browserwing.db", "opaque database format");
    f.put("db/settings.db", "");
    const ownership = { agents: ["default"], bots: [] };
    const pending = new AgentStorageMigration(f.root, ownership).status();
    assert.equal(pending.conflictItems.find(item => item.botId === "removed")?.canSkip, true);
    const skipped = new AgentStorageMigration(f.root, ownership, [], [{ channel: "telegram", botId: "removed", agentId: null }]);
    assert.deepEqual(skipped.status().conflicts, []);
    skipped.saveSelections(); await skipped.execute();
    assert.equal(new AgentStorageMigration(f.root, ownership).status().needed, false);
    assert.equal(readFileSync(join(f.root, "db/browserwing.db"), "utf8"), "opaque database format");
    assert.equal(readFileSync(join(f.root, "db/settings.db"), "utf8"), "");
  } finally { f.dispose(); }
});

test("damaged application SQLite stores remain blocking and identify the file", () => {
  for (const [file, content] of [["inbound-queue.sqlite", "damaged store"], ["inbound-queue.sqlite", ""], ["sessions.db", ""]]) {
    const f = fixture();
    try {
      f.put("moli-t/bots/removed/chat/contexts/a.json", "[]");
      f.put(`db/${file}`, content);
      const ownership = { agents: ["default"], bots: [] };
      const pending = new AgentStorageMigration(f.root, ownership).status();
      const item = pending.conflictItems.find(item => item.botId === "removed");
      assert.equal(item?.canSkip, false);
      assert.ok(item?.skipBlockedReason?.includes(`Invalid SQLite database: ${join("db", file)}`));
      const skipped = new AgentStorageMigration(f.root, ownership, [], [{ channel: "telegram", botId: "removed", agentId: null }]);
      assert.ok(skipped.status().conflicts.some(message => message.includes(file)));
    } finally { f.dispose(); }
  }
});

test("historical trace payload statuses do not count as recoverable tasks for excluded Bots", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const f = fixture();
  try {
    f.put("moli-w/bots/personal/web:personal:owner/contexts/a.json", "[]");
    mkdirSync(join(f.root, "db"));
    const db = new DatabaseSync(join(f.root, "db/traces.sqlite"));
    try {
      db.exec("CREATE TABLE agent_trace_events(id TEXT PRIMARY KEY,channel TEXT,bot_id TEXT,session_id TEXT,payload_json TEXT)");
      for (const status of ["success", "running", "waiting_for_approval"]) db.prepare("INSERT INTO agent_trace_events VALUES(?,?,?,?,?)").run(status, "web", "personal", "a", JSON.stringify({ status }));
      const before = db.prepare("SELECT * FROM agent_trace_events").all();
      const ownership = { agents: ["default"], bots: [] };
      assert.equal(new AgentStorageMigration(f.root, ownership).status().conflictItems.find(item => item.botId === "personal")?.canSkip, true);
      const migration = new AgentStorageMigration(f.root, ownership, [], [{ channel: "web", botId: "personal", agentId: null }]);
      assert.deepEqual(migration.status().conflicts, []);
      migration.saveSelections(); await migration.execute();
      assert.deepEqual(db.prepare("SELECT * FROM agent_trace_events").all(), before);
    } finally { db.close(); }
  } finally { f.dispose(); }
});

test("deferred Pi recovery records still prevent excluding their Bot", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const f = fixture();
  try {
    f.put("moli-t/bots/removed/chat/contexts/a.json", "[]");
    mkdirSync(join(f.root, "runtime"));
    const db = new DatabaseSync(join(f.root, "runtime/pi-recovery.sqlite"));
    try {
      db.exec("CREATE TABLE owners(run_id TEXT PRIMARY KEY, record TEXT)");
      const record = { deferred: true, channel: "telegram", transport: { instanceId: "removed" }, sessionId: "a" };
      db.prepare("INSERT INTO owners VALUES(?,?)").run("waiting", JSON.stringify(record));
      const ownership = { agents: ["default"], bots: [] };
      assert.equal(new AgentStorageMigration(f.root, ownership).status().conflictItems.find(item => item.botId === "removed")?.canSkip, false);
      db.prepare("UPDATE owners SET record=?").run(JSON.stringify({ ...record, deferred: false }));
      assert.equal(new AgentStorageMigration(f.root, ownership).status().conflictItems.find(item => item.botId === "removed")?.canSkip, true);
    } finally { db.close(); }
  } finally { f.dispose(); }
});

test("ambiguous legacy history stays intact while scoped references migrate and live tasks block", async () => {
  const f = fixture();
  const { DatabaseSync } = await import("node:sqlite");
  try {
    f.put("moli-t/bots/one/chat/contexts/default.json", "[]");
    f.put("moli-q/bots/two/chat/contexts/default.json", "[]");
    mkdirSync(join(f.root, "db"));
    const db = new DatabaseSync(join(f.root, "db", "history.sqlite"));
    try {
      db.exec("CREATE TABLE runs(id TEXT PRIMARY KEY, session_id TEXT, status TEXT); CREATE TABLE image_tasks(id TEXT PRIMARY KEY, session_id TEXT, status TEXT); CREATE TABLE memory_profile_snapshots(session_id TEXT PRIMARY KEY, scope_key TEXT); CREATE TABLE agent_trace_events(id TEXT PRIMARY KEY, channel TEXT, bot_id TEXT, chat_id TEXT, session_id TEXT)");
      db.exec("INSERT INTO runs VALUES ('run', 'default', 'completed'); INSERT INTO image_tasks VALUES ('image', 'default', 'processing'); INSERT INTO memory_profile_snapshots VALUES ('default', 'personal'); INSERT INTO agent_trace_events VALUES ('trace', 'qq', 'two', 'chat', 'default')");
      for (const table of ["video_tasks", "approvals", "approval_requests"]) {
        db.exec(`CREATE TABLE ${table}(id TEXT PRIMARY KEY, session_id TEXT, status TEXT)`);
        db.prepare(`INSERT INTO ${table} VALUES (?, 'default', ?)`).run(table, table === "video_tasks" ? "processing" : "executed");
      }
      assert.equal(f.migration().prepare().phase, "prepared");
      const plan = await f.migration().execute();
      assert.equal(db.prepare("SELECT session_id FROM runs").get()?.session_id, "default");
      assert.equal(db.prepare("SELECT session_id FROM image_tasks").get()?.session_id, "default");
      assert.equal(db.prepare("SELECT session_id FROM memory_profile_snapshots").get()?.session_id, "default");
      assert.equal(db.prepare("SELECT session_id FROM agent_trace_events").get()?.session_id, plan.sessions.find(s => s.source.channel === "qq")?.targetId);
      for (const table of ["video_tasks", "approvals", "approval_requests"]) {
        assert.equal(db.prepare(`SELECT session_id FROM ${table}`).get()?.session_id, "default");
      }
      db.exec("UPDATE runs SET status='running'");
      const { migrateStorageReferences } = await import("./agentStorageReferences.js");
      assert.throws(() => migrateStorageReferences(f.root, plan, true), /Ambiguous persistent Session reference/);
      db.exec("UPDATE runs SET status='completed'; UPDATE approvals SET status='pending'");
      assert.throws(() => migrateStorageReferences(f.root, plan, true), /Ambiguous persistent Session reference/);
      db.exec("UPDATE approvals SET status='executed'; CREATE TABLE unknown_tasks(id TEXT PRIMARY KEY, session_id TEXT); INSERT INTO unknown_tasks VALUES ('unknown', 'default')");
      assert.throws(() => migrateStorageReferences(f.root, plan, true), /Ambiguous persistent Session reference/);
    } finally { db.close(); }
  } finally { f.dispose(); }
});

test("completed cutover stays complete after new runtime references and source cleanup", async () => {
  const f = fixture();
  const { DatabaseSync } = await import("node:sqlite");
  try {
    f.put("moli-t/bots/one/chat/contexts/default.json", "[]");
    f.put("moli-q/bots/two/chat/contexts/default.json", "[]");
    await f.migration().execute();
    f.put("sessions/default/contexts/new.json", "[]");
    assert.equal(f.migration().status(true).needed, false);
    mkdirSync(join(f.root, "db"));
    const db = new DatabaseSync(join(f.root, "db/mory.sqlite"));
    try {
      db.exec("CREATE TABLE conversation_search_changes(seq INTEGER PRIMARY KEY, conversation_id TEXT, payload_json TEXT); INSERT INTO conversation_search_changes VALUES (3287, 'default', NULL)");
      // New runtime records must not be interpreted through the old cutover map.
      db.exec("CREATE TABLE inbound_tasks(id TEXT PRIMARY KEY, session_id TEXT, status TEXT); INSERT INTO inbound_tasks VALUES ('new', 'default', 'running')");
      for (const cleanup of [false, true]) {
        if (cleanup) { rmSync(join(f.root, "moli-t"), { recursive: true }); rmSync(join(f.root, "moli-q"), { recursive: true }); }
        const status = f.migration().status();
        assert.equal(status.needed, false);
        assert.equal(status.phase, "completed");
        assert.deepEqual(status.conflicts, []);
      }
      assert.equal(db.prepare("SELECT session_id FROM inbound_tasks").get()?.session_id, "default");
    } finally { db.close(); }
  } finally { f.dispose(); }
});

test("ambiguous search history does not block cutover while scoped search references migrate", async () => {
  const f = fixture();
  const { DatabaseSync } = await import("node:sqlite");
  try {
    f.put("moli-t/bots/one/chat/contexts/default.json", "[]");
    f.put("moli-q/bots/two/chat/contexts/default.json", "[]");
    mkdirSync(join(f.root, "db"));
    const db = new DatabaseSync(join(f.root, "db/mory.sqlite"));
    try {
      for (const table of ["conversation_search_changes", "conversation_search_documents", "conversation_search_tombstones"]) {
        db.exec(`CREATE TABLE ${table}(id TEXT PRIMARY KEY, conversation_id TEXT, channel TEXT, bot_id TEXT, chat_id TEXT, payload_json TEXT)`);
        db.prepare(`INSERT INTO ${table} VALUES ('ambiguous', 'default', NULL, NULL, NULL, NULL)`).run();
        db.prepare(`INSERT INTO ${table} VALUES ('scoped', 'default', 'qq', 'two', 'chat', ?)`).run(JSON.stringify({ conversationId: "default" }));
      }
      assert.deepEqual(f.migration().status().conflicts, []);
      const plan = await f.migration().execute();
      const targetId = plan.sessions.find(s => s.source.channel === "qq")!.targetId;
      for (const table of ["conversation_search_changes", "conversation_search_documents", "conversation_search_tombstones"]) {
        assert.equal(db.prepare(`SELECT conversation_id FROM ${table} WHERE id='ambiguous'`).get()?.conversation_id, "default");
        const scoped = db.prepare(`SELECT conversation_id, payload_json FROM ${table} WHERE id='scoped'`).get()!;
        assert.equal(scoped.conversation_id, targetId);
        assert.equal(JSON.parse(scoped.payload_json as string).conversationId, targetId);
      }
    } finally { db.close(); }
  } finally { f.dispose(); }
});

test("in-flight progress reads the manifest without rescanning changed sources", () => {
  const f = fixture();
  try {
    f.put("moli-t/bots/one/chat/contexts/old.json", "[]");
    const migration = f.migration();
    const prepared = migration.prepare();
    f.put("moli-t/bots/one/chat/contexts/old.json", "changed during migration");
    const progress = migration.status(true);
    assert.equal(progress.phase, "prepared");
    assert.equal(progress.copiedFiles, prepared.files.length);
    assert.equal(progress.files, prepared.files.length);
    assert.deepEqual(progress.conflicts, []);
    assert.ok(migration.status().conflicts.some(message => message.includes("Source changed")));
  } finally { f.dispose(); }
});

test("batched checkpoints resume files published since the last saved receipt", async () => {
  const f = fixture();
  try {
    f.put("moli-t/bots/one/chat/contexts/old.json", "[]");
    for (let index = 0; index < 80; index++) f.put(`moli-t/bots/one/chat/attachments/${String(index).padStart(3, "0")}.txt`, `file ${index}`);
    const migration = f.migration();
    const save = Reflect.get(migration, "saveManifest");
    let writes = 0;
    Reflect.set(migration, "saveManifest", function (manifest: { phase: string; published?: Record<string, string> }) {
      writes++;
      if (manifest.phase === "committing" && Object.keys(manifest.published ?? {}).length >= 64) throw new Error("interrupted checkpoint");
      save.call(migration, manifest);
    });
    await assert.rejects(migration.execute(), /interrupted checkpoint/);
    assert.ok(writes < 15, `unexpected full-manifest writes: ${writes}`);
    const saved = JSON.parse(readFileSync(join(f.root, "runtime/agent-storage-migration/manifest.json"), "utf8"));
    assert.equal(Object.keys(saved.published).length, 32);
    const finished = await f.migration().execute();
    assert.equal(finished.phase, "completed");
    for (const file of finished.files) assert.equal(readFileSync(join(f.root, file.target), "utf8"), file.content ?? readFileSync(join(f.root, file.source!), "utf8"));
  } finally { f.dispose(); }
});
