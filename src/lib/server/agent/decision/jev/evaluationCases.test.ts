import assert from "node:assert/strict";
import test from "node:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { completeSimple } from "@earendil-works/pi-ai/compat";
import { defaultRuntimeSettings } from "$lib/server/settings/defaults.js";
import { resolveModel } from "$lib/server/agent/routing/modelRouting.js";
import { LlmDecisionProvider } from "../adaptiveThinking.js";
import { CloudflareJevProvider } from "./cloudflare.js";
import { EVALUATION_CASE_IDS, evaluationCase, parseEvaluationAnswers } from "./evaluationCases.js";
import { TypeSafeJevProvider } from "./typesafe.js";

const answers = {
  noul: { refund_requested: { type: "noul", noul: 0.96 } },
  choice: { department: { type: "choice", choice: "billing", confidence: 0.9, probabilities: { billing: 0.9, technical: 0.05, other: 0.05 } } },
  score: { urgency: { type: "score", score: 1.6, confidence: 0.8, legend: { "0": "Routine: no time-sensitive request or immediate impact", "1": "Soon: a billing problem needs attention", "2": "Urgent: explicit deadline or serious immediate impact" }, probabilities: { "0": 0.05, "1": 0.3, "2": 0.65 } } }
} as const;

for (const id of EVALUATION_CASE_IDS) {
  test(`${id} case sends identical state and questions to TypeSafe, Cloudflare, and the LLM`, async () => {
    const expected = evaluationCase(id);
    let typesafeInput: { state: unknown; questions: unknown } | undefined;
    let cloudflareInput: { state: unknown; questions: unknown } | undefined;
    let llmInput: { state: unknown; questions: unknown } | undefined;
    const body = JSON.stringify({ model: "jev-test", answers: answers[id] });
    const typesafe = new TypeSafeJevProvider("https://api.typesafe.ai", "key", async (_url, init) => {
      typesafeInput = JSON.parse(String(init?.body));
      return new Response(body, { status: 200 });
    });
    const cloudflare = new CloudflareJevProvider("account-123", "token", async (_url, init) => {
      cloudflareInput = JSON.parse(String(init?.body)).input;
      return new Response(body, { status: 200 });
    });
    const complete: typeof completeSimple = async (_model, context) => {
      llmInput = JSON.parse(String(context.messages[0]?.content));
      assert.deepEqual(context.tools, []);
      return fauxAssistantMessage(JSON.stringify({ answers: answers[id] }));
    };
    const llm = new LlmDecisionProvider(resolveModel(defaultRuntimeSettings, "text"), "key", complete);
    const signal = new AbortController().signal;
    const [direct, workers, textModel] = await Promise.all([
      typesafe.evaluateTestCase(id, signal),
      cloudflare.evaluateTestCase(id, signal),
      llm.evaluateTestCase(id, signal)
    ]);
    const expectedInput = { state: expected.state, questions: expected.questions };
    assert.deepEqual({ state: typesafeInput?.state, questions: typesafeInput?.questions }, expectedInput);
    assert.deepEqual(cloudflareInput, expectedInput);
    assert.deepEqual(llmInput, expectedInput);
    assert.deepEqual(direct.answers, workers.answers);
    assert.deepEqual(textModel.answers, direct.answers);
    assert.deepEqual(textModel.testCase, expected);
  });
}

test("evaluation rejects invalid labels, scores, and probabilities", () => {
  assert.throws(() => parseEvaluationAnswers("noul", { refund_requested: { type: "noul", noul: 1.2 } }), /probability/);
  assert.throws(() => parseEvaluationAnswers("choice", { department: { ...answers.choice.department, choice: "unknown" } }), /choice label/);
  assert.throws(() => parseEvaluationAnswers("score", { urgency: { ...answers.score.urgency, score: 4 } }), /outside the rubric/);
  assert.throws(() => parseEvaluationAnswers("score", { urgency: { ...answers.score.urgency, legend: { "0": "wrong", "1": "wrong", "2": "wrong" } } }), /legend/);
  assert.throws(() => parseEvaluationAnswers("noul", { ...answers.noul, extra: {} }), /expected one/);
});
