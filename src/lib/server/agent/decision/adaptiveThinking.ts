import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AdaptiveThinkingSettings, RuntimeThinkingLevel, ThinkingStrategy } from "$lib/server/settings/index.js";
import { RUNTIME_THINKING_LEVELS } from "$lib/server/settings/index.js";
import { estimateMessageTokens } from "$lib/server/agent/session/compaction.js";
import { sliceToBytes } from "$lib/server/agent/tools/truncate.js";

export const ADAPTIVE_THINKING_RUBRIC_VERSION = "v1-3-levels";
export const ADAPTIVE_THINKING_LEVELS = ["low", "medium", "high"] as const;

export type AdaptiveThinkingLevel = (typeof ADAPTIVE_THINKING_LEVELS)[number];

export interface AdaptiveThinkingContext {
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
    context: AdaptiveThinkingContext;
    settings: AdaptiveThinkingSettings;
    signal: AbortSignal;
  }): Promise<DecisionProviderResult>;
  testConnection(input: {
    baseUrl: string;
    apiKey: string;
    signal: AbortSignal;
  }): Promise<{ provider?: string; model?: string }>;
}

export type AdaptiveFallbackReason =
  | "disabled"
  | "missing_credential"
  | "invalid_configuration"
  | "timeout"
  | "network_error"
  | "malformed_response"
  | "invalid_confidence"
  | "low_confidence"
  | "insufficient_context"
  | "no_effective_choice";

export interface AdaptiveResolution {
  strategy: ThinkingStrategy;
  requestedLevel: RuntimeThinkingLevel;
  confidence?: number;
  probabilities?: Record<string, number>;
  fallbackReason?: AdaptiveFallbackReason;
  provider?: string;
  model?: string;
  latencyMs: number;
}

const MAX_CONTEXT_TOKENS = 2048;
const MAX_CONTEXT_BYTES = 12 * 1024;

function textFromMessage(message: AgentMessage): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const value = part as Record<string, unknown>;
      return value.type === "text" ? String(value.text ?? "") : "";
    })
    .filter(Boolean)
    .join("\n");
}

function takeMessageExcerpt(message: AgentMessage, maxBytes: number): string {
  const role = String((message as { role?: unknown }).role ?? "unknown");
  const content = sliceToBytes(textFromMessage(message), maxBytes).trim();
  return content ? role + ": " + content : "";
}

function headTailSlice(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  const marker = "\n[… context truncated …]\n";
  const available = Math.max(0, maxBytes - Buffer.byteLength(marker, "utf8"));
  const headBytes = Math.ceil(available * 0.6);
  const tailBytes = Math.max(0, available - headBytes);
  const buffer = Buffer.from(text, "utf8");
  let start = Math.max(0, buffer.byteLength - tailBytes);
  while (start < buffer.byteLength && ((buffer[start] ?? 0) & 0xc0) === 0x80) start += 1;
  return sliceToBytes(text, headBytes) + marker + buffer.subarray(start).toString("utf8");
}

function estimateTextTokens(text: string): number {
  return estimateMessageTokens({ role: "user", content: text, timestamp: Date.now() } as AgentMessage);
}

function fitTextToTokens(text: string, maxTokens: number): string {
  if (estimateTextTokens(text) <= maxTokens) return text;
  let low = 1;
  let high = Buffer.byteLength(text, "utf8");
  let best = "";
  while (low <= high) {
    const bytes = Math.floor((low + high) / 2);
    const candidate = headTailSlice(text, bytes);
    if (estimateTextTokens(candidate) <= maxTokens) {
      best = candidate;
      low = bytes + 1;
    } else {
      high = bytes - 1;
    }
  }
  return best;
}

/** Builds bounded context without reading tools, files, attachments, or repositories. */
export function buildAdaptiveThinkingContext(
  currentRequest: string,
  recentMessages: AgentMessage[] = [],
  metadata: Record<string, unknown> = {}
): AdaptiveThinkingContext {
  const rows: string[] = [];
  const current = String(currentRequest ?? "").trim();
  if (current) rows.push(fitTextToTokens("current_request: " + current, MAX_CONTEXT_TOKENS));

  let tokenBudget = estimateTextTokens(rows[0] ?? "");
  for (const message of recentMessages.slice(-4).reverse()) {
    if (tokenBudget >= MAX_CONTEXT_TOKENS) break;
    const excerpt = takeMessageExcerpt(message, 4096);
    if (!excerpt) continue;
    const tokens = estimateMessageTokens({ role: "user", content: excerpt, timestamp: Date.now() } as AgentMessage);
    if (tokenBudget + tokens > MAX_CONTEXT_TOKENS) continue;
    rows.push(excerpt);
    tokenBudget += tokens;
  }

  const compactMetadata = Object.fromEntries(
    Object.entries(metadata).filter(([, value]) =>
      typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    )
  );
  if (Object.keys(compactMetadata).length > 0) rows.push("metadata: " + JSON.stringify(compactMetadata));

  if (rows.at(-1)?.startsWith("metadata: ")) {
    const metadata = rows.pop()!;
    const metadataTokens = estimateTextTokens(metadata);
    if (tokenBudget + metadataTokens <= MAX_CONTEXT_TOKENS) {
      rows.push(metadata);
      tokenBudget += metadataTokens;
    }
  }

  let state = rows.join("\n\n");
  let truncated = false;
  if (estimateTextTokens(state) > MAX_CONTEXT_TOKENS) {
    state = fitTextToTokens(state, MAX_CONTEXT_TOKENS);
    truncated = true;
  }
  if (Buffer.byteLength(state, "utf8") > MAX_CONTEXT_BYTES) {
    state = headTailSlice(state, MAX_CONTEXT_BYTES);
    truncated = true;
  }
  return {
    state,
    estimatedTokens: Math.min(MAX_CONTEXT_TOKENS, estimateTextTokens(state)),
    serializedBytes: Buffer.byteLength(state, "utf8"),
    truncated
  };
}

