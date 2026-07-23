import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { createPathGuard, resolveToolPath } from "$lib/server/agent/tools/path.js";

const attachSchema = Type.Object({
  label: Type.String(),
  path: Type.String(),
  title: Type.Optional(Type.String()),
  text: Type.Optional(Type.String())
});

export function createAttachTool(options: {
  cwd: string;
  workspaceDir: string;
  artifactDir?: string;
  uploadFile: (filePath: string, title?: string, text?: string) => Promise<void>;
}): AgentTool<typeof attachSchema> {
  const ensureAllowedPath = createPathGuard(options.cwd, options.workspaceDir);
  const artifactDir = options.artifactDir?.trim();

  function isAudioFile(filePath: string): boolean {
    return /\.(aac|aif|aiff|amr|m4a|mp3|oga|ogg|opus|silk|wav)$/i.test(filePath);
  }

  function loadTranscriptSidecar(filePath: string): string | undefined {
    const transcriptPath = `${filePath}.transcript.txt`;
    if (!existsSync(transcriptPath)) return undefined;
    const text = readFileSync(transcriptPath, "utf8").trim();
    return text || undefined;
  }

  function resolveAttachPath(inputPath: string): string {
    const filePath = resolveToolPath(options.cwd, inputPath);
    if (existsSync(filePath) || !artifactDir) return filePath;

    const cwd = resolve(options.cwd);
    const rel = relative(cwd, filePath);
    const isMissingRootFile =
      rel &&
      !rel.startsWith("..") &&
      !isAbsolute(rel) &&
      !rel.includes("/") &&
      !rel.includes("\\");
    if (!isMissingRootFile) return filePath;

    const datedCandidate = resolve(cwd, artifactDir, basename(filePath));
    return existsSync(datedCandidate) ? datedCandidate : filePath;
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

      const filePath = resolveAttachPath(params.path);
      ensureAllowedPath(filePath);
      const title = params.title || basename(filePath);
      const text = typeof params.text === "string" ? params.text.trim() : "";
      const fallbackText = !text && isAudioFile(filePath) ? loadTranscriptSidecar(filePath) : undefined;
      await options.uploadFile(filePath, title, text || fallbackText);

      return {
        content: [{ type: "text", text: `Attached ${title}` }],
        details: {
          requestedPath: params.path,
          relativePath: basename(filePath),
          rootKind: "attachment",
          action: "attached",
          sizeBytes: statSync(filePath).size
        }
      };
    }
  };
}
