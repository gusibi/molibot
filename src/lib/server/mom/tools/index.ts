import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { MemoryGateway } from "../../memory/gateway.js";
import { createAttachTool } from "./attach.js";
import { createBashTool } from "./bash.js";
import { createEditTool } from "./edit.js";
import { createMemoryTool } from "./memory.js";
import { createReadTool } from "./read.js";
import { createWriteTool } from "./write.js";

export function createMomTools(options: {
  cwd: string;
  workspaceDir: string;
  chatId: string;
  memory: MemoryGateway;
  uploadFile: (filePath: string, title?: string) => Promise<void>;
}): AgentTool<any>[] {
  return [
    createMemoryTool({ memory: options.memory, chatId: options.chatId }),
    createReadTool({ cwd: options.cwd, workspaceDir: options.workspaceDir }),
    createBashTool(options.cwd),
    createEditTool({ cwd: options.cwd, workspaceDir: options.workspaceDir }),
    createWriteTool({ cwd: options.cwd, workspaceDir: options.workspaceDir, chatId: options.chatId }),
    createAttachTool(options)
  ];
}
