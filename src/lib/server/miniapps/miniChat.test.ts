import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import createMiniChat from "./builtin/mini-chat/server/index.mjs";
import { getBuiltinMiniApp } from "./bootstrap.js";
import { materializeBuiltinMiniApp } from "./builtinPackage.js";
import { createMiniAppHost } from "./host.js";

function request(path: string, method = "GET", body?: unknown) {
  return { method, path, body, query: {}, signal: new AbortController().signal };
}

function contextOver(
  dataDir: string,
  chat: (input: any) => Promise<any>,
  listTextModels: () => Promise<any> = async () => ({ currentKey: "custom|default|model", options: [] })
) {
  return {
    appId: "mini-chat",
    dataDir,
    logger: { info() {}, warn() {}, error() {} },
    ai: { chat, listTextModels }
  };
}

test("Mini Chat persists its own conversations and sends structured history without a system prompt", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "molibot-mini-chat-"));
  const calls: any[] = [];
  const first = createMiniChat(contextOver(dataDir, async (input) => {
    calls.push(input);
    return { text: calls.length === 1 ? "First answer" : "Second answer", usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 } };
  }));
  const created = await first.handleHttp(request("/conversations", "POST", {}));
  const id = created.body.conversation.id as string;

  await first.handleHttp(request(`/conversations/${id}/messages`, "POST", { content: "First question" }));
  await first.handleHttp(request(`/conversations/${id}/messages`, "POST", { content: "Second question" }));

  assert.deepEqual(calls.map(({ messages, system }) => ({ messages, system })), [
    { messages: [{ role: "user", content: "First question" }], system: undefined },
    {
      messages: [
        { role: "user", content: "First question" },
        { role: "assistant", content: "First answer" },
        { role: "user", content: "Second question" }
      ],
      system: undefined
    }
  ]);
  assert.equal(Object.hasOwn(calls[0], "system"), false, "Mini Chat must not invent a system prompt");
  first.dispose();

  const restarted = createMiniChat(contextOver(dataDir, async () => ({
    text: "unused",
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
  })));
  const loaded = await restarted.handleHttp(request(`/conversations/${id}/messages`));
  assert.deepEqual(loaded.body.messages.map((message: any) => [message.role, message.content, message.status]), [
    ["user", "First question", "completed"],
    ["assistant", "First answer", "completed"],
    ["user", "Second question", "completed"],
    ["assistant", "Second answer", "completed"]
  ]);
  restarted.dispose();
});

test("Mini Chat exposes streamed text while the final reply is still pending", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "molibot-mini-chat-stream-"));
  let release!: () => void;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  let firstDelta!: () => void;
  const deltaSeen = new Promise<void>((resolve) => { firstDelta = resolve; });
  const runtime = createMiniChat(contextOver(dataDir, async ({ onTextDelta }) => {
    onTextDelta?.("Hel");
    firstDelta();
    await wait;
    onTextDelta?.("lo");
    return { text: "Hello", usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 } };
  }));
  const created = await runtime.handleHttp(request("/conversations", "POST", {}));
  const id = created.body.conversation.id as string;

  const pending = runtime.handleHttp(request(`/conversations/${id}/messages`, "POST", { content: "Hello?" }));
  await deltaSeen;
  const during = await runtime.handleHttp(request(`/conversations/${id}/messages`));
  try {
    assert.deepEqual(
      during.body.messages.map((message: any) => [message.role, message.content, message.status]),
      [["user", "Hello?", "completed"], ["assistant", "Hel", "pending"]]
    );
  } finally {
    release();
  }
  await pending;
  const completed = await runtime.handleHttp(request(`/conversations/${id}/messages`));
  assert.equal(completed.body.messages.at(-1).content, "Hello");
  assert.equal(completed.body.messages.at(-1).status, "completed");
  runtime.dispose();
});

