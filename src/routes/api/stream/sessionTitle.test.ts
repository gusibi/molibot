import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const root = mkdtempSync(join(tmpdir(), "molibot-session-title-route-"));
process.env.DATA_DIR = root;

test("chat and stream retry provisional titles, protect custom titles and title durable sessions", { timeout: 15_000 }, async (t) => {
  const { getRuntime } = await import("$lib/server/app/runtime.js");
  const { resolveRuntimeContext } = await import("$lib/server/web/runtimeContext.js");
  const { POST } = await import("./+server.js");
  const runtime = getRuntime();
  const settings = runtime.getSettings();
  const modelKey = "custom|title-fixture|title-model";
  t.mock.method(runtime, "getSettings", () => ({
    ...settings,
    modelRouting: { ...settings.modelRouting, textModelKey: modelKey },
    customProviders: [{
      id: "title-fixture", name: "Title fixture", enabled: true,
      protocol: "openai-compatible", baseUrl: "http://127.0.0.1:1/v1", apiKey: "fixture-key",
      path: "/chat/completions", defaultModel: "title-model",
      models: [{ id: "title-model", enabled: true, tags: ["text"], supportedRoles: ["system", "user", "assistant", "tool"] }]
    }]
  }));
  const requests: string[] = [];
  t.mock.method(globalThis, "fetch", async (_url: string | URL | Request, init?: RequestInit) => {
    requests.push(String(init?.body));
    const chunk = { id: "title", object: "chat.completion.chunk", created: 1, model: "title-model",
      choices: [{ index: 0, delta: { role: "assistant", content: "WiFi速度异常排查" }, finish_reason: null }] };
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`, {
      headers: { "Content-Type": "text/event-stream" }
    });
  });
  const owner = "web:personal:web-anonymous";
  const { pool } = resolveRuntimeContext({ profileId: "personal", agentId: "default" });
  try {
    for (const customized of [false, true]) {
      const conversation = runtime.sessions.createWebConversation(owner, undefined, "default");
      const first = "现在我发现我的 WiFi 很慢，但是直接测速的话就很快，我不知道是什么原因，帮我排查一下";
      runtime.sessions.appendMessage(conversation.id, "user", first);
      if (customized) runtime.sessions.renameConversation(conversation.id, "web", owner, "我的网络笔记");
      let resolveTitle!: () => void;
      const titleSaved = new Promise<void>(resolve => { resolveTitle = resolve; });
      const originalRename = runtime.sessions.renameConversation.bind(runtime.sessions);
      const renameMock = t.mock.method(runtime.sessions, "renameConversation", (...args: Parameters<typeof originalRename>) => {
        const result = originalRename(...args);
        resolveTitle();
        return result;
      });
      const runner = pool.get(owner, conversation.id);
      const runMock = t.mock.method(runner, "run", async (ctx: Parameters<typeof runner.run>[0]) => {
        if (!customized) await titleSaved;
        await ctx.respond("检查完成");
        return { stopReason: "stop" };
      });
      const response = await POST({ request: new Request("http://localhost/api/stream", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: "personal", conversationId: conversation.id, message: "继续排查", durableMode: "suppress" })
      }) } as Parameters<typeof POST>[0]);
      const text = await response.text();
      assert.equal(response.status, 200);
      if (customized) {
        assert.doesNotMatch(text, /event: session_title_updated/);
        assert.equal(requests.length, 1);
        assert.equal(runtime.sessions.getConversationById(conversation.id, "web", owner)?.title, "我的网络笔记");
      } else {
        assert.match(text, /event: session_title_updated/);
        assert.match(text, /WiFi速度异常排查/);
        assert.match(requests[0], /WiFi 很慢/);
        assert.equal(runtime.sessions.getConversationById(conversation.id, "web", owner)?.title, "WiFi速度异常排查");
      }
      runMock.mock.restore();
      renameMock.mock.restore();
    }
    const { POST: chatPost } = await import("../chat/+server.js");
    const chatConversation = runtime.sessions.createWebConversation(owner, undefined, "default");
    runtime.sessions.appendMessage(chatConversation.id, "user", "帮我排查 WiFi 速度");
    let chatTitleSaved!: () => void;
    const chatTitle = new Promise<void>(resolve => { chatTitleSaved = resolve; });
    const originalRename = runtime.sessions.renameConversation.bind(runtime.sessions);
    const chatRenameMock = t.mock.method(runtime.sessions, "renameConversation", (...args: Parameters<typeof originalRename>) => {
      const renamed = originalRename(...args);
      chatTitleSaved();
      return renamed;
    });
    const chatRunMock = t.mock.method(pool.get(owner, chatConversation.id), "run", async (ctx: Parameters<ReturnType<typeof pool.get>["run"]>[0]) => {
      await chatTitle;
      await ctx.respond("检查完成");
      return { stopReason: "stop" };
    });
    const chatResponse = await chatPost({ request: new Request("http://localhost/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileId: "personal", conversationId: chatConversation.id, message: "继续排查", durableMode: "suppress" })
    }) } as Parameters<typeof chatPost>[0]);
    assert.equal(chatResponse.status, 200);
    assert.equal(runtime.sessions.getConversationById(chatConversation.id, "web", owner)?.title, "WiFi速度异常排查");
    assert.equal(requests.length, 2);
    chatRunMock.mock.restore();
    chatRenameMock.mock.restore();
    const durableConversation = runtime.sessions.createWebConversation(owner, undefined, "default");
    const durableResponse = await POST({ request: new Request("http://localhost/api/stream", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileId: "personal", conversationId: durableConversation.id, message: "排查 WiFi 速度", durableMode: "force" })
    }) } as Parameters<typeof POST>[0]);
    assert.equal(durableResponse.status, 200);
    const reader = durableResponse.body!.getReader();
    let durableText = "";
    try {
      while (!durableText.includes("event: session_title_updated")) {
        const { done, value } = await reader.read();
        assert.equal(done, false);
        durableText += new TextDecoder().decode(value);
      }
      assert.match(durableText, /event: durable_start/);
      assert.match(durableText, /WiFi速度异常排查/);
      assert.equal(requests.length, 3);
    } finally {
      await reader.cancel();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
