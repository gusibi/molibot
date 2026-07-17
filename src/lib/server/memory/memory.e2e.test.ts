import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MemoryGateway } from "./gateway.js";
import { MemoryCandidateStore } from "./candidateStore.js";
import { MoryMemoryBackend } from "./moryCore.js";
import { SqliteMemoryTraceStore } from "./traceStore.js";
import { MemoryProfileSnapshotStore } from "./profileSnapshotStore.js";

async function withMemory(run: (gateway: MemoryGateway, backend: MoryMemoryBackend) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "molibot-memory-e2e-"));
  const backend = new MoryMemoryBackend({} as any, { dbPath: join(dir, "mory.sqlite"), dataDir: dir });
  const candidates = new MemoryCandidateStore(join(dir, "candidates.sqlite"));
  const profileSnapshots = new MemoryProfileSnapshotStore(join(dir, "profile-snapshots.sqlite"));
  const gateway = new MemoryGateway(
    () => ({ plugins: { memory: { enabled: true, backend: "mory", embeddingProviderId: "", embeddingModel: "" } }, customProviders: [] }) as any,
    {} as any,
    undefined,
    { candidateStore: candidates, profileSnapshotStore: profileSnapshots, backends: { mory: backend }, backendDefinitions: [{ key: "mory", name: "mory", description: "test", create: () => backend }], importers: [] }
  );
  try { await run(gateway, backend); } finally { profileSnapshots.close(); candidates.close(); rmSync(dir, { recursive: true, force: true }); }
}

test("confirmed Web owner preference is injected into Telegram and keeps version history", () => withMemory(async (gateway, backend) => {
  const candidate = gateway.createCandidate({
    namespace: "owner:owner", domain: "owner", type: "user_preference", subject: "answer_length", path: "mory://user_preference/answer_length",
    value: "主人明确偏好较长且完整的回答方式", confidence: 0.9, reason: "user preference",
    sources: [{ channel: "web", sessionId: "web-session", conversationMessageId: "web-message" }], layer: "long_term"
  });
  assert.ok(candidate);
  assert.equal((await gateway.createPromptSnapshot({ channel: "telegram", externalUserId: "tg-chat", botId: "momo" }, "回答方式", 5)).selected.length, 0);
  const confirmed = await gateway.confirmCandidate(candidate.id);
  assert.equal(confirmed?.status, "confirmed");
  const telegram = await gateway.createPromptSnapshot({ channel: "telegram", externalUserId: "tg-chat", botId: "momo" }, "回答方式", 5);
  assert.ok(telegram.promptText.includes("较长"));
  const updated = await backend.add({ channel: "web", externalUserId: "web-session", botId: "momo" }, { content: "主人现在明确偏好简短直接的回答方式", namespace: "owner:owner", domain: "owner", type: "user_preference", subject: "answer_length", layer: "long_term" });
  const versions = await gateway.versions({ channel: "web", externalUserId: "web-session", botId: "momo" }, updated.id);
  assert.equal(versions.length, 2);
  assert.ok(versions.some((version) => version.content.includes("较长")));
  assert.ok(versions.some((version) => version.content.includes("简短")));
}));

test("revoking an auto-confirmed version restores only a safe predecessor", () => withMemory(async (gateway, backend) => {
  const scope = { channel: "web", externalUserId: "web-session", botId: "momo", ownerId: "owner" };
  const predecessor = await backend.add(scope, {
    content: "用户原本偏好每周一生成一次完整项目进展报告",
    namespace: "owner:owner", domain: "owner", type: "user_preference", subject: "report_schedule", layer: "long_term"
  });
  const candidate = gateway.createCandidate({
    namespace: "owner:owner", domain: "owner", type: "user_preference", subject: "report_schedule", path: "mory://user_preference/report_schedule",
    value: "用户现在偏好每周五生成一次完整项目进展报告", confidence: 0.94,
    reason: "aggregated evidence; audit:auto-confirm", supersedesMemoryId: predecessor.id,
    sources: [{ channel: "web", sessionId: "web-session", conversationMessageId: "source-1", observedAt: "2026-07-17T00:00:00Z" }],
    layer: "long_term"
  });
  assert.ok(candidate);
  const confirmed = await gateway.confirmCandidate(candidate.id);
  assert.ok(confirmed?.confirmedMemoryId);
  assert.equal((await gateway.getForGovernance(scope, predecessor.id)), null);
  const revoked = await gateway.revokeAutoConfirmedCandidate(candidate.id);
  assert.deepEqual(revoked, { revoked: true, predecessorRestored: true, needsReview: false });
  assert.equal((await gateway.getForGovernance(scope, predecessor.id))?.state, "active");
  assert.equal(await gateway.getForGovernance(scope, confirmed!.confirmedMemoryId!), null);
}));

