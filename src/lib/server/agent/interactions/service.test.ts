import { buildFeishuInteractionCard } from "$lib/server/channels/feishu/interaction.js";
import { buildTelegramInteractionKeyboard, formatTelegramInteractionView } from "$lib/server/channels/telegram/interaction.js";
import { TELEGRAM_MENU_COMMANDS } from "$lib/server/channels/telegram/commands.js";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SharedInteractionService } from "$lib/server/agent/interactions/service.js";
import { SqliteInteractionPromptStore, type InteractionPromptStore } from "$lib/server/agent/interactions/promptStore.js";
import type { InteractionContext, InteractionStateBinding } from "$lib/server/agent/interactions/types.js";

function fixture(options: { promptStore?: InteractionPromptStore; ttlMs?: number } = {}) {
  let binding: InteractionStateBinding = { sessionId: "session-1", projectId: null, runId: "run-1" };
  let selected = 0;
  const commands = {
    interactionText: (english: string, _chinese: string) => english,
    getInteractionState: () => ({ ...binding }),
    getInteractionModels: () => ({
      route: "text" as const,
      activeKey: selected ? "model-b" : "model-a",
      source: "global" as const,
      agentId: "",
      canReset: false,
      items: [
        { key: "model-a", label: "Model A", selected: selected === 0 },
        { key: "model-b", label: "Model B", selected: selected > 0 }
      ]
    }),
    selectInteractionModel: () => {
      selected += 1;
      return { ok: true, message: "switched" };
    },
    resetInteractionModel: () => ({ ok: true, message: "reset" }),
    getInteractionSessions: () => ({
      mode: "chat" as const,
      projectId: null,
      projectName: null,
      activeId: binding.sessionId,
      items: [
        { id: binding.sessionId, title: binding.sessionId, selected: true, deletable: true },
        { id: "session-2", title: "session-2", selected: false, deletable: true }
      ]
    }),
    createInteractionSession: async () => ({ ok: true, message: "created" }),
    switchInteractionSession: async () => ({ ok: true, message: "switched" }),
    deleteInteractionSession: async () => ({ ok: true, message: "deleted" }),
    getInteractionProjects: () => ({ active: null, items: [] }),
    selectInteractionProject: () => ({ ok: true, message: "project" }),
    getInteractionThinking: () => ({
      sessionId: binding.sessionId,
      override: null,
      requested: "medium",
      effective: "medium",
      supported: ["off", "low", "medium", "high"]
    }),
    selectInteractionThinking: () => ({ ok: true, message: "thinking" }),
    getInteractionSkills: () => [{
      name: "web-search",
      description: "Search the web",
      scope: "global",
      aliases: ["web-search"]
    }],
    getInteractionQueue: async () => [],
    cancelInteractionQueueItem: async () => ({ ok: true, message: "cancelled" }),
    retryInteractionQueueItem: async () => ({ ok: true, message: "retried" }),
    clearInteractionQueue: async () => ({ ok: true, message: "cleared" }),
    enqueueInteractionFront: async () => ({ ok: true, message: "front" }),
    getInteractionStatus: () => ({
      sessionId: binding.sessionId,
      projectId: null,
      projectName: null,
      modelKey: selected ? "model-b" : "model-a",
      thinkingEffective: "medium",
      queueSize: 0,
      running: Boolean(binding.runId),
      runId: binding.runId,
      contextTokens: 1200,
      contextWindow: 200000,
      compactionThreshold: 150000,
      compactRecommended: false
    }),
    compactInteractionSession: async () => ({ ok: true, message: "compacted" }),
    stopCurrentInteractionRun: () => ({ ok: true, message: "stopped current" }),
    stopInteractionRun: async () => ({ ok: true, message: "stopped" }),
    steerInteractionRun: () => ({ ok: true, message: "steered" }),
    followUpInteractionRun: () => ({ ok: true, message: "followed" }),
    handleQueuedControlAction: async () => ({ status: "steered" as const, message: "queued control" })
  } as any;

  const service = new SharedInteractionService<string>({
    channel: "telegram",
    instanceId: "bot-1",
    commands,
    ttlMs: options.ttlMs ?? 60_000,
    promptStore: options.promptStore
  });
  const context: InteractionContext<string> = {
    chatId: "chat-1",
    scopeId: "chat-1",
    actorId: "user-1",
    target: "chat-1"
  };
  return {
    service,
    commands,
    context,
    get selected() { return selected; },
    setBinding(next: InteractionStateBinding) { binding = next; }
  };
}

