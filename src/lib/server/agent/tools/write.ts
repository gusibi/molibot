import { dirname, isAbsolute, resolve } from "node:path";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { execCommand, shellEscape } from "./helpers.js";
import { createPathGuard, resolveToolPath } from "./path.js";

const writeSchema = Type.Object({
  label: Type.String(),
  path: Type.String(),
  content: Type.String()
});

function routeDefaultArtifactPath(inputPath: string, artifactDir?: string): { requestedPath: string; path: string; routed: boolean } {
  const requestedPath = inputPath.trim();
  const normalizedArtifactDir = artifactDir?.trim();
  if (!normalizedArtifactDir || !requestedPath || isAbsolute(requestedPath)) {
    return { requestedPath, path: requestedPath, routed: false };
  }

  const normalizedPath = requestedPath.replaceAll("\\", "/").replace(/^\.\//, "");
  const isPlainFileName =
    normalizedPath &&
    normalizedPath === requestedPath.replaceAll("\\", "/").replace(/^\.\//, "") &&
    !normalizedPath.includes("/") &&
    !normalizedPath.startsWith(".") &&
    normalizedPath !== "..";
  if (!isPlainFileName) {
    return { requestedPath, path: requestedPath, routed: false };
  }

  return {
    requestedPath,
    path: `${normalizedArtifactDir}/${normalizedPath}`,
    routed: true
  };
}

export function createWriteTool(options: { cwd: string; workspaceDir: string; chatId: string; artifactDir?: string }): AgentTool<typeof writeSchema> {
  const ensureAllowedPath = createPathGuard(options.cwd, options.workspaceDir);

  return {
    name: "write",
    label: "write",
    description: "Create or overwrite a file. Parent directories are created automatically. Plain file names for ordinary scratch artifacts are routed to the current dated artifact folder; explicit directories and absolute paths are left unchanged.",
    parameters: writeSchema,
    execute: async (_toolCallId, params, signal) => {
      const target = routeDefaultArtifactPath(params.path, options.artifactDir);
      const filePath = resolveToolPath(options.cwd, target.path);
      ensureAllowedPath(filePath);
      const dir = dirname(filePath);
      const cmd = `mkdir -p ${shellEscape(dir)} && printf '%s' ${shellEscape(params.content)} > ${shellEscape(filePath)}`;
      const result = await execCommand(cmd, { cwd: options.cwd, signal });
      if (result.code !== 0) {
        throw new Error(result.stderr || `Failed to write ${target.path}`);
      }
      return {
        content: [{
          type: "text",
          text: target.routed
            ? `Wrote ${params.content.length} bytes to ${target.path} (default artifact path for ${target.requestedPath})`
            : `Wrote ${params.content.length} bytes to ${target.path}`
        }],
        details: undefined
      };
    }
  };
}
