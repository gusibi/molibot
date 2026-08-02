/**
 * Detects the two ways a Mini App turn ships tool-call syntax as the answer.
 *
 * A turn routed to a Mini App preloads that app's tools and tells the model they
 * are the only ones available. Weaker models answer that setup with prose that
 * *names* the tool — "run miniapp__todo__add with title is ..." — instead of
 * emitting a call. Two distinct failures come out of that habit:
 *
 * 1. Nothing ran. The user's task was silently dropped and the reply reads like
 *    a success. `describesUncalledMiniAppTool` catches it so the runner can
 *    nudge once instead of shipping it. It only ever runs on a turn where zero
 *    tools executed, so naming a tool there is already evidence of intent.
 *
 * 2. The tool *did* run, and the model then wrote the call out again as its
 *    closing summary. The work happened, but the user is handed a line of
 *    internal syntax and cannot tell whether anything was recorded.
 *    `describesPseudoToolCall` catches that one. It cannot use the loose test
 *    above — after a real call, mentioning the tool can be legitimate — so it
 *    requires the text to be shaped like an invocation rather than a report.
 *    The reply is then recovered from the tool's own result text, which Mini
 *    App tools already write for a human reader.
 */

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Regex sources matching the ways a model writes one tool id: the full
 * `miniapp__app__tool`, and the app/tool shorthand it shortens to. The
 * shorthand demands a separator that cannot appear in ordinary prose, so "the
 * todo list" never matches.
 */
function toolIdPatterns(toolId: string): string[] {
  const id = toolId.toLowerCase();
  const patterns = [escapeRegExp(id)];
  const parts = id.split("__");
  if (parts.length === 3) {
    const [, appId, toolName] = parts;
    patterns.push(`${escapeRegExp(appId)}\\s*(?:\\.|__|::)\\s*${escapeRegExp(toolName)}`);
  }
  return patterns;
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
    const [, shorthand] = toolIdPatterns(toolId);
    if (shorthand && new RegExp(`\\b${shorthand}\\b`).test(haystack)) return toolId;
  }
  return null;
}

/** Verbs that introduce an invocation rather than a report of one. */
const CALL_VERB = "(?:run|call|calling|invoke|invoking|execute|executing|use|using|执行|调用|运行|使用)";

/**
 * @param text final assistant text of a turn in which tools DID execute
 * @param toolIds fully-qualified ids of the preloaded tools
 * @returns the tool id the text writes as a call, or null
 */
export function describesPseudoToolCall(
  text: string,
  toolIds: readonly string[]
): string | null {
  const haystack = String(text ?? "").toLowerCase().trim();
  if (!haystack) return null;
  for (const toolId of toolIds) {
    for (const pattern of toolIdPatterns(toolId)) {
      const shapes = [
        // "run tool miniapp__todo__add ...", "调用 todo.add ..."
        `${CALL_VERB}\\s+(?:the\\s+)?(?:tool\\s+)?${pattern}\\b`,
        // "miniapp__todo__add with title is ...", "todo.add(title=...)"
        `\\b${pattern}\\s*(?:with\\b|\\(|\\{)`,
        // The whole answer opens with the bare id.
        `^${pattern}\\b`
      ];
      if (shapes.some((shape) => new RegExp(shape).test(haystack))) return toolId;
    }
  }
  return null;
}

interface ToolResultLike {
  role?: string;
  toolName?: string;
  isError?: boolean;
  content?: unknown;
}

function resultText(message: ToolResultLike): string {
  const content = message.content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .filter((part): part is { type?: string; text?: string } => !!part && typeof part === "object")
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => (part.text as string).trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

/**
 * The last successful Mini App tool result of an attempt, as text.
 *
 * This is the substitute reply when the model's own closing text turned out to
 * be a pseudo-call. Mini App tools return a sentence written for the user
 * ("已记账：餐饮 −20.00 元…"), so the recovered reply says what happened without
 * the runtime having to know anything about the app's domain.
 *
 * @param attemptMessages messages produced by the attempt, in order
 * @param toolIds fully-qualified ids of the preloaded tools
 */
export function recoverMiniAppResultText(
  attemptMessages: readonly unknown[],
  toolIds: readonly string[]
): string | null {
  const allowed = new Set(toolIds);
  for (let index = attemptMessages.length - 1; index >= 0; index -= 1) {
    const message = attemptMessages[index] as ToolResultLike | undefined;
    if (!message || typeof message !== "object") continue;
    if (message.role !== "toolResult") continue;
    if (message.isError) continue;
    if (!message.toolName || !allowed.has(message.toolName)) continue;
    const text = resultText(message);
    if (text) return text;
  }
  return null;
}
