import assert from "node:assert/strict";
import test from "node:test";
import { THINKING_LEVEL_INSTRUCTIONS, THINKING_LEVEL_CRITERIA } from "../rubric.js";
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
          instructions: THINKING_LEVEL_INSTRUCTIONS,
          criteria: THINKING_LEVEL_CRITERIA
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

test("Cloudflare rejects coerced confidence and probability values", async () => {
  for (const invalid of [null, "", false, "0.9"]) {
    for (const field of ["confidence", "probability"]) {
      const answer = { type: "choice", choice: "low", confidence: field === "confidence" ? invalid : 0.9, probabilities: { low: field === "probability" ? invalid : 0.9 } };
      const provider = new CloudflareJevProvider("account", "key", async () => new Response(JSON.stringify({ answers: { thinking_level: answer } }), { status: 200 }));
      await assert.rejects(() => provider.decide({ context: buildAdaptiveThinkingContext("Translate this."), signal: new AbortController().signal }), /malformed_response/);
    }
  }
});
