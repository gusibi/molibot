import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadPiExtensionsInProcess } from "$lib/server/plugins/piExtensions/processClient.js";
import { buildPiExtensionRuntimeSnapshot } from "$lib/server/plugins/piExtensions/runtimeSnapshot.js";

const FIXTURE = `import { Type } from "@sinclair/typebox";
export default function reader(pi: any) {
  pi.registerTool({
    name: "read_ctx",
    label: "Read ctx",
    description: "returns context fields",
    parameters: Type.Object({}),
    async execute(_id: string, _params: unknown, _signal: AbortSignal, _onUpdate: unknown, ctx: any) {
      let compactError = "";
      try { ctx.compact(); } catch (error) { compactError = (error as Error).message; }
      return { content: [{ type: "text", text: JSON.stringify({
        cwd: ctx.cwd,
        model: ctx.model,
        thinkingLevel: ctx.thinkingLevel,
        scopedModels: ctx.scopedModels,
        isIdle: ctx.isIdle(),
        hasPendingMessages: ctx.hasPendingMessages(),
        contextUsage: ctx.getContextUsage(),
        systemPrompt: ctx.getSystemPrompt(),
        classifierModels: ctx.modelRegistry.getModelsOfType("classifier").map((entry: any) => entry.id),
        compactError
      }) }], details: {} };
    }
  });
}
`;

test("the extension host reflects real run state and rejects unwired interfaces", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "molibot-pi-ext-context-"));
  mkdirSync(join(dataDir, "extensions", "reader"), { recursive: true });
  writeFileSync(join(dataDir, "extensions", "reader", "index.ts"), FIXTURE, "utf8");

  const result = await loadPiExtensionsInProcess({ cwd: dataDir, agentDir: dataDir });
  try {
    const extension = result.extensions.find((entry) => entry.id === "reader");
    assert.ok(extension, "the fixture extension should load through the real worker");
    assert.ok(result.client, "the worker process client should exist");

    const snapshot = buildPiExtensionRuntimeSnapshot({
      cwd: "/work",
      systemPrompt: "SYS",
      sessionId: "s-1",
      model: { provider: "anthropic", id: "claude", api: "messages", headers: { authorization: "secret" } },
      thinkingLevel: "high",
      scopedModels: [{ model: { provider: "openai", id: "gpt" }, thinkingLevel: "low" }],
      isIdle: false,
      pendingMessages: 1,
      contextUsage: { tokens: 500, contextWindow: 1000 },
      models: {
        chat: [],
        classifier: [{ provider: "openai", id: "typesafe", name: "Typesafe", api: "classifier" }],
        image: [],
        providerAuth: { openai: true }
      }
    });

    const response = await result.client!.request("invokeTool", {
      extensionId: "reader",
      toolName: "read_ctx",
      toolCallId: "call-1",
      params: {},
      cwd: "/work",
      runtime: snapshot
    });
    const payload = JSON.parse(response.value.content[0].text);

    assert.equal(payload.cwd, "/work");
    assert.deepEqual(payload.model, { provider: "anthropic", id: "claude", api: "messages" });
    assert.equal(payload.thinkingLevel, "high");
    assert.deepEqual(payload.scopedModels, [{ model: { provider: "openai", id: "gpt" }, thinkingLevel: "low" }]);
    assert.equal(payload.isIdle, false);
    assert.equal(payload.hasPendingMessages, true);
    assert.deepEqual(payload.contextUsage, { tokens: 500, contextWindow: 1000, percent: 50 });
    assert.equal(payload.systemPrompt, "SYS");
    // Model discovery reads the snapshot catalog.
    assert.deepEqual(payload.classifierModels, ["typesafe"]);
    // Unwired interfaces fail loudly, naming the capability, instead of silent no-ops.
    assert.match(payload.compactError, /ctx\.compact/);
  } finally {
    result.client?.dispose();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
