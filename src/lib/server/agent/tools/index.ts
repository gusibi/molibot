import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { promises as fs } from "node:fs";
import { dirname as pathDirname } from "node:path";
import type { MemoryGateway } from "$lib/server/memory/gateway.js";
import { createAttachTool } from "$lib/server/agent/tools/attach.js";
import { getBashToolDefinition, tryParseHostBashCommand, findApprovedHostBash } from "$lib/server/agent/tools/bash.js";
import { getEditToolDefinition } from "$lib/server/agent/tools/edit.js";
import { createEventTool } from "$lib/server/agent/tools/event.js";
import { createLoadMcpTool } from "$lib/server/agent/tools/loadMcp.js";
import { createMemoryTool } from "$lib/server/agent/tools/memory.js";
import { createProfileFilesTool } from "$lib/server/agent/tools/profileFiles.js";
import { getReadToolDefinition } from "$lib/server/agent/tools/read.js";
import { createSkillManageTool } from "$lib/server/agent/tools/skillManage.js";
import { createSkillSearchTool } from "$lib/server/agent/tools/skillSearch.js";
import { createSubagentTool } from "$lib/server/agent/tools/subagent.js";
import { createSwitchModelTool } from "$lib/server/agent/tools/switchModel.js";
import { createToolSearchTool, type DeferredToolEntry } from "$lib/server/agent/tools/toolSearch.js";
import { getWriteToolDefinition } from "$lib/server/agent/tools/write.js";
import { createFeaturePluginTools } from "$lib/server/plugins/feature-registry.js";
import type { RuntimeSettings } from "$lib/server/settings/index.js";
import { momLog } from "$lib/server/agent/common/log.js";
import { resolveScratchArtifactDir } from "$lib/server/agent/session/scratchArtifacts.js";
import { shouldSerializeToolCall } from "$lib/server/agent/tools/toolPolicy.js";
import type { RunnerUiEvent } from "$lib/server/agent/core/types.js";
import type { MomRuntimeStore } from "$lib/server/agent/session/store.js";
import { ToolRegistry, ToolRuntime, defaultPolicyDecider, createDefaultApprovalRequest, type ToolPolicyDecider } from "$lib/server/agent/tools/toolRuntime.js";
import { getApprovalBroker } from "$lib/server/approval/approvalBroker.js";
import type { ToolDefinition, ToolExecutionContext } from "$lib/server/agent/tools/toolTypes.js";
import { createPathGuard, resolveToolPath } from "$lib/server/agent/tools/path.js";
import { wrapCommandWithVenv, execCommand } from "$lib/server/agent/tools/helpers.js";
import { prepareToolSandboxExecution } from "$lib/server/agent/tools/sandbox.js";
import { getHostBashStore } from "$lib/server/hostBash/index.js";