test("content memory is explicit-only and supports duplicate-risk retrieval", () => withMemory(async (gateway) => {
  await gateway.addContentMemory("momo", { content: "已经发布过关于加班像无限续杯咖啡的吐槽内容", type: "user_fact", subject: "published_overtime_coffee" });
  const ordinary = await gateway.createPromptSnapshot({ channel: "web", externalUserId: "chat", botId: "momo" }, "加班咖啡", 5);
  assert.equal(ordinary.selected.length, 0);
  const content = await gateway.searchContent("momo", { query: "加班咖啡吐槽", mode: "hybrid", limit: 5 });
  assert.ok(content.some((row) => row.content.includes("无限续杯")));
}));

test("pinned memory survives expiry and compaction", () => withMemory(async (gateway, backend) => {
  const scope = { channel: "web", externalUserId: "chat", botId: "momo" };
  const pinned = await backend.add(scope, { content: "请记住这条固定且不会过期的重要工作原则", layer: "daily", type: "event", subject: "pinned_principle", confidence: 0.98, expiresAt: "2020-01-01T00:00:00.000Z", pinned: true });
  const expired = await backend.add(scope, { content: "请记住这条已经过期的临时工作状态", layer: "daily", type: "event", subject: "expired_state", confidence: 0.98, expiresAt: "2020-01-01T00:00:00.000Z" });
  await gateway.compact(scope);
  assert.equal((await gateway.search(scope, { query: "固定工作原则", mode: "hybrid", limit: 10 })).some((row) => row.id === pinned.id), true);
  assert.equal((await gateway.search(scope, { query: "临时工作状态", mode: "hybrid", limit: 10 })).some((row) => row.id === expired.id), false);
}));

test("exact duplicate compaction preserves provenance on the survivor", () => withMemory(async (gateway, backend) => {
  const scope = { channel: "web", externalUserId: "chat", botId: "momo" };
  const content = "用户明确偏好在发布前运行完整测试套件并核对变更摘要";
  await backend.add(scope, { content, type: "user_preference", subject: "release_check_a", sources: [{ channel: "web", sessionId: "s1", conversationMessageId: "m1" }] });
  await backend.add(scope, { content, type: "user_preference", subject: "release_check_b", sources: [{ channel: "web", sessionId: "s2", conversationMessageId: "m2" }] });
  await gateway.compact(scope);
  const rows = await gateway.search(scope, { query: "发布前完整测试变更摘要", mode: "hybrid", limit: 10 });
  assert.equal(rows.length, 1);
  assert.deepEqual(new Set(rows[0]?.sources?.map((source) => source.conversationMessageId)), new Set(["m1", "m2"]));
}));