function buttonToken(view: any, label: string): string {
  const buttons = [
    ...(view.actions ?? []),
    ...(view.sections ?? []).flatMap((section: any) => [
      ...(section.actions ?? []),
      ...(section.rows ?? []).flatMap((row: any) => row.actions ?? [])
    ])
  ];
  const button = buttons.find((item: any) => item.label.startsWith(label));
  assert.ok(button?.token, `missing token for ${label}`);
  return button.token;
}

test("interaction tokens bind actor/chat/scope and reject stale state", async () => {
  const fx = fixture();
  const view = await fx.service.open("models", fx.context);
  const token = buttonToken(view, "Select");

  const wrongActor = await fx.service.handleToken(token, {
    actorId: "user-2",
    chatId: "chat-1",
    scopeId: "chat-1",
    target: "chat-1"
  });
  assert.equal(wrongActor.kind, "notice");
  assert.equal(fx.selected, 0);

  fx.setBinding({ sessionId: "session-2", projectId: null, runId: "run-1" });
  const stale = await fx.service.handleToken(token, {
    actorId: "user-1",
    chatId: "chat-1",
    scopeId: "chat-1",
    target: "chat-1"
  });
  assert.equal(stale.kind, "view");
  assert.equal(stale.kind === "view" ? stale.view.surface : "", "result");
  assert.equal(fx.selected, 0);
});

test("one-shot interaction actions deduplicate concurrent delivery", async () => {
  const fx = fixture();
  const view = await fx.service.open("models", fx.context);
  const token = buttonToken(view, "Select");
  const [a, b] = await Promise.all([
    fx.service.handleToken(token, { actorId: "user-1", chatId: "chat-1", scopeId: "chat-1", target: "chat-1" }),
    fx.service.handleToken(token, { actorId: "user-1", chatId: "chat-1", scopeId: "chat-1", target: "chat-1" })
  ]);
  assert.equal(a.kind, "notice");
  assert.equal(b.kind, "notice");
  assert.equal(fx.selected, 1);
});

test("service restart invalidates old callback tokens", async () => {
  const fx = fixture();
  const view = await fx.service.open("models", fx.context);
  const token = buttonToken(view, "Select");
  const freshService = new SharedInteractionService<string>({
    channel: "telegram",
    instanceId: "bot-1",
    commands: (fx as any).commands ?? ({
      interactionText: (en: string) => en
    } as any)
  });
  const result = await freshService.handleToken(token, {
    actorId: "user-1",
    chatId: "chat-1",
    scopeId: "chat-1",
    target: "chat-1"
  });
  assert.equal(result.kind, "notice");
});

test("reply-bound input ignores ordinary messages and expires when run changes", async () => {
  const fx = fixture();
  const view = await fx.service.open("status", fx.context);
  const steer = buttonToken(view, "Steer");
  const outcome = await fx.service.handleToken(steer, {
    actorId: "user-1",
    chatId: "chat-1",
    scopeId: "chat-1",
    target: "chat-1"
  });
  assert.equal(outcome.kind, "input");
  assert.ok(outcome.kind === "input");
  fx.service.bindInputPrompt(outcome.input.requestId, "prompt-1");

  const ordinary = await fx.service.consumeInputReply(fx.context, "other-message", "change direction");
  assert.equal(ordinary.handled, false);

  fx.setBinding({ sessionId: "session-1", projectId: null, runId: "run-2" });
  const stale = await fx.service.consumeInputReply(fx.context, "prompt-1", "change direction");
  assert.equal(stale.handled, true);
  assert.match(stale.message ?? "", /changed|expired/i);
});

