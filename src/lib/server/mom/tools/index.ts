import type { AgentTool } from "@mariozechner/pi-agent-core";
import { createAttachTool } from "./attach.js";
import { createBashTool } from "./bash.js";
import { createEditTool } from "./edit.js";
import { createReadTool } from "./read.js";
import { createWriteTool } from "./write.js";

export function createMomTools(options: {
  cwd: string;
  workspaceDir: string;
  chatId: string;
  uploadFile: (filePath: string, title?: string) => Promise<void>;
}): AgentTool<any>[] {
  return [
    createReadTool({ cwd: options.cwd, workspaceDir: options.workspaceDir }),
    createBashTool(options.cwd),
    createEditTool({ cwd: options.cwd, workspaceDir: options.workspaceDir }),
    createWriteTool({ cwd: options.cwd, workspaceDir: options.workspaceDir, chatId: options.chatId }),
    createAttachTool(options)
  ];
}