test("disabled memory remains searchable but is excluded from prompt injection", () => withMemory(async (gateway, backend) => {
  const scope = { channel: "web", externalUserId: "chat", botId: "momo" };
  const memory = await backend.add(scope, {
    content: "用户明确偏好 macOS 原生界面风格",
    type: "user_preference",
    subject: "ui_style",
    confidence: 0.98
  });
  const disabled = await gateway.update(scope, memory.id, { allowInjection: false });
  assert.equal(disabled?.allowInjection, false);
  await gateway.compact(scope);
  assert.equal((await gateway.search(scope, { query: "macOS 原生界面", mode: "hybrid", limit: 10 })).find((row) => row.id === memory.id)?.allowInjection, false);
  assert.equal((await gateway.search(scope, { query: "macOS 原生界面", mode: "hybrid", limit: 10 })).some((row) => row.id === memory.id), true);
  assert.equal((await gateway.createPromptSnapshot(scope, "macOS 原生界面", 5)).selected.some((row) => row.id === memory.id), false);
}));

test("disputed and dormant memories stay available for governance but not normal search or prompt", () => withMemory(async (gateway, backend) => {
  const scope = { channel: "web", externalUserId: "chat", botId: "momo", ownerId: "owner" };
  const disputed = await backend.add(scope, { content: "用户偏好非常长的回答", type: "user_preference", subject: "answer_length", confidence: 0.98 });
  const dormant = await backend.add(scope, { content: "用户过去偏好深色主题", type: "user_preference", subject: "color_theme", confidence: 0.8 });
  assert.equal((await gateway.update(scope, disputed.id, { state: "disputed" }))?.state, "disputed");
  assert.equal((await gateway.update(scope, dormant.id, { state: "dormant" }))?.state, "dormant");
  assert.equal((await gateway.search(scope, { query: "用户偏好", mode: "hybrid", limit: 10 })).some((row) => row.id === disputed.id || row.id === dormant.id), false);
  assert.equal((await gateway.createPromptSnapshot(scope, "用户偏好", 10)).selected.some((row) => row.id === disputed.id || row.id === dormant.id), false);
  assert.equal((await gateway.getForGovernance(scope, disputed.id))?.state, "disputed");
  assert.equal((await gateway.getForGovernance(scope, dormant.id))?.state, "dormant");
}));

test("privacy suppression survives compact and only explicit governance restore re-enables injection", () => withMemory(async (gateway, backend) => {
  const scope = { channel: "web", externalUserId: "chat", botId: "momo" };
  const memory = await backend.add(scope, {
    content: "用户私人偏好是仅在家中使用代号青鸟",
    type: "user_preference",
    subject: "private_codename",
    confidence: 0.95
  });
  assert.equal((await gateway.suppressPrivacy(scope, memory.id, { idempotencyKey: "private-1", reason: "too_private" }))?.privacySuppressed, true);
  await gateway.compact(scope);
  assert.equal((await gateway.search(scope, { query: "代号青鸟", mode: "hybrid", limit: 10 })).some((row) => row.id === memory.id), false);
  assert.equal((await gateway.createPromptSnapshot(scope, "代号青鸟", 5)).selected.some((row) => row.id === memory.id), false);
  assert.equal((await gateway.getForGovernance(scope, memory.id))?.privacySuppressed, true);
  assert.equal((await gateway.restorePrivacy(scope, memory.id, { idempotencyKey: "private-restore-1", reason: "user_confirmed_scope" }))?.privacySuppressed, false);
  assert.equal((await gateway.createPromptSnapshot(scope, "代号青鸟", 5)).selected.some((row) => row.id === memory.id), true);
}));

