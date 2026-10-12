import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { Models } from "@earendil-works/pi-ai";
import { createPiModelOperations, type ModelUsageReceipt } from "./modelOperations.js";

function fixtureModels(calls: string[]) {
  const classifier = { type: "classifier" as const, provider: "alpha", id: "cls", name: "Alpha classifier", api: "fixture", baseUrl: "", contextWindow: 4096 };
  const unavailable = { type: "classifier" as const, provider: "beta", id: "cls2", name: "Beta classifier", api: "fixture", baseUrl: "", contextWindow: 4096 };
  const image = { type: "image" as const, provider: "alpha", id: "img", name: "Alpha image", api: "fixture", baseUrl: "", input: ["text", "image"], output: ["image"] };
  const models = {
    getModelsOfType: (type: string) => type === "classifier" ? [classifier, unavailable] : [image],
    getModelOfType: (type: string, provider: string, id: string) => [classifier, unavailable, image].find((m) => m.type === type && m.provider === provider && m.id === id),
    checkAuth: async (provider: string) => provider === "alpha" ? { type: "api_key" as const } : undefined,
    classify: async (_model: unknown, context: { questions: Record<string, unknown> }) => {
      calls.push("classify");
      assert.ok(Object.keys(context.questions).length === 1);
      return { api: "fixture", provider: "alpha", model: "cls", answers: { flag: { type: "bool", probability: 0.9 } },
        usage: { input: 3, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 4, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "stop" as const, timestamp: 1 };
    },
    generateImages: async () => {
      calls.push("generateImages");
      return { api: "fixture", provider: "alpha", model: "img", output: [{ type: "image" as const, mimeType: "image/png", data: Buffer.from("png-bytes").toString("base64") }],
        usage: { input: 1, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 1, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "stop" as const, timestamp: 1 };
    }
  } as unknown as Models;
  return models;
}

test("catalog reports credential availability per model without allowing the call", async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-model-ops-"));
  try {
    const operations = createPiModelOperations({ models: fixtureModels([]), artifactDir: directory, workspaceDir: directory });
    const catalog = await operations.catalog();
    assert.deepEqual(catalog.map((entry) => [entry.key, entry.available, entry.supportsReferenceImages ?? null]), [
      ["classifier|alpha|cls", true, null],
      ["classifier|beta|cls2", false, null],
      ["image|alpha|img", true, true]
    ]);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("classify goes through authorization, budget and a usage receipt", async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-model-classify-"));
  try {
    const calls: string[] = [];
    const receipts: ModelUsageReceipt[] = [];
    const operations = createPiModelOperations({ models: fixtureModels(calls), artifactDir: directory, workspaceDir: directory,
      authorize: () => { calls.push("authorize"); },
      beforeCall: () => { calls.push("budget"); },
      onUsage: (receipt) => receipts.push(receipt) });
    const result = await operations.classify({ model: "classifier|alpha|cls", state: { text: "hi" }, questions: { flag: { type: "bool", instructions: "yes?", criteria: { true: "yes", false: "no" } } } });
    assert.deepEqual(calls, ["authorize", "budget", "classify"]);
    assert.equal(result.model, "cls");
    assert.equal((result.answers.flag as { probability: number }).probability, 0.9);
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0].kind, "classify");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("a denied authorization prevents the classify request", async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-model-deny-"));
  try {
    const calls: string[] = [];
    const operations = createPiModelOperations({ models: fixtureModels(calls), artifactDir: directory, workspaceDir: directory,
      authorize: () => { throw new Error("Plan mode is read-only."); } });
    await assert.rejects(() => operations.classify({ state: {}, questions: {} }), /read-only/);
    assert.deepEqual(calls, []);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("generateImages persists the image and returns a reference plus display data", async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-model-image-"));
  try {
    const calls: string[] = [];
    const operations = createPiModelOperations({ models: fixtureModels(calls), artifactDir: directory, workspaceDir: "/workspace" });
    const result = await operations.generateImages({ prompt: "a cat" });
    assert.equal(result.images.length, 1);
    assert.equal(result.images[0].mimeType, "image/png");
    assert.equal(Buffer.from(result.images[0].data, "base64").toString(), "png-bytes");
    assert.match(result.images[0].ref, /^\/workspace\/codemode-image-[a-f0-9]+\.png$/);
    assert.equal(readFileSync(join(directory, result.images[0].ref.split("/").pop()!), "utf8"), "png-bytes");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("an unknown model key fails with catalog guidance instead of a guessed model", async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-model-unknown-"));
  try {
    const operations = createPiModelOperations({ models: fixtureModels([]), artifactDir: directory, workspaceDir: directory });
    await assert.rejects(() => operations.classify({ model: "classifier|missing|x", state: {}, questions: {} }), /models\.list/);
    await assert.rejects(() => operations.generateImages({ model: "image|missing|x", prompt: "x" }), /models\.list/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
