import { choice } from "@typesafe-ai/sdk";
import { THINKING_LEVEL_INSTRUCTIONS, THINKING_LEVEL_CRITERIA } from "../rubric.js";
import {
  DECISION_THINKING_LEVELS,
  type DecisionThinkingLevel
} from "../contracts.js";

export function createThinkingLevelQuestion() {
  return choice(THINKING_LEVEL_INSTRUCTIONS, THINKING_LEVEL_CRITERIA);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseThinkingLevelAnswer(value: unknown): {
  choice: DecisionThinkingLevel;
  confidence: number;
  probabilities?: Record<string, number>;
} {
  if (!isRecord(value) || (value.type !== undefined && value.type !== "choice")) {
    throw new Error("malformed_response: Jev returned a non-Choice answer");
  }
  const selected = String(value.choice ?? "");
  const confidence = value.confidence;
  if (!DECISION_THINKING_LEVELS.includes(selected as DecisionThinkingLevel)
    || typeof confidence !== "number"
    || !Number.isFinite(confidence)
    || confidence < 0
    || confidence > 1) {
    throw new Error("malformed_response: Jev returned an invalid Choice");
  }

  let probabilities: Record<string, number> | undefined;
  if (value.probabilities !== undefined) {
    if (!isRecord(value.probabilities)) {
      throw new Error("malformed_response: Jev probabilities must be an object");
    }
    probabilities = {};
    for (const [key, raw] of Object.entries(value.probabilities)) {
      const probability = raw;
      if (typeof probability !== "number" || !Number.isFinite(probability) || probability < 0 || probability > 1) {
        throw new Error("malformed_response: Jev probabilities must be between 0 and 1");
      }
      probabilities[key] = probability;
    }
  }
  return { choice: selected as DecisionThinkingLevel, confidence, probabilities };
}

export function resolveTypeSafeBaseUrl(baseUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(String(baseUrl ?? "").trim());
  } catch {
    throw new Error("invalid_configuration: API Host must be a valid URL");
  }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:")
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || !parsed.hostname) {
    throw new Error("invalid_configuration: API Host must be an HTTP(S) URL without credentials or query parameters");
  }
  let pathname = parsed.pathname.replace(/\/+$/, "");
  if (pathname.endsWith("/v1/systemone")) {
    pathname = pathname.slice(0, -"/v1/systemone".length).replace(/\/+$/, "");
  } else if (pathname.endsWith("/v1")) {
    pathname = pathname.slice(0, -"/v1".length).replace(/\/+$/, "");
  }
  return `${parsed.protocol}//${parsed.host}${pathname}`;
}