test("trace feedback applies reversible effects once while privacy remains sticky", () => withMemory(async (gateway, backend) => {
  const scope = { channel: "web", externalUserId: "chat", botId: "momo" };
  const memory = await backend.add(scope, {
    content: "用户偏好简短直接的回答",
    type: "user_preference",
    subject: "answer_length",
    confidence: 0.95
  });
  const traces = new SqliteMemoryTraceStore(":memory:");
  const trace = traces.save({
    runId: "run-feedback",
    sessionId: "session-feedback",
    chatId: "chat",
    scope,
    profileRevokedMemoryIds: [],
    assistantSourceEntryId: "assistant-feedback",
    query: "回答方式",
    retrievedCount: 1,
    selectedCount: 1,
    injectedItems: [{
      memoryId: memory.id,
      order: 0,
      promptText: "1. 用户偏好简短直接的回答",
      source: "retrieved",
      namespace: memory.namespace,
      domain: memory.domain,
      snapshot: { displayText: memory.content, content: memory.content, layer: memory.layer, tags: memory.tags, updatedAt: memory.updatedAt }
    }],
    writeReceipts: [],
    createdAt: "2026-07-17T00:00:00.000Z"
  });

  assert.equal((await gateway.applyTraceFeedback(traces, { traceId: trace.id, memoryId: memory.id, value: "helpful", idempotencyKey: "effect-1" })).memory.utility, 0.58);
  assert.equal((await gateway.applyTraceFeedback(traces, { traceId: trace.id, memoryId: memory.id, value: "helpful", idempotencyKey: "effect-1" })).memory.utility, 0.58);
  assert.equal((await gateway.applyTraceFeedback(traces, { traceId: trace.id, memoryId: memory.id, value: "irrelevant", idempotencyKey: "effect-2" })).memory.utility, 0.42);
  assert.equal((await gateway.applyTraceFeedback(traces, { traceId: trace.id, memoryId: memory.id, value: "incorrect", idempotencyKey: "effect-3" })).memory.state, "disputed");
  const restored = await gateway.applyTraceFeedback(traces, { traceId: trace.id, memoryId: memory.id, value: "helpful", idempotencyKey: "effect-4" });
  assert.equal(restored.memory.state, "active");
  assert.equal(restored.memory.confidence, 0.95);
  assert.equal((await gateway.applyTraceFeedback(traces, { traceId: trace.id, memoryId: memory.id, value: "too_private", idempotencyKey: "effect-5" })).memory.privacySuppressed, true);
  assert.equal((await gateway.applyTraceFeedback(traces, { traceId: trace.id, memoryId: memory.id, value: "helpful", idempotencyKey: "effect-6" })).memory.privacySuppressed, true);
  traces.close();
}));

test("pending feedback effects support dry-run and idempotent replay", () => withMemory(async (gateway, backend) => {
  const scope = { channel: "web", externalUserId: "chat", botId: "momo" };
  const memory = await backend.add(scope, { content: "用户偏好先看结论", type: "user_preference", subject: "answer_order", confidence: 0.9 });
  const traces = new SqliteMemoryTraceStore(":memory:");
  const trace = traces.save({
    runId: "run-replay", sessionId: "session-replay", chatId: "chat", scope, profileRevokedMemoryIds: [], assistantSourceEntryId: "assistant-replay",
    query: "回答顺序", retrievedCount: 1, selectedCount: 1,
    injectedItems: [{ memoryId: memory.id, order: 0, promptText: `1. ${memory.content}`, source: "retrieved", snapshot: { displayText: memory.content, content: memory.content, layer: memory.layer, tags: [], updatedAt: memory.updatedAt } }],
    writeReceipts: [], createdAt: "2026-07-17T00:00:00.000Z"
  });
  traces.recordFeedback({ traceId: trace.id, memoryId: memory.id, value: "helpful", idempotencyKey: "replay-1" });
  assert.deepEqual(await gateway.replayPendingTraceFeedback(traces, { dryRun: true }), { pendingCount: 1, appliedCount: 0, failedCount: 0 });
  assert.equal((await gateway.getForGovernance(scope, memory.id))?.utility, 0.5);
  assert.deepEqual(await gateway.replayPendingTraceFeedback(traces), { pendingCount: 1, appliedCount: 1, failedCount: 0 });
  assert.equal((await gateway.getForGovernance(scope, memory.id))?.utility, 0.58);
  assert.deepEqual(await gateway.replayPendingTraceFeedback(traces), { pendingCount: 0, appliedCount: 0, failedCount: 0 });
  traces.close();
}));

