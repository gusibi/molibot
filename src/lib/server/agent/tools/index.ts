import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { promises as fs } from "node:fs";
import { dirname as pathDirname, basename, join } from "node:path";
import type { MemoryGateway } from "$lib/server/memory/gateway.js";
import { createAttachTool } from "$lib/server/agent/tools/attach.js";
import { getBashToolDefinition } from "$lib/server/agent/tools/bash.js";
import { resolveHostBashOwner } from "$lib/server/hostBash/index.js";
import { decideBashToolPolicy } from "$lib/server/agent/tools/bashPolicy.js";
import { getEditToolDefinition } from "$lib/server/agent/tools/edit.js";
import { createFileSearchTools } from "$lib/server/agent/tools/fileSearch.js";
import { createRuntimeTaskTool } from "$lib/server/agent/tools/runtimeTask.js";
import { createMcpInvokeTool } from "$lib/server/agent/tools/mcpInvoke.js";
import { createLoadMcpTool } from "$lib/server/agent/tools/loadMcp.js";
import type { McpServerStatus } from "$lib/server/agent/tools/mcp.js";
import { createMemoryTool } from "$lib/server/agent/tools/memory.js";
import { createConversationSearchTool } from "$lib/server/agent/tools/conversationSearch.js";
import { createDocExtractTool } from "$lib/server/agent/tools/docExtract.js";
import { createDocumentExportTool } from "$lib/server/agent/tools/documentExport.js";
import { createImageAnalyzeTool } from "$lib/server/agent/tools/imageAnalyze.js";
import { createProfileFilesTool } from "$lib/server/agent/tools/profileFiles.js";
import { getReadToolDefinition } from "$lib/server/agent/tools/read.js";
import { getDurableEvidenceToolDefinition } from "$lib/server/agent/tools/durableEvidence.js";
import { createSkillManageTool } from "$lib/server/agent/tools/skillManage.js";
import { createSkillSearchTool } from "$lib/server/agent/tools/skillSearch.js";
import { createSubagentTool } from "$lib/server/agent/tools/subagent.js";
import { createSwitchModelTool } from "$lib/server/agent/tools/switchModel.js";
import { createExtensionManageTool } from "$lib/server/agent/tools/extensionManage.js";
import { createMiniAppManageTool } from "$lib/server/agent/tools/miniAppManage.js";
import { createToolSearchTool, type DeferredToolEntry } from "$lib/server/agent/tools/toolSearch.js";
import { getWriteToolDefinition } from "$lib/server/agent/tools/write.js";
import { createWebSearchTool } from "$lib/server/agent/search/webSearchTool.js";
import { createWebFetchTool } from "$lib/server/agent/webFetch/webFetchTool.js";
import { createImageGenerateTool } from "$lib/server/agent/imageGenerate/imageGenerateTool.js";
import { createVideoGenerateTool } from "$lib/server/agent/videoGenerate/videoGenerateTool.js";
import { createTtsGenerateTool } from "$lib/server/agent/ttsGenerate/ttsGenerateTool.js";
import { createFeaturePluginTools } from "$lib/server/plugins/feature-registry.js";
import { getPiExtensionHost } from "$lib/server/plugins/piExtensions/host.js";
import { createPiExtensionTools } from "$lib/server/plugins/piExtensions/toolBridge.js";
import { getMiniAppHost } from "$lib/server/miniapps/registry.js";
import { buildMiniAppDeferredTools } from "$lib/server/miniapps/toolAdapter.js";
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
import { prepareToolSandboxExecution, resolveEffectiveSandboxSettings } from "$lib/server/agent/tools/sandbox.js";
import { getRuntimeToolClassification } from "$lib/server/agent/tools/toolClassification.js";
import { decideToolPermission } from "$lib/server/agent/permissions/toolPermissionGate.js";
import { clampModeForChannel, resolveEffectivePermissionMode } from "$lib/server/agent/permissions/resolvePermissionMode.js";
import { buildRunOutputLayout } from "$lib/server/agent/tools/outputLayout.js";
import { getConversationSearchIndex } from "$lib/server/sessions/conversationSearch.js";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import { config } from "$lib/server/app/env.js";

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
  exposeStub?: boolean;
}): { entry: DeferredToolEntry; stub?: AgentTool<typeof deferredToolStubSchema> } {
  return {
    entry: {
      name: options.name,
      label: options.name,
      description: options.description,
      keywords: options.keywords,
      tool: options.tool
    },
    stub: options.exposeStub === false
      ? undefined
      : createDeferredToolStub({
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
  executionSessionId?: string;
  isolateSessionHostApproval?: boolean;
  runId?: string;
  workspaceId?: string;
  timezone: string;
  messageTimestamp?: string | number | Date;
  project?: { id?: string; name?: string; rootPath: string; scratchDir: string; sandboxEnabled?: boolean };
  store: MomRuntimeStore;
  memory: MemoryGateway;
  memoryWritesAllowed?: boolean;
  getSettings: () => RuntimeSettings;
  updateSettings: (patch: Partial<RuntimeSettings>) => RuntimeSettings;
  getSelectedMcpServerIds: () => Set<string>;
  setSelectedMcpServerIds: (next: Set<string>) => void;
  getLoadedMcpTools: () => AgentTool<any>[];
  refreshLoadedMcpTools: () => Promise<{ statuses: McpServerStatus[]; toolCount: number }>;
  onLocalToolsChanged?: (tools: AgentTool<any>[]) => void;
  exposeLoadMcpTool?: boolean;
  /** A leading @mini-app selector preloads and exclusively exposes that app. */
  miniAppId?: string;
  uploadFile: (filePath: string, title?: string, text?: string) => Promise<void>;
  emitRunnerEvent?: (event: RunnerUiEvent) => Promise<void>;
  onSideEffectPreflight?: ToolExecutionContext["onSideEffectPreflight"];
  onSideEffectReceipt?: ToolExecutionContext["onSideEffectReceipt"];
  onApprovalRequest?: ToolExecutionContext["onApprovalRequest"];
  consumeDurableApproval?: ToolExecutionContext["consumeDurableApproval"];
  readDurableEvidence?: ToolExecutionContext["readDurableEvidence"];
}): AgentTool<any>[] {
  const datedArtifactDir = resolveScratchArtifactDir(options.timezone, options.messageTimestamp);
  const artifactDir = options.project
    ? join(options.project.scratchDir, datedArtifactDir)
    : datedArtifactDir;
  const toolOutputDir = options.project
    ? join(pathDirname(options.project.scratchDir), "tool-output")
    : undefined;
  const outputLayout = options.project
    ? buildRunOutputLayout({
        cwd: options.cwd,
        scratchRoot: artifactDir,
        projectRoot: options.project.rootPath
      })
    : undefined;
  const botId = basename(options.workspaceDir) || "unknown";
  const sandboxSettings = resolveEffectiveSandboxSettings({
    getSettings: options.getSettings,
    chatId: options.chatId,
    sessionId: options.sessionId,
    store: options.store,
    channel: options.channel,
    botId,
    projectOverride: options.project?.sandboxEnabled
  });
  // The second axis, resolved through the same identity and the same chain.
  // Channels see Plan/Manual clamped away: neither has an interaction surface
  // outside the desktop app (product decision 2026-08-10).
  const permissionMode = clampModeForChannel(
    resolveEffectivePermissionMode({
      getSettings: options.getSettings,
      chatId: options.chatId,
      sessionId: options.sessionId,
      store: options.store,
      channel: options.channel,
      botId
    }),
    options.channel
  );
  // "Allowed to write without asking" is declared, never inferred from cwd
  // happening to sit inside something (PRD §127). The sandbox's own writable
  // set is deliberately wider than this — it includes the whole data dir, which
  // is right for bash and too broad for auto-approval.
  const allowedWriteRoots = [
    options.project?.rootPath,
    options.project?.scratchDir,
    options.cwd,
    options.workspaceDir
  ].filter((value): value is string => Boolean(value));
  const loadedDeferredToolNames = new Set<string>();
  const runtimeTaskTool = wrapSerializedTool(createRuntimeTaskTool({
    workspaceDir: options.workspaceDir,
    chatId: options.chatId,
    sessionId: options.sessionId,
    timezone: options.timezone
  }));
  const switchModelRuntimeTool = wrapSerializedTool(createSwitchModelTool({
    getSettings: options.getSettings,
    updateSettings: options.updateSettings
  }));
  const extensionManageRuntimeTool = wrapSerializedTool(createExtensionManageTool({
    getSettings: options.getSettings,
    updateSettings: options.updateSettings
  }));
  const miniAppManageRuntimeTool = wrapSerializedTool(createMiniAppManageTool({
    cwd: options.cwd,
    workspaceDir: options.workspaceDir
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
  const webSearchRuntimeTool = wrapSerializedTool(createWebSearchTool({
    getSettings: options.getSettings
  }));
  const webFetchRuntimeTool = wrapSerializedTool(createWebFetchTool());
  const docExtractRuntimeTool = wrapSerializedTool(createDocExtractTool({
    channel: options.channel,
    cwd: options.cwd,
    workspaceDir: options.workspaceDir,
    spillDir: toolOutputDir ?? join(options.cwd, ".mom-tool-output"),
    getSettings: options.getSettings
  }));
  const documentExportRuntimeTool = wrapSerializedTool(createDocumentExportTool({
    cwd: options.cwd,
    workspaceDir: options.workspaceDir,
    artifactDir,
    outputLayout: outputLayout ?? {
      scratchRoot: join(options.cwd, artifactDir)
    },
    uploadFile: options.uploadFile
  }));
  const imageAnalyzeRuntimeTool = wrapSerializedTool(createImageAnalyzeTool({
    channel: options.channel,
    cwd: options.cwd,
    workspaceDir: options.workspaceDir,
    spillDir: toolOutputDir ?? join(options.cwd, ".mom-tool-output"),
    getSettings: options.getSettings
  }));
  const imageGenerateRuntimeTool = wrapSerializedTool(createImageGenerateTool({
    getSettings: options.getSettings,
    cwd: options.cwd,
    workspaceDir: options.workspaceDir,
    artifactDir,
    outputLayout,
    uploadFile: options.uploadFile,
    sessionId: options.sessionId
  }));
  const videoGenerateRuntimeTool = wrapSerializedTool(createVideoGenerateTool({
    getSettings: options.getSettings,
    cwd: options.cwd,
    workspaceDir: options.workspaceDir,
    artifactDir,
    outputLayout,
    uploadFile: options.uploadFile,
    sessionId: options.sessionId
  }));
  const ttsGenerateRuntimeTool = wrapSerializedTool(createTtsGenerateTool({
    getSettings: options.getSettings,
    cwd: options.cwd,
    workspaceDir: options.workspaceDir,
    artifactDir,
    outputLayout,
    uploadFile: options.uploadFile
  }));

  const featureTools = createFeaturePluginTools({
    getSettings: options.getSettings,
    cwd: options.cwd,
    workspaceDir: options.workspaceDir
  }).map((tool) => wrapSerializedTool(tool));

  let tools: AgentTool<any>[] = [];
  let deferredTools: DeferredToolEntry[] = [];
  // Tools contributed by third-party pi extensions, filled in once the built-in
  // tool names are known (built-ins always win a name collision).
  let piExtensionTools: AgentTool<any>[] = [];
  const piExtensionToolNames = new Set<string>();
  // Manifest risk hints per Mini App tool id, so classification never has to
  // guess read-only / destructive from the tool name.
  const miniAppToolHints = new Map<string, { readOnlyHint: boolean; destructiveHint: boolean }>();

  const registry = new ToolRegistry();
  const decidePolicy: ToolPolicyDecider = (tool, input, ctx) => {
    if (tool.id === "bash") {
      return decideBashToolPolicy({
        tool,
        input,
        ctx,
        sandboxEnabled: sandboxSettings.enabled
      });
    }

    // Reading an installed receipt executes no app code and needs no approval.
    // validate/install do load owner-selected server code in-process, so the
    // critical classification below deliberately sends those actions through
    // the approval broker.
    if (tool.id === "miniAppManage" && (input as { action?: unknown })?.action === "inspect") {
      return { type: "allow" };
    }

    const gate = decideToolPermission(
      permissionMode,
      {
        toolId: tool.id,
        input,
        effect: tool.effect,
        thirdPartyHint: tool.thirdPartyHint
      },
      {
        sandboxEnabled: sandboxSettings.enabled,
        allowedWriteRoots,
        cwd: options.cwd
      }
    );

    if (gate.decision === "deny") {
      // Plan only. The tool list is narrowed before the model sees it, so this
      // is the backstop rather than the mechanism — a model that bounces off
      // denials burns its budget (pitfall 14a).
      return {
        type: "deny",
        reason: `Plan mode is read-only: ${tool.id} would ${gate.effect} and is unavailable until you exit Plan.`
      };
    }
    if (gate.decision === "ask") {
      return {
        type: "approval_required",
        request: createDefaultApprovalRequest(tool, input, ctx)
      };
    }

    // `risk` keeps its own duty: a high/critical tool still reaches the broker
    // even when the mode would allow its effect, so Auto cannot silently
    // auto-approve an installer (rule 1 of the matrix) or a destructive Mini
    // App tool.
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

  const buildExecutionContext = (
    signal?: AbortSignal,
    toolCallId?: string,
    onUpdate?: (update: any) => void
  ): ToolExecutionContext => {
    return {
      runId: options.runId ?? "default-run",
      sessionId: options.executionSessionId ?? options.sessionId,
      workspaceId: options.workspaceId ?? "personal",
      actorId: options.chatId,
      cwd: options.cwd,
      signal,
      toolCallId,
      onUpdate,
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
            isError: detailEntry.isError,
            hostBashApproval: (detailEntry as any).hostBashApproval
          } as any);
        }
      },
      onSideEffectPreflight: options.onSideEffectPreflight,
      onSideEffectReceipt: options.onSideEffectReceipt,
      onApprovalRequest: options.onApprovalRequest,
      consumeDurableApproval: options.consumeDurableApproval,
      readDurableEvidence: options.readDurableEvidence
    };
  };

  const wrapWithToolRuntime = (originalTool: AgentTool<any>): AgentTool<any> => {
    if (!registry.get(originalTool.name)) {
      const { risk, source } = getRuntimeToolClassification(originalTool.name, {
        isExtensionTool: piExtensionToolNames.has(originalTool.name),
        miniApp: miniAppToolHints.get(originalTool.name)
      });
      const toolDef: ToolDefinition = {
        id: originalTool.name,
        name: originalTool.label ?? originalTool.name,
        description: originalTool.description,
        inputSchema: originalTool.parameters,
        risk,
        source,
        handler: async (input, ctx) => {
          // toolCallId falls back to runId only for callers that predate the
          // per-call context fields; onUpdate keeps progress streaming alive.
          const res = (await originalTool.execute(ctx.toolCallId ?? ctx.runId, input, ctx.signal, ctx.onUpdate)) as any;
          return {
            ok: !res.error,
            content: res.content,
            error: res.error,
            metadata: res.metadata,
            details: res.details,
            terminate: res.terminate
          };
        }
      };
      registry.register(toolDef);
    }

    return {
      ...originalTool,
      execute: async (toolCallId, params, signal, onUpdate) => {
        const toolCtx = buildExecutionContext(signal, toolCallId, onUpdate);
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
          details: result.details,
          terminate: result.terminate
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
        const toolCtx = buildExecutionContext(signal, toolCallId, onUpdate);
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
          details: result.details,
          terminate: result.terminate
        };
      }
    };
  };

  // Register built-in tool definitions in registry
  const durableEvidenceToolDef = options.readDurableEvidence
    ? getDurableEvidenceToolDefinition()
    : undefined;
  if (durableEvidenceToolDef) registry.register(durableEvidenceToolDef);

  const durableEvidenceTool = durableEvidenceToolDef
    ? toAgentTool(durableEvidenceToolDef)
    : undefined;

  const readToolDef = getReadToolDefinition({ cwd: options.cwd, workspaceDir: options.workspaceDir });
  registry.register(readToolDef);

  // The operator's deny list binds every tool that writes, not just `bash`.
  // Before this, `toolSandbox.filesystem.denyWrite` was configured in Settings
  // and silently did nothing to `write`/`edit` (Permission Modes PRD, slice 0).
  const filesystemPolicy = {
    denyWrite: sandboxSettings.filesystem.denyWrite,
    allowWrite: sandboxSettings.filesystem.allowWrite
  };

  const writeToolDef = getWriteToolDefinition({ cwd: options.cwd, workspaceDir: options.workspaceDir, chatId: options.chatId, artifactDir, outputLayout, filesystemPolicy });
  registry.register(writeToolDef);

  const editToolDef = getEditToolDefinition({ cwd: options.cwd, workspaceDir: options.workspaceDir, outputLayout, filesystemPolicy });
  registry.register(editToolDef);

  const bashToolDef = getBashToolDefinition({
    cwd: options.cwd,
    artifactDir,
    relocateRootArtifacts: !options.project,
    toolOutputDir,
    sandbox: {
      settings: sandboxSettings,
      workspaceDir: options.workspaceDir
    },
    hostApproval: {
      channel: options.channel,
      chatId: options.chatId,
      scopeId: options.chatId,
      sessionId: options.sessionId,
      // "一直允许" grants live on the project (when the run has one) or on this
      // bot workspace — never install-wide.
      owner: resolveHostBashOwner({
        projectId: options.project?.id,
        projectName: options.project?.name,
        botId
      }),
      runId: options.runId,
      store: options.store,
      ignoreSessionApprovalMode: options.isolateSessionHostApproval
    }
  });
  registry.register(bashToolDef);

  const getActiveTools = (): AgentTool<any>[] => {
    const rawTools = [
      ...deferredTools
        .filter((entry) => loadedDeferredToolNames.has(entry.name))
        .map((entry) => entry.tool),
      ...tools.filter((tool) => !loadedDeferredToolNames.has(tool.name)),
      ...featureTools,
      ...piExtensionTools
    ];
    const scopedTools = options.miniAppId
      ? rawTools.filter((tool) => tool.name.startsWith(`miniapp__${options.miniAppId}__`))
      : rawTools;
    return scopedTools.map(tool => wrapWithToolRuntime(tool));
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
      name: "runtimeTask",
      description: "Create, list, inspect, update, and delete Runtime reminders and automations.",
      keywords: [
        "create",
        "list",
        "get",
        "update",
        "delete",
        "task",
        "todo",
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
      tool: runtimeTaskTool,
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
      name: "extensionManage",
      description: "List, inspect, install, uninstall, enable or disable third-party pi extensions (plugins). Installing requires owner approval.",
      keywords: [
        "extension",
        "extensions",
        "plugin",
        "plugins",
        "install",
        "uninstall",
        "pi",
        "npm",
        "插件",
        "扩展",
        "安装"
      ],
      tool: extensionManageRuntimeTool,
      loadDeferredTools
    }),
    createDeferredToolEntry({
      name: "miniAppManage",
      description: "Validate a Mini App scratch build, atomically install/update it, or inspect the installed receipt.",
      keywords: [
        "miniapp",
        "mini app",
        "app",
        "validate",
        "install",
        "update",
        "manifest",
        "小程序",
        "校验",
        "安装",
        "更新"
      ],
      tool: miniAppManageRuntimeTool,
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
    }),
    createDeferredToolEntry({
      name: "webSearch",
      description: "Search current web information with configured providers, citations, and fallback diagnostics.",
      keywords: ["web", "search", "current", "latest", "news", "docs", "source", "citations", "internet"],
      tool: webSearchRuntimeTool,
      loadDeferredTools
    }),
    createDeferredToolEntry({
      name: "webFetch",
      description: "Fetch and extract readable Markdown from a public webpage URL with network and output-size safeguards.",
      keywords: ["web", "fetch", "url", "link", "page", "website", "html", "markdown", "content", "article"],
      tool: webFetchRuntimeTool,
      loadDeferredTools
    }),
    createDeferredToolEntry({
      name: "docExtract",
      description: "Extract readable text and tables from PDF, DOCX, and XLSX workspace documents.",
      keywords: ["document", "extract", "pdf", "docx", "xlsx", "word", "excel", "invoice", "contract", "report", "paper", "attachment"],
      tool: docExtractRuntimeTool,
      loadDeferredTools
    }),
    createDeferredToolEntry({
      name: "documentExport",
      description: "Generate and re-read verify deliverable DOCX, XLSX, or PDF files; PPTX is intentionally unsupported.",
      keywords: ["document", "export", "generate", "docx", "xlsx", "pdf", "word", "excel", "report", "contract", "deliverable", "文档", "导出", "报告", "报表", "合同"],
      tool: documentExportRuntimeTool,
      loadDeferredTools
    }),
    createDeferredToolEntry({
      name: "imageAnalyze",
      description: "Analyze workspace images with the configured vision route for OCR and general visual understanding.",
      keywords: ["image", "analyze", "vision", "ocr", "screenshot", "invoice", "chart", "picture", "recognize", "图片", "识别"],
      tool: imageAnalyzeRuntimeTool,
      loadDeferredTools
    }),
    createDeferredToolEntry({
      name: "imageGenerate",
      description: "Generate high-quality images based on text descriptions, save locally, and automatically send to chat.",
      keywords: [
        "image",
        "generate",
        "draw",
        "picture",
        "create",
        "paint",
        "illustration",
        "poster",
        "cover",
        "logo",
        "img2img"
      ],
      tool: imageGenerateRuntimeTool,
      loadDeferredTools
    }),
    createDeferredToolEntry({
      name: "videoGenerate",
      description: "Generate high-quality videos. For image-to-video, reference images must be public HTTP(S) Remote URLs only; never pass Base64/data URLs or local paths.",
      keywords: [
        "video",
        "generate",
        "animate",
        "render",
        "keyframes",
        "ti2vid"
      ],
      tool: videoGenerateRuntimeTool,
      loadDeferredTools
    }),
    createDeferredToolEntry({
      name: "ttsGenerate",
      description: "Convert text into speech audio with configured TTS providers, save locally, and automatically send to chat.",
      keywords: [
        "tts",
        "speech",
        "voice",
        "voiceover",
        "narration",
        "audio",
        "speak"
      ],
      tool: ttsGenerateRuntimeTool,
      loadDeferredTools
    }),
    // Installed Mini Apps. Deferred with no stub: the installed app set is
    // dynamic, so their schemas must not enter the prompt's stable prefix, and
    // a permissive stub would let the model call an app tool before it has seen
    // the real schema.
    ...(() => {
      let miniAppEntries: ReturnType<typeof createDeferredToolEntry>[] = [];
      try {
        miniAppEntries = buildMiniAppDeferredTools(getMiniAppHost())
          .filter((miniApp) => !options.miniAppId || miniApp.descriptor.appId === options.miniAppId)
          .map((miniApp) => {
          miniAppToolHints.set(miniApp.name, {
            readOnlyHint: miniApp.descriptor.readOnlyHint,
            destructiveHint: miniApp.descriptor.destructiveHint
          });
          return createDeferredToolEntry({
            name: miniApp.name,
            description: miniApp.description,
            keywords: miniApp.keywords,
            tool: miniApp.tool,
            loadDeferredTools,
            exposeStub: false
          });
        });
      } catch (error) {
        // A broken Mini App must not take down tool construction for the turn.
        momLog("runner", "miniapp_tools_unavailable", {
          chatId: options.chatId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
      return miniAppEntries;
    })()
  ];
  deferredTools = deferredEntries.map((item) => item.entry);
  // The Agent loop snapshots its tools before the first provider request.
  // Explicit @app invocation must therefore preload its tools now, rather
  // than relying on a later toolSearch state update.
  if (options.miniAppId) {
    for (const entry of deferredTools) {
      if (entry.name.startsWith(`miniapp__${options.miniAppId}__`)) {
        loadedDeferredToolNames.add(entry.name);
      }
    }
  }

  tools = [
    createMemoryTool({
      memory: options.memory,
      writesAllowed: options.memoryWritesAllowed !== false,
      scope: {
        channel: options.channel,
        externalUserId: options.chatId,
        botId,
        projectId: options.project?.id
      }
    }),
    createConversationSearchTool({
      index: getConversationSearchIndex(storagePaths.moryDbFile),
      externalDataRoot: config.dataDir,
      scope: {
        channel: options.channel,
        chatId: options.chatId,
        botId,
        projectId: options.project?.id
      }
    }),
    createSkillSearchTool({
      workspaceDir: options.workspaceDir,
      chatId: options.chatId,
      projectRoot: options.project?.rootPath,
      getSettings: options.getSettings
    }),
    createToolSearchTool({
      chatId: options.chatId,
      getDeferredTools: () => deferredTools,
      loadDeferredTools
    }),
    ...deferredEntries.flatMap((item) => item.stub ? [item.stub] : []),
    ...(durableEvidenceTool ? [durableEvidenceTool] : []),
    toAgentTool(readToolDef),
    toAgentTool(bashToolDef),
    toAgentTool(editToolDef),
    toAgentTool(writeToolDef),
    ...createFileSearchTools({ cwd: options.cwd, workspaceDir: options.workspaceDir }),
    createSubagentTool({
      channel: options.channel,
      cwd: options.cwd,
      workspaceDir: options.workspaceDir,
      chatId: options.chatId,
      sessionId: options.executionSessionId ?? options.sessionId,
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
    tools.splice(3, 0, wrapSerializedTool(createMcpInvokeTool({
      getLoadedMcpTools: options.getLoadedMcpTools
    })));
  }

  const piHost = getPiExtensionHost();
  const piResult = createPiExtensionTools(
    piHost.getActiveExtensions(options.getSettings(), botId),
    {
      cwd: options.cwd,
      reservedToolNames: new Set([
        ...tools.map((tool) => tool.name),
        ...deferredTools.map((entry) => entry.name),
        ...featureTools.map((tool) => tool.name)
      ])
    }
  );
  piHost.recordToolConflicts(piResult.conflicts);
  piExtensionTools = piResult.tools.map((tool) => wrapSerializedTool(tool));
  for (const tool of piExtensionTools) piExtensionToolNames.add(tool.name);

  const resultTools = getActiveTools();
  (resultTools as any).wrapTool = wrapWithToolRuntime;
  return resultTools;
}
