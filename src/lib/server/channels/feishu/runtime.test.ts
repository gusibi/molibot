import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  FeishuCardActionCoordinator,
  normalizeFeishuWsCardActionEvent
} from "$lib/server/channels/feishu/cardAction.js";
import { FeishuManager, resolveFeishuUploadFilename } from "$lib/server/channels/feishu/runtime.js";
import { SessionStore } from "$lib/server/sessions/store.js";

function createHookManagerMock() {
  return {
    register: () => {},
    unregister: () => false,
    list: () => [],
    registerPlugin: async () => {},
    unregisterPlugin: async () => false,
    emit: () => {},
    flush: async () => {},
    transform: async (_stage: unknown, _context: unknown, payload: unknown) => payload,
    gate: async () => ({ type: "allow" })
  } as any;
}

function createFeishuManagerTestHarness(
  memoryReview: any = { decide: async () => ({ status: "stale" }) },
  connectClient = true
) {
  const workspaceDir = mkdtempSync(join(tmpdir(), "molibot-feishu-runtime-test-"));
  const replyCalls: any[] = [];
  const createCalls: any[] = [];
  const patchCalls: any[] = [];

  const client = {
    cardkit: {
      v1: {
        card: {
          create: async () => ({ code: 0, msg: "ok", data: { card_id: "card_1" } }),
          update: async () => ({ code: 0, msg: "ok", data: {} }),
          settings: async () => ({ code: 0, msg: "ok", data: {} })
        },
        cardElement: {
          content: async () => ({ code: 0, msg: "ok", data: {} })
        }
      }
    },
    im: {
      message: {
        reply: async (payload: any) => {
          replyCalls.push(payload);
          return { data: { message_id: `om_reply_${replyCalls.length}` } };
        },
        create: async (payload: any) => {
          createCalls.push(payload);
          return { data: { message_id: `om_create_${createCalls.length}` } };
        },
        update: async () => ({ data: { message_id: "om_updated" } }),
        patch: async (payload: any) => {
          patchCalls.push(payload);
          return { data: { message_id: "om_updated" } };
        }
      },
      chat: { get: async () => ({ code: 0, data: { chat_type: "p2p" } }) }
    }
  };

  const manager = new FeishuManager(
    () => ({
      channels: {
        feishu: {
          instances: [{
            id: "test-bot",
            credentials: { streamOutput: "true" },
            display: { toolProgress: "all", showReasoning: "off", gatewayNotifyInterval: 0 }
          }]
        }
      },
      display: { toolProgress: "all", showReasoning: "off", gatewayNotifyInterval: 0 }
    }) as any,
    undefined,
    new SessionStore(),
    {
      workspaceDir,
      instanceId: "test-bot",
      queueDbFile: join(workspaceDir, "inbound-queue.sqlite"),
      outboxDbFile: join(workspaceDir, "outbox.sqlite"),
      memory: {} as any,
      memoryReview,
      usageTracker: {} as any,
      modelErrorTracker: {} as any,
      hookManager: createHookManagerMock()
    }
  );

  if (connectClient) (manager as any).client = client;
  return { manager, replyCalls, createCalls, patchCalls, client };
}

test("feishu reminder delivery fails closed while the client is offline", async () => {
  const { manager } = createFeishuManagerTestHarness(undefined, false);
  await assert.rejects(
    () => manager.triggerTask({
      type: "one-shot",
      chatId: "chat-1",
      text: "Offline reminder",
      delivery: "text"
    }, "offline-reminder.json"),
    /Feishu bot is not running/
  );
});

test("normalizeFeishuWsCardActionEvent converts card.action.trigger payloads", () => {
  const normalized = normalizeFeishuWsCardActionEvent({
    context: {
      open_chat_id: "oc_chat",
      open_message_id: "om_message"
    },
    operator: {
      open_id: "ou_user",
      user_id: "user_1"
    },
    tenant_key: "tenant_1",
    token: "token_1",
    action: {
      tag: "button",
      value: {
        kind: "host_bash_approval",
        action: "approve",
        botId: "feishu-default",
        chatId: "oc_chat",
        requestId: "hta_1"
      }
    }
  });

  assert.deepEqual(normalized, {
    chatId: "oc_chat",
    messageId: "om_message",
    event: {
      open_id: "ou_user",
      user_id: "user_1",
      tenant_key: "tenant_1",
      open_message_id: "om_message",
      token: "token_1",
      action: {
        value: {
          kind: "host_bash_approval",
          action: "approve",
          botId: "feishu-default",
          chatId: "oc_chat",
          requestId: "hta_1"
        },
        tag: "button",
        option: undefined,
        timezone: undefined
      }
    }
  });
});

test("normalizeFeishuWsCardActionEvent rejects payloads without chat, message, or operator ids", () => {
  assert.equal(normalizeFeishuWsCardActionEvent({}), null);
  assert.equal(normalizeFeishuWsCardActionEvent({
    context: { open_chat_id: "oc_chat", open_message_id: "om_message" },
    action: { value: {} }
  }), null);
});

