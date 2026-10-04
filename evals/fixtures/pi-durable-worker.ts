import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createModels, createProvider, Type, type Model } from "@earendil-works/pi-ai";
import { stream, streamSimple } from "@earendil-works/pi-ai/api/openai-completions";
import { PiDurableKernel } from "../../src/lib/server/agent/durable/piKernel.js";

const directory = process.env.DATA_DIR!;
const mode = process.env.PI_KERNEL_FIXTURE_MODE!;
const model: Model<"openai-completions"> = {
  api: "openai-completions", id: "fixture", provider: "fixture", name: "Fixture",
  baseUrl: process.env.PI_KERNEL_FIXTURE_BASE_URL!, reasoning: false, input: ["text"], contextWindow: 8192, maxTokens: 1024,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
};
const models = createModels();
models.setProvider(createProvider({
  id: "fixture", name: "Fixture", models: [model],
  auth: { apiKey: { name: "Fixture key", resolve: async () => ({ auth: { apiKey: "fixture-key" } }) } },
  api: { stream, streamSimple }
}));

async function barrier(signal?: AbortSignal) {
  process.send?.({ type: "barrier" });
  await new Promise<never>((_resolve, reject) => {
    signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

const kernel = new PiDurableKernel({
  storagePath: join(directory, "execution.sqlite"), models,
  scope: { ownerId: "owner", executionId: "goal", stepId: "step", planVersion: 1, authorityKey: "manual" },
  model: { provider: "fixture", modelId: "fixture" }, instructions: "Send and record the approved report.",
  assertAuthority: () => undefined,
  assertStorageOwnership: () => undefined,
  tools: [{
    name: "sendReport", label: "Send", description: "Send report", parameters: Type.Object({}),
    execute: async (_id, _args, signal) => {
      appendFileSync(join(directory, "external-ledger.txt"), "send\n");
      if (mode === "unknown-side-effect") await barrier(signal);
      return { content: [{ type: "text", text: "sent" }], details: {} };
    }
  }, {
    name: "writeRecord", label: "Record", description: "Record report", parameters: Type.Object({}), replay: "safe",
    execute: async (_id, _args, signal) => {
      if (mode === "after-committed-result") await barrier(signal);
      appendFileSync(join(directory, "external-ledger.txt"), "record\n");
      return { content: [{ type: "text", text: "recorded" }], details: {} };
    }
  }]
});

try {
  const result = await kernel.run({ requestId: "approved-report", text: "Send and record report" });
  process.send?.({ type: "result", result, ledger: readFileSync(join(directory, "external-ledger.txt"), "utf8") });
  process.disconnect?.();
} catch (error) {
  process.send?.({ type: "error", error: String(error) });
  process.exitCode = 1;
  process.disconnect?.();
}
