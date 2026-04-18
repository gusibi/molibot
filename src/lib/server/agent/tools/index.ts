import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { MemoryGateway } from "../../memory/gateway.js";
import { createAttachTool } from "./attach.js";
import { createBashTool } from "./bash.js";
import { createEditTool } from "./edit.js";
import { createEventTool } from "./event.js";
import { createLoadMcpTool } from "./loadMcp.js";
import { createMemoryTool } from "./memory.js";
import { createProfileFilesTool } from "./profileFiles.js";
import { createReadTool } from "./read.js";
import { createSkillManageTool } from "./skillManage.js";
import { createSkillSearchTool } from "./skillSearch.js";
import { createSwitchModelTool } from "./switchModel.js";
import { createWriteTool } from "./write.js";
import type { RuntimeSettings } from "../../settings/index.js";
import { shouldSerializeToolCall } from "../toolPolicy.js";

function wrapSerializedTool<T extends AgentTool<any>>(tool: T): T {
  let chain = Promise.resolve();
  return {
    ...tool,
    execute: async (toolCallId, params, signal, onUpdate) => {
      if (!shouldSerializeToolCall(tool.name, params)) {
        return tool.execute(toolCallId, params, signal, onUpdate);
      }
      const run = async () => tool.execute(toolCallId, params, signal, onUpdate);
      const result = chain.then(run, run);
      chain = result.then(() => undefined, () => undefined);
      return result;
    }
  };
}

export function createMomTools(options: {
  channel: string;
  cwd: string;
  workspaceDir: string;
  chatId: string;
  timezone: string;
  memory: MemoryGateway;
  getSettings: () => RuntimeSettings;
  updateSettings: (patch: Partial<RuntimeSettings>) => RuntimeSettings;
  getSelectedMcpServerIds: () => Set<string>;
  setSelectedMcpServerIds: (next: Set<string>) => void;
  refreshLoadedMcpTools: () => Promise<{ serverCount: number; toolCount: number }>;
  exposeLoadMcpTool?: boolean;
  uploadFile: (filePath: string, title?: string, text?: string) => Promise<void>;
}): AgentTool<any>[] {
  const tools: AgentTool<any>[] = [
    createMemoryTool({ memory: options.memory, channel: options.channel, chatId: options.chatId }),
    createSwitchModelTool({ getSettings: options.getSettings, updateSettings: options.updateSettings }),
    createSkillSearchTool({
      workspaceDir: options.workspaceDir,
      chatId: options.chatId,
      getSettings: options.getSettings
    }),
    createSkillManageTool({ workspaceDir: options.workspaceDir, chatId: options.chatId }),
    createProfileFilesTool({
      channel: options.channel,
      workspaceDir: options.workspaceDir,
      getSettings: options.getSettings
    }),
    createReadTool({ cwd: options.cwd, workspaceDir: options.workspaceDir }),
    createBashTool(options.cwd),
    createEditTool({ cwd: options.cwd, workspaceDir: options.workspaceDir }),
    createWriteTool({ cwd: options.cwd, workspaceDir: options.workspaceDir, chatId: options.chatId }),
    createEventTool({ workspaceDir: options.workspaceDir, chatId: options.chatId, timezone: options.timezone }),
    createAttachTool(options)
  ].map((tool) => wrapSerializedTool(tool));

  if (options.exposeLoadMcpTool) {
    tools.splice(2, 0, wrapSerializedTool(createLoadMcpTool({
      getSettings: options.getSettings,
      getSelectedServerIds: options.getSelectedMcpServerIds,
      setSelectedServerIds: options.setSelectedMcpServerIds,
      refreshLoadedMcpTools: options.refreshLoadedMcpTools
    })));
  }

  return tools;
}