test("normalizeFeishuWsCardActionEvent accepts stringified action values", () => {
  const normalized = normalizeFeishuWsCardActionEvent({
    context: {
      open_chat_id: "oc_chat",
      open_message_id: "om_message"
    },
    operator: {
      open_id: "ou_user"
    },
    action: {
      value: JSON.stringify({
        kind: "host_bash_approval",
        action: "reject",
        botId: "feishu-default",
        chatId: "oc_chat",
        requestId: "hta_2"
      })
    }
  });

  assert.equal(normalized?.event.action.value.kind, "host_bash_approval");
  assert.equal(normalized?.event.action.value.action, "reject");
  assert.equal(normalized?.event.action.value.requestId, "hta_2");
});

test("FeishuCardActionCoordinator resolves concurrent duplicate callbacks once", async () => {
  const coordinator = new FeishuCardActionCoordinator<{ status: string }>();
  let calls = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const action = async () => {
    calls += 1;
    await gate;
    return { status: "approved" };
  };

  const first = coordinator.run("hta_1", action);
  const duplicate = coordinator.run("hta_1", action);
  release?.();

  assert.deepEqual(await first, { status: "approved" });
  assert.deepEqual(await duplicate, { status: "approved" });
  assert.equal(calls, 1);
});

test("FeishuCardActionCoordinator exposes in-flight and completed states", async () => {
  const coordinator = new FeishuCardActionCoordinator<{ status: string }>();
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const inFlight = coordinator.start("hta_1", async () => {
    await gate;
    return { status: "approved" };
  });
  assert.equal(inFlight.status, "in_flight");

  release?.();
  if (inFlight.status === "in_flight") await inFlight.promise;

  const completed = coordinator.start("hta_1", async () => ({ status: "rejected" }));
  assert.deepEqual(completed, {
    status: "completed",
    value: { status: "approved" }
  });
});

test("FeishuCardActionCoordinator returns the completed terminal result for later clicks", async () => {
  const coordinator = new FeishuCardActionCoordinator<{ status: string }>();
  let calls = 0;

  const first = await coordinator.run("hta_1", async () => {
    calls += 1;
    return { status: "approved" };
  });
  const duplicate = await coordinator.run("hta_1", async () => {
    calls += 1;
    return { status: "rejected" };
  });

  assert.deepEqual(first, { status: "approved" });
  assert.deepEqual(duplicate, { status: "approved" });
  assert.equal(calls, 1);
});

test("Feishu run archive notice stays in the originating topic", async () => {
  const { manager, replyCalls, createCalls } = createFeishuManagerTestHarness();

  await (manager as any).sendRunArchiveNotice({
    chatId: "oc_chat",
    scopeId: "oc_chat__thread_omt_thread",
    chatType: "group",
    messageId: 1,
    platformMessageId: "om_user",
    platformThreadId: "omt_thread",
    userId: "ou_user",
    userName: "User",
    text: "question",
    ts: "2026-06-16.000",
    attachments: [],
    imageContents: []
  }, "run_1");

  const archiveReply = replyCalls.find((call) => (
    call.data?.msg_type === "post" &&
    String(call.data?.content ?? "").includes("/runlog run_1")
  ));

  assert.equal(createCalls.length, 0);
  assert.ok(archiveReply, "expected archive notice to use Feishu reply API");
  assert.deepEqual(archiveReply.path, { message_id: "om_user" });
  assert.equal(archiveReply.data.reply_in_thread, true);
});

test("Feishu interaction input cards are registered as bot messages for unmentioned group replies", async () => {
  const { manager } = createFeishuManagerTestHarness();
  const messageId = await (manager as any).sendFeishuInteractionInput({
    chatId: "oc_chat",
    scopeId: "oc_chat__thread_omt_thread",
    actorId: "ou_user",
    target: "oc_chat",
    platformThreadId: "omt_thread"
  }, {
    requestId: "input_1",
    kind: "skill.run",
    title: "Use skill",
    body: "Reply to this prompt.",
    cancelToken: "cancel_1",
    expiresAt: Date.now() + 60_000
  }, "om_source");

  assert.equal(messageId, "om_reply_1");
  assert.deepEqual((manager as any).threadRegistry.match({
    chatId: "oc_chat",
    parentMessageId: "om_reply_1"
  }), {
    allowed: true,
    reason: "parent_bot_message"
  });
});

