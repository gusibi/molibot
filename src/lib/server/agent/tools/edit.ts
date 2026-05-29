import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import * as Diff from "diff";
import { toolDefToAgentTool } from "$lib/server/agent/tools/helpers.js";
import { createPathGuard, resolveToolPath } from "$lib/server/agent/tools/path.js";
import type { ToolDefinition } from "$lib/server/agent/tools/toolTypes.js";

const editSchema = Type.Object({
  label: Type.String(),
  path: Type.String(),
  oldText: Type.String(),
  newText: Type.String()
});

export function buildDiff(oldText: string, newText: string, contextLines = 4): string {
  if (oldText === newText) return "(no changes)";

  const parts = Diff.diffLines(oldText, newText);
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const width = String(Math.max(oldLines.length, newLines.length)).length;
  const out: string[] = [];

  let oldLine = 1;
  let newLine = 1;
  let lastWasChange = false;

  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    const rawLines = part.value.split("\n");
    if (rawLines[rawLines.length - 1] === "") rawLines.pop();

    if (part.added || part.removed) {
      for (const line of rawLines) {
        if (part.added) {
          out.push(`+${String(newLine).padStart(width, " ")} ${line}`);
          newLine += 1;
        } else {
          out.push(`-${String(oldLine).padStart(width, " ")} ${line}`);
          oldLine += 1;
        }
      }
      lastWasChange = true;
      continue;
    }

    const nextPart = parts[i + 1];
    const nextPartIsChange = Boolean(nextPart?.added || nextPart?.removed);

    if (lastWasChange || nextPartIsChange) {
      let linesToShow = rawLines;
      let skipStart = 0;
      let skipEnd = 0;

      if (!lastWasChange) {
        skipStart = Math.max(0, rawLines.length - contextLines);
        linesToShow = rawLines.slice(skipStart);
      }

      if (!nextPartIsChange && linesToShow.length > contextLines) {
        skipEnd = linesToShow.length - contextLines;
        linesToShow = linesToShow.slice(0, contextLines);
      }

      if (skipStart > 0) out.push(` ${"".padStart(width, " ")} ...`);

      for (const line of linesToShow) {
        out.push(` ${String(oldLine).padStart(width, " ")} ${line}`);
        oldLine += 1;
        newLine += 1;
      }

      if (skipEnd > 0) out.push(` ${"".padStart(width, " ")} ...`);

      oldLine += skipStart + skipEnd;
      newLine += skipStart + skipEnd;
    } else {
      oldLine += rawLines.length;
      newLine += rawLines.length;
    }

    lastWasChange = false;
  }

  return out.join("\n");
}

export function getEditToolDefinition(options: { cwd: string; workspaceDir: string }): ToolDefinition {
  const ensureAllowedPath = createPathGuard(options.cwd, options.workspaceDir);

  return {
    id: "edit",
    name: "edit",
    description: "Replace exact text in a file.",
    inputSchema: editSchema,
    risk: "medium",
    source: "builtin",
    handler: async (params: any, ctx) => {
      const filePath = resolveToolPath(ctx.cwd, params.path);
      ensureAllowedPath(filePath);

      const content = await ctx.fs.readText(filePath);
      if (!content.includes(params.oldText)) {
        return { ok: false, error: "oldText not found in file" };
      }
      if (content.split(params.oldText).length - 1 > 1) {
        return { ok: false, error: "oldText appears multiple times; provide a unique snippet" };
      }

      const replaced = content.replace(params.oldText, params.newText);
      if (content === replaced) {
        return { ok: false, error: `No changes made to ${params.path}; replacement produced identical content` };
      }

      await ctx.fs.writeText(filePath, replaced);

      return {
        ok: true,
        content: [{ type: "text", text: `Updated ${params.path}` }],
        details: { diff: buildDiff(content, replaced) }
      };
    }
  };
}

export function createEditTool(options: { cwd: string; workspaceDir: string }): AgentTool<typeof editSchema> {
  const def = getEditToolDefinition(options);
  return toolDefToAgentTool(def, options.cwd);
}
