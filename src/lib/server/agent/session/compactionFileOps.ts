import type { AgentMessage } from "@earendil-works/pi-agent-core";

/**
 * Cumulative file tracking across compactions.
 *
 * Without this, a compacted summary is prose: the agent loses the concrete list
 * of files it had already read or changed, and long tasks start re-reading (or
 * worse, re-writing) work they had finished. pi solves it by extracting paths
 * from tool-call arguments and carrying them forward on every compaction; this
 * is that idea, reimplemented because pi exposes only the `FileOperations` type
 * from its package root — `extractFileOpsFromMessage`/`computeFileLists` live in
 * an internal module and the package declares no deep-import subpath.
 *
 * The block format matches pi's so a summary stays readable to a model trained
 * on either, and so the previous summary can be parsed back on the next pass.
 */

const READ_BLOCK = "read-files";
const MODIFIED_BLOCK = "modified-files";
/** Tools whose `path` argument means "the model saw this file". */
const READ_TOOLS = new Set(["read"]);
/** Tools whose `path` argument means "the model changed this file". */
const WRITE_TOOLS = new Set(["write", "edit"]);
/** Keeps a pathological run from turning the summary into a file listing. */
const MAX_TRACKED_PATHS = 60;

export interface FileOperations {
  read: Set<string>;
  modified: Set<string>;
}

export function createFileOps(): FileOperations {
  return { read: new Set(), modified: new Set() };
}

function readToolCalls(message: AgentMessage): Array<{ name: string; args: Record<string, unknown> }> {
  const content = (message as unknown as { content?: unknown }).content;
  if (!Array.isArray(content)) return [];
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const row = part as { type?: unknown; name?: unknown; arguments?: unknown };
    if (row.type !== "toolCall") continue;
    const name = String(row.name ?? "").trim();
    const args = row.arguments && typeof row.arguments === "object"
      ? row.arguments as Record<string, unknown>
      : {};
    if (name) calls.push({ name, args });
  }
  return calls;
}

/** Fold every file path touched by these messages into `ops`. */
export function extractFileOps(messages: readonly AgentMessage[], ops: FileOperations): void {
  for (const message of messages) {
    if ((message as unknown as { role?: unknown }).role !== "assistant") continue;
    for (const call of readToolCalls(message)) {
      const path = String(call.args.path ?? "").trim();
      if (!path) continue;
      if (WRITE_TOOLS.has(call.name)) ops.modified.add(path);
      else if (READ_TOOLS.has(call.name)) ops.read.add(path);
    }
  }
}

/**
 * A file that was modified is reported only as modified — listing it under both
 * headings tells the model nothing and doubles the space the block takes.
 */
export function computeFileLists(ops: FileOperations): { readFiles: string[]; modifiedFiles: string[] } {
  const modifiedFiles = [...ops.modified].sort().slice(0, MAX_TRACKED_PATHS);
  const remaining = MAX_TRACKED_PATHS - modifiedFiles.length;
  const readFiles = [...ops.read]
    .filter((path) => !ops.modified.has(path))
    .sort()
    .slice(0, remaining);
  return { readFiles, modifiedFiles };
}

function sanitizePath(path: string): string {
  return path
    .replace(/[\r\n]+/g, " ")
    .replace(/<\/?(?:read-files|modified-files)>/gi, "<file-block>")
    .trim();
}

export function formatFileOperations(readFiles: readonly string[], modifiedFiles: readonly string[]): string {
  const sections: string[] = [];
  if (readFiles.length > 0) {
    sections.push(`<${READ_BLOCK}>\n${readFiles.map(sanitizePath).filter(Boolean).join("\n")}\n</${READ_BLOCK}>`);
  }
  if (modifiedFiles.length > 0) {
    sections.push(`<${MODIFIED_BLOCK}>\n${modifiedFiles.map(sanitizePath).filter(Boolean).join("\n")}\n</${MODIFIED_BLOCK}>`);
  }
  return sections.join("\n\n");
}

function parseBlock(text: string, block: string): string[] {
  const match = new RegExp(`<${block}>([\\s\\S]*?)</${block}>`, "i").exec(text);
  if (!match) return [];
  return match[1]
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Read the file blocks back out of a previous summary and strip them from the
 * prose.
 *
 * Both halves matter: parsing is what makes tracking cumulative across repeated
 * compactions, and stripping keeps the blocks from being duplicated (or slowly
 * mangled) each time the summary is fed back to the model as `previousSummary`.
 */
export function extractFileOpsFromSummary(summary: string): { text: string; ops: FileOperations } {
  const ops = createFileOps();
  for (const path of parseBlock(summary, READ_BLOCK)) ops.read.add(path);
  for (const path of parseBlock(summary, MODIFIED_BLOCK)) ops.modified.add(path);

  const text = summary
    .replace(new RegExp(`<${READ_BLOCK}>[\\s\\S]*?</${READ_BLOCK}>`, "gi"), "")
    .replace(new RegExp(`<${MODIFIED_BLOCK}>[\\s\\S]*?</${MODIFIED_BLOCK}>`, "gi"), "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { text, ops };
}

/** Merge `extra` into `target` in place. */
export function mergeFileOps(target: FileOperations, extra: FileOperations): void {
  for (const path of extra.read) target.read.add(path);
  for (const path of extra.modified) target.modified.add(path);
}

/** Append the tracked files to a summary, replacing any blocks it already had. */
export function appendFileOperations(summary: string, ops: FileOperations): string {
  const { text } = extractFileOpsFromSummary(summary);
  const { readFiles, modifiedFiles } = computeFileLists(ops);
  const block = formatFileOperations(readFiles, modifiedFiles);
  if (!block) return text;
  return `${text}\n\n${block}`.trim();
}
