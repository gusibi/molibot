import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { createAssistantMessageEventStream, createModels, type AssistantMessage, type Model } from "@earendil-works/pi-ai";
import { PiDurableKernel } from "../../src/lib/server/agent/durable/piKernel.js";

const directory = process.env.DATA_DIR!;
const model: Model<"openai-completions"> = {
  api: "openai-completions", id: "fixture", provider: "fixture", name: "Fixture",
  baseUrl: "http://fixture.invalid", reasoning: false, input: ["text"], contextWindow: 8192, maxTokens: 1024,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
};
const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
function answer(deferred: boolean) {
  const stream = createAssistantMessageEventStream();
  const message: AssistantMessage = {
    role: "assistant", api: model.api, provider: model.provider, model: model.id, timestamp: 1, usage,
    content: deferred ? [] : [{ type: "text", text: "Deferred answer" }],
    stopReason: deferred ? "deferred" : "stop",
    deferred: deferred ? { provider: model.provider, modelId: model.id, api: model.api, id: "remote-job-42", pollAfterMs: 1 } : undefined
  };
  stream.push({ type: "done", reason: deferred ? "deferred" : "stop", message });
  stream.end();
  return stream;
}
const models = createModels();
models.setProvider({
  id: model.provider, name: "Fixture", getModels: () => [model],
  auth: { apiKey: { name: "Fixture", resolve: async () => ({ auth: { apiKey: "fixture" } }) } },
  stream: () => { appendFileSync(join(directory, "provider-ledger.txt"), "submit\n"); return answer(true); },
  streamSimple: () => { appendFileSync(join(directory, "provider-ledger.txt"), "submit\n"); return answer(true); },
  fetchDeferred: (_model, handle) => {
    appendFileSync(join(directory, "provider-ledger.txt"), `poll:${handle.id}\n`);
    if (process.env.PI_DEFERRED_FIXTURE_MODE === "interrupt") {
      // Fetch is entered only after Pi has committed its poll checkpoint.
      process.send?.({ type: "barrier", handle });
      return createAssistantMessageEventStream();
    }
    return answer(false);
  }
});
try {
  const result = await new PiDurableKernel({
    storagePath: join(directory, "deferred.sqlite"), models,
    scope: { ownerId: "owner", executionId: "deferred", stepId: "step", planVersion: 1, authorityKey: "manual" },
    model: { provider: model.provider, modelId: model.id }, instructions: "Answer asynchronously.", tools: [],
    assertStorageOwnership: () => undefined, assertAuthority: () => undefined
  }).run({ requestId: "logical-request", text: "Answer" });
  process.send?.({ type: "result", result });
  process.disconnect?.();
} catch (error) {
  process.send?.({ type: "error", error: String(error) });
  process.exitCode = 1;
  process.disconnect?.();
}
