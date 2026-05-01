import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { Agent, type AgentEvent } from "@mariozechner/pi-agent-core";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { getModels, streamSimple, type Model } from "@mariozechner/pi-ai";
import { isKnownProvider, type RuntimeSettings, type CustomProviderConfig } from "../settings/index.js";
import type { MemoryGateway } from "../memory/gateway.js";
import { currentModelKey, resolveBuiltInProviderDefaultModel } from "../settings/modelSwitch.js";
import { momError, momLog, momWarn } from "./log.js";
import { buildSystemPrompt } from "./prompt.js";
import { buildRunReflection, formatRunClosingNote, type RunSummary } from "./runSummary.js";
import { saveSkillDraft, shouldSuggestSkillDraft } from "./skillDraft.js";
import { DEFAULT_RUN_BUDGET, RunBudget } from "./runtimeBudget.js";
import { MomRuntimeStore } from "./store.js";
import { applyAssistantStreamEvent } from "./assistantStream.js";
import { buildPromptInputEnvelope } from "./promptInput.js";
import { resolveSttTarget, transcribeAudioViaConfiguredProvider } from "./stt.js";
import { describeImageViaConfiguredProvider, resolveVisionFallbackTarget } from "./vision-fallback.js";
import { createMomTools } from "./tools/index.js";
import { getMcpToolsForRuntime } from "./mcp.js";
import { findExplicitlyInvokedSkills, loadSkillsFromWorkspace } from "./skills.js";
import { compactContextMessages, shouldCompactContext } from "./compaction.js";
import { hasConfiguredAuth, resolveProviderApiKey } from "./auth.js";
import { isRetryableModelError, resolvePromptAttemptDecision, shouldEmitFinalRunnerError } from "./runnerRetryState.js";
import type { MomContext, RunResult, RunnerLike } from "./types.js";
import type { AiUsageTracker } from "../usage/tracker.js";
import type { ModelErrorTracker } from "../usage/modelErrorTracker.js";
import {
  buildCustomProviderCompat,
  resolveCustomProviderReasoningSupport,
  resolveThinkingLevel
} from "../providers/customThinking.js";
import {
  buildAnthropicBaseUrl,
  buildOpenAIBaseUrl,
  resolveCustomProviderProtocol
} from "../providers/customProtocol.js";
import {
  DEFAULT_AGENT_MAX_RETRY_DELAY_MS,
  resolvePreferredTransport
} from "./runtimeOptions.js";
import {
  getPreferredToolExecutionMode,
  validateToolCallPreflight
} from "./toolPolicy.js";
import {
  SUBAGENT_DELEGATION_RUNTIME_NOTICE,
  stripTransientRuntimeNoticesFromMessages,
  TOOL_BUDGET_RUNTIME_NOTICE
} from "./runtimeNotices.js";

const TOOL_BUDGET_EXHAUSTED_CODE = "RUN_TOOL_BUDGET_EXHAUSTED";
const SUBAGENT_DELEGATION_NOTICE_TOOL_CALLS = 12;

function rewritePromptUserMessage(
  messages: AgentMessage[],
  userMessageIndex: number,
  persistedText: string
): AgentMessage[] {
  const target = messages[userMessageIndex] as AgentMessage & {
    role?: string;
    content?: Array<{ type?: string; text?: string }>;
  };
  if (!target || target.role !== "user") return messages;

  const content = Array.isArray(target.content) ? target.content : [];
  let replaced = false;
  const nextContent = content.map((part) => {
    if (!replaced && part.type === "text") {
      replaced = true;
      return { ...part, text: persistedText };
    }
    return part;
  });
  if (!replaced) {
    nextContent.unshift({ type: "text", text: persistedText });
  }

  const nextMessages = [...messages];
  nextMessages[userMessageIndex] = {
    ...target,
    content: nextContent
  } as AgentMessage;
  return nextMessages;
}

function resolvePiModel(settings: RuntimeSettings): Model<any> {
  const models = getModels(settings.piModelProvider);
  const preferredModelId = resolveBuiltInProviderDefaultModel(
    settings,
    settings.piModelProvider,
    settings.piModelName
  );
  const found = models.find((m) => m.id === preferredModelId);
  if (found) return found;
  if (models[0]) return models[0];
  throw new Error(
    `No models available for provider '${settings.piModelProvider}'`,
  );
}

function parseModelKey(key: string): { mode: "pi" | "custom"; provider: string; model: string } | null {
  const raw = key.trim();
  if (!raw) return null;
  const [mode, provider, ...rest] = raw.split("|");
  if ((mode !== "pi" && mode !== "custom") || !provider || rest.length === 0) return null;
  const model = rest.join("|").trim();
  if (!model) return null;
  return { mode, provider: provider.trim(), model };
}

function resolvePiModelByKey(provider: string, modelId: string): Model<any> | null {
  const models = getModels(provider as any);
  const found = models.find((m) => m.id === modelId);
  return found ?? null;
}

function isCustomProviderUsable(provider: CustomProviderConfig): boolean {
  return Boolean(provider.baseUrl?.trim() && provider.apiKey?.trim());
}

function modelSupportsUseCase(
  model: Pick<CustomProviderConfig["models"][number], "tags"> | undefined,
  useCase: "text" | "vision"
): boolean {
  const tags = Array.isArray(model?.tags) ? model.tags : [];
  if (useCase === "vision") return tags.includes("vision");
  return tags.length === 0 || tags.includes("text");
}

function pickCustomModelId(provider: CustomProviderConfig, useCase: "text" | "vision"): string {
  const rows = provider.models.filter((m) => Boolean(m.id?.trim()));
  if (rows.length === 0) return "";

  const byDefault = rows.find((m) => m.id === provider.defaultModel && modelSupportsUseCase(m, useCase));
  if (byDefault?.id) return byDefault.id;
  const matched = rows.find((m) => modelSupportsUseCase(m, useCase));
  return matched?.id ?? "";
}

function getProviderModel(provider: CustomProviderConfig): string {
  const modelIds = provider.models.map((m) => m.id).filter(Boolean);
  const selected = provider.defaultModel?.trim();
  if (selected && modelIds.includes(selected)) return selected;
  return modelIds[0]?.trim() || "";
}

function getSelectedCustomProvider(
  settings: RuntimeSettings,
  options: { includeBuiltIn?: boolean } = {}
): CustomProviderConfig | undefined {
  const includeBuiltIn = options.includeBuiltIn === true;
  const candidates = includeBuiltIn
    ? settings.customProviders.filter((p) => p.enabled !== false)
    : settings.customProviders.filter((p) => !isKnownProvider(p.id) && p.enabled !== false);
  if (candidates.length === 0) return undefined;
  return (
    candidates.find(
      (p) => p.id === settings.defaultCustomProviderId,
    ) ?? candidates[0]
  );
}

function getCustomProviderById(settings: RuntimeSettings, providerId: string): CustomProviderConfig | undefined {
  return settings.customProviders.find((p) => p.id === providerId);
}

function getCustomModelRoles(settings: RuntimeSettings): string[] {
  const routed = parseModelKey(settings.modelRouting.textModelKey);
  if (routed?.mode === "custom") {
    const provider = getCustomProviderById(settings, routed.provider);
    const model = provider?.models.find((m) => m.id === routed.model && modelSupportsUseCase(m, "text"));
    if (model?.supportedRoles?.length) return model.supportedRoles;
  }

  const selected = getSelectedCustomProvider(settings);
  if (!selected) return [];
  const modelId = getProviderModel(selected);
  const model = selected.models.find((m) => m.id === modelId && modelSupportsUseCase(m, "text"))
    ?? selected.models.find((m) => modelSupportsUseCase(m, "text"));
  return model?.supportedRoles ?? [];
}

function buildAgentSessionId(
  channel: string,
  chatId: string,
  sessionId: string,
  useCase: "text" | "vision",
  selection: ResolvedModelSelection
): string {
  return [channel, chatId, sessionId, useCase, selection.providerId, selection.modelId].join(":");
}

function sameModelSelection(a: ResolvedModelSelection, b: ResolvedModelSelection): boolean {
  return a.source === b.source && a.providerId === b.providerId && a.modelId === b.modelId;
}

function formatPayloadReasoningSummary(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "reasoning: unavailable";

  const raw = payload as Record<string, unknown>;
  const reasoningEffort = typeof raw.reasoning_effort === "string"
    ? raw.reasoning_effort
    : undefined;
  const reasoningObject = raw.reasoning && typeof raw.reasoning === "object"
    ? raw.reasoning as Record<string, unknown>
    : undefined;
  const openRouterEffort = typeof reasoningObject?.effort === "string"
    ? reasoningObject.effort
    : undefined;
  const enableThinking = typeof raw.enable_thinking === "boolean"
    ? raw.enable_thinking
    : undefined;
  const chatTemplateKwargs = raw.chat_template_kwargs && typeof raw.chat_template_kwargs === "object"
    ? raw.chat_template_kwargs as Record<string, unknown>
    : undefined;
  const chatTemplateEnableThinking = typeof chatTemplateKwargs?.enable_thinking === "boolean"
    ? chatTemplateKwargs.enable_thinking
    : undefined;
  const thinkingObject = raw.thinking && typeof raw.thinking === "object"
    ? raw.thinking as Record<string, unknown>
    : undefined;
  const thinkingType = typeof thinkingObject?.type === "string"
    ? thinkingObject.type
    : undefined;
  const thinkingEnabled = typeof thinkingObject?.enabled === "boolean"
    ? thinkingObject.enabled
    : undefined;
  const thinkingLevel = typeof thinkingObject?.level === "string"
    ? thinkingObject.level
    : undefined;
  const thinkingBudget = typeof thinkingObject?.budgetTokens === "number"
    ? thinkingObject.budgetTokens
    : typeof thinkingObject?.budget_tokens === "number"
      ? thinkingObject.budget_tokens
      : undefined;

  const parts = [
    reasoningEffort ? `reasoning_effort=${reasoningEffort}` : null,
    openRouterEffort ? `reasoning.effort=${openRouterEffort}` : null,
    enableThinking !== undefined ? `enable_thinking=${String(enableThinking)}` : null,
    chatTemplateEnableThinking !== undefined
      ? `chat_template_kwargs.enable_thinking=${String(chatTemplateEnableThinking)}`
      : null,
    thinkingType ? `thinking.type=${thinkingType}` : null,
    thinkingEnabled !== undefined ? `thinking.enabled=${String(thinkingEnabled)}` : null,
    thinkingLevel ? `thinking.level=${thinkingLevel}` : null,
    thinkingBudget !== undefined ? `thinking.budget=${thinkingBudget}` : null
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(", ") : "reasoning: none";
}

function resolveCustomModel(selected: CustomProviderConfig, modelId: string): Model<any> {
  const protocol = resolveCustomProviderProtocol(selected.protocol);
  const computedBaseUrl = protocol === "anthropic"
    ? buildAnthropicBaseUrl(selected.baseUrl, selected.path)
    : buildOpenAIBaseUrl(selected.baseUrl, selected.path);
  const configuredModel = selected.models.find((m) => m.id === modelId);
  const supportsVerifiedVision = Boolean(
    configuredModel?.tags?.includes("vision") &&
    configuredModel?.verification?.vision === "passed"
  );
  return {
    id: modelId,
    name: selected.name || modelId,
    api: protocol === "anthropic" ? "anthropic-messages" : "openai-completions",
    provider: selected.id || "custom-provider",
    baseUrl: computedBaseUrl,
    reasoning: resolveCustomProviderReasoningSupport(selected),
    input: supportsVerifiedVision ? ["text", "image"] : ["text"],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: 200000,
    maxTokens: 8192,
    compat: protocol === "anthropic" ? undefined : buildCustomProviderCompat(selected)
  };
}

function stripImagePartsForTextOnlyModel(selectedModel: Model<any>, context: any): any {
  const supportsImage = Array.isArray(selectedModel.input) && selectedModel.input.includes("image");
  if (supportsImage) return context;
  if (!context || typeof context !== "object" || !Array.isArray(context.messages)) return context;

  const messages = context.messages.map((message: any) => {
    if (!message || typeof message !== "object" || !Array.isArray(message.content)) return message;

    const filtered = message.content.filter((part: any) => part?.type !== "image");
    if (filtered.length > 0) {
      return { ...message, content: filtered };
    }

    const hadImage = message.content.some((part: any) => part?.type === "image");
    if (!hadImage) return message;

    return {
      ...message,
      content: [{ type: "text", text: "[image omitted from context for text-only model]" }]
    };
  });

  return {
    ...context,
    messages
  };
}

function removeOrphanToolResultsFromContext(context: any): any {
  if (!context || typeof context !== "object" || !Array.isArray(context.messages)) return context;

  const messages: unknown[] = [];
  let pendingToolCallIds = new Set<string>();

  for (const message of context.messages) {
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      messages.push(message);
      pendingToolCallIds = new Set();
      continue;
    }

    const row = message as { role?: unknown; toolCallId?: unknown; content?: unknown };
    if (row.role === "toolResult") {
      const toolCallId = String(row.toolCallId ?? "");
      if (toolCallId && pendingToolCallIds.has(toolCallId)) {
        messages.push(message);
        pendingToolCallIds.delete(toolCallId);
      }
      continue;
    }

    messages.push(message);

    if (row.role === "assistant" && Array.isArray(row.content)) {
      pendingToolCallIds = new Set(
        row.content
          .filter((part): part is { type?: unknown; id?: unknown } =>
            Boolean(part && typeof part === "object" && !Array.isArray(part))
          )
          .filter((part) => part.type === "toolCall")
          .map((part) => String(part.id ?? ""))
          .filter(Boolean)
      );
    } else {
      pendingToolCallIds = new Set();
    }
  }

  return messages.length === context.messages.length
    ? context
    : { ...context, messages };
}

