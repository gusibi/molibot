import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadPiExtensionsInProcess } from "$lib/server/plugins/piExtensions/processClient.js";
import { buildPiExtensionRuntimeSnapshot } from "$lib/server/plugins/piExtensions/runtimeSnapshot.js";

const FIXTURE = `import { Type } from "@sinclair/typebox";
export default function models(pi: any) {
  pi.registerTool({
    name: "use_models",
    label: "Use models",
    description: "exercises ctx.modelRegistry",
    parameters: Type.Object({}),
    async execute(_id: string, _params: unknown, _signal: AbortSignal, _onUpdate: unknown, ctx: any) {
      const registry = ctx.modelRegistry;
      const errors: Record<string, string> = {};
      const probe = (name: string, fn: () => unknown) => { try { fn(); errors[name] = ""; } catch (error) { errors[name] = (error as Error).message; } };
      probe("apiKey", () => registry.getApiKeyForProvider("openai"));
      probe("register", () => registry.registerProvider("x", {}));
      probe("providerConfig", () => registry.getRegisteredProviderConfig("openai"));
      probe("nativeProvider", () => registry.getRegisteredNativeProvider("openai"));
      const classifier = registry.getModelsOfType("classifier")[0];
      const image = registry.getModelsOfType("image")[0];
      const classified = await registry.classify(classifier, { state: { a: 1 }, questions: { q: { type: "bool" } } });
      const generated = await registry.generateImages(image, { input: [{ type: "text", text: "a cat" }] });
      return { content: [{ type: "text", text: JSON.stringify({
        availableTypes: (await registry.getAvailableOfType("classifier", "openai")).map((entry: any) => entry.id),
        providerIds: registry.getRegisteredProviderIds(),
        rejectedImage: await registry.generateImages(image, { input: [] }, { seed: 1 }),
        all: registry.getAll().map((entry: any) => entry.id),
        available: registry.getAvailable().map((entry: any) => entry.id),
        typesafe: registry.getModelOfType("classifier", "openai", "typesafe")?.id,
        classified,
        generated,
        errors
      }) }], details: {} };
    }
  });
}
`;

const SNAPSHOT_MODELS = {
  chat: [{ provider: "openai", id: "gpt", name: "GPT", api: "openai" }],
  classifier: [{ provider: "openai", id: "typesafe", name: "Typesafe", api: "classifier" }],
  image: [{ provider: "openai", id: "dalle", name: "DALL-E", api: "image" }],
  providerAuth: { openai: true }
};

async function withFixture<T>(run: (client: NonNullable<Awaited<ReturnType<typeof loadPiExtensionsInProcess>>["client"]>, dataDir: string) => Promise<T>): Promise<T> {
  const dataDir = mkdtempSync(join(tmpdir(), "molibot-pi-ext-models-"));
  mkdirSync(join(dataDir, "extensions", "models"), { recursive: true });
  writeFileSync(join(dataDir, "extensions", "models", "index.ts"), FIXTURE, "utf8");
  const result = await loadPiExtensionsInProcess({ cwd: dataDir, agentDir: dataDir });
  try {
    assert.ok(result.client, "the worker client should exist");
    return await run(result.client, dataDir);
  } finally {
    result.client?.dispose();
    rmSync(dataDir, { recursive: true, force: true });
  }
}

function snapshot() {
  return buildPiExtensionRuntimeSnapshot({ cwd: "/work", isIdle: false, models: SNAPSHOT_MODELS });
}

async function invoke(client: NonNullable<Awaited<ReturnType<typeof loadPiExtensionsInProcess>>["client"]>, dataDir: string, hostToken?: string) {
  const response = await client.request("invokeTool", {
    extensionId: "models",
    toolName: "use_models",
    toolCallId: "call-1",
    params: {},
    cwd: dataDir,
    runtime: snapshot(),
    ...(hostToken ? { hostToken } : {})
  });
  return JSON.parse(response.value.content[0].text);
}

test("ctx.modelRegistry lists models and routes classify/image through the host", async () => {
  await withFixture(async (client, dataDir) => {
    const calls: Array<{ method: string; input: any }> = [];
    client.registerHostSession("tok-1", async (method, input) => {
      calls.push({ method, input });
      if (method === "modelRegistry.classify") {
        return { model: "typesafe", answers: { q: { type: "bool", value: true } }, usage: { totalTokens: 5 } };
      }
      if (method === "modelRegistry.generateImages") {
        return { model: "dalle", images: [{ mimeType: "image/png", data: "AAAA" }], text: "done", usage: { totalTokens: 9 } };
      }
      throw new Error(`unexpected ${method}`);
    });
    const payload = await invoke(client, dataDir, "tok-1");
    client.releaseHostSession("tok-1");

    assert.deepEqual(payload.all, ["gpt"]);
    assert.deepEqual(payload.available, ["gpt"]);
    assert.equal(payload.typesafe, "typesafe");
    assert.deepEqual(calls[0], {
      method: "modelRegistry.classify",
      input: { key: "classifier|openai|typesafe", state: { a: 1 }, questions: { q: { type: "bool" } } }
    });
    assert.deepEqual(calls[1], {
      method: "modelRegistry.generateImages",
      input: { key: "image|openai|dalle", prompt: "a cat", images: [] }
    });
    assert.deepEqual(payload.availableTypes, ["typesafe"]);
    assert.deepEqual(payload.providerIds, ["openai"]);
    assert.equal(payload.rejectedImage.stopReason, "error");
    assert.match(payload.rejectedImage.errorMessage, /option seed/);
    assert.equal(payload.classified.stopReason, "stop");
    assert.deepEqual(payload.classified.answers, { q: { type: "bool", value: true } });
    assert.equal(payload.generated.stopReason, "stop");
    assert.deepEqual(payload.generated.output, [
      { type: "image", mimeType: "image/png", data: "AAAA" },
      { type: "text", text: "done" }
    ]);
  });
});

test("credential and registration interfaces are rejected explicitly", async () => {
  await withFixture(async (client, dataDir) => {
    client.registerHostSession("tok-2", async () => ({ model: "typesafe", answers: {}, images: [] }));
    const payload = await invoke(client, dataDir, "tok-2");
    client.releaseHostSession("tok-2");
    assert.match(payload.errors.apiKey, /never exposed/);
    assert.match(payload.errors.register, /cannot modify providers/);
    assert.match(payload.errors.providerConfig, /configuration may contain credentials/);
    assert.match(payload.errors.nativeProvider, /Provider objects are host-owned/);
  });
});

test("classify without a host session reports an error result instead of throwing", async () => {
  await withFixture(async (client, dataDir) => {
    const payload = await invoke(client, dataDir);
    assert.equal(payload.classified.stopReason, "error");
    assert.match(payload.classified.errorMessage, /not available/i);
  });
});
