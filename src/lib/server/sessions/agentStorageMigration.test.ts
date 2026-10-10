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

test("unimplemented profile and Web display data block readiness instead of disappearing", () => {
  const f = fixture();
  try {
    f.put("moli-t/bots/one/BOT.md", "custom rules");
    f.put("moli-w/ui-sessions/index.json", "{}");
    const status = f.migration().status();
    assert.equal(status.needed, true);
    assert.ok(status.conflicts.some(item => item.includes("BOT.md")));
    assert.ok(status.conflicts.some(item => item.includes("ui-sessions/index.json")));
    assert.throws(() => f.migration().prepare(), /Unsupported legacy file/);
  } finally { f.dispose(); }
});
