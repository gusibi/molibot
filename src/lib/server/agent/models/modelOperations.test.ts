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

test("generateImages persists the image and returns a file-tool-usable reference plus display data", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "molibot-model-image-"));
  const artifactDir = join(workspace, "artifacts");
  try {
    const calls: string[] = [];
    const operations = createPiModelOperations({ models: fixtureModels(calls), artifactDir, workspaceDir: workspace });
    const result = await operations.generateImages({ prompt: "a cat" });
    assert.equal(result.images.length, 1);
    assert.equal(result.images[0].mimeType, "image/png");
    assert.equal(Buffer.from(result.images[0].data, "base64").toString(), "png-bytes");
    // The ref is the real persisted artifact, relative to the workspace so the
    // model's file tools can open it.
    assert.match(result.images[0].ref, /^artifacts\/codemode-image-[a-f0-9]+\.png$/);
    assert.equal(readFileSync(join(workspace, result.images[0].ref), "utf8"), "png-bytes");
  } finally { rmSync(workspace, { recursive: true, force: true }); }
});

test("an artifact persisted outside the workspace keeps an absolute reference", async () => {
  const artifactDir = mkdtempSync(join(tmpdir(), "molibot-model-image-outside-"));
  const workspace = mkdtempSync(join(tmpdir(), "molibot-model-image-ws-"));
  try {
    const operations = createPiModelOperations({ models: fixtureModels([]), artifactDir, workspaceDir: workspace });
    const result = await operations.generateImages({ prompt: "a cat" });
    assert.equal(result.images[0].ref, join(artifactDir, result.images[0].ref.split("/").pop()!));
  } finally {
    rmSync(artifactDir, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("an unknown model key fails with catalog guidance instead of a guessed model", async () => {
  const directory = mkdtempSync(join(tmpdir(), "molibot-model-unknown-"));
  try {
    const operations = createPiModelOperations({ models: fixtureModels([]), artifactDir: directory, workspaceDir: directory });
    await assert.rejects(() => operations.classify({ model: "classifier|missing|x", state: {}, questions: {} }), /models\.list/);
    await assert.rejects(() => operations.generateImages({ model: "image|missing|x", prompt: "x" }), /models\.list/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("billed image usage survives artifact failure and keeps its call identity", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "molibot-model-failure-"));
  try {
    const receipts: ModelUsageReceipt[] = [];
    const calls: string[] = [];
    const { writeFileSync } = await import("node:fs");
    const artifactDir = join(workspace, "blocked");
    writeFileSync(artifactDir, "not a directory");
    const operations = createPiModelOperations({ models: fixtureModels(calls), artifactDir, workspaceDir: workspace,
      onUsage: receipt => receipts.push(receipt) });
    await assert.rejects(() => operations.generateImages({ prompt: "cat" }, undefined, "original-image-call"));
    assert.deepEqual(calls, ["generateImages"]);
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0].id, "original-image-call");
  } finally { rmSync(workspace, { recursive: true, force: true }); }
});

test("distinct model calls reserve distinct identities, while reuse keeps its identity", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "molibot-model-identities-"));
  try {
    const identities: string[] = [];
    const operations = createPiModelOperations({ models: fixtureModels([]), artifactDir: workspace, workspaceDir: workspace,
      beforeCall: (_operation, details) => identities.push(details.id) });
    const input = { state: {}, questions: { flag: { type: "bool" as const, instructions: "yes?", criteria: { true: "yes", false: "no" } } } };
    await operations.classify(input, undefined, "first");
    await operations.classify(input, undefined, "second");
    assert.deepEqual(identities, ["first", "second"]);
  } finally { rmSync(workspace, { recursive: true, force: true }); }
});


test("oversized inline references are rejected before any billed request", async () => {
  const directory = mkdtempSync(join(tmpdir(), "model-reference-inline-")); const calls: string[] = [];
  try {
    const operations = createPiModelOperations({ models: fixtureModels(calls), artifactDir: directory, workspaceDir: directory });
    await assert.rejects(operations.generateImages({ prompt: "reference", images: [`data:image/png;base64,${Buffer.alloc(10 * 1024 * 1024 + 1).toString("base64")}`] }), /exceeds 10 MiB/);
    assert.deepEqual(calls, []);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("oversized downloads cancel the body before reading the remaining chunks", async () => {
  const directory = mkdtempSync(join(tmpdir(), "model-reference-stream-")); const calls: string[] = [];
  let pulls = 0; let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ pull(controller) { pulls++; controller.enqueue(new Uint8Array(1024 * 1024)); if (pulls === 12) controller.close(); }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
  try {
    const operations = createPiModelOperations({ models: fixtureModels(calls), artifactDir: directory, workspaceDir: directory,
      fetch: async () => new Response(body, { headers: { "content-type": "image/png" } }) });
    await assert.rejects(operations.generateImages({ prompt: "reference", images: ["https://fixture.invalid/large.png"] }), /exceeds 10 MiB/);
    assert.equal(cancelled, true); assert.equal(pulls, 11); assert.deepEqual(calls, []);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
