export const DECISION_THINKING_LEVELS = ["low", "medium", "high"] as const;

export type DecisionThinkingLevel = (typeof DECISION_THINKING_LEVELS)[number];

export interface DecisionContext {
  state: string;
  estimatedTokens: number;
  serializedBytes: number;
  truncated: boolean;
}

export interface DecisionProviderResult {
  level: string;
  confidence?: number;
  probabilities?: Record<string, number>;
  provider?: string;
  model?: string;
}

export interface DecisionProvider {
  decide(input: {
    context: DecisionContext;
    signal: AbortSignal;
  }): Promise<DecisionProviderResult>;
}
