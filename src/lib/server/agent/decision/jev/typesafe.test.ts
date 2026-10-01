import assert from "node:assert/strict";
import test from "node:test";
import { THINKING_LEVEL_INSTRUCTIONS, THINKING_LEVEL_CRITERIA } from "../rubric.js";
import { buildAdaptiveThinkingContext } from "../adaptiveThinking.js";
import { TypeSafeJevProvider } from "./typesafe.js";

test("TypeSafe Jev uses the SDK System One endpoint and validates its Choice result", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const provider = new TypeSafeJevProvider("https://api.typesafe.ai", "test-key", async (input, init) => {
    requestUrl = String(input);
    requestInit = init;
    return new Response(JSON.stringify({
      model: "jev-latest",
      usage: { input_tokens: 24, output_tokens: 5 },
      answers: {
        thinking_level: {
          type: "choice",
          choice: "medium",
          confidence: 0.86,
          probabilities: { low: 0.05, medium: 0.86, high: 0.09 }
        }
      }
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  const context = buildAdaptiveThinkingContext("Compare the two approaches.");
  const result = await provider.decide({ context, signal: new AbortController().signal });

  assert.equal(requestUrl, "https://api.typesafe.ai/v1/systemone");
  assert.equal(new Headers(requestInit?.headers).get("authorization"), "Bearer test-key");
  assert.deepEqual(JSON.parse(String(requestInit?.body)), {
    state: context.state,
    questions: {
      thinking_level: {
        type: "choice",
        instructions: THINKING_LEVEL_INSTRUCTIONS,
        criteria: THINKING_LEVEL_CRITERIA
      }
    },
    model: "jev-latest"
  });
  assert.deepEqual(result, {
    level: "medium",
    confidence: 0.86,
    probabilities: { low: 0.05, medium: 0.86, high: 0.09 },
    provider: "typesafe",
    model: "jev-latest",
    usage: { inputTokens: 24, outputTokens: 5 }
  });
});

test("TypeSafe Jev normalizes a full System One URL and rejects unsafe Hosts before fetching", async () => {
  let calls = 0;
  let requestUrl = "";
  const provider = new TypeSafeJevProvider("https://api.typesafe.ai/v1/systemone/", "test-key", async (input) => {
    calls += 1;
    requestUrl = String(input);
    return new Response(JSON.stringify({
      model: "jev-latest",
      answers: { refund_requested: { type: "noul", noul: 0.9 } }
    }), { status: 200 });
  });
  const testResult = await provider.evaluateTestCase("noul", new AbortController().signal);
  assert.equal(testResult.provider, "typesafe");
  assert.equal(testResult.model, "jev-latest");
  assert.deepEqual(testResult.answers, { refund_requested: { type: "noul", noul: 0.9 } });
  assert.equal(requestUrl, "https://api.typesafe.ai/v1/systemone");
  assert.equal(calls, 1);
  assert.throws(
    () => new TypeSafeJevProvider("https://user:pass@example.test/?token=secret", "test-key", async () => new Response()),
    /invalid_configuration/
  );
});

test("TypeSafe errors never expose an upstream credential echo", async () => {
  const provider = new TypeSafeJevProvider("https://proxy.example.test", "saved-secret", async () => new Response(JSON.stringify({ error: "Invalid API key saved-secret" }), { status: 401 }));
  for (const run of [
    () => provider.decide({ context: buildAdaptiveThinkingContext("Translate this."), signal: new AbortController().signal }),
    () => provider.evaluateTestCase("choice", new AbortController().signal)
  ]) {
    await assert.rejects(run, (error: Error) => error.message === "Jev request failed (HTTP 401)" && !error.message.includes("saved-secret"));
  }
});

test("TypeSafe rejects coerced confidence and probability values", async () => {
  for (const invalid of [null, "", false, "0.9"]) {
    for (const field of ["confidence", "probability"]) {
      const answer = { type: "choice", choice: "low", confidence: field === "confidence" ? invalid : 0.9, probabilities: { low: field === "probability" ? invalid : 0.9 } };
      const provider = new TypeSafeJevProvider("https://proxy.example.test", "key", async () => new Response(JSON.stringify({ answers: { thinking_level: answer } }), { status: 200 }));
      await assert.rejects(() => provider.decide({ context: buildAdaptiveThinkingContext("Translate this."), signal: new AbortController().signal }), /malformed_response/);
    }
  }
});
