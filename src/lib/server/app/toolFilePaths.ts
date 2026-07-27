/**
 * Maps a tool call's raw arguments to the Project-relative paths it touches.
 *
 * Recorded at the call site instead of parsed back out of the human-readable
 * label: labels are localized, truncated and prefixed with a display name, so
 * scraping them would break the moment a label changes wording.
 */

/** Tools whose `path` argument is a file they WRITE. */
const MUTATING_PATH_TOOLS = new Set(["write", "edit"]);

/** Tools whose `path` argument is a file they only READ. */
const READING_PATH_TOOLS = new Set(["read"]);

export interface ToolFileTarget {
  paths: string[];
  mutates: boolean;
}

function normalize(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim().replaceAll("\\", "/").replace(/^\.\//, "");
  // Absolute paths and parent escapes are not Project-relative; a surface that
  // matches them against `git status` output would silently never match, so
  // drop them rather than record something misleading.
  if (!trimmed || trimmed.startsWith("/") || trimmed.startsWith("~") || trimmed.split("/").includes("..")) return "";
  return trimmed;
}

export function resolveToolFileTarget(toolName: string, args: unknown): ToolFileTarget | undefined {
  const mutates = MUTATING_PATH_TOOLS.has(toolName);
  if (!mutates && !READING_PATH_TOOLS.has(toolName)) return undefined;
  const path = normalize((args as { path?: unknown } | undefined)?.path);
  if (!path) return undefined;
  return { paths: [path], mutates };
}
