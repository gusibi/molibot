import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { MemoryGateway } from "../../memory/gateway.js";
import { createAttachTool } from "./attach.js";
import { createBashTool } from "./bash.js";
import { createEditTool } from "./edit.js";
import { createEventTool } from "./event.js";
import { createMemoryTool } from "./memory.js";
import { createReadTool } from "./read.js";
import { createWriteTool } from "./write.js";

export function createMomTools(options: {
  channel: string;
  cwd: string;
  workspaceDir: string;
  chatId: string;
  timezone: string;
  memory: MemoryGateway;
  uploadFile: (filePath: string, title?: string) => Promise<void>;
}): AgentTool<any>[] {
  return [
    createMemoryTool({ memory: options.memory, channel: options.channel, chatId: options.chatId }),
    createReadTool({ cwd: options.cwd, workspaceDir: options.workspaceDir }),
    createBashTool(options.cwd),
    createEditTool({ cwd: options.cwd, workspaceDir: options.workspaceDir }),
    createWriteTool({ cwd: options.cwd, workspaceDir: options.workspaceDir, chatId: options.chatId }),
    createEventTool({ workspaceDir: options.workspaceDir, chatId: options.chatId, timezone: options.timezone }),
    createAttachTool(options)
  ];
}