function wrapSerializedTool<T extends AgentTool<any>>(tool: T): T {
  let chain = Promise.resolve();
  return {
    ...tool,
    execute: async (toolCallId, params, signal, onUpdate) => {
      if (!shouldSerializeToolCall(tool.name, params)) {
        if (signal?.aborted) throw new Error("Aborted");
        return tool.execute(toolCallId, params, signal, onUpdate);
      }
      const run = async () => {
        if (signal?.aborted) throw new Error("Aborted");
        return tool.execute(toolCallId, params, signal, onUpdate);
      };
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

function createDeferredToolEntry(options: {
  name: string;
  description: string;
  keywords: string[];
  tool: AgentTool<any>;
  loadDeferredTools: (toolNames: string[]) => string[];
}): { entry: DeferredToolEntry; stub: AgentTool<typeof deferredToolStubSchema> } {
  return {
    entry: {
      name: options.name,
      label: options.name,
      description: options.description,
      keywords: options.keywords,
      tool: options.tool
    },
    stub: createDeferredToolStub({
      name: options.name,
      description: `Deferred lightweight entry for ${options.name}. Prefer toolSearch first for full schema; if called with valid parameters, this delegates to the real ${options.name} tool.`,
      delegateTool: options.tool,
      loadDeferredTools: options.loadDeferredTools
    })
  };
}

export function createMomTools(options: {
  channel: string;
  cwd: string;
  workspaceDir: string;
  chatId: string;
  sessionId: string;
  runId?: string;
  workspaceId?: string;
  timezone: string;
  messageTimestamp?: string | number | Date;
  store: MomRuntimeStore;
  memory: MemoryGateway;
  getSettings: () => RuntimeSettings;
  updateSettings: (patch: Partial<RuntimeSettings>) => RuntimeSettings;
  getSelectedMcpServerIds: () => Set<string>;
  setSelectedMcpServerIds: (next: Set<string>) => void;
  refreshLoadedMcpTools: () => Promise<{ serverCount: number; toolCount: number }>;
  onLocalToolsChanged?: (tools: AgentTool<any>[]) => void;
  exposeLoadMcpTool?: boolean;
  uploadFile: (filePath: string, title?: string, text?: string) => Promise<void>;
  emitRunnerEvent?: (event: RunnerUiEvent) => Promise<void>;
}): AgentTool<any>[] {
  const artifactDir = resolveScratchArtifactDir(options.timezone, options.messageTimestamp);
  const loadedDeferredToolNames = new Set<string>();
  const createEventRuntimeTool = wrapSerializedTool(createEventTool({
    workspaceDir: options.workspaceDir,
    chatId: options.chatId,
    timezone: options.timezone
  }));
  const switchModelRuntimeTool = wrapSerializedTool(createSwitchModelTool({
    getSettings: options.getSettings,
    updateSettings: options.updateSettings
  }));
  const skillManageRuntimeTool = wrapSerializedTool(createSkillManageTool({
    workspaceDir: options.workspaceDir,
    chatId: options.chatId
  }));
  const profileFilesRuntimeTool = wrapSerializedTool(createProfileFilesTool({
    channel: options.channel,
    workspaceDir: options.workspaceDir,
    getSettings: options.getSettings
  }));

  const featureTools = createFeaturePluginTools({
    getSettings: options.getSettings
  }).map((tool) => wrapSerializedTool(tool));

  let tools: AgentTool<any>[] = [];
  let deferredTools: DeferredToolEntry[] = [];

  const registry = new ToolRegistry();
  const decidePolicy: ToolPolicyDecider = (tool, input, ctx) => {
    if (tool.id === "bash") {
      const params = input as { command?: string; hostApproval?: any };

      if (params?.hostApproval) {
        return {
          type: "approval_required",
          request: createDefaultApprovalRequest(tool, input, ctx)
        };
      }

      const hostBashStore = getHostBashStore();
      const parsed = tryParseHostBashCommand(params?.command ?? "");
      const approved = findApprovedHostBash(hostBashStore, parsed);
      if (approved) {
        return { type: "allow" };
      }

      const sandboxSettings = options.getSettings().toolSandbox;
      if (sandboxSettings.enabled) {
        return { type: "allow" };
      }

      return {
        type: "approval_required",
        request: createDefaultApprovalRequest(tool, input, ctx)
      };
    }

    if (tool.risk === "high" || tool.risk === "critical") {
      return {
        type: "approval_required",
        request: createDefaultApprovalRequest(tool, input, ctx)
      };
    }
    return { type: "allow" };
  };

  const toolRuntime = new ToolRuntime(registry, {
    approvalBroker: getApprovalBroker(),
    decidePolicy
  });

  const ensureAllowedPath = createPathGuard(options.cwd, options.workspaceDir);

  const buildExecutionContext = (signal?: AbortSignal): ToolExecutionContext => {
    return {
      runId: options.runId ?? "default-run",
      sessionId: options.sessionId,
      workspaceId: options.workspaceId ?? "personal",
      actorId: options.chatId,
      cwd: options.cwd,
      fs: {
        readText: async (path) => {
          const filePath = resolveToolPath(options.cwd, path);
          ensureAllowedPath(filePath);
          return fs.readFile(filePath, "utf8");
        },
        writeText: async (path, content) => {
          const filePath = resolveToolPath(options.cwd, path);
          ensureAllowedPath(filePath);
          await fs.mkdir(pathDirname(filePath), { recursive: true });
          await fs.writeFile(filePath, content, "utf8");
        },
        readBuffer: async (path) => {
          const filePath = resolveToolPath(options.cwd, path);
          ensureAllowedPath(filePath);
          return fs.readFile(filePath);
        }
      },
      shell: {
        run: async (cmd, runOpts) => {
          const targetCwd = runOpts?.cwd ?? options.cwd;
          const timeoutSeconds = runOpts?.timeoutMs ? runOpts.timeoutMs / 1000 : undefined;
          
          const sandboxSettings = options.getSettings().toolSandbox;
          const sandboxEnv = artifactDir ? { MOLIBOT_SCRATCH_ARTIFACT_DIR: artifactDir } : {};
          const wrappedCommand = wrapCommandWithVenv(cmd);
          const sandboxed = sandboxSettings.enabled
            ? await prepareToolSandboxExecution({
                settings: sandboxSettings,
                workspaceDir: options.workspaceDir,
                cwd: targetCwd,
                command: wrappedCommand,
                env: sandboxEnv,
                signal
              })
            : {
                command: wrappedCommand,
                env: sandboxEnv,
                inheritProcessEnv: true,
                sandboxApplied: false,
                warning: undefined
              };

          const result = await execCommand(sandboxed.command, {
            cwd: targetCwd,
            timeoutSeconds,
            signal,
            env: sandboxed.env,
            inheritProcessEnv: sandboxed.inheritProcessEnv
          });

          return {
            exitCode: result.code,
            stdout: result.stdout,
            stderr: result.stderr,
            sandboxApplied: sandboxed.sandboxApplied,
            warning: sandboxed.warning
          };
        }
      },
      network: {
        fetch: async (url, init) => {
          const res = await fetch(url, init as any);
          return {
            status: res.status,
            statusText: res.statusText,
            ok: res.ok,
            headers: Object.fromEntries(res.headers.entries()),
            text: async () => res.text()
          };
        }
      },
      emit: (detailEntry) => {
        if (options.emitRunnerEvent) {
          void options.emitRunnerEvent({
            type: detailEntry.type === "tool_start" ? "tool_execution_start" : "tool_execution_end",
            toolName: detailEntry.toolName,
            displayName: detailEntry.displayName,
            label: detailEntry.summary,
            summary: detailEntry.summary,
            isError: detailEntry.isError
          } as any);
        }
      }
    };
  };

  const wrapWithToolRuntime = (originalTool: AgentTool<any>): AgentTool<any> => {
    if (!registry.get(originalTool.name)) {
      const isMcp = originalTool.name.startsWith("mcp__");
      const toolDef: ToolDefinition = {
        id: originalTool.name,
        name: originalTool.label ?? originalTool.name,
        description: originalTool.description,
        inputSchema: originalTool.parameters,
        risk: originalTool.name === "bash" ? "high" : (["write", "edit"].includes(originalTool.name) ? "medium" : "low"),
        source: originalTool.name === "bash" ? "host" : (isMcp ? "mcp" : "builtin"),
        handler: async (input, ctx) => {
          const res = (await originalTool.execute(ctx.runId, input)) as any;
          return {
            ok: !res.error,
            content: res.content,
            error: res.error,
            metadata: res.metadata
          };
        }
      };
      registry.register(toolDef);
    }

    return {
      ...originalTool,
      execute: async (toolCallId, params, signal, onUpdate) => {
        const toolCtx = buildExecutionContext(signal);
        const result = await toolRuntime.executeToolCall({
          toolId: originalTool.name,
          input: params,
          context: toolCtx
        });

        return {
          content: Array.isArray(result.content)
            ? result.content
            : [{ type: "text", text: String(result.content ?? result.error ?? "") }],
          error: result.ok ? undefined : result.error,
          metadata: result.metadata,
          details: result.details
        };
      }
    };
  };

  const toAgentTool = (def: ToolDefinition): AgentTool<any> => {
    return {
      name: def.id,
      label: def.name,
      description: def.description,
      parameters: def.inputSchema as any,
      execute: async (toolCallId, params, signal, onUpdate) => {
        const toolCtx = buildExecutionContext(signal);
        const result = await toolRuntime.executeToolCall({
          toolId: def.id,
          input: params,
          context: toolCtx
        });

        return {
          content: Array.isArray(result.content)
            ? result.content
            : [{ type: "text", text: String(result.content ?? result.error ?? "") }],
          error: result.ok ? undefined : result.error,
          metadata: result.metadata,
          details: result.details
        };
      }
    };
  };

  // Register built-in tool definitions in registry
  const readToolDef = getReadToolDefinition({ cwd: options.cwd, workspaceDir: options.workspaceDir });
  registry.register(readToolDef);

  const writeToolDef = getWriteToolDefinition({ cwd: options.cwd, workspaceDir: options.workspaceDir, chatId: options.chatId, artifactDir });
  registry.register(writeToolDef);

  const editToolDef = getEditToolDefinition({ cwd: options.cwd, workspaceDir: options.workspaceDir });
  registry.register(editToolDef);

  const bashToolDef = getBashToolDefinition({
    cwd: options.cwd,
    artifactDir,
    sandbox: {
      settings: options.getSettings().toolSandbox,
      workspaceDir: options.workspaceDir
    },
    hostApproval: {
      channel: options.channel,
      chatId: options.chatId,
      scopeId: options.chatId,
      sessionId: options.sessionId,
      store: options.store
    }
  });
  registry.register(bashToolDef);

  const getActiveTools = (): AgentTool<any>[] => {
    const rawTools = [
      ...deferredTools
        .filter((entry) => loadedDeferredToolNames.has(entry.name))
        .map((entry) => entry.tool),
      ...tools.filter((tool) => !loadedDeferredToolNames.has(tool.name)),
      ...featureTools
    ];
    return rawTools.map(tool => wrapWithToolRuntime(tool));
  };
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

  const deferredEntries = [
    createDeferredToolEntry({
      name: "createEvent",
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
      tool: createEventRuntimeTool,
      loadDeferredTools
    }),
    createDeferredToolEntry({
      name: "switchModel",
      description: "List configured runtime model options or safely switch the active model route.",
      keywords: ["switch", "model", "models", "route", "routing", "provider", "settings"],
      tool: switchModelRuntimeTool,
      loadDeferredTools
    }),
    createDeferredToolEntry({
      name: "skillManage",
      description: "Draft, create, update, list, read, or promote reusable skills.",
      keywords: ["skill", "skills", "draft", "workflow", "promote", "create", "update", "manage"],
      tool: skillManageRuntimeTool,
      loadDeferredTools
    }),
    createDeferredToolEntry({
      name: "profileFiles",
      description: "Read, bootstrap, write, or edit bot profile markdown files with parent fallback.",
      keywords: ["profile", "profiles", "bot", "soul", "identity", "tools", "user", "file", "files", "markdown"],
      tool: profileFilesRuntimeTool,
      loadDeferredTools
    })
  ];
  deferredTools = deferredEntries.map((item) => item.entry);

  tools = [
    createMemoryTool({ memory: options.memory, channel: options.channel, chatId: options.chatId }),
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
    ...deferredEntries.map((item) => item.stub),
    toAgentTool(readToolDef),
    toAgentTool(bashToolDef),
    toAgentTool(editToolDef),
    toAgentTool(writeToolDef),
    createSubagentTool({
      channel: options.channel,
      cwd: options.cwd,
      workspaceDir: options.workspaceDir,
      chatId: options.chatId,
      sessionId: options.sessionId,
      store: options.store,
      artifactDir,
      getSettings: options.getSettings,
      emitRunnerEvent: options.emitRunnerEvent,
      runId: options.runId
    }),
    createAttachTool({ ...options, artifactDir })
  ].map((tool) => wrapSerializedTool(tool));

  if (options.exposeLoadMcpTool) {
    tools.splice(2, 0, wrapSerializedTool(createLoadMcpTool({
      getSettings: options.getSettings,
      getSelectedServerIds: options.getSelectedMcpServerIds,
      setSelectedServerIds: options.setSelectedMcpServerIds,
      refreshLoadedMcpTools: options.refreshLoadedMcpTools
    })));
  }

  const resultTools = getActiveTools();
  (resultTools as any).wrapTool = wrapWithToolRuntime;
  return resultTools;
}