function rank(level: RuntimeThinkingLevel): number {
  return RUNTIME_THINKING_LEVELS.indexOf(level);
}

function concreteLevel(value: string, fallback: RuntimeThinkingLevel): RuntimeThinkingLevel {
  return RUNTIME_THINKING_LEVELS.includes(value as RuntimeThinkingLevel)
    ? value as RuntimeThinkingLevel
    : fallback;
}

/** Applies the Auto ceiling and model capabilities without pi-ai upward promotion. */
export function resolveAutoEffectiveThinkingLevel(input: {
  requestedLevel: RuntimeThinkingLevel;
  fallbackLevel: RuntimeThinkingLevel;
  ceiling: RuntimeThinkingLevel;
  supportedLevels: readonly RuntimeThinkingLevel[];
}): { level?: RuntimeThinkingLevel; compatible: boolean } {
  const supported = input.supportedLevels
    .filter((level, index, values) => values.indexOf(level) === index)
    .filter((level) => rank(level) >= 0 && rank(level) <= rank(input.ceiling))
    .sort((a, b) => rank(a) - rank(b));
  if (supported.length === 0) return { compatible: false };

  const requested = concreteLevel(input.requestedLevel, input.fallbackLevel);
  const limitedRank = Math.min(rank(requested), rank(input.ceiling));
  const atOrBelow = supported.filter((level) => rank(level) <= limitedRank);
  if (atOrBelow.length > 0) return { level: atOrBelow[atOrBelow.length - 1], compatible: true };
  return { level: supported[0], compatible: true };
}

function fallbackResolution(
  reason: AdaptiveFallbackReason,
  settings: AdaptiveThinkingSettings,
  latencyMs: number
): AdaptiveResolution {
  return {
    strategy: "auto",
    requestedLevel: settings.fallbackThinkingLevel,
    fallbackReason: reason,
    latencyMs
  };
}

export async function resolveAdaptiveThinking(input: {
  strategy: ThinkingStrategy;
  fixedLevel: RuntimeThinkingLevel;
  settings: AdaptiveThinkingSettings;
  context: AdaptiveThinkingContext;
  provider: DecisionProvider;
  signal: AbortSignal;
}): Promise<AdaptiveResolution> {
  if (input.strategy === "fixed") {
    return { strategy: "fixed", requestedLevel: input.fixedLevel, latencyMs: 0 };
  }
  const startedAt = Date.now();
  if (!input.settings.enabled) return fallbackResolution("disabled", input.settings, 0);
  if (!input.settings.apiKey) return fallbackResolution("missing_credential", input.settings, 0);
  if (!input.context.state.trim()) return fallbackResolution("insufficient_context", input.settings, 0);

  try {
    if (input.signal.aborted) throw new Error("adaptive thinking cancelled");
    const decisionController = new AbortController();
    const abortFromParent = () => decisionController.abort();
    input.signal.addEventListener("abort", abortFromParent, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      decisionController.abort();
    }, input.settings.timeoutMs);
    let result: DecisionProviderResult;
    try {
      result = await input.provider.decide({ context: input.context, settings: input.settings, signal: decisionController.signal });
    } finally {
      clearTimeout(timer);
      input.signal.removeEventListener("abort", abortFromParent);
    }
    if (input.signal.aborted) throw new Error("adaptive thinking cancelled");
    if (timedOut) return fallbackResolution("timeout", input.settings, Date.now() - startedAt);
    if (!result || typeof result.level !== "string") return fallbackResolution("malformed_response", input.settings, Date.now() - startedAt);
    const confidence = Number(result.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      return { ...fallbackResolution("invalid_confidence", input.settings, Date.now() - startedAt), confidence };
    }
    if (confidence < input.settings.confidenceThreshold) {
      return { ...fallbackResolution("low_confidence", input.settings, Date.now() - startedAt), confidence, probabilities: result.probabilities, provider: result.provider, model: result.model };
    }
    if (!ADAPTIVE_THINKING_LEVELS.includes(result.level as AdaptiveThinkingLevel)) {
      return { ...fallbackResolution("malformed_response", input.settings, Date.now() - startedAt), confidence, provider: result.provider, model: result.model };
    }
    const level = result.level as RuntimeThinkingLevel;
    return {
      strategy: "auto",
      requestedLevel: level,
      confidence,
      probabilities: result.probabilities,
      provider: result.provider,
      model: result.model,
      latencyMs: Date.now() - startedAt
    };
  } catch (error) {
    if (input.signal.aborted) throw error;
    const message = String(error instanceof Error ? error.message : error).toLowerCase();
    const fallbackReason = message.includes("invalid_configuration")
      ? "invalid_configuration"
      : message.includes("malformed_response")
      ? "malformed_response"
      : message.includes("timeout") || message.includes("abort")
        ? "timeout"
        : "network_error";
    return fallbackResolution(fallbackReason, input.settings, Date.now() - startedAt);
  }
}

