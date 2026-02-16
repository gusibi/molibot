import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { execCommand, shellEscape } from "./helpers.js";
import { createPathGuard, resolveToolPath } from "./path.js";

const editSchema = Type.Object({
  label: Type.String(),
  path: Type.String(),
  oldText: Type.String(),
  newText: Type.String()
});

function buildDiff(oldText: string, newText: string): string {
  if (oldText === newText) return "(no changes)";
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const out: string[] = [];
  const max = Math.max(oldLines.length, newLines.length);

  for (let i = 0; i < max; i += 1) {
    const before = oldLines[i];
    const after = newLines[i];
    if (before === after) continue;
    const line = i + 1;
    if (before !== undefined) out.push(`-${line} ${before}`);
    if (after !== undefined) out.push(`+${line} ${after}`);
  }

  return out.join("\n");
}

export function createEditTool(options: { cwd: string; workspaceDir: string }): AgentTool<typeof editSchema> {
  const ensureAllowedPath = createPathGuard(options.cwd, options.workspaceDir);

  return {
    name: "edit",
    label: "edit",
    description: "Replace exact text in a file.",
    parameters: editSchema,
    execute: async (_toolCallId, params, signal) => {
      const filePath = resolveToolPath(options.cwd, params.path);
      ensureAllowedPath(filePath);

      const readResult = await execCommand(`cat ${shellEscape(filePath)}`, { cwd: options.cwd, signal });
      if (readResult.code !== 0) {
        throw new Error(readResult.stderr || `Failed to open ${params.path}`);
      }

      const content = readResult.stdout;
      if (!content.includes(params.oldText)) {
        throw new Error("oldText not found in file");
      }
      if (content.split(params.oldText).length - 1 > 1) {
        throw new Error("oldText appears multiple times; provide a unique snippet");
      }

      const replaced = content.replace(params.oldText, params.newText);
      const writeResult = await execCommand(`printf '%s' ${shellEscape(replaced)} > ${shellEscape(filePath)}`, {
        cwd: options.cwd,
        signal
      });
      if (writeResult.code !== 0) {
        throw new Error(writeResult.stderr || `Failed to write ${params.path}`);
      }

      return {
        content: [{ type: "text", text: `Updated ${params.path}` }],
        details: { diff: buildDiff(content, replaced) }
      };
    }
  };
}
