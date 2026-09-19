import test from "node:test";
import assert from "node:assert/strict";
import { SharedInteractionService } from "$lib/server/agent/interactions/service.js";
import type { InteractionContext, InteractionStateBinding } from "$lib/server/agent/interactions/types.js";

function fixture() {
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
      runId: binding.runId
    }),
    stopInteractionRun: async () => ({ ok: true, message: "stopped" }),
    steerInteractionRun: () => ({ ok: true, message: "steered" }),
    followUpInteractionRun: () => ({ ok: true, message: "followed" }),
    handleQueuedControlAction: async () => ({ status: "steered" as const, message: "queued control" })
  } as any;

  const service = new SharedInteractionService<string>({
    channel: "telegram",
    instanceId: "bot-1",
    commands,
    ttlMs: 60_000
  });
  const context: InteractionContext<string> = {
    chatId: "chat-1",
    scopeId: "chat-1",
    actorId: "user-1",
    target: "chat-1"
  };
  return {
    service,
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
