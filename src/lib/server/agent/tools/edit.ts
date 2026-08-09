import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { generateDiffString, generateUnifiedPatch, withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { toolDefToAgentTool } from "$lib/server/agent/tools/helpers.js";
import { createPathGuard, resolveToolPath } from "$lib/server/agent/tools/path.js";
import type { ToolDefinition } from "$lib/server/agent/tools/toolTypes.js";
import { describeFileToolResult, type RunOutputLayout } from "$lib/server/agent/tools/outputLayout.js";

const editSchema = Type.Object({
  label: Type.String(),
  path: Type.String(),
  oldText: Type.String(),
  newText: Type.String(),
  replaceAll: Type.Optional(Type.Boolean({
    description: "Replace every occurrence of oldText instead of requiring a unique match."
  }))
});

/**
 * Line-numbered diff for tool output.
 *
 * Delegates to pi, which produces the same format the local implementation did
 * but correctly elides unchanged regions between distant edits — the local
 * version only skipped context around a single change, so a file with two far
 * apart edits was emitted in full.
 */
export function buildDiff(oldText: string, newText: string, contextLines = 4): string {
  if (oldText === newText) return "(no changes)";
  return generateDiffString(oldText, newText, contextLines).diff;
}

export function getEditToolDefinition(options: { cwd: string; workspaceDir: string; outputLayout?: RunOutputLayout }): ToolDefinition {
  const ensureAllowedPath = createPathGuard(options.cwd, options.workspaceDir);

  return {
    id: "edit",
    name: "edit",
    description: "Replace exact text in a file. oldText must match the file content exactly (including whitespace) and be unique unless replaceAll is true.",
    inputSchema: editSchema,
    risk: "medium",
    source: "builtin",
    sideEffectClass: "idempotent",
    handler: async (params: any, ctx) => {
      const filePath = resolveToolPath(ctx.cwd, params.path);
      ensureAllowedPath(filePath);

      if (params.oldText === params.newText) {
        return { ok: false, error: "No changes to make: oldText and newText are exactly the same" };
      }

      // Read-modify-write must be atomic per file: two concurrent edits (main
      // agent and a subagent, or two parallel subagents) would otherwise both
      // read the pre-edit content and the second write would drop the first
      // edit. pi's queue keys on realpath, so symlinks and case-insensitive
      // filesystems collapse to the same lock.
      return withFileMutationQueue(filePath, async () => {
        const rawContent = await ctx.fs.readText(filePath);

        // Match against LF-normalized content so CRLF files are editable; restore
        // the file's original line endings on write.
        const usesCrlf = rawContent.includes("\r\n");
        const content = usesCrlf ? rawContent.replaceAll("\r\n", "\n") : rawContent;
        const oldText = params.oldText.replaceAll("\r\n", "\n");
        const newText = params.newText.replaceAll("\r\n", "\n");
        const replaceAll = params.replaceAll === true;

        const matches = content.split(oldText).length - 1;
        if (matches === 0) {
          return { ok: false, error: "oldText not found in file" };
        }
        if (matches > 1 && !replaceAll) {
          return {
            ok: false,
            error: `Found ${matches} matches of oldText. Provide a larger unique snippet, or set replaceAll to true to replace all occurrences.`
          };
        }

        // Use a replacer function so `$` sequences in newText are inserted literally.
        const replaced = replaceAll
          ? content.replaceAll(oldText, () => newText)
          : content.replace(oldText, () => newText);
        if (content === replaced) {
          return { ok: false, error: `No changes made to ${params.path}; replacement produced identical content` };
        }

        await ctx.fs.writeText(filePath, usesCrlf ? replaced.replaceAll("\n", "\r\n") : replaced);

        return {
          ok: true,
          content: [{
            type: "text",
            text: replaceAll && matches > 1
              ? `Updated ${params.path} (replaced ${matches} occurrences)`
              : `Updated ${params.path}`
          }],
          details: {
            diff: buildDiff(content, replaced),
            // `diff` above is pi's display format (`+12 line`), which is for a
            // terminal and is not a patch. A UI that renders diffs needs a real
            // unified patch, so both are produced rather than one being
            // reinterpreted as the other.
            unifiedDiff: generateUnifiedPatch(params.path, content, replaced),
            ...(options.outputLayout
              ? describeFileToolResult(options.outputLayout, filePath, "modified", params.path, Buffer.byteLength(replaced, "utf8"))
              : {})
          }
        };
      });
    }
  };
}

export function createEditTool(options: { cwd: string; workspaceDir: string; outputLayout?: RunOutputLayout }): AgentTool<typeof editSchema> {
  const def = getEditToolDefinition(options);
  return toolDefToAgentTool(def, options.cwd);
}
