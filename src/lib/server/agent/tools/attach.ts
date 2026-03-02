import { basename } from "node:path";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { createPathGuard, resolveToolPath } from "./path.js";

const attachSchema = Type.Object({
  label: Type.String(),
  path: Type.String(),
  title: Type.Optional(Type.String())
});

export function createAttachTool(options: {
  cwd: string;
  workspaceDir: string;
  uploadFile: (filePath: string, title?: string) => Promise<void>;
}): AgentTool<typeof attachSchema> {
  const ensureAllowedPath = createPathGuard(options.cwd, options.workspaceDir);

  return {
    name: "attach",
    label: "attach",
    description: "Send a local file to Telegram.",
    parameters: attachSchema,
    execute: async (_toolCallId, params, signal) => {
      if (signal?.aborted) {
        throw new Error("Aborted");
      }

      const filePath = resolveToolPath(options.cwd, params.path);
      ensureAllowedPath(filePath);
      const title = params.title || basename(filePath);
      await options.uploadFile(filePath, title);

      return {
        content: [{ type: "text", text: `Attached ${title}` }],
        details: undefined
      };
    }
  };
}
