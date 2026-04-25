import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
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
import { createToolSearchTool, type DeferredToolEntry } from "./toolSearch.js";
import { createWriteTool } from "./write.js";
import { createFeaturePluginTools } from "../../plugins/feature-registry.js";
import type { RuntimeSettings } from "../../settings/index.js";
import { momLog } from "../log.js";
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

const deferredToolStubSchema = Type.Object({}, { additionalProperties: true });

function createDeferredToolStub(options: {
  name: string;
  description: string;
  delegateTool: AgentTool<any>;
  loadDeferredTools: (toolNames: string[]) => string[];
}): AgentTool<typeof deferredToolStubSchema> {
  return {
    name: options.name,
    label: options.name,
    description: options.description,
    parameters: deferredToolStubSchema,
    executionMode: "sequential",
    execute: async (toolCallId, params, signal, onUpdate) => {
      const loaded = options.loadDeferredTools([options.name]);
      if (params && Object.keys(params as Record<string, unknown>).length > 0) {
        return options.delegateTool.execute(toolCallId, params, signal, onUpdate);
      }
      return {
        content: [{
          type: "text",
          text: loaded.length > 0
            ? `${options.name} is now loaded. Call ${options.name} again with the required parameters.`
            : `${options.name} is already loaded. Call ${options.name} again with the required parameters.`
        }],
        details: { loaded }
      };
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
  onLocalToolsChanged?: (tools: AgentTool<any>[]) => void;
  exposeLoadMcpTool?: boolean;
  uploadFile: (filePath: string, title?: string, text?: string) => Promise<void>;
}): AgentTool<any>[] {
  const loadedDeferredToolNames = new Set<string>();
  const createEventRuntimeTool = wrapSerializedTool(createEventTool({
    workspaceDir: options.workspaceDir,
    chatId: options.chatId,
    timezone: options.timezone
  }));
  const deferredTools: DeferredToolEntry[] = [
    {
      name: "createEvent",
      label: "createEvent",
      description: "Schedule one-shot, recurring, or immediate messages and reminders.",
      keywords: [
        "create",
        "event",
        "events",
        "schedule",
        "scheduling",
        "reminder",
        "remind",
        "recurring",
        "periodic",
        "cron",
        "timer",
        "later",
        "tomorrow"
      ],
      tool: createEventRuntimeTool
    }
  ];

  const featureTools = createFeaturePluginTools({
    getSettings: options.getSettings
  }).map((tool) => wrapSerializedTool(tool));

  let tools: AgentTool<any>[] = [];
  const getActiveTools = (): AgentTool<any>[] => [
    ...deferredTools
      .filter((entry) => loadedDeferredToolNames.has(entry.name))
      .map((entry) => entry.tool),
    ...tools.filter((tool) => !loadedDeferredToolNames.has(tool.name)),
    ...featureTools
  ];
  const loadDeferredTools = (toolNames: string[]): string[] => {
    const loaded: string[] = [];
    const requested = new Set(toolNames);
    const beforeLoaded = Array.from(loadedDeferredToolNames);
    for (const entry of deferredTools) {
      if (!requested.has(entry.name) || loadedDeferredToolNames.has(entry.name)) continue;
      loadedDeferredToolNames.add(entry.name);
      loaded.push(entry.name);
    }
    momLog("runner", "deferred_tools_load", {
      chatId: options.chatId,
      requested: Array.from(requested),
      loaded,
      beforeLoaded,
      afterLoaded: Array.from(loadedDeferredToolNames),
      deferredTools: deferredTools.map((entry) => entry.name),
      activeLocalTools: getActiveTools().map((tool) => tool.name)
    });
    if (loaded.length > 0) {
      options.onLocalToolsChanged?.(getActiveTools());
    }
    return loaded;
  };

  tools = [
    createMemoryTool({ memory: options.memory, channel: options.channel, chatId: options.chatId }),
    createSwitchModelTool({ getSettings: options.getSettings, updateSettings: options.updateSettings }),
    createSkillSearchTool({
      workspaceDir: options.workspaceDir,
      chatId: options.chatId,
      getSettings: options.getSettings
    }),
    createToolSearchTool({
      chatId: options.chatId,
      getDeferredTools: () => deferredTools,
      loadDeferredTools
    }),
    createDeferredToolStub({
      name: "createEvent",
      description:
        "Deferred lightweight entry for createEvent. Prefer toolSearch first for full schema; if called with valid scheduling parameters, this delegates to the real createEvent tool.",
      delegateTool: createEventRuntimeTool,
      loadDeferredTools
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

  return getActiveTools();
}
