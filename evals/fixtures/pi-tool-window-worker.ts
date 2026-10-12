import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { createAssistantMessageEventStream, type AssistantMessage, type Model } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { PiRunSession } from "../../src/lib/server/agent/core/piRunSession.js";

const directory = process.env.DATA_DIR!;
const window = process.env.PI_TOOL_WINDOW!;
const replay = process.env.PI_TOOL_REPLAY === "safe" ? "safe" as const : undefined;

const model: Model<"openai-completions"> = { api: "openai-completions", id: "fixture", provider: "fixture", name: "Fixture",
  baseUrl: "http://fixture.invalid", reasoning: false, input: ["text"], contextWindow: 8192, maxTokens: 1024,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };

const answer = (): AssistantMessage => ({ role: "assistant", api: model.api, provider: model.provider, model: model.id,
  content: [{ type: "text", text: "Done" }], stopReason: "stop", timestamp: Date.now(),
  usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });

const hold = () => new Promise<never>(() => undefined);
let executions = 0;

// The external simulator ledger is independent of any Molibot state: it counts
// real effect executions across attempts.
const tool: AgentTool = {
  name: "effect", label: "Effect", description: "Effect", parameters: { type: "object", properties: {} },
  ...(replay ? { replay } : {}),
  execute: async () => {
    appendFileSync(join(directory, "ledger"), `exec:${++executions}\n`);
    if (window === "external-success") {
      // The external operation already happened; kill before its result can commit.
      process.send?.({ type: "barrier" });
      await new Promise((resolve) => setTimeout(resolve, 60_000));
    }
    return { content: [{ type: "text", text: "ok" }], details: {} };
  }
};

let requests = 0;
const run = new PiRunSession({
  initialState: { model, systemPrompt: "Answer", messages: [], tools: [tool] },
  getApiKey: () => "fixture",
  beforeToolCall: async (context) => {
    // intent 前: hold inside the tool's `call` phase, before its durable intent commit.
    if (window === "before-intent") { process.send?.({ type: "barrier" }); await hold(); }
    // 结果提交未投影: the first call is committed; hold the second before intent.
    if (window === "committed-not-projected" && context.toolCall.id === "call-2") { process.send?.({ type: "barrier" }); await hold(); }
    return undefined;
  },
  streamFn: () => {
    requests += 1;
    const stream = createAssistantMessageEventStream();
    const message: AssistantMessage = requests === 1
      ? { ...answer(), stopReason: "toolUse", content: window === "committed-not-projected"
        ? [{ type: "toolCall", id: "call-1", name: "effect", arguments: {} }, { type: "toolCall", id: "call-2", name: "effect", arguments: {} }]
        : [{ type: "toolCall", id: "call-1", name: "effect", arguments: {} }] }
      : answer();
    stream.push({ type: "done", reason: message.stopReason === "toolUse" ? "toolUse" : "stop", message });
    stream.end();
    return stream;
  }
});

run.startTurn();
run.bindRun({
  storagePath: join(directory, "pi.sqlite"), requestId: "inbound", admissionKey: "manual", models: [model],
  scope: { ownerId: "owner", executionId: "run", stepId: "step", planVersion: 1, authorityKey: "manual" },
  assertStorageOwnership: () => undefined, assertAuthority: () => undefined
});
void run.prompt("Do it").catch(() => undefined);
