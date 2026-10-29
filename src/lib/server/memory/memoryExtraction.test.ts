import test from "node:test";
import assert from "node:assert/strict";
import { MemoryExtractionService } from "./memoryExtraction.js";
import type { MemoryExtractionSession } from "./memoryExtraction.js";
import type { MemoryExtractionState, MemoryExtractionStatePort } from "./memoryExtractionStore.js";
import type { MemoryWriteResult } from "./memoryWriter.js";

function statePort(initial: Record<string, MemoryExtractionState> = {}): MemoryExtractionStatePort {
  const states = new Map<string, MemoryExtractionState>(Object.entries(initial));
  return {
    get: (id) => states.get(id) ?? null,
    set: (id, state) => { states.set(id, state); },
    delete: (id) => { states.delete(id); }
  };
}

function message(id: string, role: "user" | "assistant", createdAt: string, content = "内容") {
  return { id, role, content, createdAt } as never;
}

function session(overrides: Partial<MemoryExtractionSession> = {}): MemoryExtractionSession {
  return {
    conversationId: "session-1",
    source: "local",
    channel: "web",
    botId: "default",
    agentId: "default",
    ownerExternalUserId: "web:default:chat",
    lastActivityAt: "2026-10-25T09:58:30.000Z",
    updatedAt: "2026-10-25T09:58:30.000Z",
    ...overrides
  };
}

function harness(options: {
  messages: ReturnType<typeof message>[];
  session?: MemoryExtractionSession;
  now?: Date;
  relatedMemories?: (scope: never, messages: Array<{ id: string; role: string; content: string; createdAt: string }>) => Promise<Array<{ subject: string; value: string }>>;
  extract?: (input: {
    messages: Array<{ id: string; role: string; content: string; createdAt: string }>;
    relatedMemories: Array<{ subject: string; value: string }>;
  }) => Promise<unknown>;
} ) {
  const now = options.now ?? new Date("2026-10-25T10:00:00.000Z");
  const calls: Array<{
    messages: Array<{ id: string; role: string; content: string; createdAt: string }>;
    relatedMemories: Array<{ subject: string; value: string }>;
  }> = [];
  const writes: Array<{ items: unknown[]; runKey: string }> = [];
  const store = statePort();
  const writeResult: MemoryWriteResult = { committed: ["memory-1"], proposals: [], skipped: 0, failures: [] };
  const service = new MemoryExtractionService({
    listSessions: () => ({ items: [options.session ?? session()], total: 1 }),
    listMessages: () => options.messages as never,
    store,
    writer: {
      write: async (_scope, items, _sources, runKey) => {
        writes.push({ items, runKey });
        return writeResult;
      }
    },
    relatedMemories: options.relatedMemories as never,
    extractor: async (input) => {
      calls.push({ messages: input.messages, relatedMemories: input.relatedMemories });
      if (options.extract) return options.extract(input) as never;
      return {
        memories: [{
          domain: "owner",
          type: "user_fact",
          subject: "pet.dog",
          value: "养了一只叫豆豆的柯基",
          confidence: 0.9
        }]
      };
    },
    now: () => now
  });
  return { service, calls, writes, store };
}

test("an idle completed exchange is extracted once and the watermark advances", async () => {
  const h = harness({
    messages: [
      message("m1", "user", "2026-10-25T09:58:00.000Z", "我养了一只叫豆豆的柯基"),
      message("m2", "assistant", "2026-10-25T09:58:30.000Z", "豆豆这个名字很可爱")
    ]
  });

  const first = await h.service.runSweep();
  assert.equal(first.attempted, 1);
  assert.equal(first.committed, 1);
  assert.equal(h.calls.length, 1);
  assert.equal(h.store.get("session-1")?.processedThroughId, "m2");

  const second = await h.service.runSweep();
  assert.equal(second.attempted, 0);
  assert.equal(h.calls.length, 1);
});

test("only messages after the watermark are sent to the extractor", async () => {
  const messages = [
    message("m1", "user", "2026-10-25T09:58:00.000Z", "我养了一只叫豆豆的柯基"),
    message("m2", "assistant", "2026-10-25T09:58:30.000Z", "记住了")
  ];
  const h = harness({ messages });
  await h.service.runSweep();

  messages.push(message("m3", "user", "2026-10-25T09:59:00.000Z", "它今年两岁了"));
  messages.push(message("m4", "assistant", "2026-10-25T09:59:30.000Z", "两岁正是活泼的年纪"));
  const second = await h.service.runSweep();

  assert.equal(second.attempted, 1);
  assert.deepEqual(h.calls[1].messages.map((item) => item.id), ["m3", "m4"]);
});

test("a session whose last message is from the user is not extracted mid-turn", async () => {
  const h = harness({
    messages: [
      message("m1", "user", "2026-10-25T09:58:00.000Z", "我养了一只叫豆豆的柯基")
    ]
  });

  const result = await h.service.runSweep();
  assert.equal(result.attempted, 0);
  assert.equal(h.calls.length, 0);
});

