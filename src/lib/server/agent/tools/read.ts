import { extname } from "node:path";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import { toolDefToAgentTool } from "$lib/server/agent/tools/helpers.js";
import { createPathGuard, resolveToolPath } from "$lib/server/agent/tools/path.js";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead, type TruncationResult } from "$lib/server/agent/tools/truncate.js";
import type { ToolDefinition } from "$lib/server/agent/tools/toolTypes.js";

const IMAGE_MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp"
};

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const readSchema = Type.Object({
  label: Type.Optional(Type.String()),
  path: Type.String(),
  offset: Type.Optional(Type.Number()),
  limit: Type.Optional(Type.Number())
});

interface ReadToolDetails {
  truncation?: TruncationResult;
}

export function getReadToolDefinition(options: { cwd: string; workspaceDir: string }): ToolDefinition {
  const ensureAllowedPath = createPathGuard(options.cwd, options.workspaceDir);

  return {
    id: "read",
    name: "read",
    description:
      `Read text/image files from workspace. Supports offset/limit for partial reads of large files. Text output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}.`,
    inputSchema: readSchema,
    risk: "low",
    source: "builtin",
    handler: async (params: any, ctx) => {
      const { path, offset, limit } = params;
      const filePath = resolveToolPath(ctx.cwd, path);
      ensureAllowedPath(filePath);

      if (!ctx.fs.readBuffer) {
        throw new Error("fs.readBuffer is not implemented in execution context.");
      }

      const mimeType = IMAGE_MIME_TYPES[extname(filePath).toLowerCase()];
      if (mimeType) {
        const bytes = await ctx.fs.readBuffer(filePath);
        if (bytes.length > MAX_IMAGE_BYTES) {
          return {
            ok: false,
            error: `Image is too large to read (${formatSize(bytes.length)}, max ${formatSize(MAX_IMAGE_BYTES)}). Resize or compress it first (e.g. with sips or ffmpeg via bash).`
          };
        }
        return {
          ok: true,
          content: [
            { type: "text", text: `Read image file [${mimeType}]` },
            { type: "image", mimeType, data: bytes.toString("base64") }
          ],
          details: undefined
        };
      }

      let buffer: Buffer;
      try {
        buffer = await ctx.fs.readBuffer(filePath);
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : `Failed to read ${path}` };
      }

      if (buffer.subarray(0, 8192).includes(0)) {
        return { ok: false, error: `${path} appears to be a binary file. Use bash with a format-appropriate tool instead.` };
      }

      const allLines = buffer.toString("utf-8").split("\n");
      // A trailing newline produces a phantom empty final element; drop it from the count.
      const totalFileLines = allLines[allLines.length - 1] === "" && allLines.length > 1
        ? allLines.length - 1
        : allLines.length;

      const startLine = offset && offset > 0 ? offset : 1;
      if (startLine > totalFileLines) {
        return { ok: false, error: `Offset ${startLine} is beyond end of file (${totalFileLines} lines total)` };
      }

      // Slice over allLines (not totalFileLines) so a trailing newline is preserved.
      let selectedLines = allLines.slice(startLine - 1);
      let userLimitedLines: number | undefined;
      if (limit !== undefined && limit < selectedLines.length) {
        selectedLines = selectedLines.slice(0, Math.max(limit, 0));
        userLimitedLines = selectedLines.length;
      }
      const selected = selectedLines.join("\n");

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
        ok: true,
        content: [{ type: "text", text: outputText || "(empty file)" }],
        details
      };
    }
  };
}

export function createReadTool(options: { cwd: string; workspaceDir: string }): AgentTool<typeof readSchema> {
  const def = getReadToolDefinition(options);
  return toolDefToAgentTool(def, options.cwd);
}
