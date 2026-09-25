import assert from "node:assert/strict";
import test from "node:test";
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
        instructions: "Which reasoning effort is appropriate for this request?",
        criteria: {
          low: "Direct answer, routine transformation, or a simple action with clear requirements.",
          medium: "Several dependent steps, bounded debugging, or analysis that needs comparison and verification.",
          high: "Difficult diagnosis, interacting constraints, architectural tradeoffs, or complex multi-step reasoning."
        }
      }
    },
    model: "jev-latest"
  });
  assert.deepEqual(result, {
    level: "medium",
    confidence: 0.86,
    probabilities: { low: 0.05, medium: 0.86, high: 0.09 },
    provider: "typesafe",
    model: "jev-latest"
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
