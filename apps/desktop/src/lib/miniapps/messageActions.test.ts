import assert from "node:assert/strict";
import test from "node:test";
import { invokeDesktopMiniAppAction } from "../api";
import { catalogMessageActions } from "./messageActions";

test("desktop Mini App action client posts the standard capture envelope", async () => {
  const original = globalThis.fetch;
  let seen: { url: string; init?: RequestInit } | null = null;
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    seen = { url: String(url), init };
    return new Response(JSON.stringify({ ok: true, content: [{ type: "text", text: "saved" }] }), {
      headers: { "content-type": "application/json" }
    });
  }) as typeof globalThis.fetch;
  try {
    const result = await invokeDesktopMiniAppAction("http://127.0.0.1:3210", {
      appId: "todo",
      tool: "add",
      capture: { text: "answer", role: "assistant", source: { sessionTitle: "Session" } }
    });
    assert.deepEqual(result.content, [{ type: "text", text: "saved" }]);
    assert.ok(seen);
    const request = seen as { url: string; init?: RequestInit };
    assert.equal(request.url, "http://127.0.0.1:3210/api/desktop/miniapps/invoke");
    assert.equal(request.init?.method, "POST");
    assert.deepEqual(JSON.parse(String(request.init?.body)), {
      appId: "todo",
      tool: "add",
      capture: { text: "answer", role: "assistant", source: { sessionTitle: "Session" } }
    });
  } finally {
    globalThis.fetch = original;
  }
});

test("catalog message actions include active apps and use the current locale", () => {
  const base = {
    name: "Todo",
    version: "1.0.2",
    description: "",
    builtin: true,
    toolNames: ["add"],
    aiCapabilities: [],
    badge: null,
    iconDataUri: "",
    source: { kind: "builtin" as const },
    updateAvailable: false,
    availableVersion: "",
    error: ""
  };
  const actions = catalogMessageActions([
    {
      ...base,
      id: "todo",
      enabled: true,
      status: "active" as const,
      messageActions: [{ tool: "add", label: { zh: "存为待办", en: "Save as Todo" }, accepts: ["text" as const] }]
    },
    {
      ...base,
      id: "off",
      enabled: false,
      status: "disabled" as const,
      messageActions: [{ tool: "add", label: { zh: "隐藏", en: "Hidden" }, accepts: ["text" as const] }]
    }
  ], "zh-CN");
  assert.deepEqual(actions, [{
    id: "todo:add",
    appId: "todo",
    tool: "add",
    label: "存为待办",
    icon: undefined,
    accepts: ["text"]
  }]);
});
