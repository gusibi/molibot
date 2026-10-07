import assert from "node:assert/strict";
import test from "node:test";
import { defaultRuntimeSettings } from "$lib/server/settings/defaults.js";
import { decideDurableActivation, DURABLE_ACTIVATION_QUESTION } from "./durableActivation.js";
import { CloudflareJevProvider } from "./jev/cloudflare.js";
import { TypeSafeJevProvider } from "./jev/typesafe.js";
import { LlmDecisionProvider } from "./adaptiveThinking.js";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { resolveModel } from "$lib/server/agent/routing/modelRouting.js";

function settings() {
  const value = structuredClone(defaultRuntimeSettings);
  value.adaptiveThinking.enabled = true;
  value.adaptiveThinking.timeoutMs = 1000;
  return value;
}

const pastedPrompts = '1. 专业精修\n保持附近每个元素不变，不要数字生成。\n2. 稍后继续：这是提示词示例。\n@prompt-box 收录这个提示词';

test("activation sends the requested action and content to the selected decision provider", async () => {
  const result = await decideDurableActivation({ message: pastedPrompts, settings: settings() }, async () => ({
    async decide(input) {
      assert.equal(input.question, DURABLE_ACTIVATION_QUESTION);
      assert.match(input.question.instructions, /pasted articles, prompts/);
      assert.match(input.context.state, /@prompt-box 收录这个提示词/);
      assert.match(input.question.criteria.ordinary, /collection of prompts/);
      return { level: "ordinary", confidence: 0.99 };
    }
  }));
  assert.equal(result.mode, "ordinary");
  assert.equal(result.degraded, undefined);
});

test("a confident durable decision promotes dependent work", async () => {
  const result = await decideDurableActivation({ message: "Complete the release over several days", settings: settings() }, async () => ({
    async decide() { return { level: "durable", confidence: 0.99, provider: "jev", model: "configured" }; }
  }));
  assert.deepEqual(result, { mode: "promote", reason: "decision_model:jev:configured:durable" });
});

test("unavailable, invalid and uncertain decisions never fall back to keyword promotion", async () => {
  const input = { message: pastedPrompts, settings: settings() };
  assert.equal((await decideDurableActivation({ message: pastedPrompts })).mode, "ordinary");
  assert.equal((await decideDurableActivation(input, async () => null)).reason, "decision_model_unavailable");
  for (const result of [
    { level: "durable", confidence: 0.01 },
    { level: "durable", confidence: NaN },
    { level: "high", confidence: 0.99 }
  ]) {
    const decision = await decideDurableActivation(input, async () => ({ async decide() { return result; } }));
    assert.equal(decision.mode, "ordinary");
    assert.equal(decision.degraded, true);
  }
  assert.equal((await decideDurableActivation(input, async () => { throw new Error("offline"); })).reason, "decision_model_error");
});

test("timeout cancels the provider and caller cancellation propagates", async () => {
  let signal: AbortSignal | undefined;
  const hanging = async () => ({ decide(input: { signal: AbortSignal }) { signal = input.signal; return new Promise<never>(() => {}); } });
  const timedSettings = settings();
  timedSettings.adaptiveThinking.timeoutMs = 25;
  const result = await decideDurableActivation({ message: pastedPrompts, settings: timedSettings }, hanging);
  assert.equal(result.reason, "decision_model_timeout");
  assert.equal(signal?.aborted, true);
  const controller = new AbortController();
  const promise = decideDurableActivation({ message: pastedPrompts, settings: settings(), signal: controller.signal }, async () => ({
    async decide() { controller.abort(); return { level: "durable", confidence: 0.99 }; }
  }));
  await assert.rejects(promise, /abort/i);
});

for (const adapter of ["typesafe", "cloudflare"] as const) {
  test(`${adapter} sends and parses the durable Choice rather than thinking-level criteria`, async () => {
    const request: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      const question = (body.input ?? body).questions.execution_mode;
      assert.equal(question.type, "choice");
      assert.deepEqual(question.criteria, DURABLE_ACTIVATION_QUESTION.criteria);
      return new Response(JSON.stringify({ model: "jev", answers: { execution_mode: { type: "choice", choice: "ordinary", confidence: 0.98, probabilities: { ordinary: 0.98, durable: 0.02 } } } }), { status: 200 });
    };
    const provider = adapter === "typesafe" ? new TypeSafeJevProvider("https://api.typesafe.ai", "test", request) : new CloudflareJevProvider("account", "test", request);
    const result = await decideDurableActivation({ message: pastedPrompts, settings: settings() }, async () => provider);
    assert.equal(result.mode, "ordinary");
    assert.equal(result.degraded, undefined);
  });
}

test("LLM decision uses durable labels and rejects thinking labels", async () => {
  const model = resolveModel(defaultRuntimeSettings);
  const provider = new LlmDecisionProvider(model, "test", async (_model, context) => {
    assert.match(context.systemPrompt ?? "", /ordinary\|durable/);
    assert.match(context.systemPrompt ?? "", /pasted articles/);
    return fauxAssistantMessage('{"level":"ordinary","confidence":0.99}');
  });
  const result = await decideDurableActivation({ message: pastedPrompts, settings: settings() }, async () => provider);
  assert.equal(result.mode, "ordinary");
  assert.equal(result.degraded, undefined);
});