test("retrieval does not count as usage and successful injection retries count once", () => withMemory(async (gateway, backend) => {
  const scope = { channel: "web", externalUserId: "chat", botId: "momo" };
  const memory = await backend.add(scope, {
    content: "用户偏好在技术说明中包含验证证据",
    type: "user_preference",
    subject: "verification_evidence",
    confidence: 0.9
  });
  await gateway.search(scope, { query: "验证证据", mode: "hybrid", limit: 5 });
  assert.equal((await gateway.getForGovernance(scope, memory.id))?.injectionCount, 0);
  assert.equal(await gateway.recordSuccessfulInjectionUsage(scope, "trace-usage", [memory.id], "2026-07-17T03:00:00.000Z"), 1);
  assert.equal(await gateway.recordSuccessfulInjectionUsage(scope, "trace-usage", [memory.id], "2026-07-17T03:01:00.000Z"), 0);
  const used = await gateway.getForGovernance(scope, memory.id);
  assert.equal(used?.injectionCount, 1);
  assert.equal(used?.lastInjectedAt, "2026-07-17T03:00:00.000Z");
}));

test("session profile base stays stable while governance revocation removes without replacement", () => withMemory(async (gateway, backend) => {
  const scope = { channel: "web", externalUserId: "chat", botId: "momo", ownerId: "owner" };
  const original = await backend.add(scope, {
    content: "用户长期偏好使用深色主题",
    type: "user_preference",
    subject: "color_theme",
    confidence: 0.95,
    pinned: true
  });
  const input = { ...scope, includeOwner: true, includeAgentSelf: true };
  const first = await gateway.createProfileTurnSnapshot("session-profile", input);
  assert.equal(first.effectiveItems.some((item) => item.memoryId === original.id), true);
  await gateway.update(scope, original.id, { state: "disputed" });
  const replacement = await backend.add(scope, {
    content: "用户最近尝试浅色主题",
    type: "user_preference",
    subject: "temporary_color_theme",
    confidence: 0.99,
    pinned: true
  });
  const next = await gateway.createProfileTurnSnapshot("session-profile", input);
  assert.equal(next.baseFingerprint, first.baseFingerprint);
  assert.equal(next.revokedMemoryIds.includes(original.id), true);
  assert.equal(next.effectiveItems.some((item) => item.memoryId === original.id), false);
  assert.equal(next.effectiveItems.some((item) => item.memoryId === replacement.id), false);
}));

test("a memory id cannot be read or updated from another chat namespace", () => withMemory(async (gateway, backend) => {
  const firstScope = { channel: "web", externalUserId: "chat-a", botId: "momo", ownerId: "owner", shareOwner: false };
  const otherScope = { channel: "web", externalUserId: "chat-b", botId: "momo", ownerId: "owner", shareOwner: false };
  const memory = await backend.add(firstScope, { content: "只属于 chat-a 的临时执行约定", layer: "long_term" });
  assert.equal(await gateway.getForGovernance(otherScope, memory.id), null);
  assert.equal(await gateway.update(otherScope, memory.id, { pinned: true }), null);
  assert.equal((await gateway.getForGovernance(firstScope, memory.id))?.origin?.externalUserId, "chat-a");
}));

test("embedding failure opens a cooldown and avoids repeated attempts", () => withMemory(async (_gateway, backend) => {
  let attempts = 0;
  backend.configureEmbedder(async () => { attempts += 1; throw new Error("provider unavailable"); }, "test-model");
  const scope = { channel: "web", externalUserId: "chat", botId: "momo" };
  await backend.add(scope, { content: "请记住第一条稳定且完整的工作偏好", type: "user_preference", subject: "first_preference", confidence: 0.98 });
  await backend.add(scope, { content: "请记住第二条稳定且完整的工作偏好", type: "user_preference", subject: "second_preference", confidence: 0.98 });
  await backend.search(scope, { query: "工作偏好", mode: "hybrid", limit: 10 });
  await backend.search(scope, { query: "稳定偏好", mode: "hybrid", limit: 10 });
  assert.equal(attempts, 1);
}));

test("compaction membership checks remain set-based", () => {
  const source = readFileSync(new URL("./moryCore.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /expiredIds\.includes\(|duplicateIds\.includes\(/);
});
