import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { createPathGuard, resolveToolPath } from "./path.js";

const attachSchema = Type.Object({
  label: Type.String(),
  path: Type.String(),
  title: Type.Optional(Type.String()),
  text: Type.Optional(Type.String())
});

export function createAttachTool(options: {
  cwd: string;
  workspaceDir: string;
  uploadFile: (filePath: string, title?: string, text?: string) => Promise<void>;
}): AgentTool<typeof attachSchema> {
  const ensureAllowedPath = createPathGuard(options.cwd, options.workspaceDir);

  function isAudioFile(filePath: string): boolean {
    return /\.(aac|aif|aiff|amr|m4a|mp3|oga|ogg|opus|silk|wav)$/i.test(filePath);
  }

  function loadTranscriptSidecar(filePath: string): string | undefined {
    const transcriptPath = `${filePath}.transcript.txt`;
    if (!existsSync(transcriptPath)) return undefined;
    const text = readFileSync(transcriptPath, "utf8").trim();
    return text || undefined;
  }

  return {
    name: "attach",
    label: "attach",
    description: "Send a local file through the active channel adapter. For voice/audio replies, set `text` to the full spoken content so the channel can show the full fallback text.",
    parameters: attachSchema,
    execute: async (_toolCallId, params, signal) => {
      if (signal?.aborted) {
        throw new Error("Aborted");
      }

      const filePath = resolveToolPath(options.cwd, params.path);
      ensureAllowedPath(filePath);
      const title = params.title || basename(filePath);
      const text = typeof params.text === "string" ? params.text.trim() : "";
      const fallbackText = !text && isAudioFile(filePath) ? loadTranscriptSidecar(filePath) : undefined;
      await options.uploadFile(filePath, title, text || fallbackText);

      return {
        content: [{ type: "text", text: `Attached ${title}` }],
        details: undefined
      };
    }
  };
}