test("skill input becomes a normal explicit-skill agent message only after exact reply", async () => {
  const fx = fixture();
  const list = await fx.service.open("skills", fx.context);
  const detailsToken = buttonToken(list, "Details");
  const details = await fx.service.handleToken(detailsToken, {
    actorId: "user-1",
    chatId: "chat-1",
    scopeId: "chat-1",
    target: "chat-1"
  });
  assert.equal(details.kind, "view");
  assert.ok(details.kind === "view");
  const useToken = buttonToken(details.view, "Use this skill");
  const input = await fx.service.handleToken(useToken, {
    actorId: "user-1",
    chatId: "chat-1",
    scopeId: "chat-1",
    target: "chat-1"
  });
  assert.equal(input.kind, "input");
  assert.ok(input.kind === "input");
  fx.service.bindInputPrompt(input.input.requestId, 42);

  const result = await fx.service.consumeInputReply(fx.context, 42, "find current release notes");
  assert.equal(result.handled, true);
  assert.equal(result.agentText, "/web-search find current release notes");

  const duplicate = await fx.service.consumeInputReply(fx.context, 42, "find current release notes");
  assert.equal(duplicate.handled, true);
  assert.equal(duplicate.agentText, undefined);
  assert.match(duplicate.message ?? "", /already submitted/i);
});

async function openBoundInput(service: SharedInteractionService<string>, context: InteractionContext<string>, messageId: string) {
  const view = await service.open("queue", context);
  const front = buttonToken(view, "Add to front");
  const outcome = await service.handleToken(front, {
    actorId: context.actorId,
    chatId: context.chatId,
    scopeId: context.scopeId,
    target: context.target
  });
  assert.equal(outcome.kind, "input");
  if (outcome.kind !== "input") throw new Error("expected an input prompt");
  service.bindInputPrompt(outcome.input.requestId, messageId);
  return outcome.input;
}

test("a reply to a cancelled input prompt is rejected instead of falling through", async () => {
  const fx = fixture();
  const prompt = await openBoundInput(fx.service, fx.context, "prompt-cancel");

  await fx.service.handleToken(prompt.cancelToken, {
    actorId: "user-1",
    chatId: "chat-1",
    scopeId: "chat-1",
    target: "chat-1"
  });

  const first = await fx.service.consumeInputReply(fx.context, "prompt-cancel", "run this task");
  assert.equal(first.handled, true);
  assert.equal(first.terminal, true);
  assert.equal(first.agentText, undefined);
  assert.match(first.message ?? "", /cancelled/i);

  const second = await fx.service.consumeInputReply(fx.context, "prompt-cancel", "run this task again");
  assert.equal(second.handled, true);
  assert.equal(second.agentText, undefined);
});

test("an expired input prompt keeps rejecting late replies", async () => {
  const fx = fixture({ ttlMs: 50 });
  await openBoundInput(fx.service, fx.context, "prompt-expired");
  await new Promise((resolve) => setTimeout(resolve, 70));

  const first = await fx.service.consumeInputReply(fx.context, "prompt-expired", "late task");
  assert.equal(first.handled, true);
  assert.equal(first.terminal, true);
  assert.equal(first.agentText, undefined);

  const second = await fx.service.consumeInputReply(fx.context, "prompt-expired", "late task again");
  assert.equal(second.handled, true);
  assert.equal(second.agentText, undefined);
});

test("a completed input stays a tombstone for repeated platform deliveries", async () => {
  const fx = fixture();
  await openBoundInput(fx.service, fx.context, "prompt-done");
  const first = await fx.service.consumeInputReply(fx.context, "prompt-done", "queued work");
  assert.equal(first.handled, true);
  assert.equal(first.agentText, undefined);
  assert.equal(first.terminal, true);

  const second = await fx.service.consumeInputReply(fx.context, "prompt-done", "queued work");
  assert.equal(second.handled, true);
  assert.equal(second.agentText, undefined);

  const third = await fx.service.consumeInputReply(fx.context, "prompt-done", "queued work");
  assert.equal(third.handled, true);
  assert.equal(third.agentText, undefined);
});

