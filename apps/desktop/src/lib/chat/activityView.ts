import type { DesktopConversationActivity } from "@molibot/desktop-contract";

/**
 * How a tool result should be rendered in the transcript.
 *
 * Every tool used to print into one `<pre>`, so a diff, a file's contents, a
 * shell transcript, a search result and an MCP JSON payload all looked like the
 * same block of grey monospace. The renderer is chosen from the tool's own id
 * plus the shape of what it produced — never from the label, which is prose the
 * model wrote and is localized, truncated and occasionally invented.
 */
export type ActivityBodyKind = "diff" | "code" | "json" | "terminal" | "text";

export interface ActivityBody {
  kind: ActivityBodyKind;
  /** The text to render (empty for `diff`, which carries its own payload). */
  content: string;
  /** Patch text when `kind === "diff"`. */
  diff?: string;
  /**
   * Path used to pick syntax highlighting for `code`. `CodeViewer` derives the
   * language from it, so a wrong path is a wrong language, never a crash.
   */
  filePath?: string;
}

/** Tools whose output is a shell transcript rather than a document. */
const TERMINAL_TOOLS = new Set(["bash", "bashOutput", "bash_output", "hostBash"]);
/** Tools whose successful output is the literal contents of a file. */
const FILE_CONTENT_TOOLS = new Set(["read", "docExtract"]);

/**
 * The tool's id.
 *
 * `activity.tool` is authoritative. Activities persisted before that field
 * existed only carry `key`, whose shape is `<toolName>-<sequence>` — so the
 * fallback strips a trailing all-digit segment and nothing else. A tool id may
 * itself contain `-`, which is why this splits on the LAST separator and why a
 * key with no numeric suffix is returned whole rather than guessed at.
 */
export function activityToolName(activity: Pick<DesktopConversationActivity, "tool" | "key">): string {
  const declared = activity.tool?.trim();
  if (declared) return declared;
  const key = activity.key ?? "";
  const separator = key.lastIndexOf("-");
  if (separator <= 0) return key;
  const suffix = key.slice(separator + 1);
  return /^\d+$/.test(suffix) ? key.slice(0, separator) : key;
}

/** True when `text` is a JSON object or array worth rendering as a tree. */
function looksLikeJson(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 2) return false;
  const opener = trimmed[0];
  const closer = trimmed[trimmed.length - 1];
  if (!((opener === "{" && closer === "}") || (opener === "[" && closer === "]"))) return false;
  try {
    const parsed = JSON.parse(trimmed);
    return typeof parsed === "object" && parsed !== null;
  } catch {
    return false;
  }
}

/**
 * Picks the renderer for one activity's payload.
 *
 * An errored call always falls back to plain text: the payload is then a
 * message about what went wrong, not the artifact the tool normally produces,
 * and feeding a stack trace to a JSON tree or a code viewer buries it.
 */
export function classifyActivityBody(activity: DesktopConversationActivity): ActivityBody | null {
  const diff = activity.diff?.trim();
  if (diff) return { kind: "diff", content: "", diff };

  const summary = activity.summary ?? "";
  if (!summary.trim()) return null;
  if (activity.state === "error") return { kind: "text", content: summary };

  const tool = activityToolName(activity);
  if (TERMINAL_TOOLS.has(tool)) return { kind: "terminal", content: summary };
  if (FILE_CONTENT_TOOLS.has(tool)) {
    return { kind: "code", content: summary, filePath: activity.paths?.[0] ?? "" };
  }
  if (looksLikeJson(summary)) return { kind: "json", content: summary };
  return { kind: "text", content: summary };
}

export interface ActivityHeadline {
  /** Label of the step the head should name: the running one, else the last. */
  label: string;
  /** 1-based position of that step. */
  index: number;
  total: number;
  running: boolean;
  failed: boolean;
}

/**
 * What the collapsed head says.
 *
 * "Completed actions · 23" tells the reader nothing about a 23-step run — which
 * step is running, or which one just failed. The head names a step, and prefers
 * the failed one over the merely latest, because that is the one the reader
 * needs to open.
 */
export function activityHeadline(activities: DesktopConversationActivity[]): ActivityHeadline | null {
  if (!activities.length) return null;
  const runningIndex = activities.findIndex((activity) => activity.state === "running");
  const failedIndex = activities.findIndex((activity) => activity.state === "error");
  const index = runningIndex >= 0
    ? runningIndex
    : failedIndex >= 0
      ? failedIndex
      : activities.length - 1;
  return {
    label: activities[index].label ?? "",
    index: index + 1,
    total: activities.length,
    running: runningIndex >= 0,
    failed: failedIndex >= 0
  };
}

export interface ActivityFileSummary {
  written: string[];
  read: string[];
}

/**
 * Distinct paths this run touched, split by whether they were written.
 *
 * `paths`/`mutates` have been on the contract since file targets were recorded,
 * but nothing in the transcript read them — so "which files did this turn
 * change?" was only answerable by opening every step. A path that was both read
 * and written counts as written: that is the fact worth surfacing.
 */
export function activityFileSummary(activities: DesktopConversationActivity[]): ActivityFileSummary {
  const written = new Set<string>();
  const read = new Set<string>();
  for (const activity of activities) {
    if (activity.state === "error") continue;
    for (const path of activity.paths ?? []) {
      if (!path) continue;
      if (activity.mutates) written.add(path);
      else read.add(path);
    }
  }
  for (const path of written) read.delete(path);
  return { written: [...written], read: [...read] };
}
