import { dirname, isAbsolute } from "node:path";
import fs from "node:fs";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { toolDefToAgentTool } from "$lib/server/agent/tools/helpers.js";
import { createPathGuard, resolveToolPath } from "$lib/server/agent/tools/path.js";
import type { ToolDefinition } from "$lib/server/agent/tools/toolTypes.js";

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

export function getWriteToolDefinition(options: { cwd: string; workspaceDir: string; chatId: string; artifactDir?: string }): ToolDefinition {
  const ensureAllowedPath = createPathGuard(options.cwd, options.workspaceDir);

  return {
    id: "write",
    name: "write",
    description: "Create or overwrite a file. Parent directories are created automatically. Plain file names for ordinary scratch artifacts are routed to the current dated artifact folder; explicit directories and absolute paths are left unchanged.",
    inputSchema: writeSchema,
    risk: "medium",
    source: "builtin",
    handler: async (params: any, ctx) => {
      const target = routeDefaultArtifactPath(params.path, options.artifactDir);
      const filePath = resolveToolPath(ctx.cwd, target.path);
      ensureAllowedPath(filePath);

      const dir = dirname(filePath);
      await fs.promises.mkdir(dir, { recursive: true });
      await ctx.fs.writeText(filePath, params.content);

      return {
        ok: true,
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

export function createWriteTool(options: { cwd: string; workspaceDir: string; chatId: string; artifactDir?: string }): AgentTool<typeof writeSchema> {
  const def = getWriteToolDefinition(options);
  return toolDefToAgentTool(def, options.cwd);
}
