import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import * as Diff from "diff";
import { execCommand, shellEscape } from "./helpers.js";
import { createPathGuard, resolveToolPath } from "./path.js";

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
      if (content === replaced) {
        throw new Error(`No changes made to ${params.path}; replacement produced identical content`);
      }

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