test("a reply to a prompt from a previous process is rejected after restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "molibot-interaction-store-"));
  const dbFile = join(dir, "interaction-prompts.sqlite");
  const firstStore = new SqliteInteractionPromptStore({ channel: "telegram", instanceId: "bot-1", dbFile });
  try {
    const first = fixture({ promptStore: firstStore });
    await openBoundInput(first.service, first.context, "prompt-restart");

    const reopened = new SqliteInteractionPromptStore({ channel: "telegram", instanceId: "bot-1", dbFile });
    const restarted = new SharedInteractionService<string>({
      channel: "telegram",
      instanceId: "bot-1",
      commands: first.commands as any,
      promptStore: reopened,
      ttlMs: 60_000
    });
    const reply = await restarted.consumeInputReply(first.context, "prompt-restart", "run after restart");
    assert.equal(reply.handled, true);
    assert.equal(reply.terminal, true);
    assert.equal(reply.agentText, undefined);
    reopened.close();
  } finally {
    firstStore.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an unbounded reply to a prompt still leaves ordinary messages normal", async () => {
  const fx = fixture();
  const ordinary = await fx.service.consumeInputReply(fx.context, "not-a-prompt", "hello there");
  assert.equal(ordinary.handled, false);
});

test("clear pending confirms the exact set and fails stale when it moved", async () => {
  const fx = fixture();
  (fx.commands as any).getInteractionQueue = async () => [
    { id: 5, status: "pending", preview: "confirmed", createdAt: "" },
    { id: 6, status: "pending", preview: "confirmed", createdAt: "" }
  ];
  const view = await fx.service.open("queue", fx.context);
  const clearToken = buttonToken(view, "Clear pending");
  const confirm = await fx.service.handleToken(clearToken, {
    actorId: "user-1",
    chatId: "chat-1",
    scopeId: "chat-1",
    target: "chat-1"
  });
  assert.equal(confirm.kind, "view");
  if (confirm.kind !== "view") return;

  let confirmedIds: number[] = [];
  (fx.commands as any).clearInteractionQueue = async (_context: unknown, ids: number[]) => {
    confirmedIds = [...ids].sort((a, b) => a - b);
    return { ok: false, stale: true, message: "The pending queue changed." };
  };

  const confirmToken = buttonToken(confirm.view, "Clear");
  const outcome = await fx.service.handleToken(confirmToken, {
    actorId: "user-1",
    chatId: "chat-1",
    scopeId: "chat-1",
    target: "chat-1"
  });
  assert.deepEqual(confirmedIds, [5, 6]);
  assert.equal(outcome.kind, "view");
  assert.equal(outcome.kind === "view" ? outcome.view.surface : "", "result");
});


test("stop confirmation offers continue queue and binds it to the current run", async () => {
  const fx = fixture();
  fx.commands.getInteractionQueue = async () => [{ id: 5, status: "pending", preview: "later", createdAt: "" }];
  let currentStops = 0;
  let clears = 0;
  fx.commands.stopCurrentInteractionRun = (_context: unknown, runId: string) => {
    assert.equal(runId, "run-1"); currentStops++;
    return { ok: true, message: "continued" };
  };
  fx.commands.stopInteractionRun = async () => { clears++; return { ok: true, message: "cleared" }; };
  const view = fx.service.queuedControlView(fx.context, 5);
  const confirmation = await fx.service.handleToken(buttonToken(view, "Stop"), fx.context);
  assert.equal(confirmation.kind, "view");
  if (confirmation.kind !== "view") return;
  buttonToken(confirmation.view, "Stop and clear");
  const token = buttonToken(confirmation.view, "Stop and continue queue");
  await fx.service.handleToken(token, fx.context);
  await fx.service.handleToken(token, fx.context);
  assert.equal(currentStops, 1);
  assert.equal(clears, 0);
  const another = await fx.service.handleToken(buttonToken(fx.service.queuedControlView(fx.context, 5), "Stop"), fx.context);
  assert.equal(another.kind, "view");
  if (another.kind !== "view") return;
  const staleToken = buttonToken(another.view, "Stop and continue queue");
  fx.setBinding({ sessionId: "session-1", projectId: null, runId: "replacement-run" });
  await fx.service.handleToken(staleToken, fx.context);
  assert.equal(currentStops, 1);
});


