import { APIConnectionError, APIError, APITimeoutError, APIUserAbortError, TypeSafeClient } from "@typesafe-ai/sdk";
import type { DecisionContext, DecisionProvider, DecisionProviderResult } from "../contracts.js";
import { createThinkingLevelQuestion, parseThinkingLevelAnswer, resolveTypeSafeBaseUrl } from "./protocol.js";
import { evaluationCase, parseEvaluationAnswers, type EvaluationCaseId, type EvaluationCaseResult } from "./evaluationCases.js";

const DEFAULT_JEV_MODEL = "jev-latest";
const REQUEST_TIMEOUT_MS = 10_000;

function createClient(baseUrl: string, apiKey: string, modelId: string, fetchRequest: typeof fetch): TypeSafeClient {
  if (!apiKey.trim()) throw new Error("invalid_configuration: Jev API key is required");
  return new TypeSafeClient({
    apiKey,
    baseURL: resolveTypeSafeBaseUrl(baseUrl),
    defaultModel: modelId,
    logLevel: "off",
    timeout: REQUEST_TIMEOUT_MS,
    retry: { maxRetries: 0 },
    fetch: (input, init) => fetchRequest(input, { ...init, redirect: "error" })
  });
}

export class TypeSafeJevProvider implements DecisionProvider {
  private readonly client: TypeSafeClient;
  private readonly modelId: string;
  private readonly providerId: string;

  constructor(
    baseUrl: string,
    apiKey: string,
    fetchRequest: typeof fetch = fetch,
    modelId = DEFAULT_JEV_MODEL,
    providerId = "typesafe"
  ) {
    this.modelId = modelId.trim() || DEFAULT_JEV_MODEL;
    this.providerId = providerId;
    this.client = createClient(baseUrl, apiKey, this.modelId, fetchRequest);
  }

  private async request(payload: Parameters<TypeSafeClient["systemOne"]>[0], options: { signal: AbortSignal }) {
    try {
      return await this.client.systemOne(payload, options);
    } catch (error) {
      if (error instanceof APIUserAbortError) throw new Error("Jev request was aborted");
      if (error instanceof APITimeoutError) throw new Error("Jev request timed out");
      if (error instanceof APIError) throw new Error("Jev request failed (HTTP " + error.status + ")");
      if (error instanceof APIConnectionError) throw new Error("Jev request failed: network error");
      throw new Error("malformed_response: Jev returned an invalid response");
    }
  }

  async decide(input: { context: DecisionContext; signal: AbortSignal }): Promise<DecisionProviderResult> {
    const response = await this.request({
      state: input.context.state,
      questions: { thinking_level: createThinkingLevelQuestion() }
    }, { signal: input.signal });
    const answer = parseThinkingLevelAnswer(response.answers.thinking_level);
    return {
      level: answer.choice,
      confidence: answer.confidence,
      probabilities: answer.probabilities,
      ...(Number.isFinite(response.usage?.input_tokens) && Number.isFinite(response.usage?.output_tokens)
        ? { usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens } } : {}),
      provider: this.providerId,
      model: response.model ?? this.modelId
    };
  }

  async evaluateTestCase(id: EvaluationCaseId, signal: AbortSignal): Promise<EvaluationCaseResult> {
    const testCase = evaluationCase(id);
    const response = await this.request({ state: testCase.state, questions: testCase.questions }, { signal });
    return {
      provider: this.providerId,
      model: response.model ?? this.modelId,
      testCase,
      answers: parseEvaluationAnswers(id, response.answers)
    };
  }
}
