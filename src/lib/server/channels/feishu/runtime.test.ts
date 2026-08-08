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

function createFeishuManagerTestHarness(memoryReview: any = { decide: async () => ({ status: "stale" }) }) {
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

  (manager as any).client = client;
  return { manager, replyCalls, createCalls, patchCalls, client };
}

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

test("Feishu queued-control callback acknowledges immediately, updates the card, and rejects a different verified chat", async () => {
  const { manager, patchCalls } = createFeishuManagerTestHarness();
  const calls: unknown[] = [];
  (manager as any).commandService.handleQueuedControlAction = async (scopeId: string, queueId: number, action: string) => {
    calls.push({ scopeId, queueId, action });
    return { status: "steered", message: "已将这条消息插入当前任务。" };
  };
  const event = {
    open_message_id: "om_queue",
    action: {
      value: {
        kind: "queued_control",
        action: "steer",
        botId: "test-bot",
        chatId: "oc_chat",
        scopeId: "oc_chat__thread_1",
        queueId: 12
      }
    }
  };

  assert.equal(await (manager as any).resolveCardAction(event, "oc_other"), undefined);
  const outcome = await (manager as any).resolveCardAction(event, "oc_chat");
  assert.equal(outcome.message, "processing");
  assert.equal(outcome.card.header.title.content, "操作处理中");
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  assert.deepEqual(calls, [{ scopeId: "oc_chat__thread_1", queueId: 12, action: "steer" }]);
  assert.equal(patchCalls.length, 1);
  const updated = JSON.parse(patchCalls[0].data.content);
  assert.equal(updated.header.title.content, "操作已完成");
  assert.equal(updated.elements.some((element: any) => element.tag === "action"), false);
  assert.match(updated.elements[0].content, /已将这条消息插入当前任务/);
});

test("Feishu queued-control callback sends a text receipt when the card update fails", async () => {
  const { manager, client } = createFeishuManagerTestHarness();
  const receipts: Array<{ chatId: string; text: string }> = [];
  client.im.message.patch = async () => { throw new Error("card update unavailable"); };
  (manager as any).sendText = async (chatId: string, text: string) => {
    receipts.push({ chatId, text });
    return { message_id: "om_receipt" };
  };
  (manager as any).commandService.handleQueuedControlAction = async () => ({
    status: "stopped",
    message: "已停止当前任务。"
  });

  const outcome = await (manager as any).resolveCardAction({
    open_message_id: "om_queue_stop",
    action: {
      value: {
        kind: "queued_control",
        action: "stop",
        botId: "test-bot",
        chatId: "oc_chat",
        scopeId: "oc_chat",
        queueId: 13
      }
    }
  }, "oc_chat");

  assert.equal(outcome.card.header.title.content, "操作处理中");
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  assert.deepEqual(receipts, [{ chatId: "oc_chat", text: "已停止当前任务。" }]);
});
