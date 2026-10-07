import type { ClassifierModel } from "@earendil-works/pi-ai";
import { getPiModels } from "$lib/server/providers/piRegistry.js";
import { APIConnectionError, APIError, APITimeoutError, APIUserAbortError, TypeSafeClient } from "@typesafe-ai/sdk";
import type { DecisionContext, DecisionProvider, DecisionProviderResult, DecisionQuestion } from "../contracts.js";
import { parseChoiceAnswer, resolveTypeSafeBaseUrl } from "./protocol.js";
import { evaluationCase, parseEvaluationAnswers, type EvaluationCaseId, type EvaluationCaseResult } from "./evaluationCases.js";

import { THINKING_LEVEL_INSTRUCTIONS, THINKING_LEVEL_CRITERIA } from "../rubric.js";

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
  private readonly classifier: ClassifierModel<"typesafe-system-one">;
  private readonly apiKey: string;
  private readonly fetchRequest: typeof fetch;

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
    const catalogModel = getPiModels().getModelOfType("classifier", "typesafe", DEFAULT_JEV_MODEL);
    if (!catalogModel) throw new Error("TypeSafe classifier is missing from the Pi catalog");
    this.classifier = { ...catalogModel, api: "typesafe-system-one", id: this.modelId, baseUrl: resolveTypeSafeBaseUrl(baseUrl) + "/v1" };
    this.apiKey = apiKey;
    this.fetchRequest = fetchRequest;
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

  async decide(input: { context: DecisionContext; question?: DecisionQuestion; signal: AbortSignal }): Promise<DecisionProviderResult> {
    const question = input.question ?? { id: "thinking_level", instructions: THINKING_LEVEL_INSTRUCTIONS, criteria: THINKING_LEVEL_CRITERIA };
    let httpStatus: number | undefined;
    let networkFailed = false;
    const response = await getPiModels().classify(this.classifier, {
      state: { request: input.context.state },
      questions: { [question.id]: { type: "choice", instructions: question.instructions, criteria: question.criteria } }
    }, {
      apiKey: this.apiKey,
      signal: input.signal,
      timeoutMs: REQUEST_TIMEOUT_MS,
      maxRetries: 0,
      fetch: async (url, init) => {
        try {
          const result = await this.fetchRequest(url, { ...init, redirect: "error" });
          httpStatus = result.status;
          return result;
        } catch (error) {
          networkFailed = true;
          throw error;
        }
      }
    });
    if (response.stopReason !== "stop") {
      if (input.signal.aborted) throw new Error("Jev request was aborted");
      if (httpStatus !== undefined && httpStatus >= 400) throw new Error("Jev request failed (HTTP " + httpStatus + ")");
      if (networkFailed) throw new Error("Jev request failed: network error or timeout");
      throw new Error("malformed_response: Jev returned an invalid response");
    }
    const answer = parseChoiceAnswer(response.answers[question.id], Object.keys(question.criteria));
    return {
      level: answer.choice,
      confidence: answer.confidence,
      probabilities: answer.probabilities,
      ...(response.usage !== undefined
        ? { usage: { inputTokens: response.usage.input, outputTokens: response.usage.output } } : {}),
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
