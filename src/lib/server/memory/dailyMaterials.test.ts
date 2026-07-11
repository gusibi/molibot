import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DailyMaterialsService, dailyMaterialsTargetId, type DailyMaterialsInternal } from "./dailyMaterials.js";
import { ReflectionStateStore, reflectionTargetId, type ReflectionSourceProjection, type ReflectionTarget } from "./reflection.js";

function harness() {
  const dir = mkdtempSync(join(tmpdir(), "molibot-daily-materials-"));
  const projectRoot = join(dir, "momo-agent");
  mkdirSync(projectRoot, { recursive: true });
  const state = new ReflectionStateStore(join(dir, "state.sqlite"));
  const target: ReflectionTarget = { ownerId: "owner", botId: "momo", timezone: "Asia/Shanghai", sourceScopes: [{ channel: "web", externalUserId: "web:momo:web-anonymous" }] };
  const targetId = dailyMaterialsTargetId(target);
  const projection: ReflectionSourceProjection = {
    scope: target.sourceScopes[0], conversationId: "session-1",
    messages: [{ id: "message-1", conversationId: "session-1", sessionId: "session-1", channel: "web", role: "user", content: "今天把素材自动化接通了", createdAt: "2026-07-11T02:00:00.000Z" }]
  };
  const internal: DailyMaterialsInternal = { kind: "daily-materials", target, output: { projectId: "momo-agent", dir: "content/daily-materials" } };
  const projects = { get: (id: string) => id === "momo-agent" ? { id, rootPath: projectRoot } : null };
  const cleanup = () => { state.close(); rmSync(dir, { recursive: true, force: true }); };
  return { dir, projectRoot, state, target, targetId, projection, internal, projects, cleanup };
}

test("daily materials writes once, advances its isolated watermark, then reruns quietly", async () => {
  const h = harness();
  try {
    const reader = { read: async () => h.state.get(h.targetId, "session-1") ? [] : [h.projection] };
    const service = new DailyMaterialsService(reader, h.state, async () => "# 今日素材\n\n自动化已接通。", h.projects);
    const first = await service.run(h.internal, { now: new Date("2026-07-12T12:00:00.000Z") });
    const second = await service.run(h.internal, { now: new Date("2026-07-12T12:00:00.000Z") });
    assert.equal(first.createdFile, "content/daily-materials/2026-07-11.md");
    assert.equal(second.createdFile, null);
    assert.match(readFileSync(join(h.projectRoot, first.createdFile!), "utf8"), /自动化已接通/);
    assert.ok(h.state.get(h.targetId, "session-1"));
    assert.notEqual(h.targetId, reflectionTargetId(h.target));
  } finally { h.cleanup(); }
});

test("daily materials strips an outer Markdown fence from model output", async () => {
  const h = harness();
  try {
    const service = new DailyMaterialsService({ read: async () => [h.projection] }, h.state, async () => "```markdown\n# 今日素材\n```", h.projects);
    const result = await service.run(h.internal, { now: new Date("2026-07-12T12:00:00.000Z") });
    assert.equal(readFileSync(join(h.projectRoot, result.createdFile!), "utf8"), "# 今日素材\n");
  } finally { h.cleanup(); }
});

test("missing output project fails without advancing watermark", async () => {
  const h = harness();
  try {
    const service = new DailyMaterialsService({ read: async () => [h.projection] }, h.state, async () => "unused", { get: () => null });
    await assert.rejects(service.run(h.internal, { now: new Date("2026-07-12T12:00:00.000Z") }), /not registered/);
    assert.equal(h.state.get(h.targetId, "session-1"), undefined);
  } finally { h.cleanup(); }
});

test("abort after generation does not write or advance watermark", async () => {
  const h = harness();
  try {
    const controller = new AbortController();
    const service = new DailyMaterialsService({ read: async () => [h.projection] }, h.state, async () => { controller.abort(new Error("stop")); return "unused"; }, h.projects);
    await assert.rejects(service.run(h.internal, { now: new Date("2026-07-12T12:00:00.000Z"), signal: controller.signal }), /stop/);
    assert.equal(h.state.get(h.targetId, "session-1"), undefined);
    assert.equal(existsSync(join(h.projectRoot, "content/daily-materials/2026-07-11.md")), false);
  } finally { h.cleanup(); }
});

test("output containment rejects parent traversal without writing or watermark", async () => {
  const h = harness();
  try {
    const service = new DailyMaterialsService({ read: async () => [h.projection] }, h.state, async () => "unused", h.projects);
    await assert.rejects(service.run({ ...h.internal, output: { projectId: "momo-agent", dir: "../outside" } }, { now: new Date("2026-07-12T12:00:00.000Z") }), /inside the project root/);
    assert.equal(h.state.get(h.targetId, "session-1"), undefined);
  } finally { h.cleanup(); }
});

test("output containment rejects an existing symlink that leaves the project", async () => {
  const h = harness();
  try {
    mkdirSync(h.projectRoot, { recursive: true });
    symlinkSync(h.dir, join(h.projectRoot, "escaped"));
    const service = new DailyMaterialsService({ read: async () => [h.projection] }, h.state, async () => "unused", h.projects);
    await assert.rejects(service.run({ ...h.internal, output: { projectId: "momo-agent", dir: "escaped/materials" } }, { now: new Date("2026-07-12T12:00:00.000Z") }), /inside the project root/);
    assert.equal(h.state.get(h.targetId, "session-1"), undefined);
  } finally { h.cleanup(); }
});
