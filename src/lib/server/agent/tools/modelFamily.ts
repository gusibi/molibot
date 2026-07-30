/**
 * Model lineage identification, used to decide whether two model routes are
 * genuinely independent of each other.
 *
 * The provider id alone cannot answer this: aggregators (`openrouter`,
 * `vercel-ai-gateway`, `amazon-bedrock`, `github-copilot`) and private proxies
 * all serve other vendors' models, so `anthropic|claude-sonnet-4-5` and
 * `openrouter|anthropic/claude-opus-4-1` are two providers but one lineage —
 * and one lineage shares its blind spots. The model id is the reliable signal;
 * the provider is only the fallback for ids we do not recognize.
 */

export interface ModelRouteRef {
  provider: string;
  model: string;
}

/**
 * Ordered lineage patterns. Order matters where ids overlap: `gpt-oss` must
 * resolve to the GPT lineage, and `kimi` before a generic vendor match.
 */
const FAMILY_PATTERNS: Array<[family: string, pattern: RegExp]> = [
  ["claude", /(^|[^a-z])claude([^a-z]|$)|anthropic/],
  ["gemini", /(^|[^a-z])gemini([^a-z]|$)/],
  ["gpt", /(^|[^a-z])(gpt|chatgpt|o[1-4])([^a-z0-9]|$)|codex/],
  ["deepseek", /deepseek/],
  ["qwen", /qwen|qwq/],
  ["glm", /(^|[^a-z])glm([^a-z]|$)|chatglm/],
  ["kimi", /kimi|moonshot/],
  ["grok", /(^|[^a-z])grok([^a-z]|$)/],
  ["llama", /llama/],
  ["mistral", /mistral|mixtral|magistral|devstral|codestral/],
  ["minimax", /minimax|abab/],
  ["doubao", /doubao|seed-/],
  ["nova", /(^|[^a-z])nova-/],
  ["command", /(^|[^a-z])command-[ar]/]
];

/**
 * Stable identifier for the lineage behind a model route. Unrecognized models
 * resolve to `provider:<id>` so two unrelated private providers never look
 * related, while two unknown models behind one provider are conservatively
 * treated as one lineage.
 */
export function modelFamilyOf(route: ModelRouteRef): string {
  const model = String(route.model ?? "").trim().toLowerCase();
  for (const [family, pattern] of FAMILY_PATTERNS) {
    if (pattern.test(model)) return family;
  }
  const provider = String(route.provider ?? "").trim().toLowerCase();
  return `provider:${provider}`;
}

/** True when both routes come from the same model lineage. */
export function isSameModelFamily(a: ModelRouteRef, b: ModelRouteRef): boolean {
  return modelFamilyOf(a) === modelFamilyOf(b);
}