interface ResolvedModelSelection {
  model: Model<any>;
  source: "pi" | "custom";
  providerId: string;
  modelId: string;
  configuredModel?: CustomProviderConfig["models"][number];
}

interface ModelAttemptFailure {
  provider: string;
  model: string;
  baseUrl?: string;
  endpointUrl?: string;
  message: string;
  kind: "request_error" | "empty_response" | "missing_api_key";
}

export function resolveModelSelection(
  settings: RuntimeSettings,
  useCase: "text" | "vision" = "text"
): ResolvedModelSelection {
  const routedKey = useCase === "vision"
    ? settings.modelRouting.visionModelKey
    : settings.modelRouting.textModelKey;
  const routed = parseModelKey(routedKey);
  if (routed) {
    if (routed.mode === "pi") {
      const pi = resolvePiModelByKey(routed.provider, routed.model);
      if (pi) {
        return {
          model: pi,
          source: "pi",
          providerId: routed.provider,
          modelId: routed.model
        };
      }
    } else {
      if (isKnownProvider(routed.provider)) {
        const pi = resolvePiModelByKey(routed.provider, routed.model);
        if (pi) {
          return {
            model: pi,
            source: "pi",
            providerId: routed.provider,
            modelId: routed.model
          };
        }
      }
      const provider = getCustomProviderById(settings, routed.provider);
      const configuredModel = provider?.models.find((m) => m.id === routed.model);
      if (
        provider &&
        provider.enabled !== false &&
        isCustomProviderUsable(provider) &&
        routed.model &&
        modelSupportsUseCase(configuredModel, useCase)
      ) {
        return {
          model: resolveCustomModel(provider, routed.model),
          source: "custom",
          providerId: provider.id,
          modelId: routed.model,
          configuredModel
        };
      }
    }
  }

  if (settings.providerMode === "custom") {
    const selected = getSelectedCustomProvider(settings);
    const modelId = selected ? pickCustomModelId(selected, useCase) : "";
    if (selected && isCustomProviderUsable(selected) && modelId) {
      return {
        model: resolveCustomModel(selected, modelId),
        source: "custom",
        providerId: selected.id,
        modelId,
        configuredModel: selected.models.find((m) => m.id === modelId)
      };
    }
  }

  for (const provider of settings.customProviders) {
    if (provider.enabled === false) continue;
    if (!isCustomProviderUsable(provider)) continue;
    const modelId = pickCustomModelId(provider, useCase);
    if (!modelId) continue;
    return {
      model: resolveCustomModel(provider, modelId),
      source: "custom",
      providerId: provider.id,
      modelId,
      configuredModel: provider.models.find((m) => m.id === modelId)
    };
  }

  const pi = resolvePiModel(settings);
  return {
    model: pi,
    source: "pi",
    providerId: settings.piModelProvider,
    modelId: pi.id
  };
}

function resolveModel(settings: RuntimeSettings, useCase: "text" | "vision" = "text"): Model<any> {
  return resolveModelSelection(settings, useCase).model;
}

function appendEndpointPath(baseUrl: string, endpointPath: string): string {
  return `${baseUrl.replace(/\/$/, "")}${endpointPath}`;
}

function modelEndpointUrl(api: string, baseUrl: string): string | undefined {
  if (api === "anthropic-messages") {
    return appendEndpointPath(baseUrl, "/v1/messages");
  }
  if (api === "openai-completions") {
    return appendEndpointPath(baseUrl, "/chat/completions");
  }
  return undefined;
}

function toModelAttemptFailure(
  selection: ResolvedModelSelection,
  message: string,
  kind: ModelAttemptFailure["kind"]
): ModelAttemptFailure {
  const redactedBaseUrl = selection.model.baseUrl ? redactBaseUrl(selection.model.baseUrl) : undefined;
  return {
    provider: selection.model.provider,
    model: selection.model.id,
    baseUrl: redactedBaseUrl,
    endpointUrl: redactedBaseUrl ? modelEndpointUrl(selection.model.api, redactedBaseUrl) : undefined,
    message,
    kind
  };
}

function formatModelAttemptFailure(failure: ModelAttemptFailure): string {
  return [
    `provider=${failure.provider}`,
    `model=${failure.model}`,
    failure.baseUrl ? `baseUrl=${failure.baseUrl}` : null,
    failure.endpointUrl ? `endpoint=${failure.endpointUrl}` : null,
    `type=${failure.kind}`,
    `error=${failure.message}`
  ].filter(Boolean).join(", ");
}

