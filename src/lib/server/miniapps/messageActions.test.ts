import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_MESSAGE_CAPTURE_BYTES,
  buildMessageCaptureContext,
  invokeMessageAction
} from "$lib/server/miniapps/messageActions.js";
import type { MiniAppHost } from "$lib/server/miniapps/host.js";

test("message capture truncates by UTF-8 bytes and replaces client authority", () => {
  const context = buildMessageCaptureContext({
    text: `开${"a".repeat(MAX_MESSAGE_CAPTURE_BYTES)}`,
    selection: " selected ",
    role: "assistant",
    source: { sessionTitle: " Session ", channel: "forged" },
    capturedAt: "1999-01-01T00:00:00.000Z"
  }, {
    channel: "desktop",
    now: new Date("2026-08-06T01:02:03.000Z")
  });

  assert.equal(Buffer.byteLength(context.text, "utf8"), MAX_MESSAGE_CAPTURE_BYTES);
  assert.equal(context.text.includes("�"), false);
  assert.equal(context.truncated, true);
  assert.equal(context.selection, "selected");
  assert.equal(context.capturedAt, "2026-08-06T01:02:03.000Z");
  assert.deepEqual(context.source, { sessionTitle: "Session", channel: "desktop" });
  assert.equal(JSON.stringify(context).includes("sessionId"), false);
});

test("message action invocation only calls a contributed active tool with host-owned capture fields", async () => {
  let invoked: { toolId: string; input: unknown } | null = null;
  const host = {
    listCatalog: () => [{
      id: "capture-app",
      enabled: true,
      status: "active",
      messageActions: [{ tool: "save", label: { zh: "保存", en: "Save" }, accepts: ["text"] }]
    }],
    invokeTool: async (toolId: string, input: unknown) => {
      invoked = { toolId, input };
      return { content: [{ type: "text" as const, text: "saved" }], structuredContent: { id: "1" } };
    }
  } as unknown as MiniAppHost;

  const result = await invokeMessageAction(host, {
    appId: "capture-app",
    tool: "save",
    capture: {
      text: "hello",
      role: "assistant",
      capturedAt: "forged",
      source: { channel: "forged" }
    }
  }, { channel: "desktop", now: new Date("2026-08-06T02:00:00.000Z") });

  assert.deepEqual(result, {
    content: [{ type: "text", text: "saved" }],
    structuredContent: { id: "1" }
  });
  assert.equal(invoked?.toolId, "miniapp__capture-app__save");
  assert.deepEqual(invoked?.input, {
    capture: {
      text: "hello",
      role: "assistant",
      truncated: false,
      capturedAt: "2026-08-06T02:00:00.000Z",
      source: { channel: "desktop" }
    }
  });
});
