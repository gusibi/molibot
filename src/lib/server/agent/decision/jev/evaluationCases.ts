import { choice, noul, score, type Questions } from "@typesafe-ai/sdk";

export const EVALUATION_CASE_IDS = ["noul", "choice", "score"] as const;
export type EvaluationCaseId = typeof EVALUATION_CASE_IDS[number];
export interface EvaluationCaseResult {
  provider: string;
  model: string;
  testCase: ReturnType<typeof evaluationCase>;
  answers: Record<string, unknown>;
}

const state = {
  ticket: {
    subject: "Duplicate charge for order A-104",
    message: "I was charged twice for order A-104. Please refund the duplicate charge today."
  },
  order: { id: "A-104", captured_charges_usd: [49, 49] },
  refund_policy: "Duplicate captured charges are eligible for a refund."
};
const choiceCriteria = {
  billing: "Charges, invoices, and refunds",
  technical: "Bugs, outages, and integrations",
  other: "Requests outside billing and technical support"
};
const scoreCriteria = [
  "Routine: no time-sensitive request or immediate impact",
  "Soon: a billing problem needs attention",
  "Urgent: explicit deadline or serious immediate impact"
] as const;

export function evaluationCase(id: EvaluationCaseId): { id: EvaluationCaseId; state: typeof state; questions: Questions } {
  if (id === "noul") return {
    id,
    state,
    questions: { refund_requested: noul("Does the customer explicitly request a refund?", {
      true: "The customer asks for a refund.",
      false: "The customer does not ask for a refund."
    }) }
  };
  if (id === "choice") return {
    id,
    state,
    questions: { department: choice("Which team should handle this ticket?", choiceCriteria) }
  };
  return {
    id,
    state,
    questions: { urgency: score("How urgently should this ticket be handled?", scoreCriteria) }
  };
}

export function parseEvaluationCaseId(value: unknown): EvaluationCaseId {
  if (EVALUATION_CASE_IDS.includes(value as EvaluationCaseId)) return value as EvaluationCaseId;
  throw new Error("Select a valid Jev test mode.");
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function probability(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error("malformed_response: evaluation probability must be between 0 and 1");
  }
  return value;
}

export function parseEvaluationAnswers(id: EvaluationCaseId, value: unknown): Record<string, unknown> {
  const answers = record(value);
  const test = evaluationCase(id);
  const key = Object.keys(test.questions)[0]!;
  if (!answers || Object.keys(answers).length !== 1) throw new Error(`malformed_response: expected one ${id} answer`);
  const answer = record(answers?.[key]);
  if (!answer || answer.type !== id) throw new Error(`malformed_response: missing ${id} answer`);
  if (id === "noul") return { [key]: { type: "noul", noul: probability(answer.noul) } };

  const confidence = probability(answer.confidence);
  const allowed = id === "choice"
    ? Object.keys(choiceCriteria)
    : scoreCriteria.map((_, index) => String(index));
  const rawProbabilities = record(answer.probabilities);
  if (!rawProbabilities || Object.keys(rawProbabilities).length !== allowed.length) {
    throw new Error(`malformed_response: ${id} probabilities do not match the criteria`);
  }
  const probabilities = Object.fromEntries(allowed.map((label) => [label, probability(rawProbabilities[label])]));
  if (id === "choice") {
    if (typeof answer.choice !== "string" || !allowed.includes(answer.choice)) {
      throw new Error("malformed_response: invalid choice label");
    }
    return { [key]: { type: "choice", choice: answer.choice, confidence, probabilities } };
  }
  if (typeof answer.score !== "number" || !Number.isFinite(answer.score) || answer.score < 0 || answer.score > allowed.length - 1) {
    throw new Error("malformed_response: score is outside the rubric");
  }
  const legend = Object.fromEntries(scoreCriteria.map((description, index) => [String(index), description]));
  const rawLegend = record(answer.legend);
  if (!rawLegend || Object.keys(rawLegend).length !== allowed.length
    || allowed.some((label) => rawLegend[label] !== legend[label])) {
    throw new Error("malformed_response: score legend does not match the rubric");
  }
  return { [key]: { type: "score", score: answer.score, confidence, legend, probabilities } };
}
