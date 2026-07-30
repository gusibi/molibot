/**
 * Maps a transcript message's model label back onto a composer option key.
 *
 * The two sides speak different dialects: the composer selector is keyed by a
 * routing key (`custom|<providerId>|<modelId>` or `pi|<providerId>|<modelId>`),
 * while a persisted message carries the display pair `"<provider>/<model>"`
 * projected by `conversationProjection.modelLabel` on the server. Without this
 * translation the composer can only ever show a *configured* default, which is
 * how a Session whose turns all ran on DeepSeek ended up displaying the global
 * Gemini default in its input bar.
 *
 * Model ids legitimately contain "/" (`deepseek/deepseek-v4-pro`), provider ids
 * do not, so the pair splits at the FIRST slash only.
 */
export type ModelOptionKey = { key: string };

export type TranscriptModelSource = { role: string; model?: string; [extra: string]: unknown };

export function optionKeyForTranscriptModel(
  label: string | undefined,
  options: readonly ModelOptionKey[]
): string {
  const raw = String(label ?? "").trim();
  const slash = raw.indexOf("/");
  if (slash <= 0 || slash === raw.length - 1) return "";
  const provider = raw.slice(0, slash);
  const model = raw.slice(slash + 1);
  const match = options.find((option) => {
    const parts = option.key.split("|");
    return parts.length === 3 && parts[1] === provider && parts[2] === model;
  });
  return match?.key ?? "";
}

/**
 * The option key of the model that answered LAST in this transcript, or "" when
 * the transcript has no assistant message whose model resolves to a currently
 * listed option (unknown / removed / disabled models must not silently select
 * something else — callers fall back to the persisted or default key).
 */
export function lastTranscriptModelKey(
  messages: readonly TranscriptModelSource[],
  options: readonly ModelOptionKey[]
): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "assistant" || !message.model) continue;
    const key = optionKeyForTranscriptModel(message.model, options);
    if (key) return key;
  }
  return "";
}
