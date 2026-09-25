import type { DecisionContext, DecisionProvider, DecisionProviderResult } from "../contracts.js";
import { createThinkingLevelQuestion, parseThinkingLevelAnswer } from "./protocol.js";
import { evaluationCase, parseEvaluationAnswers, type EvaluationCaseId, type EvaluationCaseResult } from "./evaluationCases.js";

const CLOUDFLARE_JEV_MODEL = "typesafe/jev";

export function isValidCloudflareAccountId(value: string): boolean {
  return Boolean(value.trim() && !/[/?#]/.test(value));
}

function resolveCloudflareEndpoint(accountId: string): string {
  const value = String(accountId ?? "").trim();
  if (!isValidCloudflareAccountId(value)) {
    throw new Error("invalid_configuration: Cloudflare Account ID is required");
  }
  return "https://api.cloudflare.com/client/v4/accounts/" + encodeURIComponent(value) + "/ai/run";
}

export class CloudflareJevProvider implements DecisionProvider {
  constructor(
    private readonly accountId = "",
    private readonly apiToken = "",
    private readonly fetchRequest: typeof fetch = fetch
  ) {}

  async decide(input: { context: DecisionContext; signal: AbortSignal }): Promise<DecisionProviderResult> {
    const response = await this.fetchRequest(resolveCloudflareEndpoint(this.accountId), {
      method: "POST",
      headers: { authorization: "Bearer " + this.apiToken, "content-type": "application/json" },
      body: JSON.stringify({
        model: CLOUDFLARE_JEV_MODEL,
        input: {
          state: input.context.state,
          questions: { thinking_level: createThinkingLevelQuestion() }
        }
      }),
      signal: input.signal,
      redirect: "error"
    });
    const payload = await response.json().catch(() => null) as { model?: unknown; answers?: Record<string, unknown> } | null;
    if (!response.ok) throw new Error("Cloudflare Workers AI request failed (" + response.status + ")");
    if (!payload?.answers?.thinking_level) {
      throw new Error("malformed_response: Cloudflare Jev response has no thinking-level answer");
    }
    const answer = parseThinkingLevelAnswer(payload.answers.thinking_level);
    return {
      level: answer.choice,
      confidence: answer.confidence,
      probabilities: answer.probabilities,
      provider: "cloudflare",
      model: String(payload.model ?? CLOUDFLARE_JEV_MODEL)
    };
  }

  async evaluateTestCase(id: EvaluationCaseId, signal: AbortSignal): Promise<EvaluationCaseResult> {
    const testCase = evaluationCase(id);
    const response = await this.fetchRequest(resolveCloudflareEndpoint(this.accountId), {
      method: "POST",
      headers: { authorization: "Bearer " + this.apiToken, "content-type": "application/json" },
      body: JSON.stringify({ model: CLOUDFLARE_JEV_MODEL, input: { state: testCase.state, questions: testCase.questions } }),
      signal,
      redirect: "error"
    });
    const payload = await response.json().catch(() => null) as { model?: unknown; answers?: unknown } | null;
    if (!response.ok) throw new Error("Cloudflare Workers AI request failed (" + response.status + ")");
    return {
      provider: "cloudflare",
      model: String(payload?.model ?? CLOUDFLARE_JEV_MODEL),
      testCase,
      answers: parseEvaluationAnswers(id, payload?.answers)
    };
  }
}
