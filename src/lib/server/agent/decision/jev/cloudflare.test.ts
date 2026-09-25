import assert from "node:assert/strict";
import test from "node:test";
import { buildAdaptiveThinkingContext } from "../adaptiveThinking.js";
import { CloudflareJevProvider } from "./cloudflare.js";

test("Cloudflare Jev uses the Workers AI universal run request", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const response = new Response(JSON.stringify({
    model: "jev-1.13.0",
    answers: {
      thinking_level: {
        type: "choice",
        choice: "high",
        confidence: 0.91,
        probabilities: { low: 0.01, medium: 0.08, high: 0.91 }
      }
    }
  }), { status: 200, headers: { "content-type": "application/json" } });
  const provider = new CloudflareJevProvider("account-123", "cf-token", async (input, init) => {
    requestUrl = String(input);
    requestInit = init;
    return response;
  });
  const context = buildAdaptiveThinkingContext("Compare these options.");
  const result = await provider.decide({ context, signal: new AbortController().signal });

  assert.equal(requestUrl, "https://api.cloudflare.com/client/v4/accounts/account-123/ai/run");
  assert.equal(new Headers(requestInit?.headers).get("authorization"), "Bearer cf-token");
  assert.deepEqual(JSON.parse(String(requestInit?.body)), {
    model: "typesafe/jev",
    input: {
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
      }
    }
  });
  assert.deepEqual(result, {
    level: "high",
    confidence: 0.91,
    probabilities: { low: 0.01, medium: 0.08, high: 0.91 },
    provider: "cloudflare",
    model: "jev-1.13.0"
  });
});

test("Cloudflare Jev rejects an invalid account ID before making a request", async () => {
  let calls = 0;
  const provider = new CloudflareJevProvider("bad/account", "token", async () => {
    calls += 1;
    return new Response();
  });
  await assert.rejects(
    () => provider.decide({ context: buildAdaptiveThinkingContext("Review this."), signal: new AbortController().signal }),
    /invalid_configuration.*Account ID/
  );
  assert.equal(calls, 0);
});