function buildModelFallbackSelections(
  settings: RuntimeSettings,
  primary: ResolvedModelSelection,
  useCase: "text" | "vision"
): ResolvedModelSelection[] {
  const seen = new Set<string>();
  const pushUnique = (rows: ResolvedModelSelection[], row: ResolvedModelSelection): void => {
    const key = `${row.source}|${row.providerId}|${row.modelId}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push(row);
  };

  const rows: ResolvedModelSelection[] = [];
  pushUnique(rows, primary);
  const fallbackMode = settings.modelFallback?.mode ?? "same-provider";
  if (fallbackMode === "off") {
    return rows;
  }

  const sameProviderAlternatives = settings.customProviders
    .filter((provider) => provider.enabled !== false && isCustomProviderUsable(provider))
    .filter((provider) => provider.id === primary.providerId)
    .flatMap((provider) =>
      provider.models
        .filter((model) => Boolean(model.id?.trim()))
        .filter((model) => modelSupportsUseCase(model, useCase))
        .filter((model) => model.id !== primary.modelId)
        .map((model) => ({
          model: resolveCustomModel(provider, model.id),
          source: "custom" as const,
          providerId: provider.id,
          modelId: model.id,
          configuredModel: provider.models.find((row) => row.id === model.id)
        }))
    );

  if (fallbackMode === "same-provider") {
    for (const row of sameProviderAlternatives) {
      pushUnique(rows, row);
    }
    return rows;
  }

  const differentProviderCustom: ResolvedModelSelection[] = [];
  for (const provider of settings.customProviders) {
    if (provider.enabled === false || !isCustomProviderUsable(provider) || provider.id === primary.providerId) {
      continue;
    }
    const modelId = pickCustomModelId(provider, useCase);
    if (!modelId) continue;
    differentProviderCustom.push({
      model: resolveCustomModel(provider, modelId),
      source: "custom",
      providerId: provider.id,
      modelId,
      configuredModel: provider.models.find((model) => model.id === modelId)
    });
  }

  for (const row of differentProviderCustom) {
    pushUnique(rows, row);
  }

  for (const row of sameProviderAlternatives) {
    pushUnique(rows, row);
  }

  const piSelection = resolveModelSelection(
    {
      ...settings,
      providerMode: "pi",
      modelRouting: {
        ...settings.modelRouting,
        textModelKey: `pi|${settings.piModelProvider}|${
          resolveBuiltInProviderDefaultModel(settings, settings.piModelProvider, settings.piModelName)
        }`,
        visionModelKey: `pi|${settings.piModelProvider}|${
          resolveBuiltInProviderDefaultModel(settings, settings.piModelProvider, settings.piModelName)
        }`
      }
    },
    useCase
  );
  pushUnique(rows, piSelection);

  return rows;
}

function hasExplicitMcpInvocation(inputText: string): boolean {
  const text = String(inputText ?? "");
  if (!text.trim()) return false;

  const lower = text.toLowerCase();
  const directPatterns = [
    /\bloadMcp\b/i,
    /(?:^|\s)\/mcp(?:\s|$)/i
  ];
  if (directPatterns.some((pattern) => pattern.test(lower))) {
    return true;
  }

  // Language-agnostic fallback: standalone MCP token anywhere in the sentence.
  return /(?:^|[\s([{'"“‘])mcp(?=$|[\s)\]}'"”’，。,.!?;:：])/i.test(lower);
}

function injectExplicitSkillInvocationContext(
  inputText: string,
  skills: Array<{ name: string; scope: string; filePath: string; baseDir?: string; aliases?: string[] }>
): string {
  if (skills.length === 0) return inputText;
  const lines = skills.map(
    (skill) =>
      `- name: ${skill.name}\n  scope: ${skill.scope}\n  skill_file: ${skill.filePath}${
        skill.baseDir ? `\n  base_dir: ${skill.baseDir}` : ""
      }${
        Array.isArray(skill.aliases) && skill.aliases.length > 0 ? `\n  aliases: ${skill.aliases.join(", ")}` : ""
      }`
  );
  return `${inputText}\n\n[explicit skill invocation]\n${lines.join("\n")}\n[/explicit skill invocation]`;
}

function injectExplicitSkillFileContext(
  inputText: string,
  skills: Array<{ name: string; scope: string; filePath: string; baseDir?: string }>
): string {
  if (skills.length === 0) return inputText;

  const blocks: string[] = [];
  for (const skill of skills) {
    try {
      const raw = readFileSync(skill.filePath, "utf8").trim();
      if (!raw) {
        blocks.push(
          [
            `- name: ${skill.name}`,
            `  scope: ${skill.scope}`,
            `  skill_file: ${skill.filePath}`,
            ...(skill.baseDir ? [`  base_dir: ${skill.baseDir}`] : []),
            "  status: empty"
          ].join("\n")
        );
        continue;
      }

      blocks.push(
        [
          `- name: ${skill.name}`,
          `  scope: ${skill.scope}`,
          `  skill_file: ${skill.filePath}`,
          ...(skill.baseDir ? [`  base_dir: ${skill.baseDir}`] : []),
          "  status: loaded",
          "  content: |",
          ...raw.split("\n").map((line) => `    ${line}`)
        ].join("\n")
      );
    } catch (error) {
      blocks.push(
        [
          `- name: ${skill.name}`,
          `  scope: ${skill.scope}`,
          `  skill_file: ${skill.filePath}`,
          ...(skill.baseDir ? [`  base_dir: ${skill.baseDir}`] : []),
          `  status: read_failed`,
          `  error: ${error instanceof Error ? error.message : String(error)}`
        ].join("\n")
      );
    }
  }

  return `${inputText}\n\n[explicit skill file]\n${blocks.join("\n")}\n[/explicit skill file]`;
}

function buildPromptRefreshKey(
  settings: RuntimeSettings,
  channel: string,
  workspaceDir: string
): string {
  const botId = basename(workspaceDir);
  const instances = settings.channels?.[channel]?.instances ?? [];
  const activeInstance = instances.find((instance) => instance.id === botId);
  return JSON.stringify({
    channel,
    botId,
    botAgentId: String(activeInstance?.agentId ?? "").trim(),
    botInstanceEnabled: activeInstance?.enabled !== false,
    timezone: settings.timezone,
    systemPrompt: settings.systemPrompt,
    disabledSkillPaths: settings.disabledSkillPaths,
    mcpServers: settings.mcpServers
  });
}

function supportsVisionNatively(
  selection: ResolvedModelSelection
): boolean {
  if (selection.source === "custom") {
    return Boolean(
      selection.configuredModel?.tags?.includes("vision") &&
      selection.configuredModel?.verification?.vision === "passed"
    );
  }
  return Array.isArray(selection.model.input) && selection.model.input.includes("image");
}

function supportsAudioInputConfigured(
  selection: ResolvedModelSelection
): boolean {
  if (selection.source !== "custom") return false;
  return Boolean(
    selection.configuredModel?.tags?.includes("audio_input") &&
    selection.configuredModel?.verification?.audio_input === "passed"
  );
}

export function decideVisionRouting(settings: RuntimeSettings, hasImages: boolean): {
  selection: ResolvedModelSelection;
  sendImagesNatively: boolean;
  mode: "text" | "vision" | "fallback";
  reason: string;
} {
  const textSelection = resolveModelSelection(settings, "text");
  if (!hasImages) {
    return {
      selection: textSelection,
      sendImagesNatively: false,
      mode: "text",
      reason: "no_images"
    };
  }

  const visionSelection = resolveModelSelection(settings, "vision");
  if (!sameModelSelection(visionSelection, textSelection) && supportsVisionNatively(visionSelection)) {
    const verification = visionSelection.configuredModel?.verification?.vision ?? "missing";
    return {
      selection: visionSelection,
      sendImagesNatively: true,
      mode: "vision",
      reason: verification === "passed"
        ? "vision_route_declared_verified"
        : "vision_route_declared_unverified"
    };
  }

  if (supportsVisionNatively(textSelection)) {
    const verification = textSelection.configuredModel?.verification?.vision ?? "missing";
    return {
      selection: textSelection,
      sendImagesNatively: true,
      mode: "text",
      reason: verification === "passed"
        ? "text_model_declared_vision_verified"
        : "text_model_declared_vision_unverified"
    };
  }

  if (supportsVisionNatively(visionSelection)) {
    const verification = visionSelection.configuredModel?.verification?.vision ?? "missing";
    return {
      selection: visionSelection,
      sendImagesNatively: true,
      mode: "vision",
      reason: verification === "passed"
        ? "vision_route_declared_verified"
        : "vision_route_declared_unverified"
    };
  }

  return {
    selection: textSelection,
    sendImagesNatively: false,
    mode: "fallback",
    reason: "no_declared_native_vision"
  };
}

function decideAudioRouting(settings: RuntimeSettings, hasAudio: boolean): {
  shouldTranscribe: boolean;
  mode: "none" | "stt" | "fallback";
  reason: string;
  userNotice?: string;
} {
  if (!hasAudio) {
    return {
      shouldTranscribe: false,
      mode: "none",
      reason: "no_audio"
    };
  }

  const textSelection = resolveModelSelection(settings, "text");
  const nativeAudioConfigured = supportsAudioInputConfigured(textSelection);
  const sttTarget = resolveSttTarget(settings);

  if (nativeAudioConfigured && sttTarget) {
    return {
      shouldTranscribe: true,
      mode: "stt",
      reason: "audio_input_verified_but_transport_unavailable"
    };
  }

  if (nativeAudioConfigured && !sttTarget) {
    return {
      shouldTranscribe: false,
      mode: "fallback",
      reason: "audio_input_verified_but_no_stt_fallback",
      userNotice: "当前主模型已声明并验证 `audio_input`，但 runtime 还不支持原生音频直传，且未配置可用的 STT 模型。"
    };
  }

  if (sttTarget?.declared && sttTarget.verification === "passed") {
    return {
      shouldTranscribe: true,
      mode: "stt",
      reason: "stt_route_verified"
    };
  }

  if (sttTarget?.declared && (sttTarget.verification === "untested" || sttTarget.verification === "missing")) {
    return {
      shouldTranscribe: true,
      mode: "stt",
      reason: "stt_route_declared_unverified"
    };
  }

  if (sttTarget) {
    return {
      shouldTranscribe: true,
      mode: "stt",
      reason: "builtin_stt_fallback"
    };
  }

  return {
    shouldTranscribe: false,
    mode: "fallback",
    reason: "no_stt_target",
    userNotice: "收到语音消息，但当前没有可用的 STT 路由；系统将保留语音占位文本而不做转写。"
  };
}

function decideImageFallbackRouting(
  settings: RuntimeSettings,
  hasImages: boolean,
  visionDecision: { sendImagesNatively: boolean; reason: string }
): {
  shouldAnalyze: boolean;
  mode: "none" | "native" | "vision" | "fallback";
  reason: string;
  userNotice?: string;
} {
  if (!hasImages) {
    return {
      shouldAnalyze: false,
      mode: "none",
      reason: "no_images"
    };
  }

  if (visionDecision.sendImagesNatively) {
    return {
      shouldAnalyze: false,
      mode: "native",
      reason: visionDecision.reason
    };
  }

  const target = resolveVisionFallbackTarget(settings);
  if (!target) {
    return {
      shouldAnalyze: false,
      mode: "fallback",
      reason: "no_vision_target",
      userNotice: "收到图片消息，但当前没有可用的 vision fallback 路由；系统将保留图片附件占位信息而不做内容识别。"
    };
  }

  if (!target.declared) {
    return {
      shouldAnalyze: false,
      mode: "fallback",
      reason: "vision_target_not_declared",
      userNotice: "收到图片消息，但当前选中的图片模型没有声明 `vision` 能力；系统将保留图片附件占位信息而不做内容识别。"
    };
  }

  if (target.verification === "failed") {
    return {
      shouldAnalyze: false,
      mode: "fallback",
      reason: "vision_target_failed_verification",
      userNotice: "收到图片消息，但当前可用的 vision 模型验证失败；系统将保留图片附件占位信息而不做内容识别。"
    };
  }

  return {
    shouldAnalyze: true,
    mode: "vision",
    reason: target.verification === "passed"
      ? "vision_fallback_verified"
      : "vision_fallback_declared_unverified"
  };
}

function envVarForProvider(provider: string): string | null {
  switch (provider) {
    case "anthropic":
      return "ANTHROPIC_API_KEY";
    case "openai":
    case "openai-codex":
      return "OPENAI_API_KEY";
    case "google":
    case "google-antigravity":
    case "google-gemini-cli":
      return "GOOGLE_API_KEY";
    case "xai":
      return "XAI_API_KEY";
    case "groq":
      return "GROQ_API_KEY";
    case "cerebras":
      return "CEREBRAS_API_KEY";
    case "openrouter":
      return "OPENROUTER_API_KEY";
    case "mistral":
      return "MISTRAL_API_KEY";
    case "zai":
      return "ZAI_API_KEY";
    case "minimax":
    case "minimax-cn":
      return "MINIMAX_API_KEY";
    case "huggingface":
      return "HUGGINGFACE_API_KEY";
    default:
      return null;
  }
}

async function resolveApiKeyForModel(
  model: Model<any>,
  settings: RuntimeSettings,
): Promise<string | undefined> {
  const mapped = settings.customProviders.find((p) => p.id === model.provider);
  if (mapped) {
    return mapped.apiKey?.trim() || undefined;
  }

  return resolveProviderApiKey(model.provider);
}

function redactBaseUrl(baseUrl: string): string {
  if (!baseUrl) return baseUrl;
  return baseUrl.replace(/\/\/([^/@]+)@/, "//***@");
}

function recordModelFailure(
  tracker: ModelErrorTracker,
  input: {
    channel: string;
    botId: string;
    chatId: string;
    sessionId: string;
    runId: string;
    route: "text" | "vision" | "stt" | "tts";
    selection: ResolvedModelSelection;
    failure: ModelAttemptFailure;
    candidateIndex: number;
    recovered: boolean;
    fallbackUsed: boolean;
    finalSelection?: ResolvedModelSelection;
  }
): void {
  tracker.record({
    source: "runner",
    channel: input.channel,
    botId: input.botId,
    chatId: input.chatId,
    sessionId: input.sessionId,
    runId: input.runId,
    provider: input.failure.provider,
    model: input.failure.model,
    api: input.selection.model.api,
    route: input.route,
    kind: input.failure.kind,
    message: input.failure.message,
    baseUrl: input.failure.baseUrl,
    endpointUrl: input.failure.endpointUrl,
    candidateIndex: input.candidateIndex,
    recovered: input.recovered,
    fallbackUsed: input.fallbackUsed,
    finalProvider: input.finalSelection?.model.provider,
    finalModel: input.finalSelection?.model.id
  });
}

function keyFingerprint(key: string | undefined): string {
  if (!key) return "none";
  if (key.length <= 8) return `len=${key.length}`;
  return `${key.slice(0, 4)}...${key.slice(-2)}(len=${key.length})`;
}

export function validateRuntimeSettings(settings: RuntimeSettings): string | null {
  const selection = resolveModelSelection(settings, "text");
  if (selection.source === "custom") {
    const selected = getCustomProviderById(settings, selection.providerId);
    if (!selected) {
      return `AI settings error: active custom model provider '${selection.providerId}' is missing from provider settings.`;
    }
    if (!selected.baseUrl?.trim() || !selected.apiKey?.trim() || !selection.modelId) {
      return "AI settings error: active custom model requires baseUrl, apiKey, and a valid model.";
    }
    return null;
  }

  const configuredBuiltInProvider = settings.customProviders.find((provider) => provider.id === selection.model.provider);
  if (!hasConfiguredAuth(selection.model.provider, () => configuredBuiltInProvider?.apiKey?.trim() || undefined)) {
    const envVar = envVarForProvider(selection.model.provider);
    const hint = envVar ? `${envVar} or auth.json` : "auth.json";
    return `AI settings error: missing credentials for provider '${selection.model.provider}'. Configure ${hint}.`;
  }
  return null;
}

function isContextOverflowError(message: string): boolean {
  const text = message.toLowerCase();
  return [
    "context length",
    "context window",
    "maximum context length",
    "prompt is too long",
    "too many tokens",
    "token limit",
    "maximum tokens",
    "input is too long"
  ].some((needle) => text.includes(needle));
}

function extractTextFromResult(result: unknown): string {
  if (typeof result === "string") return result;
  if (!result || typeof result !== "object") return JSON.stringify(result);
  const obj = result as { content?: Array<{ type?: string; text?: string }> };
  if (!Array.isArray(obj.content)) return JSON.stringify(result);
  const parts = obj.content
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text as string);
  return parts.join("\n") || JSON.stringify(result);
}

function normalizeAudioMimeType(mimeType?: string | null): string {
  const value = String(mimeType || "").toLowerCase().trim();
  if (!value || value === "application/octet-stream") return "audio/ogg";
  if (value.includes("opus")) return "audio/ogg";
  if (value.includes("ogg")) return "audio/ogg";
  if (value.includes("mpeg") || value.includes("mp3")) return "audio/mpeg";
  if (value.includes("wav")) return "audio/wav";
  if (value.includes("mp4") || value.includes("m4a")) return "audio/mp4";
  if (value.includes("aac")) return "audio/aac";
  if (value.includes("webm")) return "audio/webm";
  if (value.includes("flac")) return "audio/flac";
  return "audio/ogg";
}

function resolveAudioExt(mimeType?: string | null): string {
  const value = String(mimeType || "").toLowerCase();
  if (value.includes("opus")) return ".opus";
  if (value.includes("ogg")) return ".ogg";
  if (value.includes("mpeg") || value.includes("mp3")) return ".mp3";
  if (value.includes("wav")) return ".wav";
  if (value.includes("mp4") || value.includes("m4a")) return ".m4a";
  if (value.includes("aac")) return ".aac";
  if (value.includes("webm")) return ".webm";
  if (value.includes("flac")) return ".flac";
  return ".ogg";
}

function ensureAudioFilename(filename: string, mimeType?: string | null): string {
  const trimmed = filename.trim() || "audio-message";
  const lower = trimmed.toLowerCase();
  if (/\.(flac|mp3|mp4|mpeg|mpga|m4a|ogg|opus|wav|webm|aac)$/.test(lower)) {
    return trimmed;
  }
  return `${trimmed}${resolveAudioExt(mimeType)}`;
}

async function enrichMessageTextWithAudio(
  ctx: MomContext,
  settings: RuntimeSettings,
  audioDecision: { shouldTranscribe: boolean; reason: string; userNotice?: string },
  baseText: string = ctx.message.text
): Promise<{
  text: string;
  transcriptionErrors: string[];
}> {
  const audioAttachments = ctx.message.attachments.filter((item) => item.isAudio);
  if (audioAttachments.length === 0) {
    return { text: baseText, transcriptionErrors: [] };
  }

  if (ctx.message.hasInlineAudioTranscript) {
    return { text: baseText, transcriptionErrors: [] };
  }

  if (!audioDecision.shouldTranscribe) {
    return {
      text: baseText,
      transcriptionErrors: audioDecision.userNotice ? [audioDecision.userNotice] : []
    };
  }

  const transcripts: string[] = [];
  const transcriptionErrors: string[] = [];

  for (const attachment of audioAttachments) {
    const fullPath = join(ctx.workspaceDir, attachment.local);
    let data: Buffer;
    try {
      data = readFileSync(fullPath);
    } catch (error) {
      transcriptionErrors.push(
        `无法读取语音附件 ${attachment.original}: ${error instanceof Error ? error.message : String(error)}`
      );
      continue;
    }

    const mimeType = normalizeAudioMimeType(attachment.mimeType);
    const filename = ensureAudioFilename(attachment.original, mimeType);
    const transcription = await transcribeAudioViaConfiguredProvider({
      channel: ctx.channel,
      settings,
      data,
      filename,
      mimeType,
      maxAttempts: 3,
      retryDelayMs: 800
    });

    if (transcription.text) {
      transcripts.push(transcription.text);
    } else if (transcription.errorMessage) {
      transcriptionErrors.push(transcription.errorMessage);
    }
  }

  let text = baseText;
  if (transcripts.length > 0) {
    const transcriptSection = `[voice transcript]\n${transcripts.join("\n\n")}`;
    text = text.trim()
      ? `${text}\n\n${transcriptSection}`
      : transcriptSection;
  } else if (!text.trim()) {
    text = "(voice message received; transcription unavailable)";
  }

  return { text, transcriptionErrors };
}

async function enrichMessageTextWithImages(
  ctx: MomContext,
  settings: RuntimeSettings,
  imageDecision: { shouldAnalyze: boolean; reason: string; userNotice?: string },
  baseText: string
): Promise<{
  text: string;
  analysisErrors: string[];
}> {
  const imageAttachments = ctx.message.attachments.filter((item) => item.isImage);
  const imageContents = Array.isArray(ctx.message.imageContents) ? ctx.message.imageContents : [];
  if (imageAttachments.length === 0 || imageContents.length === 0) {
    return { text: baseText, analysisErrors: [] };
  }

  if (!imageDecision.shouldAnalyze) {
    return {
      text: baseText,
      analysisErrors: imageDecision.userNotice ? [imageDecision.userNotice] : []
    };
  }

  const analyses: string[] = [];
  const analysisErrors: string[] = [];
  const pairCount = Math.min(imageAttachments.length, imageContents.length);

  for (let index = 0; index < pairCount; index += 1) {
    const attachment = imageAttachments[index];
    const image = imageContents[index];
    const label = attachment?.original?.trim() || `image-${index + 1}`;
    const analysis = await describeImageViaConfiguredProvider({
      channel: ctx.channel,
      settings,
      image,
      label,
      maxAttempts: 3,
      retryDelayMs: 800
    });

    if (analysis.text) {
      analyses.push(`[image analysis #${index + 1}: ${label}]\n${analysis.text}`);
    } else if (analysis.errorMessage) {
      analysisErrors.push(`${label}: ${analysis.errorMessage}`);
    }
  }

  let text = baseText;
  if (analyses.length > 0) {
    const imageSection = analyses.join("\n\n");
    text = text.trim()
      ? `${text}\n\n${imageSection}`
      : imageSection;
  } else if (!text.trim()) {
    text = "(image message received; analysis unavailable)";
  }

  return { text, analysisErrors };
}

