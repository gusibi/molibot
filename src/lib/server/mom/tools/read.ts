import { extname } from "node:path";
import { readFileSync } from "node:fs";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { ImageContent, TextContent } from "@mariozechner/pi-ai";
import { execCommand, shellEscape } from "./helpers.js";
import { createPathGuard, resolveToolPath } from "./path.js";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead, type TruncationResult } from "./truncate.js";

const IMAGE_MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp"
};

const readSchema = Type.Object({
  label: Type.String(),
  path: Type.String(),
  offset: Type.Optional(Type.Number()),
  limit: Type.Optional(Type.Number())
});

interface ReadToolDetails {
  truncation?: TruncationResult;
}

export function createReadTool(options: { cwd: string; workspaceDir: string }): AgentTool<typeof readSchema> {
  const ensureAllowedPath = createPathGuard(options.cwd, options.workspaceDir);

  return {
    name: "read",
    label: "read",
    description:
      `Read text/image files from workspace. Text output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}.`,
    parameters: readSchema,
    execute: async (
      _toolCallId,
      { path, offset, limit }: { label: string; path: string; offset?: number; limit?: number },
      signal
    ): Promise<{ content: Array<TextContent | ImageContent>; details: ReadToolDetails | undefined }> => {
      const filePath = resolveToolPath(options.cwd, path);
      ensureAllowedPath(filePath);

      const mimeType = IMAGE_MIME_TYPES[extname(filePath).toLowerCase()];
      if (mimeType) {
        const bytes = readFileSync(filePath);
        return {
          content: [
            { type: "text", text: `Read image file [${mimeType}]` },
            { type: "image", mimeType, data: bytes.toString("base64") }
          ],
          details: undefined
        };
      }

      const countResult = await execCommand(`wc -l < ${shellEscape(filePath)}`, { cwd: options.cwd, signal });
      if (countResult.code !== 0) {
        throw new Error(countResult.stderr || `Failed to read ${path}`);
      }
      const totalFileLines = Number.parseInt(countResult.stdout.trim(), 10) + 1;
      const startLine = offset && offset > 0 ? offset : 1;
      if (startLine > totalFileLines) {
        throw new Error(`Offset ${startLine} is beyond end of file (${totalFileLines} lines total)`);
      }

      const readCmd = startLine === 1 ? `cat ${shellEscape(filePath)}` : `tail -n +${startLine} ${shellEscape(filePath)}`;
      const result = await execCommand(readCmd, { cwd: options.cwd, signal });
      if (result.code !== 0) {
        throw new Error(result.stderr || `Failed to read ${path}`);
      }

      let selected = result.stdout;
      let userLimitedLines: number | undefined;
      if (limit !== undefined) {
        const lines = selected.split("\n");
        const endLine = Math.min(limit, lines.length);
        selected = lines.slice(0, endLine).join("\n");
        userLimitedLines = endLine;
      }

      const truncation = truncateHead(selected);
      let outputText = truncation.content;
      let details: ReadToolDetails | undefined;

      if (truncation.firstLineExceedsLimit) {
        outputText = `[Line ${startLine} exceeds ${formatSize(DEFAULT_MAX_BYTES)}. Use bash with byte slicing.]`;
        details = { truncation };
      } else if (truncation.truncated) {
        const endLineDisplay = startLine + truncation.outputLines - 1;
        const nextOffset = endLineDisplay + 1;
        outputText += `\n\n[Showing lines ${startLine}-${endLineDisplay} of ${totalFileLines}. Use offset=${nextOffset} to continue]`;
        details = { truncation };
      } else if (userLimitedLines !== undefined) {
        const linesFromStart = startLine - 1 + userLimitedLines;
        if (linesFromStart < totalFileLines) {
          outputText += `\n\n[${totalFileLines - linesFromStart} more lines. Use offset=${startLine + userLimitedLines} to continue]`;
        }
      }

      return {
        content: [{ type: "text", text: outputText || "(empty file)" }],
        details
      };
    }
  };
}