test("Mini Chat settings select a model and system prompt and survive restart", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "molibot-mini-chat-settings-"));
  const calls: any[] = [];
  const listTextModels = async () => ({
    currentKey: "custom|provider|fast",
    options: [
      { key: "custom|provider|fast", label: "Fast" },
      { key: "custom|provider|careful", label: "Careful" }
    ]
  });
  const first = createMiniChat(contextOver(dataDir, async (input) => {
    calls.push(input);
    return { text: "Configured", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
  }, listTextModels));

  const saved = await first.handleHttp(request("/settings", "PATCH", {
    modelKey: "custom|provider|careful",
    systemPrompt: "Answer briefly and warmly."
  }));
  assert.equal(saved.status, 200);
  first.dispose();

  const restarted = createMiniChat(contextOver(dataDir, async (input) => {
    calls.push(input);
    return { text: "Configured", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
  }, listTextModels));
  const loaded = await restarted.handleHttp(request("/settings"));
  assert.deepEqual(loaded.body.settings, {
    modelKey: "custom|provider|careful",
    systemPrompt: "Answer briefly and warmly."
  });
  const created = await restarted.handleHttp(request("/conversations", "POST", {}));
  await restarted.handleHttp(request(`/conversations/${created.body.conversation.id}/messages`, "POST", { content: "Hello" }));
  assert.equal(calls.at(-1).modelKey, "custom|provider|careful");
  assert.equal(calls.at(-1).system, "Answer briefly and warmly.");

  const invalid = await restarted.handleHttp(request("/settings", "PATCH", { modelKey: "custom|missing|model", systemPrompt: "" }));
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.code, "invalid_model");
  const invalidPrompt = await restarted.handleHttp(request("/settings", "PATCH", { modelKey: "", systemPrompt: { text: "not a string" } }));
  assert.equal(invalidPrompt.status, 400);
  assert.equal(invalidPrompt.body.code, "invalid_system_prompt");
  assert.match(invalidPrompt.body.error, /must be text/i);
  restarted.dispose();
});

test("Mini Chat cancellation aborts the host model call and leaves a retryable receipt", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "molibot-mini-chat-cancel-"));
  let observedAbort = false;
  let callCount = 0;
  const runtime = createMiniChat(contextOver(dataDir, ({ signal }) => {
    callCount += 1;
    if (callCount > 1) {
      return Promise.resolve({ text: "Retried", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } });
    }
    return new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => {
        observedAbort = true;
        reject(Object.assign(new Error("aborted"), { code: "aborted" }));
      }, { once: true });
    });
  }));
  const created = await runtime.handleHttp(request("/conversations", "POST", {}));
  const id = created.body.conversation.id as string;

  const pending = runtime.handleHttp(request(`/conversations/${id}/messages`, "POST", { content: "Please wait" }));
  await Promise.resolve();
  const cancelled = await runtime.handleHttp(request(`/conversations/${id}/cancel`, "POST"));
  await pending;

  assert.equal(cancelled.body.cancelled, true);
  assert.equal(observedAbort, true);
  const loaded = await runtime.handleHttp(request(`/conversations/${id}/messages`));
  assert.equal(loaded.body.messages.at(-1).status, "cancelled");
  const retried = await runtime.handleHttp(request(`/conversations/${id}/retry`, "POST"));
  assert.notEqual(retried.status, 409, "cancelled replies remain retryable");
  runtime.dispose();
});

test("Mini Chat returns an actionable host AI error instead of a generic request failure", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "molibot-mini-chat-error-"));
  const runtime = createMiniChat(contextOver(dataDir, async () => {
    throw Object.assign(new Error('Model request failed (400): reasoning level "low" is not supported; choose medium or high.'), {
      code: "provider_failed"
    });
  }));
  const created = await runtime.handleHttp(request("/conversations", "POST", {}));
  const id = created.body.conversation.id as string;

  const failed = await runtime.handleHttp(request(`/conversations/${id}/messages`, "POST", { content: "Hello" }));

  assert.equal(failed.status, 500);
  assert.equal(failed.body.code, "provider_failed");
  assert.equal(
    failed.body.error,
    'Model request failed (400): reasoning level "low" is not supported; choose medium or high.'
  );
  runtime.dispose();
});

