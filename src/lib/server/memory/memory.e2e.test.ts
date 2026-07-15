import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MemoryGateway } from "./gateway.js";
import { MemoryCandidateStore } from "./candidateStore.js";
import { MoryMemoryBackend } from "./moryCore.js";

async function withMemory(run: (gateway: MemoryGateway, backend: MoryMemoryBackend) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "molibot-memory-e2e-"));
  const backend = new MoryMemoryBackend({} as any, { dbPath: join(dir, "mory.sqlite"), dataDir: dir });
  const candidates = new MemoryCandidateStore(join(dir, "candidates.sqlite"));
  const gateway = new MemoryGateway(
    () => ({ plugins: { memory: { enabled: true, backend: "mory", embeddingProviderId: "", embeddingModel: "" } }, customProviders: [] }) as any,
    {} as any,
    undefined,
    { candidateStore: candidates, backends: { mory: backend }, backendDefinitions: [{ key: "mory", name: "mory", description: "test", create: () => backend }], importers: [] }
  );
  try { await run(gateway, backend); } finally { candidates.close(); rmSync(dir, { recursive: true, force: true }); }
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
