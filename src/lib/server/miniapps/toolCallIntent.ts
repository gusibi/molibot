/**
 * Detects the "described the call instead of making it" failure mode.
 *
 * A turn routed to a Mini App preloads that app's tools and tells the model they
 * are the only ones available. Weaker models answer that setup with prose that
 * *names* the tool — "run miniapp__todo__add with title is ..." — and stop.
 * Nothing executed, the user's task was silently dropped, and the reply reads
 * like a success. The runner uses this to nudge once instead of shipping it.
 *
 * It only ever runs on a turn where zero tools executed, so naming a tool here
 * is already evidence of intent rather than ordinary explanation.
 */

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * @param text final assistant text of a turn in which no tool ran
 * @param toolIds fully-qualified ids of the preloaded tools, e.g. `miniapp__todo__add`
 * @returns the tool id the text names, or null
 */
export function describesUncalledMiniAppTool(
  text: string,
  toolIds: readonly string[]
): string | null {
  const haystack = String(text ?? "").toLowerCase();
  if (!haystack.trim()) return null;
  for (const toolId of toolIds) {
    const id = toolId.toLowerCase();
    if (haystack.includes(id)) return toolId;
    // Models also shorten the id to its app/tool pair. Require a separator that
    // cannot appear in ordinary prose so "the todo list" never matches.
    const parts = id.split("__");
    if (parts.length !== 3) continue;
    const [, appId, toolName] = parts;
    const shorthand = new RegExp(
      `\\b${escapeRegExp(appId)}\\s*(?:\\.|__|::)\\s*${escapeRegExp(toolName)}\\b`
    );
    if (shorthand.test(haystack)) return toolId;
  }
  return null;
}