test("Mini Chat model settings cross the child-process host boundary", async () => {
  const root = mkdtempSync(join(tmpdir(), "molibot-mini-chat-process-settings-"));
  const codeRoot = join(root, "apps");
  const dataRoot = join(root, "data");
  mkdirSync(codeRoot, { recursive: true });
  mkdirSync(dataRoot, { recursive: true });
  materializeBuiltinMiniApp(codeRoot, getBuiltinMiniApp("mini-chat")!);
  const calls: any[] = [];
  const host = createMiniAppHost({
    codeRoot,
    dataRoot,
    getEnablement: () => ({}),
    setEnablement() {},
    builtinAppIds: ["mini-chat"],
    processCallTimeoutMs: 5_000,
    createAiFacade: () => ({
      listTextModels: async () => ({
        currentKey: "custom|provider|fast",
        options: [
          { key: "custom|provider|fast", label: "Fast" },
          { key: "custom|provider|careful", label: "Careful" }
        ]
      }),
      generateText: async () => { throw new Error("unused"); },
      transcribe: async () => { throw new Error("unused"); },
      chat: async (input) => {
        calls.push(input);
        return { text: "done", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
      }
    })
  });
  const call = (path: string, init?: RequestInit) => host.handleHttp(
    "mini-chat",
    new Request(`http://127.0.0.1/miniapps/mini-chat/api${path}`, {
      headers: { "content-type": "application/json" },
      ...init
    }),
    path
  );

  const settings = await (await call("/settings")).json() as any;
  assert.equal(settings.models.currentKey, "custom|provider|fast");
  const saved = await call("/settings", {
    method: "PATCH",
    body: JSON.stringify({ modelKey: "custom|provider|careful", systemPrompt: "Be concise." })
  });
  assert.equal(saved.status, 200);
  const created = await (await call("/conversations", { method: "POST", body: "{}" })).json() as any;
  await call(`/conversations/${created.conversation.id}/messages`, {
    method: "POST",
    body: JSON.stringify({ content: "Hello" })
  });
  assert.equal(calls[0].modelKey, "custom|provider|careful");
  assert.equal(calls[0].system, "Be concise.");
});

test("Mini Chat preserves actionable AI errors across the child-process boundary", async () => {
  const root = mkdtempSync(join(tmpdir(), "molibot-mini-chat-process-error-"));
  const codeRoot = join(root, "apps");
  const dataRoot = join(root, "data");
  mkdirSync(codeRoot, { recursive: true });
  mkdirSync(dataRoot, { recursive: true });
  materializeBuiltinMiniApp(codeRoot, getBuiltinMiniApp("mini-chat")!);

  const host = createMiniAppHost({
    codeRoot,
    dataRoot,
    getEnablement: () => ({}),
    setEnablement() {},
    builtinAppIds: ["mini-chat"],
    processCallTimeoutMs: 5_000,
    createAiFacade: () => ({
      listTextModels: async () => ({ currentKey: "", options: [] }),
      generateText: async () => { throw new Error("unused"); },
      transcribe: async () => { throw new Error("unused"); },
      chat: async () => {
        throw Object.assign(new Error('Model request failed (400): reasoning level "low" is not supported; choose medium or high.'), {
          code: "provider_failed"
        });
      }
    })
  });
  const call = (path: string, init?: RequestInit) => host.handleHttp(
    "mini-chat",
    new Request(`http://127.0.0.1/miniapps/mini-chat/api${path}`, {
      headers: { "content-type": "application/json" },
      ...init
    }),
    path
  );
  const created = await (await call("/conversations", { method: "POST", body: "{}" })).json() as any;
  const id = created.conversation.id as string;

  const failed = await call(`/conversations/${id}/messages`, {
    method: "POST",
    body: JSON.stringify({ content: "Hello" })
  });
  const body = await failed.json() as any;

  assert.equal(failed.status, 500);
  assert.equal(body.code, "provider_failed");
  assert.equal(
    body.error,
    'Model request failed (400): reasoning level "low" is not supported; choose medium or high.'
  );
});

test("Mini Chat cancellation crosses the child-process host boundary", async () => {
  const root = mkdtempSync(join(tmpdir(), "molibot-mini-chat-process-cancel-"));
  const codeRoot = join(root, "apps");
  const dataRoot = join(root, "data");
  mkdirSync(codeRoot, { recursive: true });
  mkdirSync(dataRoot, { recursive: true });
  materializeBuiltinMiniApp(codeRoot, getBuiltinMiniApp("mini-chat")!);

  let signalStarted!: () => void;
  const started = new Promise<void>((resolve) => { signalStarted = resolve; });
  let observedAbort = false;
  const host = createMiniAppHost({
    codeRoot,
    dataRoot,
    getEnablement: () => ({}),
    setEnablement() {},
    builtinAppIds: ["mini-chat"],
    processCallTimeoutMs: 5_000,
    createAiFacade: () => ({
      listTextModels: async () => ({ currentKey: "", options: [] }),
      generateText: async () => { throw new Error("unused"); },
      transcribe: async () => { throw new Error("unused"); },
      chat: ({ signal }) => new Promise((resolve, reject) => {
        signalStarted();
        signal?.addEventListener("abort", () => {
          observedAbort = true;
          reject(Object.assign(new Error("aborted"), { code: "aborted" }));
        }, { once: true });
      })
    })
  });
  const call = (path: string, init?: RequestInit) => host.handleHttp(
    "mini-chat",
    new Request(`http://127.0.0.1/miniapps/mini-chat/api${path}`, {
      headers: { "content-type": "application/json" },
      ...init
    }),
    path
  );
  const created = await (await call("/conversations", { method: "POST", body: "{}" })).json() as any;
  const id = created.conversation.id as string;
  const pending = call(`/conversations/${id}/messages`, {
    method: "POST",
    body: JSON.stringify({ content: "Cancel across IPC" })
  });
  await started;
  const cancelled = await call(`/conversations/${id}/cancel`, { method: "POST", body: "{}" });
  await pending;

  assert.equal(cancelled.status, 200);
  assert.equal(observedAbort, true, "host_cancel must abort the parent-side Provider call");
});

test("Mini Chat forwards text deltas across the child-process host boundary", async () => {
  const root = mkdtempSync(join(tmpdir(), "molibot-mini-chat-process-stream-"));
  const codeRoot = join(root, "apps");
  const dataRoot = join(root, "data");
  mkdirSync(codeRoot, { recursive: true });
  mkdirSync(dataRoot, { recursive: true });
  materializeBuiltinMiniApp(codeRoot, getBuiltinMiniApp("mini-chat")!);

  let release!: () => void;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  let firstDelta!: () => void;
  const deltaSeen = new Promise<void>((resolve) => { firstDelta = resolve; });
  const host = createMiniAppHost({
    codeRoot,
    dataRoot,
    getEnablement: () => ({}),
    setEnablement() {},
    builtinAppIds: ["mini-chat"],
    processCallTimeoutMs: 5_000,
    createAiFacade: () => ({
      listTextModels: async () => ({ currentKey: "", options: [] }),
      generateText: async () => { throw new Error("unused"); },
      transcribe: async () => { throw new Error("unused"); },
      chat: async ({ onTextDelta }) => {
        onTextDelta?.("cross-process");
        firstDelta();
        await wait;
        return { text: "cross-process", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
      }
    })
  });
  const call = (path: string, init?: RequestInit) => host.handleHttp(
    "mini-chat",
    new Request(`http://127.0.0.1/miniapps/mini-chat/api${path}`, {
      headers: { "content-type": "application/json" },
      ...init
    }),
    path
  );
  const created = await (await call("/conversations", { method: "POST", body: "{}" })).json() as any;
  const id = created.conversation.id as string;
  const pending = call(`/conversations/${id}/messages`, {
    method: "POST",
    body: JSON.stringify({ content: "Stream across IPC" })
  });

  await deltaSeen;
  const during = await (await call(`/conversations/${id}/messages`)).json() as any;
  try {
    assert.equal(during.messages.at(-1).content, "cross-process");
    assert.equal(during.messages.at(-1).status, "pending");
  } finally {
    release();
  }
  await pending;
});

test("Mini Chat removes the assistant initials avatar to preserve narrow-screen width", () => {
  const source = readFileSync(join(process.cwd(), "src/lib/server/miniapps/builtin/mini-chat/ui-src/main.tsx"), "utf8");
  assert.equal(source.includes('avatar={<Avatar name="Mini Chat"'), false);
});

test("Mini Chat aligns assistant metadata through the bubble slot and has no hidden rail shadow", () => {
  const root = join(process.cwd(), "src/lib/server/miniapps/builtin/mini-chat/ui-src");
  const source = readFileSync(join(root, "main.tsx"), "utf8");
  const styles = readFileSync(join(root, "styles.css"), "utf8");
  assert.match(source, /<ChatMessageBubble variant="ghost" metadata=\{/);
  assert.doesNotMatch(styles, /box-shadow:\s*18px 0 50px/);
});

test("Mini Chat deletion does not depend on blocked iframe modal dialogs", () => {
  const source = readFileSync(join(process.cwd(), "src/lib/server/miniapps/builtin/mini-chat/ui-src/main.tsx"), "utf8");
  assert.doesNotMatch(source, /window\.confirm\(/);
  assert.match(source, /deleteOpen/);
});

test("Mini Chat icon matches the colorful built-in app family without a black tile", () => {
  const icon = readFileSync(join(process.cwd(), "src/lib/server/miniapps/builtin/mini-chat/ui/icon.svg"), "utf8");
  assert.match(icon, /viewBox="0 0 24 24"/);
  assert.match(icon, /#00ACC1/);
  assert.match(icon, /#00838F/);
  assert.doesNotMatch(icon, /#171717|<rect[^>]+width="64"/);
});
