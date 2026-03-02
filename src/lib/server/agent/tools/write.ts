import { basename, dirname, extname, resolve } from "node:path";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { execCommand, shellEscape } from "./helpers.js";
import { createPathGuard, resolveToolPath } from "./path.js";

const writeSchema = Type.Object({
  label: Type.String(),
  path: Type.String(),
  content: Type.String()
});

export function createWriteTool(options: { cwd: string; workspaceDir: string; chatId: string }): AgentTool<typeof writeSchema> {
  const ensureAllowedPath = createPathGuard(options.cwd, options.workspaceDir);

  return {
    name: "write",
    label: "write",
    description: "Create or overwrite a file. Parent directories are created automatically.",
    parameters: writeSchema,
    execute: async (_toolCallId, params, signal) => {
      const filePath = resolveToolPath(options.cwd, params.path);
      ensureAllowedPath(filePath);
      const dir = dirname(filePath);
      const cmd = `mkdir -p ${shellEscape(dir)} && printf '%s' ${shellEscape(params.content)} > ${shellEscape(filePath)}`;
      const result = await execCommand(cmd, { cwd: options.cwd, signal });
      if (result.code !== 0) {
        throw new Error(result.stderr || `Failed to write ${params.path}`);
      }
      return {
        content: [{ type: "text", text: `Wrote ${params.content.length} bytes to ${params.path}` }],
        details: undefined
      };
    }
  };
}
