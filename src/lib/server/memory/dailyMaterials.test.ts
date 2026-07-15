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

// A reader with a message on each of three consecutive local days, honoring the
// isolated daily-materials watermark exactly like the real session reader.
function backfillReader(h: ReturnType<typeof harness>) {
  const days: Record<string, { id: string; createdAt: string; content: string }> = {
    "2026-07-09": { id: "m-9", createdAt: "2026-07-09T02:00:00.000Z", content: "第九天素材" },
    "2026-07-10": { id: "m-10", createdAt: "2026-07-10T02:00:00.000Z", content: "第十天素材" },
    "2026-07-11": { id: "m-11", createdAt: "2026-07-11T02:00:00.000Z", content: "第十一天素材" }
  };
  return {
    earliestLocalDate: () => "2026-07-09",
    read: async (_target: ReflectionTarget, localDate: string): Promise<ReflectionSourceProjection[]> => {
      const message = days[localDate];
      if (!message) return [];
      const watermark = h.state.get(h.targetId, "session-1");
      const key = `${message.createdAt}:${message.id}`;
      if (watermark && key <= watermark) return [];
      return [{
        scope: h.target.sourceScopes[0],
        conversationId: "session-1",
        messages: [{ ...message, conversationId: "session-1", sessionId: "session-1", channel: "web", role: "user" as const }]
      }];
    }
  };
}

test("backfill auto-scans from the earliest day, writes one file per day, then reruns empty", async () => {
  const h = harness();
  try {
    const service = new DailyMaterialsService(backfillReader(h), h.state, async () => "# 今日素材\n\n历史回填。", h.projects);
    const result = await service.runBackfill(h.internal, { now: new Date("2026-07-12T12:00:00.000Z") });
    assert.equal(result.from, "2026-07-09");
    assert.equal(result.to, "2026-07-11");
    assert.equal(result.totalDays, 3);
    assert.equal(result.daysWithData, 3);
    for (const date of ["2026-07-09", "2026-07-10", "2026-07-11"]) {
      assert.ok(existsSync(join(h.projectRoot, `content/daily-materials/${date}.md`)), `missing ${date}`);
    }
    const rerun = await service.runBackfill(h.internal, { now: new Date("2026-07-12T12:00:00.000Z") });
    assert.equal(rerun.daysWithData, 0);
  } finally { h.cleanup(); }
});

test("a busy day over budget splits into batches and synthesizes one file", async () => {
  const h = harness();
  try {
    const big = "内容".repeat(3000); // ~6000 CJK chars ≈ 6000 tokens per conversation
    const projections: ReflectionSourceProjection[] = [0, 1, 2].map((i) => ({
      scope: h.target.sourceScopes[0],
      conversationId: `session-${i}`,
      messages: [{ id: `m-${i}`, conversationId: `session-${i}`, sessionId: `session-${i}`, channel: "web", role: "user" as const, content: big, createdAt: `2026-07-11T0${i}:00:00.000Z` }]
    }));
    const prompts: string[] = [];
    const service = new DailyMaterialsService(
      { read: async () => projections },
      h.state,
      async (prompt: string) => { prompts.push(prompt); return prompt.includes("分批提取的素材笔记") ? "# 今日素材\n\n汇总结果" : "批次素材"; },
      h.projects
    );
    // Budget 10000 tokens: three ~6000-token conversations force multiple batches.
    const result = await service.run({ ...h.internal, scanTokenBudget: 10000 }, { now: new Date("2026-07-12T12:00:00.000Z") });
    assert.ok(result.batches >= 2, `expected multiple batches, got ${result.batches}`);
    // one reply per batch + one synthesis pass
    assert.equal(prompts.length, result.batches + 1);
    assert.equal(readFileSync(join(h.projectRoot, result.createdFile!), "utf8"), "# 今日素材\n\n汇总结果\n");
    for (const i of [0, 1, 2]) assert.ok(h.state.get(h.targetId, `session-${i}`), `watermark ${i}`);
  } finally { h.cleanup(); }
});

test("backfill honors an explicit range and reports ascending progress", async () => {
  const h = harness();
  try {
    const progress: number[] = [];
    const service = new DailyMaterialsService(backfillReader(h), h.state, async () => "# 素材", h.projects);
    const result = await service.runBackfill(h.internal, {
      from: "2026-07-10",
      to: "2026-07-11",
      now: new Date("2026-07-12T12:00:00.000Z"),
      onProgress: (p) => progress.push(p.index)
    });
    assert.equal(result.totalDays, 2);
    assert.deepEqual(progress, [1, 2]);
    assert.equal(existsSync(join(h.projectRoot, "content/daily-materials/2026-07-09.md")), false);
    assert.ok(existsSync(join(h.projectRoot, "content/daily-materials/2026-07-10.md")));
  } finally { h.cleanup(); }
});