function mapUnsupportedDeveloperRole(
  settings: RuntimeSettings,
  context: any,
): any {
  const shouldCheckCustom = resolveModelSelection(settings, "text").source === "custom";
  if (!shouldCheckCustom) return context;
  const roles = getCustomModelRoles(settings);
  if (roles.includes("developer")) return context;

  if (
    !context ||
    typeof context !== "object" ||
    !Array.isArray(context.messages)
  )
    return context;
  const mappedMessages = context.messages.map((msg: any) => {
    if (!msg || typeof msg !== "object") return msg;
    if (msg.role !== "developer") return msg;
    return { ...msg, role: "system" };
  });

  // For some OpenAI-compatible adapters, systemPrompt can be emitted as a "developer" message.
  // Move it into explicit system message to force compatible role shape.
  const prompt =
    typeof context.systemPrompt === "string" ? context.systemPrompt.trim() : "";
  if (!prompt) {
    return { ...context, messages: mappedMessages };
  }

  return {
    ...context,
    systemPrompt: "",
    messages: [{ role: "system", content: prompt }, ...mappedMessages],
  };
}

function extractPlainTextContent(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const text = (part as { text?: unknown }).text;
      return typeof text === "string" ? text.trim() : "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function moveAnthropicSystemMessagesToTopLevel(context: any): any {
  if (
    !context ||
    typeof context !== "object" ||
    !Array.isArray(context.messages)
  )
    return context;

  const systemBlocks: string[] = [];
  const messages: unknown[] = [];
  const existingSystemPrompt =
    typeof context.systemPrompt === "string" ? context.systemPrompt.trim() : "";
  if (existingSystemPrompt) systemBlocks.push(existingSystemPrompt);

  for (const msg of context.messages) {
    if (!msg || typeof msg !== "object") {
      messages.push(msg);
      continue;
    }
    const role = (msg as { role?: unknown }).role;
    if (role !== "system" && role !== "developer") {
      messages.push(msg);
      continue;
    }
    const text = extractPlainTextContent((msg as { content?: unknown }).content);
    if (text) systemBlocks.push(text);
  }

  return {
    ...context,
    systemPrompt: systemBlocks.join("\n\n"),
    messages
  };
}

export class MomRunner implements RunnerLike {
  private readonly agent: Agent;
  private running = false;
  private selectedMcpServerIds = new Set<string>();
  private promptRefreshKey = "";
  private systemPromptReady = false;
  private activeRunnerEventSink: NonNullable<MomContext["onRunnerEvent"]> | undefined;
  private activeRunBudget: RunBudget | undefined;
  private activePayloadContext:
    | {
        provider: string;
        model: string;
        api: string;
        requestedThinkingLevel: RuntimeSettings["defaultThinkingLevel"];
        effectiveThinkingLevel: RuntimeSettings["defaultThinkingLevel"];
      }
    | undefined;