function resolveEndpoint(baseUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(String(baseUrl ?? "").trim());
  } catch {
    throw new Error("invalid_configuration: Jev Host must be a valid URL");
  }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:")
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || !parsed.hostname) {
    throw new Error("invalid_configuration: Jev Host must be an HTTP(S) URL without credentials or query parameters");
  }
  let pathname = parsed.pathname.replace(/\/+$/, "");
  if (pathname.endsWith("/v1/systemone")) pathname = pathname.slice(0, -"/v1/systemone".length).replace(/\/+$/, "");
  return `${parsed.protocol}//${parsed.host}${pathname}/v1/systemone`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseChoiceAnswer(value: unknown): {
  choice: string;
  confidence: number;
  probabilities?: Record<string, number>;
} {
  if (!isRecord(value) || (value.type !== undefined && value.type !== "choice")) {
    throw new Error("malformed_response: TypeSafe returned a non-Choice answer");
  }
  const choice = String(value.choice ?? "");
  const confidence = Number(value.confidence);
  if (!ADAPTIVE_THINKING_LEVELS.includes(choice as AdaptiveThinkingLevel)
    || !Number.isFinite(confidence)
    || confidence < 0
    || confidence > 1) {
    throw new Error("malformed_response: TypeSafe returned an invalid Choice");
  }
  let probabilities: Record<string, number> | undefined;
  if (value.probabilities !== undefined) {
    if (!isRecord(value.probabilities)) {
      throw new Error("malformed_response: TypeSafe probabilities must be an object");
    }
    probabilities = {};
    for (const [key, raw] of Object.entries(value.probabilities)) {
      const probability = Number(raw);
      if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
        throw new Error("malformed_response: TypeSafe probabilities must be between 0 and 1");
      }
      probabilities[key] = probability;
    }
  }
  return { choice, confidence, probabilities };
}

function thinkingChoiceQuestion(): Record<string, unknown> {
  return {
    type: "choice",
    instructions: "Which reasoning effort is appropriate for this request?",
    criteria: {
      low: "Direct answer, routine transformation, or a simple action with clear requirements.",
      medium: "Several dependent steps, bounded debugging, or analysis that needs comparison and verification.",
      high: "Difficult diagnosis, interacting constraints, architectural tradeoffs, or complex multi-step reasoning."
    }
  };
}

export class TypeSafeJevProvider implements DecisionProvider {
  async decide(input: { context: AdaptiveThinkingContext; settings: AdaptiveThinkingSettings; signal: AbortSignal }): Promise<DecisionProviderResult> {
    const response = await fetch(resolveEndpoint(input.settings.baseUrl), {
      method: "POST",
      headers: { authorization: "Bearer " + input.settings.apiKey, "content-type": "application/json" },
      body: JSON.stringify({
        state: input.context.state,
        model: "jev-latest",
        questions: { thinking_level: thinkingChoiceQuestion() }
      }),
      signal: input.signal,
      redirect: "error"
    });
    const payload = await response.json().catch(() => null) as { model?: unknown; answers?: Record<string, unknown> } | null;
    if (!response.ok || !payload?.answers?.thinking_level) throw new Error("TypeSafe request failed (" + response.status + ")");
    const answer = parseChoiceAnswer(payload.answers.thinking_level);
    return {
      level: answer.choice,
      confidence: answer.confidence,
      probabilities: answer.probabilities,
      provider: "typesafe",
      model: String(payload.model ?? "jev-latest")
    };
  }

  async testConnection(input: { baseUrl: string; apiKey: string; signal: AbortSignal }): Promise<{ provider?: string; model?: string }> {
    const response = await fetch(resolveEndpoint(input.baseUrl), {
      method: "POST",
      headers: { authorization: "Bearer " + input.apiKey, "content-type": "application/json" },
      body: JSON.stringify({
        state: "Synthetic connection test. Return one valid thinking level for this simple request.",
        model: "jev-latest",
        questions: { thinking_level: thinkingChoiceQuestion() }
      }),
      signal: input.signal,
      redirect: "error"
    });
    const payload = await response.json().catch(() => null) as { model?: unknown; answers?: Record<string, unknown> } | null;
    const answer = payload?.answers?.thinking_level;
    if (!response.ok || !answer) throw new Error("TypeSafe connection failed (" + response.status + ")");
    parseChoiceAnswer(answer);
    return { provider: "typesafe", model: String(payload.model ?? "jev-latest") };
  }
}