test("a reply to a cancelled Feishu input prompt never becomes an Agent task", async () => {
  const { manager } = createFeishuManagerTestHarness();
  (manager as any).wsClient = {};
  const service = (manager as any).interactionService;
  const context = {
    chatId: "oc_chat",
    scopeId: "oc_chat",
    actorId: "ou_user",
    target: "oc_chat"
  };
  const actor = { actorId: "ou_user", chatId: "oc_chat", scopeId: "oc_chat", target: "oc_chat" };

  const view = await service.open("queue", context);
  const front = view.actions.find((button: any) => button.label === "Add to front");
  assert.ok(front?.token);
  const outcome = await service.handleToken(front.token, actor);
  assert.equal(outcome.kind, "input");
  if (outcome.kind !== "input") return;

  const promptMessageId = await (manager as any).sendFeishuInteractionInput(context, outcome.input, "om_source");
  assert.ok(promptMessageId);
  await service.handleToken(outcome.input.cancelToken, actor);

  let enqueued = 0;
  (manager as any).inboundTasks.enqueue = () => {
    enqueued += 1;
    return 1;
  };

  await (manager as any).handleIncomingMessage({
    chat_id: "oc_chat",
    chat_type: "p2p",
    message_id: "om_late_reply",
    parent_id: promptMessageId,
    message_type: "text",
    content: JSON.stringify({ text: "run this cancelled task" }),
    create_time: "1710000000123",
    mentions: []
  }, { sender_id: { open_id: "ou_user", union_id: "on_user" } }, new Set());

  assert.equal(enqueued, 0);
});

test("Feishu queue-front synthetic tasks preserve the real chat and thread route", async () => {
  const { manager } = createFeishuManagerTestHarness();
  const captured: any[] = [];
  (manager as any).inboundTasks.enqueue = (scopeId: string, payload: any, options: any) => {
    captured.push({ scopeId, payload, options });
    return 77;
  };

  const id = await (manager as any).enqueueSyntheticTask({
    chatId: "oc_chat",
    scopeId: "oc_chat__thread_omt_thread",
    platformMessageId: "om_reply_task",
    platformThreadId: "omt_thread"
  }, "urgent follow-up", true);

  assert.equal(id, 77);
  assert.equal(captured.length, 1);
  assert.equal(captured[0].scopeId, "oc_chat__thread_omt_thread");
  assert.equal(captured[0].payload.chatId, "oc_chat");
  assert.equal(captured[0].payload.scopeId, "oc_chat__thread_omt_thread");
  assert.equal(captured[0].payload.platformMessageId, "om_reply_task");
  assert.equal(captured[0].payload.platformThreadId, "omt_thread");
  assert.equal(captured[0].options.front, true);
});

test("resolveFeishuUploadFilename preserves the real extension over a label title", () => {
  const filePath = "/scratch/2026/06/16/runway_model_video.mp4";

  // A display title without an extension must not strip the real .mp4 suffix,
  // otherwise the upload is sent as an untyped generic file instead of a video.
  assert.equal(resolveFeishuUploadFilename(filePath, "T台走秀视频"), "T台走秀视频.mp4");

  // A title that already has an extension is used as-is.
  assert.equal(resolveFeishuUploadFilename(filePath, "clip.mp4"), "clip.mp4");

  // No title falls back to the source file's basename.
  assert.equal(resolveFeishuUploadFilename(filePath), "runway_model_video.mp4");

  // Empty path with no title uses the provided fallback.
  assert.equal(resolveFeishuUploadFilename("", undefined, "runlog.txt"), "runlog.txt");
});

test("Feishu sends memory review cards only to p2p chats", async () => {
  const { manager, createCalls, client } = createFeishuManagerTestHarness();
  const item = { batchId: "batch", candidateId: "123e4567-e89b-12d3-a456-426614174000", ordinal: 1, value: "主人希望回答简短直接" };
  client.im.chat.get = async () => ({ code: 230001, msg: "not a group chat" });
  assert.deepEqual(await manager.sendMemoryReviewItem("oc_private", item), { messageId: "om_create_1" });
  assert.equal(createCalls.length, 1);
  client.im.chat.get = async () => ({ code: 0, data: { chat_type: "group" } });
  assert.equal(await manager.sendMemoryReviewItem("oc_group", item), null);
  assert.equal(createCalls.length, 1);
  client.im.chat.get = async () => { throw new Error("network unavailable"); };
  assert.equal(await manager.sendMemoryReviewItem("oc_unverifiable", item), null);
  assert.equal(createCalls.length, 1);
});

test("Feishu restores memory review buttons when a decision fails", async () => {
  const item = { batchId: "batch", candidateId: "123e4567-e89b-12d3-a456-426614174000", ordinal: 1, value: "主人希望回答简短直接" };
  const { manager, patchCalls } = createFeishuManagerTestHarness({
    decide: async () => { throw new Error("temporary backend failure"); },
    getDeliveredItem: () => item
  });
  const outcome = await (manager as any).resolveCardAction({
    open_message_id: "om_review",
    action: { value: { kind: "memory_review", action: "keep", candidateId: item.candidateId } }
  }, "oc_private");
  assert.equal(outcome.message, "processing");
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  assert.equal(patchCalls.length, 1);
  const restored = JSON.parse(patchCalls[0].data.content);
  assert.equal(restored.elements.at(-1).tag, "action");
  assert.equal(restored.elements.at(-1).actions.length, 2);
});