  constructor(
    private readonly channel: string,
    private readonly chatId: string,
    private readonly sessionId: string,
    private readonly store: MomRuntimeStore,
    private readonly getSettings: () => RuntimeSettings,
    private readonly updateSettings: (patch: Partial<RuntimeSettings>) => RuntimeSettings,
    private readonly usageTracker: AiUsageTracker,
    private readonly modelErrorTracker: ModelErrorTracker,
    private readonly memory: MemoryGateway,
  ) {
    const settings = this.getSettings();
    const model = resolveModel(settings, "text");
    const initialPrompt = buildSystemPrompt(
      this.store.getWorkspaceDir(),
      this.chatId,
      this.sessionId,
      "(memory will be loaded via gateway before each run)",
      {
        channel: this.channel as "telegram" | "feishu" | "qq" | "weixin" | "web",
        timezone: settings.timezone,
        settings
      },
    );

    this.agent = new Agent({
      initialState: {
        systemPrompt: initialPrompt,
        model,
        thinkingLevel: resolveThinkingLevel(settings, model.reasoning),
        tools: [],
      },
      sessionId: buildAgentSessionId(this.channel, this.chatId, this.sessionId, "text", resolveModelSelection(settings, "text")),
      transport: resolvePreferredTransport(model),
      maxRetryDelayMs: DEFAULT_AGENT_MAX_RETRY_DELAY_MS,
      toolExecution: getPreferredToolExecutionMode(),
      onPayload: async (payload) => {
        if (this.activeRunnerEventSink && this.activePayloadContext) {
          await this.activeRunnerEventSink({
            type: "payload",
            provider: this.activePayloadContext.provider,
            model: this.activePayloadContext.model,
            api: this.activePayloadContext.api,
            requestedThinkingLevel: this.activePayloadContext.requestedThinkingLevel,
            effectiveThinkingLevel: this.activePayloadContext.effectiveThinkingLevel,
            summary: formatPayloadReasoningSummary(payload)
          });
        }
        return undefined;
      },
      beforeToolCall: async (context) => {
        const blockedReason = validateToolCallPreflight(context, {
          cwd: this.store.getScratchDir(this.chatId),
          workspaceDir: this.store.getWorkspaceDir()
        });
        const budgetResult = this.activeRunBudget?.tryStartTool() ?? { ok: true };
        const finalBlockedReason = blockedReason ?? budgetResult.reason;
        if (!finalBlockedReason) return undefined;
        if (!budgetResult.ok) {
          this.agent.state.tools = [];
        }
        momWarn("runner", "tool_call_blocked", {
          chatId: this.chatId,
          sessionId: this.sessionId,
          tool: context.toolCall.name,
          reason: finalBlockedReason
        });
        return { block: true, reason: finalBlockedReason };
      },
      streamFn: (selectedModel, context, opts) => {
        const settingsNow = this.getSettings();
        const rolePatchedContext = selectedModel.api === "anthropic-messages"
          ? moveAnthropicSystemMessagesToTopLevel(context)
          : mapUnsupportedDeveloperRole(
              settingsNow,
              context,
            );
        const contextWithoutOrphanTools = removeOrphanToolResultsFromContext(
          rolePatchedContext,
        );
        const patchedContext = stripImagePartsForTextOnlyModel(
          selectedModel as Model<any>,
          contextWithoutOrphanTools,
        );
        momLog("runner", "llm_stream_start", {
          chatId: this.chatId,
          provider: selectedModel.provider,
          api: selectedModel.api,
          modelId: selectedModel.id,
          baseUrl: redactBaseUrl(selectedModel.baseUrl),
          messageCount: patchedContext.messages.length,
          hasSystemPrompt: Boolean(patchedContext.systemPrompt),
          hasTools:
            Array.isArray(patchedContext.tools) &&
            patchedContext.tools.length > 0,
        });
        momLog("runner", "llm_request_sent", {
          chatId: this.chatId,
          modelId: selectedModel.id,
          provider: selectedModel.provider
        });
        return streamSimple(
          selectedModel as any,
          patchedContext as any,
          opts as any,
        );
      },
      getApiKey: async (provider: string) => {
        const settingsNow = this.getSettings();
        const selectedCustom = settingsNow.customProviders.find((p) => p.id === provider);
        const key = await resolveProviderApiKey(provider, () => selectedCustom?.apiKey?.trim() || undefined);
        momLog("runner", "api_key_resolve", {
          chatId: this.chatId,
          provider,
          providerMode: settingsNow.providerMode,
          hasKey: Boolean(key),
          keyFingerprint: keyFingerprint(key),
          customProviderId: selectedCustom?.id
        });
        return key;
      },
    });

    const saved = this.store.loadContext(this.chatId, this.sessionId);
    if (saved.length > 0) {
      this.agent.state.messages = saved;
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  abort(): void {
    this.agent.clearAllQueues();
    momLog("runner", "abort_requested", {
      chatId: this.chatId,
      sessionId: this.sessionId
    });
    this.agent.abort();
  }

  steer(text: string): boolean {
    return this.enqueueLiveMessage("steer", text);
  }

  followUp(text: string): boolean {
    return this.enqueueLiveMessage("follow_up", text);
  }

  private enqueueLiveMessage(mode: "steer" | "follow_up", text: string): boolean {
    const normalized = text.trim();
    if (!normalized || !this.running) return false;

    const message: AgentMessage = {
      role: "user",
      content: [{ type: "text", text: normalized }],
      timestamp: Date.now()
    };

    if (mode === "steer") {
      this.agent.steer(message);
    } else {
      this.agent.followUp(message);
    }

    momLog("runner", "live_message_queued", {
      chatId: this.chatId,
      sessionId: this.sessionId,
      mode,
      textLength: normalized.length
    });
    return true;
  }

  async compact(options?: {
    reason?: "threshold" | "manual";
    customInstructions?: string;
    notify?: (text: string) => Promise<void>;
    signal?: AbortSignal;
  }): Promise<{
    changed: boolean;
    summary: string;
    beforeTokens: number;
    afterTokens: number;
    summarizedMessages: number;
    keptMessages: number;
  }> {
    const settings = this.getSettings();
    const selection = resolveModelSelection(settings, "text");
    const apiKey = await resolveApiKeyForModel(selection.model, settings);
    if (!apiKey) {
      throw new Error(`Missing API key for compaction model provider '${selection.model.provider}'.`);
    }

    const currentMessages = [...(this.agent.state.messages as AgentMessage[])];
    const contextWindow = selection.model.contextWindow || 200000;
    if (
      options?.reason !== "manual" &&
      !shouldCompactContext(currentMessages, contextWindow, settings.compaction)
    ) {
      return {
        changed: false,
        summary: "",
        beforeTokens: 0,
        afterTokens: 0,
        summarizedMessages: 0,
        keptMessages: currentMessages.length
      };
    }

    const result = await compactContextMessages({
      messages: currentMessages,
      model: selection.model,
      apiKey,
      settings: settings.compaction,
      reason: options?.reason ?? "manual",
      customInstructions: options?.customInstructions,
      signal: options?.signal
    });
    if (!result.changed) {
      return {
        changed: false,
        summary: "",
        beforeTokens: result.beforeTokens,
        afterTokens: result.afterTokens,
        summarizedMessages: 0,
        keptMessages: result.keptMessages
      };
    }

    this.agent.state.messages = result.messages;
    this.store.appendCompaction(
      this.chatId,
      result.summary,
      result.messages.slice(1),
      result.beforeTokens,
      result.afterTokens,
      result.summarizedMessages,
      result.reason,
      this.sessionId
    );
    momLog("runner", "context_compacted", {
      chatId: this.chatId,
      sessionId: this.sessionId,
      reason: result.reason,
      beforeTokens: result.beforeTokens,
      afterTokens: result.afterTokens,
      summarizedMessages: result.summarizedMessages,
      keptMessages: result.keptMessages
    });
    if (options?.notify) {
      await options.notify(
        [
          `Context compacted (${result.reason}).`,
          `before≈${result.beforeTokens} tokens`,
          `after≈${result.afterTokens} tokens`,
          `summarized_messages=${result.summarizedMessages}`,
          `kept_messages=${result.keptMessages}`
        ].join("\n")
      );
    }

    return {
      changed: true,
      summary: result.summary,
      beforeTokens: result.beforeTokens,
      afterTokens: result.afterTokens,
      summarizedMessages: result.summarizedMessages,
      keptMessages: result.keptMessages
    };
  }

  async run(ctx: MomContext): Promise<RunResult> {
    const runId =
      (ctx.message as { runId?: string }).runId ??
      `${this.chatId}-${this.sessionId}-${ctx.message.messageId}`;
    const runStartedAt = Date.now();
    const budget = new RunBudget(DEFAULT_RUN_BUDGET);
    const usedToolNames: string[] = [];
    const failedToolNames: string[] = [];
    let subagentDelegationNoticeSent = false;
    const botId = basename(this.store.getWorkspaceDir()) || "unknown";
    this.running = true;
    this.activeRunnerEventSink = ctx.onRunnerEvent;
    this.activePayloadContext = undefined;
    momLog("runner", "run_start", {
      runId,
      chatId: this.chatId,
      sessionId: this.sessionId,
      messageId: ctx.message.messageId,
      textLength: ctx.message.text.length,
      attachments: ctx.message.attachments.length,
      images: ctx.message.imageContents.length,
      isEvent: Boolean(ctx.message.isEvent),
    });

    const queue: Array<() => Promise<void>> = [];
    let queueRunning = false;
    const enqueue = (job: () => Promise<void>): void => {
      queue.push(job);
      if (!queueRunning) {
        void runQueue();
      }
    };

    const runQueue = async (): Promise<void> => {
      queueRunning = true;
      while (queue.length > 0) {
        const job = queue.shift();
        if (!job) continue;
        try {
          await job();
        } catch {
          // ignore UI update errors
        }
      }
      queueRunning = false;
    };

    const settings = this.getSettings();
    const settingsError = validateRuntimeSettings(settings);
    if (settingsError) {
      momWarn("runner", "settings_error", {
        runId,
        chatId: this.chatId,
        settingsError,
      });
      await ctx.setTyping(true);
      await ctx.setWorking(false);
      await ctx.replaceMessage(settingsError);
      return { stopReason: "error", errorMessage: settingsError };
    }

    const audioDecision = decideAudioRouting(
      settings,
      ctx.message.attachments.some((item) => item.isAudio)
    );
    momLog("runner", "audio_route_decision", {
      runId,
      chatId: this.chatId,
      sessionId: this.sessionId,
      mode: audioDecision.mode,
      reason: audioDecision.reason,
      audioRouteKey: currentModelKey(settings, "stt"),
      hasAudioInput: ctx.message.attachments.some((item) => item.isAudio),
    });

    const audioEnrichedInput = await enrichMessageTextWithAudio(ctx, settings, audioDecision);
    momLog("runner", "voice_transcription_success", {
      runId,
      chatId: this.chatId,
      sessionId: this.sessionId,
      transcriptionErrors: audioEnrichedInput.transcriptionErrors.length,
      hasTranscripts: audioEnrichedInput.text !== ctx.message.text
    });
    if (audioEnrichedInput.transcriptionErrors.length > 0) {
      await ctx.respondInThread(
        [
          "语音识别失败，已降级为未转写消息。",
          ...audioEnrichedInput.transcriptionErrors,
          "建议：检查 STT provider 的 baseUrl/path/model 是否正确。"
        ].join("\n")
      );
    }

    const visionDecision = decideVisionRouting(
      settings,
      Array.isArray(ctx.message.imageContents) && ctx.message.imageContents.length > 0
    );
    const imageDecision = decideImageFallbackRouting(
      settings,
      Array.isArray(ctx.message.imageContents) && ctx.message.imageContents.length > 0,
      visionDecision
    );
    momLog("runner", "image_fallback_decision", {
      runId,
      chatId: this.chatId,
      sessionId: this.sessionId,
      mode: imageDecision.mode,
      reason: imageDecision.reason,
      visionRouteKey: currentModelKey(settings, "vision"),
      hasImages: Array.isArray(ctx.message.imageContents) && ctx.message.imageContents.length > 0,
    });
    const enrichedInput = await enrichMessageTextWithImages(
      ctx,
      settings,
      imageDecision,
      audioEnrichedInput.text
    );
    momLog("runner", "image_analysis_success", {
      runId,
      chatId: this.chatId,
      sessionId: this.sessionId,
      analysisErrors: enrichedInput.analysisErrors.length,
      hasAnalyses: enrichedInput.text !== audioEnrichedInput.text
    });
    if (enrichedInput.analysisErrors.length > 0) {
      await ctx.respondInThread(
        [
          "图片识别不可用，已降级为仅保留图片附件占位信息。",
          ...enrichedInput.analysisErrors,
          "建议：检查 vision provider 的 baseUrl/path/model，以及模型是否声明 `vision` 能力。"
        ].join("\n")
      );
    }

    const modelUseCase: "text" | "vision" = visionDecision.sendImagesNatively ? "vision" : "text";
    const modelCandidates = buildModelFallbackSelections(settings, visionDecision.selection, modelUseCase);
    let activeSelection = modelCandidates[0] ?? visionDecision.selection;
    await this.memory.syncExternalMemories();
    const memorySnapshot = await this.memory.createPromptSnapshot(
      { channel: this.channel, externalUserId: this.chatId },
      enrichedInput.text,
      12
    );
    const nextPromptKey = buildPromptRefreshKey(settings, this.channel, this.store.getWorkspaceDir());
    const runPromptKey = JSON.stringify({
      base: nextPromptKey,
      memory: memorySnapshot.fingerprint,
      query: memorySnapshot.query
    });
    if (!this.systemPromptReady || this.promptRefreshKey !== runPromptKey) {
      const memoryText = memorySnapshot.promptText || "(no working memory yet)";
      this.agent.state.systemPrompt = buildSystemPrompt(
        this.store.getWorkspaceDir(),
        this.chatId,
        this.sessionId,
        memoryText,
        {
          channel: this.channel as "telegram" | "feishu" | "qq" | "weixin" | "web",
          timezone: settings.timezone,
          settings
        },
      );
      this.promptRefreshKey = runPromptKey;
      this.systemPromptReady = true;
      momLog("runner", "system_prompt_refreshed", {
        runId,
        chatId: this.chatId,
        sessionId: this.sessionId
      });
    } else {
      momLog("runner", "system_prompt_reused", {
        runId,
        chatId: this.chatId,
        sessionId: this.sessionId
      });
    }

    const { skills } = loadSkillsFromWorkspace(this.store.getWorkspaceDir(), this.chatId, {
      disabledSkillPaths: settings.disabledSkillPaths
    });
    const explicitlyInvokedSkills = findExplicitlyInvokedSkills(skills, enrichedInput.text);
    const skillExplicitlyInvoked = explicitlyInvokedSkills.length > 0;
    const mcpExplicitlyInvoked = hasExplicitMcpInvocation(enrichedInput.text);
    const skillRequiresMcp = explicitlyInvokedSkills.some((skill) => skill.mcpServers.length > 0);
    const effectiveInputText = injectExplicitSkillFileContext(
      injectExplicitSkillInvocationContext(enrichedInput.text, explicitlyInvokedSkills),
      explicitlyInvokedSkills
    );
    const resolveScopedMcpServers = (): RuntimeSettings["mcpServers"] => {
      const settingsNow = this.getSettings();
      const selectedIds = this.selectedMcpServerIds;
      if (selectedIds.size > 0) {
        return (settingsNow.mcpServers ?? []).filter((server) =>
          server.enabled && selectedIds.has(server.id)
        );
      }
      return [];
    };

    let localTools: ReturnType<typeof createMomTools> = [];
    let loadedMcpTools: Awaited<ReturnType<typeof getMcpToolsForRuntime>> = [];
    const refreshLoadedMcpTools = async (): Promise<{ serverCount: number; toolCount: number }> => {
      const scoped = resolveScopedMcpServers();
      const mcpTools = await getMcpToolsForRuntime(scoped, {
        workspaceDir: this.store.getWorkspaceDir(),
        onWarn: (event, extra) => {
          momWarn("runner", event, {
            runId,
            chatId: this.chatId,
            sessionId: this.sessionId,
            ...extra
          });
        }
      });
      loadedMcpTools = mcpTools;
      this.agent.state.tools = [...localTools, ...mcpTools];
      return {
        serverCount: scoped.length,
        toolCount: mcpTools.length
      };
    };

    const exposeLoadMcpTool =
      mcpExplicitlyInvoked || skillRequiresMcp || this.selectedMcpServerIds.size > 0;
    localTools = createMomTools({
      channel: ctx.channel,
      cwd: this.store.getScratchDir(this.chatId),
      workspaceDir: this.store.getWorkspaceDir(),
      chatId: this.chatId,
      timezone: settings.timezone,
      memory: this.memory,
      getSettings: this.getSettings,
      updateSettings: this.updateSettings,
      getSelectedMcpServerIds: () => new Set(this.selectedMcpServerIds),
      setSelectedMcpServerIds: (next) => {
        this.selectedMcpServerIds = new Set(next);
      },
      refreshLoadedMcpTools,
      onLocalToolsChanged: (nextTools) => {
        localTools = nextTools;
        this.agent.state.tools = [...localTools, ...loadedMcpTools];
      },
      exposeLoadMcpTool,
      uploadFile: async (filePath, title, text) => {
        await ctx.uploadFile(filePath, title, text);
      },
    });
    const scopedMcpServers = resolveScopedMcpServers();

    const mcpTools = await getMcpToolsForRuntime(scopedMcpServers, {
      workspaceDir: this.store.getWorkspaceDir(),
      onWarn: (event, extra) => {
        momWarn("runner", event, {
          runId,
          chatId: this.chatId,
          sessionId: this.sessionId,
          ...extra
        });
      }
    });
    loadedMcpTools = mcpTools;
    momLog("runner", "mcp_tools_loaded", {
      runId,
      chatId: this.chatId,
      sessionId: this.sessionId,
      skillExplicitlyInvoked,
      mcpExplicitlyInvoked,
      skillRequiresMcp,
      exposeLoadMcpTool,
      mcpServerCount: scopedMcpServers.filter((server) => server.enabled).length,
      mcpToolCount: mcpTools.length
    });
    this.agent.state.tools = [...localTools, ...mcpTools];

    let stopReason: "stop" | "aborted" | "error" = "stop";
    let errorMessage: string | undefined;
    let finalUsage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0
    };
    let assistantTextStreamed = false;
    let streamedAssistantText = "";
    let firstAssistantTokenLogged = false;
    let promptStartedAt = 0;

    const unsubscribe = this.agent.subscribe((event: AgentEvent) => {
      if (
        event.type === "message_start" &&
        (event.message as { role?: string }).role === "assistant"
      ) {
        const next = applyAssistantStreamEvent(
          { assistantTextStreamed, streamedAssistantText },
          { type: "message_start", role: (event.message as { role?: string }).role }
        );
        assistantTextStreamed = next.assistantTextStreamed;
        streamedAssistantText = next.streamedAssistantText;
      }

      if (event.type === "message_update") {
        const assistantEvent = event.assistantMessageEvent;
        if (assistantEvent.type === "text_delta" && assistantEvent.delta) {
          const next = applyAssistantStreamEvent(
            { assistantTextStreamed, streamedAssistantText },
            { type: "text_delta", delta: assistantEvent.delta }
          );
          assistantTextStreamed = next.assistantTextStreamed;
          streamedAssistantText = next.streamedAssistantText;
          if (!firstAssistantTokenLogged) {
            firstAssistantTokenLogged = true;
            momLog("runner", "llm_first_token", {
              runId,
              chatId: this.chatId,
              modelId: activeSelection.model.id,
              latency: promptStartedAt > 0 ? Date.now() - promptStartedAt : undefined
            });
          }
        }
        if (ctx.onRunnerEvent) {
          enqueue(() => ctx.onRunnerEvent!({
            type: "assistant_message_event",
            event: assistantEvent
          }));
        }
      }

      if (event.type === "tool_execution_start") {
        const args = event.args as { label?: string };
        const label = args.label || event.toolName;
        usedToolNames.push(event.toolName);
        momLog("runner", "tool_start", {
          runId,
          chatId: this.chatId,
          tool: event.toolName,
          label,
        });
        if (ctx.onRunnerEvent) {
          enqueue(() => ctx.onRunnerEvent!({
            type: "tool_execution_start",
            toolName: event.toolName,
            label
          }));
        }
        enqueue(() => ctx.respond(`_→ ${label}_`, false));
      }

      if (event.type === "tool_execution_end") {
        const body = extractTextFromResult(event.result);
        const status = event.isError ? "✗" : "✓";
        const budgetResult = budget.recordToolResult(event.isError);
        if (event.isError) {
          failedToolNames.push(event.toolName);
        }
        momLog("runner", "tool_end", {
          runId,
          chatId: this.chatId,
          tool: event.toolName,
          isError: event.isError,
          resultPreview: body.slice(0, 160),
        });
        if (ctx.onRunnerEvent) {
          enqueue(() => ctx.onRunnerEvent!({
            type: "tool_execution_end",
            toolName: event.toolName,
            isError: event.isError,
            summary: body
          }));
        }
        const text = `*${status} ${event.toolName}*\n\`\`\`\n${body}\n\`\`\``;
        if (event.isError) {
          enqueue(() => ctx.respondInThread(text));
          enqueue(() => ctx.respond(`_Error: ${body.slice(0, 200)}_`, false));
        }
        if (!budgetResult.ok) {
          enqueue(() => ctx.respondInThread(budgetResult.reason ?? "Run budget exceeded."));
          this.agent.abort();
        } else {
          const currentBudget = budget.snapshot();
          const shouldRecommendSubagent =
            !subagentDelegationNoticeSent &&
            currentBudget.toolCalls >= SUBAGENT_DELEGATION_NOTICE_TOOL_CALLS &&
            !usedToolNames.includes("subagent") &&
            this.agent.state.tools.some((tool) => tool.name === "subagent");
          if (shouldRecommendSubagent) {
            subagentDelegationNoticeSent = true;
            this.agent.followUp({
              role: "user",
              content: [{ type: "text", text: SUBAGENT_DELEGATION_RUNTIME_NOTICE }],
              timestamp: Date.now()
            });
            momWarn("runner", "subagent_delegation_notice", {
              runId,
              chatId: this.chatId,
              sessionId: this.sessionId,
              toolCalls: currentBudget.toolCalls,
              maxToolCalls: budget.limitsSnapshot().maxToolCalls
            });
          }
        }
      }

      if (
        event.type === "message_end" &&
        (event.message as { role?: string }).role === "assistant"
      ) {
        const msg = event.message as {
          stopReason?: "stop" | "aborted" | "error";
          errorMessage?: string;
          content?: Array<{ type: string; text?: string }>;
          api?: string;
          provider?: string;
          model?: string;
          usage?: {
            input?: number;
            output?: number;
            cacheRead?: number;
            cacheWrite?: number;
            totalTokens?: number;
          };
        };
        if (msg.stopReason) stopReason = msg.stopReason;
        if (msg.errorMessage) errorMessage = msg.errorMessage;
        if (msg.errorMessage) {
          momWarn("runner", "assistant_error_message", {
            runId,
            chatId: this.chatId,
            errorMessage: msg.errorMessage,
          });
        }
        momLog("runner", "assistant_message_end", {
          runId,
          chatId: this.chatId,
          stopReason: msg.stopReason,
          api: msg.api,
          provider: msg.provider,
          model: msg.model,
          contentCount: Array.isArray(msg.content) ? msg.content.length : 0,
          usage: msg.usage,
        });
        if (msg.usage) {
          finalUsage = {
            inputTokens: Number(msg.usage.input ?? 0),
            outputTokens: Number(msg.usage.output ?? 0),
            cacheReadTokens: Number(msg.usage.cacheRead ?? 0),
            cacheWriteTokens: Number(msg.usage.cacheWrite ?? 0),
            totalTokens: Number(msg.usage.totalTokens ?? 0)
          };
          this.usageTracker.record({
            channel: this.channel,
            botId,
            provider: msg.provider ?? activeSelection.model.provider,
            model: msg.model ?? activeSelection.model.id,
            api: msg.api ?? activeSelection.model.api,
            inputTokens: msg.usage.input,
            outputTokens: msg.usage.output,
            cacheReadTokens: msg.usage.cacheRead,
            cacheWriteTokens: msg.usage.cacheWrite,
            totalTokens: msg.usage.totalTokens
          });
        }

        const text = (msg.content || [])
          .filter(
            (part) => part.type === "text" && typeof part.text === "string",
          )
          .map((part) => part.text as string)
          .join("\n");

        if (text.trim() && !assistantTextStreamed) {
          momLog("runner", "assistant_text_chunk", {
            runId,
            chatId: this.chatId,
            textLength: text.length,
          });
          enqueue(() => ctx.respond(text));
        }
      }
    });

    const MAX_EMPTY_RETRIES = 2;
    const modelFailures: ModelAttemptFailure[] = [];
    let savedSkillDraft:
      | {
          filePath: string;
          fileName: string;
          name: string;
          content: string;
        }
      | undefined;

    try {
      this.activeRunBudget = budget;
      this.agent.state.messages = stripTransientRuntimeNoticesFromMessages(
        this.agent.state.messages as AgentMessage[]
      );
      await ctx.setTyping(true);
      await ctx.setWorking(true);

      const nonImage = ctx.message.attachments
        .filter((a) => !a.isImage || !visionDecision.sendImagesNatively)
        .map((a) => `${ctx.workspaceDir}/${a.local}`);
      const promptInput = buildPromptInputEnvelope({
        messageText: effectiveInputText,
        attachmentPaths: nonImage,
        messageTimestamp: ctx.message.ts,
        timezone: settings.timezone
      });
      const userMessage = promptInput.modelMessage;

      let finalText = "";
      let finalAttemptCount = 0;
      let successfulCandidateIndex = -1;
      const pendingModelErrorEvents: Array<{
        selection: ResolvedModelSelection;
        failure: ModelAttemptFailure;
        candidateIndex: number;
      }> = [];

      for (let candidateIndex = 0; candidateIndex < modelCandidates.length; candidateIndex += 1) {
        const budgetAttempt = budget.tryRecordModelAttempt();
        if (!budgetAttempt.ok) {
          stopReason = "error";
          errorMessage = budgetAttempt.reason;
          break;
        }
        const selection = modelCandidates[candidateIndex];
        activeSelection = selection;
        stopReason = "stop";
        errorMessage = undefined;

        const selectedModel = selection.model;
        const selectedCustom = settings.customProviders.find((p) => p.id === selectedModel.provider);
        const resolvedKey = await resolveApiKeyForModel(selectedModel, settings);
        if (!resolvedKey) {
          const keyError =
            `AI settings error: missing API key for active model provider '${selectedModel.provider}'. ` +
            "Please check current model routing and provider key configuration.";
          const failure = toModelAttemptFailure(selection, keyError, "missing_api_key");
          modelFailures.push(failure);
          pendingModelErrorEvents.push({ selection, failure, candidateIndex });
          momWarn("runner", "active_model_missing_api_key", {
            runId,
            chatId: this.chatId,
            providerMode: settings.providerMode,
            modelProvider: selectedModel.provider,
            modelId: selectedModel.id
          });
          if (candidateIndex === modelCandidates.length - 1) {
            for (const item of pendingModelErrorEvents) {
              recordModelFailure(this.modelErrorTracker, {
                channel: this.channel,
                botId,
                chatId: this.chatId,
                sessionId: this.sessionId,
                runId,
                route: "text",
                selection: item.selection,
                failure: item.failure,
                candidateIndex: item.candidateIndex,
                recovered: false,
                fallbackUsed: false
              });
            }
            await ctx.setWorking(false);
            await ctx.replaceMessage(keyError);
            return { stopReason: "error", errorMessage: keyError };
          }
          continue;
        }

        this.agent.state.model = selectedModel;
        const requestedThinkingLevel = ctx.thinkingLevelOverride ?? settings.defaultThinkingLevel;
        const effectiveThinkingLevel = resolveThinkingLevel(
          { defaultThinkingLevel: requestedThinkingLevel },
          selectedModel.reasoning
        );
        this.agent.state.thinkingLevel = effectiveThinkingLevel;
        this.activePayloadContext = {
          provider: selectedModel.provider,
          model: selectedModel.id,
          api: selectedModel.api,
          requestedThinkingLevel,
          effectiveThinkingLevel
        };
        if (ctx.onRunnerEvent) {
          await ctx.onRunnerEvent({
            type: "thinking_config",
            requestedThinkingLevel,
            effectiveThinkingLevel,
            provider: selectedModel.provider,
            model: selectedModel.id,
            reasoningSupported: selectedModel.reasoning
          });
        }
        this.agent.sessionId = buildAgentSessionId(
          this.channel,
          this.chatId,
          this.sessionId,
          modelUseCase,
          selection
        );
        this.agent.transport = resolvePreferredTransport(selectedModel);
        if (candidateIndex === 0) {
          try {
            await this.compact({
              reason: "threshold",
              notify: async (text) => {
                await ctx.respondInThread(text);
              }
            });
          } catch (error) {
            momWarn("runner", "context_compaction_failed", {
              runId,
              chatId: this.chatId,
              provider: selectedModel.provider,
              model: selectedModel.id,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }
        momLog("runner", "model_selected", {
          runId,
          chatId: this.chatId,
          sessionId: this.sessionId,
          providerMode: settings.providerMode,
          modelProvider: selectedModel.provider,
          modelId: selectedModel.id,
          modelApi: selectedModel.api,
          modelBaseUrl: redactBaseUrl(selectedModel.baseUrl),
          customProviderId: selectedCustom?.id,
          customProviderName: selectedCustom?.name,
          customProviderPath: selectedCustom?.path,
          customProviderProtocol: selectedCustom?.protocol ?? "openai-compatible",
          customProviderComputedBaseUrl: selectedCustom
            ? redactBaseUrl(
              resolveCustomProviderProtocol(selectedCustom.protocol) === "anthropic"
                ? buildAnthropicBaseUrl(selectedCustom.baseUrl, selectedCustom.path)
                : buildOpenAIBaseUrl(selectedCustom.baseUrl, selectedCustom.path),
            )
            : undefined,
          visionRoutingMode: visionDecision.mode,
          visionRoutingReason: visionDecision.reason,
          nativeVisionEnabled: visionDecision.sendImagesNatively,
          visionRouteKey: currentModelKey(settings, "vision"),
          audioRoutingMode: audioDecision.mode,
          audioRoutingReason: audioDecision.reason,
          sttRouteKey: currentModelKey(settings, "stt"),
          modelFallbackMode: settings.modelFallback?.mode ?? "same-provider",
          hasApiKey: Boolean(resolvedKey),
          apiKeyFingerprint: keyFingerprint(resolvedKey),
          candidateIndex,
          candidateCount: modelCandidates.length
        });

        const beforeAttempt = [...(this.agent.state.messages as AgentMessage[])];
        let attemptCount = 0;
        let candidateFinalText = "";
        let overflowRetryUsed = false;
        let toolBudgetContinuationUsed = false;

        let candidateHadAttemptError = false;
        try {
          while (attemptCount <= MAX_EMPTY_RETRIES) {
            if (attemptCount > 0) {
              momWarn("runner", "empty_response_retry", {
                runId,
                chatId: this.chatId,
                attempt: attemptCount,
                provider: selectedModel.provider,
                model: selectedModel.id
              });
              await new Promise((resolve) => setTimeout(resolve, 1000));
            }

            momLog("runner", "prompt_start", {
              runId,
              chatId: this.chatId,
              promptLength: userMessage.length,
              imageCount: visionDecision.sendImagesNatively ? ctx.message.imageContents.length : 0,
              rawImageCount: ctx.message.imageContents.length,
              visionRoutingMode: visionDecision.mode,
              attempt: attemptCount,
              provider: selectedModel.provider,
              model: selectedModel.id
            });
            promptStartedAt = Date.now();
            firstAssistantTokenLogged = false;
            stopReason = "stop";
            errorMessage = undefined;
            await this.agent.prompt(
              userMessage,
              visionDecision.sendImagesNatively && ctx.message.imageContents.length > 0
                ? ctx.message.imageContents
                : undefined,
            );
            momLog("runner", "prompt_end", {
              runId,
              chatId: this.chatId,
              stopReason,
              attempt: attemptCount,
              provider: selectedModel.provider,
              model: selectedModel.id
            });

            while (queueRunning || queue.length > 0) {
              await new Promise((resolve) => setTimeout(resolve, 25));
            }
            momLog("runner", "queue_flushed", {
              runId,
              chatId: this.chatId,
              attempt: attemptCount,
              provider: selectedModel.provider,
              model: selectedModel.id
            });

            const messages = this.agent.state.messages as AgentMessage[];
            const lastAssistant = [...messages]
              .reverse()
              .find((item) => (item as { role?: string }).role === "assistant") as
              | { content?: Array<{ type: string; text?: string }> }
              | undefined;

            candidateFinalText = (lastAssistant?.content || [])
              .filter((part) => part.type === "text" && typeof part.text === "string")
              .map((part) => part.text as string)
              .join("\n")
              .trim();
            const lastAssistantContentCount = Array.isArray(lastAssistant?.content)
              ? lastAssistant.content.length
              : 0;
            momLog("runner", "final_text_evaluated", {
              runId,
              chatId: this.chatId,
              finalTextLength: candidateFinalText.length,
              lastAssistantContentCount,
              attempt: attemptCount,
              provider: selectedModel.provider,
              model: selectedModel.id
            });

            if (
              !toolBudgetContinuationUsed &&
              budget.getExceededReason()?.includes("too many tool calls")
            ) {
              const continuationBudget = budget.tryRecordModelAttempt();
              if (!continuationBudget.ok) {
                stopReason = "error";
                errorMessage = continuationBudget.reason;
              } else {
                toolBudgetContinuationUsed = true;
                const toolBudgetNotice = budget.getExceededReason() ?? "Run budget exceeded: too many tool calls.";
                this.store.appendRuntimeEvent(this.chatId, {
                  code: TOOL_BUDGET_EXHAUSTED_CODE,
                  level: "warn",
                  summary: "Run hit the tool-call budget and switched to one no-tool continuation attempt.",
                  details: {
                    reason: toolBudgetNotice,
                    budget: budget.snapshot(),
                    limits: budget.limitsSnapshot(),
                    candidateIndex,
                    attempt: attemptCount
                  }
                }, this.sessionId);
                const partialBeforeContinuation = candidateFinalText || streamedAssistantText.trim();
                if (ctx.beginContinuationResponse) {
                  await ctx.beginContinuationResponse(partialBeforeContinuation, toolBudgetNotice);
                } else {
                  await ctx.respondInThread(toolBudgetNotice);
                }
                streamedAssistantText = "";
                assistantTextStreamed = false;
                candidateFinalText = "";
                const previousTools = this.agent.state.tools;
                this.agent.state.tools = [];
                await ctx.respondInThread(
                  "工具调用已达到本轮上限，正在自动发起一次无工具续写，尽量保留已有结果并给出当前最佳答案。"
                );
                momWarn("runner", "tool_budget_continuation_prompt", {
                  runId,
                  chatId: this.chatId,
                  provider: selectedModel.provider,
                  model: selectedModel.id,
                  candidateIndex,
                  attempt: attemptCount,
                  reason: budget.getExceededReason()
                });
                promptStartedAt = Date.now();
                firstAssistantTokenLogged = false;
                stopReason = "stop";
                errorMessage = undefined;
                try {
                  await this.agent.prompt(TOOL_BUDGET_RUNTIME_NOTICE);
                } finally {
                  this.agent.state.tools = previousTools;
                }
                this.agent.state.messages = stripTransientRuntimeNoticesFromMessages(
                  this.agent.state.messages as AgentMessage[]
                );
                while (queueRunning || queue.length > 0) {
                  await new Promise((resolve) => setTimeout(resolve, 25));
                }
                const continuationMessages = this.agent.state.messages as AgentMessage[];
                const continuationAssistant = [...continuationMessages]
                  .reverse()
                  .find((item) => (item as { role?: string }).role === "assistant") as
                  | { content?: Array<{ type: string; text?: string }> }
                  | undefined;
                candidateFinalText = (continuationAssistant?.content || [])
                  .filter((part) => part.type === "text" && typeof part.text === "string")
                  .map((part) => part.text as string)
                  .join("\n")
                  .trim();
                if (!candidateFinalText && streamedAssistantText.trim()) {
                  candidateFinalText = streamedAssistantText.trim();
                }
                const manualContinueNotice =
                  "自动续写最多执行一次；如果这条回复仍然不完整或再次触发上限，请手动发送“继续”，我会基于当前上下文接着处理。";
                candidateFinalText = candidateFinalText
                  ? `${candidateFinalText}\n\n${manualContinueNotice}`
                  : manualContinueNotice;
                momLog("runner", "tool_budget_continuation_evaluated", {
                  runId,
                  chatId: this.chatId,
                  finalTextLength: candidateFinalText.length,
                  provider: selectedModel.provider,
                  model: selectedModel.id
                });
              }
            }

            const decision = resolvePromptAttemptDecision({
              stopReason,
              errorMessage,
              finalText: candidateFinalText,
              attemptCount,
              maxEmptyRetries: MAX_EMPTY_RETRIES
            });
            if (decision.kind === "retryable_error" || decision.kind === "terminal_error") {
              candidateHadAttemptError = true;
              const failure = toModelAttemptFailure(selection, decision.message, "request_error");
              modelFailures.push(failure);
              pendingModelErrorEvents.push({ selection, failure, candidateIndex });
              momWarn("runner", "model_attempt_retryable_error", {
                runId,
                chatId: this.chatId,
                provider: selectedModel.provider,
                model: selectedModel.id,
                candidateIndex,
                attempt: attemptCount,
                error: decision.message
              });
              this.agent.state.messages = beforeAttempt;
              if (decision.kind === "retryable_error") {
                attemptCount += 1;
                continue;
              }
              attemptCount += 1;
              break;
            }

            if (candidateFinalText) {
              const sessionContextFile = this.store.getSessionEntriesPath(this.chatId, this.sessionId);
              const finalMessages = rewritePromptUserMessage(
                this.agent.state.messages as AgentMessage[],
                beforeAttempt.length,
                promptInput.persistedMessage
              );
              this.agent.state.messages = finalMessages;
              this.store.saveContext(this.chatId, finalMessages, this.sessionId);
              momLog("runner", "context_saved", {
                runId,
                chatId: this.chatId,
                sessionId: this.sessionId,
                sessionContextFile,
                messageCount: finalMessages.length,
              });
              break;
            }
            this.agent.state.messages = beforeAttempt;
            attemptCount += 1;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!overflowRetryUsed && isContextOverflowError(message)) {
            overflowRetryUsed = true;
            momWarn("runner", "context_overflow_detected", {
              runId,
              chatId: this.chatId,
              provider: selectedModel.provider,
              model: selectedModel.id,
              candidateIndex,
              error: message
            });
            this.agent.state.messages = beforeAttempt;
            try {
              const compacted = await this.compact({
                reason: "threshold",
                notify: async (text) => {
                  await ctx.respondInThread(text);
                }
              });
              if (compacted.changed) {
                momLog("runner", "context_overflow_retrying_after_compact", {
                  runId,
                  chatId: this.chatId,
                  provider: selectedModel.provider,
                  model: selectedModel.id,
                  candidateIndex,
                  beforeTokens: compacted.beforeTokens,
                  afterTokens: compacted.afterTokens
                });
                continue;
              }
            } catch (compactError) {
              momWarn("runner", "context_overflow_compaction_failed", {
                runId,
                chatId: this.chatId,
                provider: selectedModel.provider,
                model: selectedModel.id,
                candidateIndex,
                error: compactError instanceof Error ? compactError.message : String(compactError)
              });
            }
          }
          const failure = toModelAttemptFailure(selection, message, "request_error");
          modelFailures.push(failure);
          pendingModelErrorEvents.push({ selection, failure, candidateIndex });
          momWarn("runner", "model_attempt_failed", {
            runId,
            chatId: this.chatId,
            provider: selectedModel.provider,
            model: selectedModel.id,
            candidateIndex,
            error: message
          });
          this.agent.state.messages = beforeAttempt;
          if (candidateIndex < modelCandidates.length - 1 && isRetryableModelError(message)) {
            continue;
          }
          for (const item of pendingModelErrorEvents) {
            recordModelFailure(this.modelErrorTracker, {
              channel: this.channel,
              botId,
              chatId: this.chatId,
              sessionId: this.sessionId,
              runId,
              route: "text",
              selection: item.selection,
              failure: item.failure,
              candidateIndex: item.candidateIndex,
              recovered: false,
              fallbackUsed: false
            });
          }
          throw new Error(
            `Run failed after model attempts: ${modelFailures.map(formatModelAttemptFailure).join(" | ")}`
          );
        }

        finalAttemptCount = attemptCount;
        if (candidateFinalText) {
          finalText = candidateFinalText;
          successfulCandidateIndex = candidateIndex;
          break;
        }

        if (!candidateHadAttemptError) {
          const failure = toModelAttemptFailure(
            selection,
            `empty response after ${attemptCount} attempt(s)`,
            "empty_response"
          );
          modelFailures.push(failure);
          pendingModelErrorEvents.push({ selection, failure, candidateIndex });
          momWarn("runner", "final_empty_response_after_retries", {
            runId,
            chatId: this.chatId,
            totalAttempts: attemptCount,
            modelProvider: selectedModel.provider,
            modelId: selectedModel.id,
            modelBaseUrl: redactBaseUrl(selectedModel.baseUrl),
            candidateIndex
          });
        }
        this.agent.state.messages = beforeAttempt;
      }

      if (successfulCandidateIndex >= 0 && pendingModelErrorEvents.length > 0) {
        const finalSelection = modelCandidates[successfulCandidateIndex];
        for (const item of pendingModelErrorEvents) {
          recordModelFailure(this.modelErrorTracker, {
            channel: this.channel,
            botId,
            chatId: this.chatId,
            sessionId: this.sessionId,
            runId,
            route: "text",
            selection: item.selection,
            failure: item.failure,
            candidateIndex: item.candidateIndex,
            recovered: true,
            fallbackUsed: successfulCandidateIndex > 0,
            finalSelection
          });
        }
      }
      if (successfulCandidateIndex < 0 && pendingModelErrorEvents.length > 0) {
        for (const item of pendingModelErrorEvents) {
          recordModelFailure(this.modelErrorTracker, {
            channel: this.channel,
            botId,
            chatId: this.chatId,
            sessionId: this.sessionId,
            runId,
            route: "text",
            selection: item.selection,
            failure: item.failure,
            candidateIndex: item.candidateIndex,
            recovered: false,
            fallbackUsed: false
          });
        }
      }

      if (!finalText && streamedAssistantText.trim()) {
        finalText = streamedAssistantText.trim();
        stopReason = "error";
        errorMessage = errorMessage ?? budget.getExceededReason();
        momWarn("runner", "partial_stream_preserved_after_error", {
          runId,
          chatId: this.chatId,
          finalTextLength: finalText.length,
          errorMessage
        });
      }

      if (finalText.startsWith("[SILENT]")) {
        momLog("runner", "final_silent", { runId, chatId: this.chatId });
        await ctx.deleteMessage();
      } else if (finalText) {
        if (successfulCandidateIndex > 0 && modelFailures.length > 0) {
          const recoveredFailureTitle = modelUseCase === "vision"
            ? "图片识别模型请求失败，已自动切换到备用模型继续处理。"
            : "主模型请求失败，已自动切换到备用模型。";
          await ctx.respondInThread(
            [
              recoveredFailureTitle,
              ...modelFailures.map((failure, index) => `${index + 1}. ${formatModelAttemptFailure(failure)}`),
              `active=provider=${activeSelection.model.provider}, model=${activeSelection.model.id}`
            ].join("\n")
          );
        }
        momLog("runner", "final_replace", {
          runId,
          chatId: this.chatId,
          finalTextLength: finalText.length,
        });
        await ctx.replaceMessage(finalText);
      } else {
        const modelInfo = [
          `provider: ${activeSelection.model.provider}`,
          `model: ${activeSelection.model.id}`,
          activeSelection.model.baseUrl ? `baseUrl: ${redactBaseUrl(activeSelection.model.baseUrl)}` : null,
        ].filter(Boolean).join(", ");
        const emptyResponseMessage =
          `All model attempts failed. Last model returned empty response after ${finalAttemptCount} attempt(s). ` +
          `(${modelInfo}) — ${modelFailures.map(formatModelAttemptFailure).join(" | ")}`;
        await ctx.replaceMessage(emptyResponseMessage);
        await ctx.respondInThread(
          [
            `All model attempts failed. Last model info — ${modelInfo}`,
            ...modelFailures.map((failure, index) => `${index + 1}. ${formatModelAttemptFailure(failure)}`)
          ].join("\n")
        );
        stopReason = "error";
        if (!errorMessage) errorMessage = emptyResponseMessage;
      }

      await ctx.setWorking(false);

      if (shouldEmitFinalRunnerError(errorMessage, finalText)) {
        momWarn("runner", "final_error", {
          runId,
          chatId: this.chatId,
          errorMessage,
        });
        await ctx.replaceMessage("Sorry, something went wrong.");
        await ctx.respondInThread(`Error: ${errorMessage}`);
      }

      momLog("runner", "run_end", {
        runId,
        chatId: this.chatId,
        stopReason,
        hasError: Boolean(errorMessage),
      });

      if (
        shouldSuggestSkillDraft({
          stopReason,
          finalText,
          toolCalls: budget.snapshot().toolCalls,
          toolFailures: budget.snapshot().toolFailures,
          modelAttempts: budget.snapshot().modelAttempts,
          explicitSkillCount: explicitlyInvokedSkills.length,
          settings: settings.skillDrafts
        })
      ) {
        savedSkillDraft = saveSkillDraft({
          workspaceDir: this.store.getWorkspaceDir(),
          chatId: this.chatId,
          userMessage: effectiveInputText,
          finalAnswer: finalText,
          toolNames: usedToolNames,
          failedToolNames,
          explicitSkillNames: explicitlyInvokedSkills.map((skill) => skill.name),
          modelFailures: modelFailures.map(formatModelAttemptFailure),
          settings: settings.skillDrafts
        });
      }

      const runSummary: RunSummary = {
        runId,
        sessionId: this.sessionId,
        stopReason,
        durationMs: Date.now() - runStartedAt,
        finalText,
        toolNames: usedToolNames,
        failedToolNames,
        explicitSkillNames: explicitlyInvokedSkills.map((skill) => skill.name),
        usedFallbackModel: successfulCandidateIndex > 0,
        modelFailureSummaries: modelFailures.map(formatModelAttemptFailure),
        budget: budget.snapshot(),
        budgetLimits: budget.limitsSnapshot(),
        usage: finalUsage,
        memorySnapshot: {
          createdAt: memorySnapshot.createdAt,
          fingerprint: memorySnapshot.fingerprint,
          query: memorySnapshot.query,
          selectedCount: memorySnapshot.selected.length,
          longTermCount: memorySnapshot.longTerm.length,
          dailyCount: memorySnapshot.daily.length
        },
        skillDraft: savedSkillDraft,
        reflection: buildRunReflection({
          stopReason,
          finalText,
          failedToolNames,
          usedFallbackModel: successfulCandidateIndex > 0,
          errorMessage,
          skillDraftSaved: Boolean(savedSkillDraft)
        }),
        errorMessage
      };
      this.store.appendRunSummary(this.chatId, runSummary as unknown as Record<string, unknown>);

      if (!finalText.startsWith("[SILENT]") && Boolean(savedSkillDraft)) {
        await ctx.respondInThread(formatRunClosingNote(runSummary));
      }
      return { stopReason, errorMessage };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const partialText = streamedAssistantText.trim();
      momError("runner", "run_exception", {
        runId,
        chatId: this.chatId,
        error: message,
        partialTextLength: partialText.length
      });
      const failedSummary: RunSummary = {
        runId,
        sessionId: this.sessionId,
        stopReason: "error",
        durationMs: Date.now() - runStartedAt,
        finalText: partialText,
        toolNames: usedToolNames,
        failedToolNames,
        explicitSkillNames: [],
        usedFallbackModel: false,
        modelFailureSummaries: [],
        budget: budget.snapshot(),
        budgetLimits: budget.limitsSnapshot(),
        usage: finalUsage,
        reflection: buildRunReflection({
          stopReason: "error",
          finalText: "",
          failedToolNames,
          usedFallbackModel: false,
          errorMessage: message,
          skillDraftSaved: false
        }),
        errorMessage: message
      };
      this.store.appendRunSummary(this.chatId, failedSummary as unknown as Record<string, unknown>);
      try {
        await ctx.setWorking(false);
        if (!partialText) {
          await ctx.replaceMessage(`Run failed: ${message}`);
        }
        await ctx.respondInThread(`Error: ${message}`);
      } catch {
        // ignore secondary UI errors
      }
      return { stopReason: "error", errorMessage: message };
    } finally {
      unsubscribe();
      this.activeRunBudget = undefined;
      this.activeRunnerEventSink = undefined;
      this.activePayloadContext = undefined;
      this.running = false;
    }
  }
}

export class RunnerPool {
  private readonly map = new Map<string, MomRunner>();

  constructor(
    private readonly channel: string,
    private readonly store: MomRuntimeStore,
    private readonly getSettings: () => RuntimeSettings,
    private readonly updateSettings: (patch: Partial<RuntimeSettings>) => RuntimeSettings,
    private readonly usageTracker: AiUsageTracker,
    private readonly modelErrorTracker: ModelErrorTracker,
    private readonly memory: MemoryGateway,
  ) { }

  private key(chatId: string, sessionId: string): string {
    return `${chatId}::${sessionId}`;
  }

  get(chatId: string, sessionId: string): MomRunner {
    const key = this.key(chatId, sessionId);
    const existing = this.map.get(key);
    if (existing) return existing;
    const runner = new MomRunner(
      this.channel,
      chatId,
      sessionId,
      this.store,
      this.getSettings,
      this.updateSettings,
      this.usageTracker,
      this.modelErrorTracker,
      this.memory,
    );
    this.map.set(key, runner);
    return runner;
  }

  abort(chatId: string, sessionId: string): boolean {
    const runner = this.get(chatId, sessionId);
    if (!runner.isRunning()) return false;
    runner.abort();
    return true;
  }

  steer(chatId: string, sessionId: string, text: string): boolean {
    return this.get(chatId, sessionId).steer(text);
  }

  followUp(chatId: string, sessionId: string, text: string): boolean {
    return this.get(chatId, sessionId).followUp(text);
  }

  reset(chatId: string, sessionId: string): void {
    this.map.delete(this.key(chatId, sessionId));
  }

  async compact(
    chatId: string,
    sessionId: string,
    options?: {
      reason?: "threshold" | "manual";
      customInstructions?: string;
    }
  ): Promise<{
    changed: boolean;
    summary: string;
    beforeTokens: number;
    afterTokens: number;
    summarizedMessages: number;
    keptMessages: number;
  }> {
    return this.get(chatId, sessionId).compact(options);
  }
}

export function readBotUsernameFromMemory(workspaceDir: string): string | null {
  const path = join(workspaceDir, "BOT_USERNAME.txt");
  if (!existsSync(path)) return null;
  try {
    const text = readFileSync(path, "utf8").trim();
    return text || null;
  } catch {
    return null;
  }
}
