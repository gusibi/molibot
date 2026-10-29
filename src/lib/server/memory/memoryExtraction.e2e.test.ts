import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MemoryGateway } from "./gateway.js";
import { MemoryCandidateStore } from "./candidateStore.js";
import { MoryMemoryBackend } from "./moryCore.js";
import { MemoryProfileSnapshotStore } from "./profileSnapshotStore.js";
import { MemoryWriter } from "./memoryWriter.js";
import { MemoryExtractionService, type MemoryExtractionOutput } from "./memoryExtraction.js";
import { MemoryExtractionStateStore } from "./memoryExtractionStore.js";

async function withMemory(run: (gateway: MemoryGateway) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "molibot-memory-extraction-e2e-"));
  const backend = new MoryMemoryBackend({} as never, { dbPath: join(dir, "mory.sqlite"), dataDir: dir });
  const candidates = new MemoryCandidateStore(join(dir, "candidates.sqlite"));
  const profileSnapshots = new MemoryProfileSnapshotStore(join(dir, "profile-snapshots.sqlite"));
  const gateway = new MemoryGateway(
    () => ({
      plugins: { memory: { enabled: true, backend: "mory" } },
      customProviders: [],
      agents: [{ id: "default", shareOwnerMemory: true }]
    }) as never,
    {} as never,
    undefined,
    {
      candidateStore: candidates,
      profileSnapshotStore: profileSnapshots,
      backends: { mory: backend },
      backendDefinitions: [{ key: "mory", name: "mory", description: "test", create: () => backend }],
      importers: []
    }
  );
  try {
    await run(gateway);
  } finally {
    profileSnapshots.close();
    candidates.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

function message(id: string, role: "user" | "assistant", createdAt: string, content: string) {
  return { id, role, content, createdAt } as never;
}

test("a natural statement becomes recallable in a different session without saying 记住", () => withMemory(async (gateway) => {
  const dir = mkdtempSync(join(tmpdir(), "molibot-memory-extraction-state-"));
  const store = new MemoryExtractionStateStore(join(dir, "state.json"));
  const service = new MemoryExtractionService({
    listSessions: () => ({
      items: [{
        conversationId: "session-a",
        source: "local",
        channel: "web",
        botId: "momo",
        agentId: "default",
        ownerExternalUserId: "web:momo:chat-a",
        lastActivityAt: "2026-10-25T09:58:30.000Z",
        updatedAt: "2026-10-25T09:58:30.000Z"
      }],
      total: 1
    }),
    listMessages: () => [
      message("m1", "user", "2026-10-25T09:58:00.000Z", "我养了一只叫豆豆的柯基，特别黏人"),
      message("m2", "assistant", "2026-10-25T09:58:30.000Z", "豆豆听起来很可爱")
    ],
    store,
    writer: new MemoryWriter(gateway),
    extractor: async () => ({
      memories: [{
        domain: "owner",
        type: "user_fact",
        subject: "pet.dog.name",
        value: "养了一只叫豆豆的柯基",
        confidence: 0.92,
        reason: "user stated a durable fact"
      }]
    }),
    now: () => new Date("2026-10-25T10:00:00.000Z")
  });

  const swept = await service.runSweep();
  assert.equal(swept.committed, 1);
  assert.equal(swept.failed, 0);

  // A different session, same owner: the fact is found by name.
  const hits = await gateway.search(
    { channel: "web", externalUserId: "web:momo:chat-b", botId: "momo" },
    { query: "豆豆", mode: "hybrid", limit: 5 }
  );
  assert.ok(hits.some((hit) => hit.content.includes("豆豆")));

  // And it is in the stable profile that every turn injects, even when the
  // query has no lexical overlap with "养了一只叫豆豆的柯基".
  const profile = await gateway.createProfileTurnSnapshot("session-b", {
    channel: "web",
    externalUserId: "web:momo:chat-b",
    ownerId: "owner",
    botId: "momo",
    includeOwner: true,
    includeAgentSelf: true
  });
  assert.ok(profile.effectiveItems.some((item) => item.promptText.includes("豆豆")));

  rmSync(dir, { recursive: true, force: true });
}));

test("a correction reuses the related subject and leaves only the new value active", () => withMemory(async (gateway) => {
  const dir = mkdtempSync(join(tmpdir(), "molibot-memory-correction-"));
  const store = new MemoryExtractionStateStore(join(dir, "state.json"));
  const scopeOf = (chatId: string) => ({
    channel: "web",
    externalUserId: `web:momo:${chatId}`,
    botId: "momo",
    agentId: "default",
    ownerId: "owner"
  });
  const relatedMemories = async (scope: ReturnType<typeof scopeOf>) => {
    const profile = await gateway.buildProfile({
      ...scope,
      ownerId: "owner",
      botId: "momo",
      includeOwner: true,
      includeAgentSelf: true
    });
    return [...profile.stablePreferences, ...profile.profileFacts]
      .filter((row) => Boolean(row.subject))
      .map((row) => ({ subject: String(row.subject), value: row.content }));
  };
  const runSession = async (input: {
    conversationId: string;
    chatId: string;
    messages: ReturnType<typeof message>[];
    extractor: (related: Array<{ subject: string; value: string }>) => MemoryExtractionOutput;
  }) => {
    const service = new MemoryExtractionService({
      listSessions: () => ({
        items: [{
          conversationId: input.conversationId,
          source: "local",
          channel: "web",
          botId: "momo",
          agentId: "default",
          ownerExternalUserId: `web:momo:${input.chatId}`,
          lastActivityAt: "2026-10-25T09:58:30.000Z",
          updatedAt: "2026-10-25T09:58:30.000Z"
        }],
        total: 1
      }),
      listMessages: () => input.messages,
      store,
      writer: new MemoryWriter(gateway),
      relatedMemories: async (scope) => relatedMemories(scope as ReturnType<typeof scopeOf>),
      extractor: async ({ relatedMemories: related }) => input.extractor(related),
      now: () => new Date("2026-10-25T10:00:00.000Z")
    });
    return service.runSweep();
  };

  await runSession({
    conversationId: "session-a",
    chatId: "chat-a",
    messages: [
      message("a1", "user", "2026-10-25T09:58:00.000Z", "我之前开的是宝马"),
      message("a2", "assistant", "2026-10-25T09:58:30.000Z", "知道了")
    ],
    extractor: () => ({
      memories: [{ domain: "owner", type: "user_fact", subject: "user.car", value: "用户之前开宝马" }]
    })
  });

  let seenRelated: Array<{ subject: string; value: string }> = [];
  const second = await runSession({
    conversationId: "session-b",
    chatId: "chat-b",
    messages: [
      message("b1", "user", "2026-10-25T09:58:00.000Z", "我换特斯拉了"),
      message("b2", "assistant", "2026-10-25T09:58:30.000Z", "好的，以后按特斯拉记")
    ],
    extractor: (related) => {
      seenRelated = related;
      return {
        memories: [{
          domain: "owner",
          type: "user_fact",
          subject: "car",
          value: "用户现在开特斯拉",
          supersedesSubject: "user.car"
        }]
      };
    }
  });
  assert.equal(second.committed, 1);
  assert.ok(seenRelated.some((memory) => memory.subject === "user.car" && memory.value.includes("宝马")));

  const tesla = await gateway.search(scopeOf("chat-c"), { query: "特斯拉", mode: "hybrid", limit: 5 });
  assert.equal(tesla.length, 1);
  assert.match(tesla[0].content, /特斯拉/);
  const bmw = await gateway.search(scopeOf("chat-c"), { query: "宝马", mode: "hybrid", limit: 5 });
  assert.equal(bmw.length, 0);

  const versions = await gateway.versions(scopeOf("chat-c"), tesla[0].id);
  assert.ok(versions.some((version) => version.content.includes("宝马")));
  assert.ok(versions.some((version) => version.content.includes("特斯拉")));

  const profile = await gateway.createProfileTurnSnapshot("session-c", {
    channel: "web",
    externalUserId: "web:momo:chat-c",
    ownerId: "owner",
    botId: "momo",
    includeOwner: true,
    includeAgentSelf: true
  });
  const profileText = profile.effectiveItems.map((item) => item.promptText).join("\n");
  assert.match(profileText, /特斯拉/);
  assert.doesNotMatch(profileText, /宝马/);

  rmSync(dir, { recursive: true, force: true });
}));

test("a spouse fact reaches the prompt through the stable profile even without lexical overlap", () => withMemory(async (gateway) => {
  const dir = mkdtempSync(join(tmpdir(), "molibot-memory-c8-"));
  const store = new MemoryExtractionStateStore(join(dir, "state.json"));
  const service = new MemoryExtractionService({
    listSessions: () => ({
      items: [{
        conversationId: "session-c8",
        source: "local",
        channel: "web",
        botId: "momo",
        agentId: "default",
        ownerExternalUserId: "web:momo:chat-c8",
        lastActivityAt: "2026-10-25T09:58:30.000Z",
        updatedAt: "2026-10-25T09:58:30.000Z"
      }],
      total: 1
    }),
    listMessages: () => [
      message("c8-1", "user", "2026-10-25T09:58:00.000Z", "我妻子叫小红，她的生日是 5 月 1 日"),
      message("c8-2", "assistant", "2026-10-25T09:58:30.000Z", "记住了")
    ],
    store,
    writer: new MemoryWriter(gateway),
    extractor: async () => ({
      memories: [{
        domain: "owner",
        type: "user_fact",
        subject: "person.wife",
        value: "妻子叫小红，生日是 5 月 1 日",
        confidence: 0.92
      }]
    }),
    now: () => new Date("2026-10-25T10:00:00.000Z")
  });
  await service.runSweep();

  const scope = { channel: "web", externalUserId: "web:momo:chat-c8-other", botId: "momo" };
  // No shared words: lexical recall alone cannot find this.
  const lexical = await gateway.search(scope, { query: "伴侣的纪念日", mode: "hybrid", limit: 5 });
  assert.equal(lexical.length, 0);

  const profile = await gateway.createProfileTurnSnapshot("session-c8-other", {
    channel: "web",
    externalUserId: "web:momo:chat-c8-other",
    ownerId: "owner",
    botId: "momo",
    includeOwner: true,
    includeAgentSelf: true
  });
  const injected = profile.effectiveItems.map((item) => item.promptText).join("\n");
  assert.match(injected, /小红/);
  assert.match(injected, /5 月 1 日/);
  rmSync(dir, { recursive: true, force: true });
}));

test("forgetting a memory deletes it and suppresses the same fact from extraction", () => withMemory(async (gateway) => {
  const scope = {
    channel: "web",
    externalUserId: "web:momo:chat-forget",
    botId: "momo",
    agentId: "default",
    ownerId: "owner"
  };
  const record = await gateway.add(scope, {
    content: "用户开宝马",
    domain: "owner",
    type: "user_fact",
    subject: "user.car",
    layer: "long_term"
  });
  assert.ok(record);
  assert.equal(await gateway.forget(scope, record.id, { reason: "user_forget" }), true);
  const hits = await gateway.search(scope, { query: "宝马", mode: "hybrid", limit: 5 });
  assert.equal(hits.length, 0);
  assert.equal(gateway.isPrivacySuppressed({
    namespace: "owner:owner",
    domain: "owner",
    type: "user_fact",
    subject: "user.car",
    value: "用户开宝马"
  }), true);

  // A later extraction of the same statement must not recreate it.
  const dir = mkdtempSync(join(tmpdir(), "molibot-memory-forget-extraction-"));
  const service = new MemoryExtractionService({
    listSessions: () => ({
      items: [{
        conversationId: "session-forget",
        source: "local",
        channel: "web",
        botId: "momo",
        agentId: "default",
        ownerExternalUserId: "web:momo:chat-forget",
        lastActivityAt: "2026-10-25T09:58:30.000Z",
        updatedAt: "2026-10-25T09:58:30.000Z"
      }],
      total: 1
    }),
    listMessages: () => [
      message("f1", "user", "2026-10-25T09:58:00.000Z", "我之前开的是宝马"),
      message("f2", "assistant", "2026-10-25T09:58:30.000Z", "知道了")
    ],
    store: new MemoryExtractionStateStore(join(dir, "state.json")),
    writer: new MemoryWriter(gateway),
    extractor: async () => ({
      memories: [{ domain: "owner", type: "user_fact", subject: "user.car", value: "用户开宝马" }]
    }),
    now: () => new Date("2026-10-25T10:00:00.000Z")
  });
  const swept = await service.runSweep();
  assert.equal(swept.skipped, 1);
  assert.equal(swept.committed, 0);
  rmSync(dir, { recursive: true, force: true });
}));

test("a short structured fact survives the gateway write policy", () => withMemory(async (gateway) => {
  const scope = {
    channel: "web",
    externalUserId: "web:momo:chat-short",
    botId: "momo",
    agentId: "default",
    ownerId: "owner"
  };
  const record = await gateway.add(scope, {
    content: "不吃辣",
    domain: "owner",
    type: "user_preference",
    subject: "user.diet",
    layer: "long_term"
  });
  assert.ok(record);
  const hits = await gateway.search(scope, { query: "辣", mode: "hybrid", limit: 5 });
  assert.ok(hits.some((hit) => hit.content === "不吃辣"));
}));

test("previous/current qualifiers in a subject do not leave two active facts", () => withMemory(async (gateway) => {
  const scope = {
    channel: "web",
    externalUserId: "web:momo:chat-car",
    botId: "momo",
    agentId: "default",
    ownerId: "owner"
  };
  await gateway.add(scope, {
    content: "用户之前开宝马",
    domain: "owner",
    type: "user_fact",
    subject: "user.car.previous",
    layer: "long_term"
  });
  const current = await gateway.add(scope, {
    content: "用户现在开特斯拉",
    domain: "owner",
    type: "user_fact",
    subject: "user.car.current",
    layer: "long_term"
  });
  assert.ok(current);
  const bmw = await gateway.search(scope, { query: "宝马", mode: "hybrid", limit: 5 });
  assert.equal(bmw.length, 0);
  const tesla = await gateway.search(scope, { query: "特斯拉", mode: "hybrid", limit: 5 });
  assert.equal(tesla.length, 1);
  const versions = await gateway.versions(scope, tesla[0].id);
  assert.ok(versions.some((version) => version.content.includes("宝马")));
}));

test("a sensitive natural statement stays a proposal and is not recalled", () => withMemory(async (gateway) => {
  const dir = mkdtempSync(join(tmpdir(), "molibot-memory-extraction-sensitive-"));
  const store = new MemoryExtractionStateStore(join(dir, "state.json"));
  const service = new MemoryExtractionService({
    listSessions: () => ({
      items: [{
        conversationId: "session-a",
        source: "local",
        channel: "web",
        botId: "momo",
        agentId: "default",
        ownerExternalUserId: "web:momo:chat-a",
        lastActivityAt: "2026-10-25T09:58:30.000Z",
        updatedAt: "2026-10-25T09:58:30.000Z"
      }],
      total: 1
    }),
    listMessages: () => [
      message("m1", "user", "2026-10-25T09:58:00.000Z", "我最近在吃抗抑郁的药"),
      message("m2", "assistant", "2026-10-25T09:58:30.000Z", "如果愿意可以和我聊聊")
    ],
    store,
    writer: new MemoryWriter(gateway),
    extractor: async () => ({
      memories: [{
        domain: "owner",
        type: "user_fact",
        subject: "health.medication",
        value: "最近在吃抗抑郁的药",
        confidence: 0.9
      }]
    }),
    now: () => new Date("2026-10-25T10:00:00.000Z")
  });

  const swept = await service.runSweep();
  assert.equal(swept.committed, 0);
  assert.equal(swept.proposals, 1);

  const hits = await gateway.search(
    { channel: "web", externalUserId: "web:momo:chat-b", botId: "momo" },
    { query: "抗抑郁", mode: "hybrid", limit: 5 }
  );
  assert.equal(hits.length, 0);
  assert.equal(gateway.listCandidates("pending").length, 1);

  rmSync(dir, { recursive: true, force: true });
}));