test("a session that is not idle yet waits for the next sweep", async () => {
  const h = harness({
    session: session({ lastActivityAt: "2026-10-25T09:59:40.000Z", updatedAt: "2026-10-25T09:59:40.000Z" }),
    messages: [
      message("m1", "user", "2026-10-25T09:59:30.000Z", "我养了一只叫豆豆的柯基"),
      message("m2", "assistant", "2026-10-25T09:59:40.000Z", "记住了")
    ]
  });

  const result = await h.service.runSweep();
  assert.equal(result.attempted, 0);
  assert.equal(h.calls.length, 0);
});

test("a long continuous session is extracted without waiting for idle", async () => {
  const h = harness({
    session: session({
      lastActivityAt: "2026-10-25T09:59:55.000Z",
      updatedAt: "2026-10-25T09:59:55.000Z",
      userTurnCount: 10,
      assistantTurnCount: 10
    }),
    messages: [
      message("m1", "user", "2026-10-25T09:58:00.000Z", "我养了一只叫豆豆的柯基"),
      message("m2", "assistant", "2026-10-25T09:58:30.000Z", "记住了")
    ]
  });

  const first = await h.service.runSweep();
  assert.equal(first.attempted, 1);

  // Within ten minutes of the last extraction, even a long session waits.
  h.store.set("session-1", {
    processedThroughId: "",
    revision: "",
    updatedAt: "2026-10-25T09:55:00.000Z",
    attempts: 0
  });
  const second = await h.service.runSweep();
  assert.equal(second.attempted, 0);
});

test("a correction reuses the related subject even when the extractor proposes a new one", async () => {
  const h = harness({
    messages: [
      message("m1", "user", "2026-10-25T09:58:00.000Z", "我换特斯拉了"),
      message("m2", "assistant", "2026-10-25T09:58:30.000Z", "好的")
    ],
    relatedMemories: async () => [{ subject: "user.car", value: "用户开宝马" }],
    extract: async () => ({
      memories: [{
        domain: "owner",
        type: "user_fact",
        subject: "car",
        value: "用户现在开特斯拉",
        supersedesSubject: "user.car"
      }]
    })
  });

  const result = await h.service.runSweep();
  assert.equal(result.committed, 1);
  assert.deepEqual(h.calls[0].relatedMemories, [{ subject: "user.car", value: "用户开宝马" }]);
  assert.equal((h.writes[0].items[0] as { subject: string }).subject, "user.car");
});

test("a hallucinated supersedesSubject cannot overwrite an unrelated fact", async () => {
  const h = harness({
    messages: [
      message("m1", "user", "2026-10-25T09:58:00.000Z", "我换特斯拉了"),
      message("m2", "assistant", "2026-10-25T09:58:30.000Z", "好的")
    ],
    relatedMemories: async () => [{ subject: "user.car", value: "用户开宝马" }],
    extract: async () => ({
      memories: [{
        domain: "owner",
        type: "user_fact",
        subject: "car",
        value: "用户现在开特斯拉",
        supersedesSubject: "user.salary"
      }]
    })
  });

  await h.service.runSweep();
  assert.equal((h.writes[0].items[0] as { subject: string }).subject, "car");
});

test("a failed extraction backs off and keeps the watermark", async () => {
  const h = harness({
    messages: [
      message("m1", "user", "2026-10-25T09:58:00.000Z", "我养了一只叫豆豆的柯基"),
      message("m2", "assistant", "2026-10-25T09:58:30.000Z", "记住了")
    ],
    extract: async () => { throw new Error("model unavailable"); }
  });

  const first = await h.service.runSweep();
  assert.equal(first.failed, 1);
  const state = h.store.get("session-1");
  assert.equal(state?.processedThroughId, "");
  assert.equal(state?.attempts, 1);
  assert.ok(state?.retryAfter);

  const second = await h.service.runSweep();
  assert.equal(second.attempted, 0);
  assert.equal(h.calls.length, 1);
});

test("malformed model output is a failure, not proof that nothing was worth keeping", async () => {
  const h = harness({
    messages: [
      message("m1", "user", "2026-10-25T09:58:00.000Z", "我养了一只叫豆豆的柯基"),
      message("m2", "assistant", "2026-10-25T09:58:30.000Z", "记住了")
    ],
    extract: async () => ({ memories: [{ domain: "not-a-domain", type: "user_fact", subject: "x", value: "y" }] })
  });

  const result = await h.service.runSweep();
  assert.equal(result.failed, 1);
  assert.equal(h.writes.length, 0);
  assert.match(h.store.get("session-1")?.lastError ?? "", /malformed/);
});

test("no useful information advances the watermark without writing", async () => {
  const h = harness({
    messages: [
      message("m1", "user", "2026-10-25T09:58:00.000Z", "今天天气不错"),
      message("m2", "assistant", "2026-10-25T09:58:30.000Z", "是呀")
    ],
    extract: async () => ({ noUsefulInformation: true })
  });

  const result = await h.service.runSweep();
  assert.equal(result.failed, 0);
  assert.equal(h.writes.length, 0);
  assert.equal(h.store.get("session-1")?.processedThroughId, "m2");
});