test("stop queue choices have Chinese labels and explicit destructive action", async () => {
  const fx = fixture();
  fx.commands.interactionText = (_english: string, chinese: string) => chinese;
  fx.commands.getInteractionQueue = async () => [{ id: 5, status: "pending", preview: "later", createdAt: "" }];
  const queued = fx.service.queuedControlView(fx.context, 5);
  const result = await fx.service.handleToken(buttonToken(queued, "停止"), fx.context);
  assert.equal(result.kind, "view");
  if (result.kind !== "view") return;
  assert.match(result.view.body ?? "", /1 个待执行任务/);
  buttonToken(result.view, "停止并继续队列");
  buttonToken(result.view, "停止并清空");
});


for (const chinese of [false, true]) {
  test(`new session shows compact actions and only loads history on demand (${chinese ? "zh" : "en"})`, async () => {
    const fx = fixture();
    fx.commands.interactionText = (en: string, zh: string) => chinese ? zh : en;
    let historyReads = 0;
    const sessions = fx.commands.getInteractionSessions;
    fx.commands.getInteractionSessions = () => { historyReads++; return sessions(); };
    fx.commands.createInteractionSession = async () => {
      fx.setBinding({ sessionId: "new-session", projectId: null, runId: null });
      return { ok: true, message: "created" };
    };
    const menu = await fx.service.open("menu", fx.context);
    const result = await fx.service.handleToken(buttonToken(menu, chinese ? "新建会话" : "New session"), fx.context);
    assert.equal(result.kind, "notice");
    if (result.kind !== "notice" || !result.view) return;
    assert.equal(historyReads, 0);
    assert.equal(result.view.actions?.length, 4);
    assert.equal(result.view.sections, undefined);
    const feishu = buildFeishuInteractionCard(result.view);
    const telegram = buildTelegramInteractionKeyboard(result.view);
    assert.equal(telegram.inline_keyboard.flat().length, 4);
    assert.doesNotMatch(JSON.stringify(feishu), /session-2/);
    assert.doesNotMatch(formatTelegramInteractionView(result.view), /session-2/);
    const history = await fx.service.handleToken(buttonToken(result.view, chinese ? "历史会话" : "Sessions"), fx.context);
    assert.equal(history.kind, "view");
    assert.equal(historyReads, 1);
    if (history.kind === "view") assert.equal(history.view.sections?.[0]?.rows?.length, 2);
  });

  test(`running menu renders both stop buttons on Feishu and Telegram (${chinese ? "zh" : "en"})`, async () => {
    const fx = fixture();
    fx.commands.interactionText = (en: string, zh: string) => chinese ? zh : en;
    let currentStops = 0;
    fx.commands.stopCurrentInteractionRun = (_context: unknown, runId: string) => {
      assert.equal(runId, "run-1"); currentStops++;
      return { ok: true, message: "continued" };
    };
    for (const surface of ["menu", "status"] as const) {
      const view = await fx.service.open(surface, fx.context);
      const label = chinese ? "停止并继续队列" : "Stop and continue queue";
      const token = buttonToken(view, label);
      buttonToken(view, chinese ? "停止并清空" : "Stop and clear");
      assert.ok(JSON.stringify(buildFeishuInteractionCard(view)).includes(label));
      assert.ok(buildTelegramInteractionKeyboard(view).inline_keyboard.flat().some((button) => button.text === label));
      await fx.service.handleToken(token, fx.context);
    }
    assert.equal(currentStops, 2);
    fx.setBinding({ sessionId: "session-1", projectId: null, runId: null });
    const idle = await fx.service.open("menu", fx.context);
    assert.doesNotMatch(JSON.stringify(buildTelegramInteractionKeyboard(idle)), /Stop and|停止并/);
  });
}

test("Telegram native command menu describes stop's queue-clearing behavior", () => {
  const stop = TELEGRAM_MENU_COMMANDS.find((entry) => entry.command === "stop");
  assert.match(stop?.en ?? "", /clear queued/);
  assert.match(stop?.zh ?? "", /清空队列/);
});
