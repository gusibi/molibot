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

function createFeishuManagerTestHarness() {
  const workspaceDir = mkdtempSync(join(tmpdir(), "molibot-feishu-runtime-test-"));
  const replyCalls: any[] = [];
  const createCalls: any[] = [];

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
        update: async () => ({ data: { message_id: "om_updated" } })
      }
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
      usageTracker: {} as any,
      modelErrorTracker: {} as any,
      hookManager: createHookManagerMock()
    }
  );

  (manager as any).client = client;
  return { manager, replyCalls, createCalls };
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
