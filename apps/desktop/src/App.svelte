<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { onMount } from "svelte";
  import ChatView from "./ChatView.svelte";
  import { initialLocale, normalizeLocale, translator, type Locale } from "./lib/i18n";
  import type { DesktopAgentSaveRequest, DesktopAgentsSummary, DesktopChannelSaveRequest, DesktopChannelsSummary, DesktopExternalChannel, DesktopHostBashSummary, DesktopMcpSaveRequest, DesktopMcpSummary, DesktopMediaGenerateUpdateRequest, DesktopMediaTask, DesktopMediaTaskKind, DesktopModelRoutingSettings, DesktopModelRoutingUpdateRequest, DesktopModelState, DesktopProviderCreateRequest, DesktopProviderGlobalsRequest, DesktopProviderModel, DesktopProviderModelRole, DesktopProviderModelTag, DesktopProvidersSummary, DesktopProviderUpdateRequest, DesktopRuntimeEnvSummary, DesktopRunHistoryItem, DesktopSandboxSummary, DesktopSandboxUpdateRequest, DesktopMemoryItem, DesktopMemoryRejection, DesktopMemorySummary, DesktopPluginsSummary, DesktopSettingsTestResponse, DesktopTtsUpdateRequest, DesktopWebSearchUpdateRequest, DesktopWebSearchSummary, DesktopMediaGenerateSummary, DesktopTtsSummary, DesktopSkillsSummary, DesktopTaskSession, DesktopTaskSummary, DesktopTraceRange, DesktopTraceSummary, DesktopUsageSummary, DesktopWebProfile } from "@molibot/desktop-contract";
  import {
    buildDiagnosticsSummary,
    applyDesktopSandboxPreset,
    createDesktopProvider,
    deleteDesktopProvider,
    deleteDesktopAgent,
    deleteDesktopChannel,
    deleteDesktopMcp,
    deleteDesktopWebProfile,
    discoverDesktopProviderModels,
    formatDurationMs,
    formatTokenCount,
    hasEnabledWebProfile,
    loadDesktopBootstrap,
    loadDesktopHostBash,
    loadDesktopAgents,
    loadDesktopAgentFiles,
    loadDesktopBotFiles,
    loadDesktopMcp,
    loadDesktopModelRouting,
    loadDesktopModels,
    loadDesktopChannels,
    loadDesktopMemory,
    loadDesktopMemoryRejections,
    loadDesktopPlugins,
    loadDesktopProfileFiles,
    loadDesktopWebSearch,
    loadDesktopImageGenerate,
    loadDesktopVideoGenerate,
    loadDesktopTts,
    loadDesktopTtsVoices,
    loadDesktopMediaTasks,
    loadDesktopSkills,
    loadDesktopProviders,
    loadDesktopRunHistory,
    loadDesktopRuntimeEnv,
    loadDesktopSandbox,
    loadDesktopTasks,
    loadDesktopTaskSession,
    loadDesktopTrace,
    loadDesktopUsage,
    loadDesktopWebProfiles,
    normalizeTheme,
    parseDesktopSandboxList,
    patchDesktopWebProfile,
    providerItemToUpdateRequest,
    saveDesktopAgent,
    saveDesktopAgentFiles,
    saveDesktopBotFiles,
    saveDesktopChannel,
    saveDesktopMcp,
    saveDesktopModelRouting,
    saveDesktopProfileFiles,
    saveDesktopPlugins,
    saveDesktopSandbox,
    saveDesktopWebSearch,
    saveDesktopImageGenerate,
    saveDesktopVideoGenerate,
    saveDesktopTts,
    deleteDesktopMediaTask,
    desktopTtsAudioUrl,
    saveDesktopWebProfile,
    runDesktopMemoryAction,
    runDesktopTaskAction,
    shouldShowServiceReconnect,
    summarizeDesktopReadiness,
    detectDesktopSandboxPreset,
    switchDesktopModel,
    testDesktopProvider,
    testDesktopChannel,
    testDesktopWebSearchSettings,
    testDesktopImageGenerateSettings,
    testDesktopVideoGenerateSettings,
    testDesktopTtsSettings,
    toggleDesktopHostBashWhitelist,
    updateDesktopProvider,
    updateDesktopProviderGlobals,
    updateDesktopSkills,
    type DesktopModelRoute,
    type DesktopReadiness,
    type DesktopSandboxPreset,
    type DesktopTheme
  } from "./lib/api";

  type Ownership = "managed" | "external";
  type ToolSettingsSection = "webSearch" | "imageGenerate" | "videoGenerate" | "ttsGenerate";
  type DesktopStatus = {
    service: {
      endpoint: string | null;
      ownership: Ownership | null;
      state: "disconnected" | "ready" | "incompatible" | "error";
      version: string | null;
    };
    launchAtLogin: boolean;
  };

  type SettingsSection = "general" | "models" | "providers" | "agents" | "mcp" | "skills" | "memory" | "channels" | "plugins" | "webSearch" | "imageGenerate" | "videoGenerate" | "ttsGenerate" | "profiles" | "usage" | "runHistory" | "trace" | "sandbox" | "hostBash" | "tasks" | "diagnostics" | "runtimeEnv";
  const MODEL_ROUTES: DesktopModelRoute[] = ["text", "vision", "stt", "tts", "subagent"];
  const TRACE_RANGES: DesktopTraceRange[] = ["today", "yesterday", "last7Days", "last30Days"];
  const PROVIDER_MODEL_TAGS: DesktopProviderModelTag[] = ["text", "vision", "audio_input", "stt", "tts", "tool"];
  const PROVIDER_MODEL_ROLES: DesktopProviderModelRole[] = ["system", "user", "assistant", "tool", "developer"];
  const PROVIDER_THINKING_FORMATS = ["openai", "openrouter", "anthropic", "deepseek", "zai", "qwen", "qwen-chat-template"] as const;
  const PROFILE_FILE_NAMES = ["BOT.md", "SOUL.md", "IDENTITY.md", "SONG.md"] as const;
  const AGENT_FILE_NAMES = ["AGENTS.md", "SOUL.md", "IDENTITY.md", "SONG.md"] as const;
  const DESKTOP_CHANNELS: DesktopExternalChannel[] = ["telegram", "feishu", "qq", "weixin"];
  const CHANNEL_FIELD_CONFIG: Record<DesktopExternalChannel, { visible: string[]; secret: string[] }> = {
    telegram: { visible: ["streamOutput"], secret: ["token"] },
    feishu: { visible: ["appId", "streamOutput"], secret: ["appSecret", "verificationToken", "encryptKey"] },
    qq: { visible: ["appId"], secret: ["clientSecret"] },
    weixin: { visible: ["baseUrl"], secret: [] }
  };
  type ProfileEditor = { previousId?: string; isNew: boolean; id: string; name: string; enabled: boolean; agentId: string; sandboxEnabled?: boolean; files: Record<string, string> };
  type ChannelEditor = DesktopChannelSaveRequest & { isNew: boolean; files: Record<string, string> };
  type McpEditor = DesktopMcpSaveRequest & { isNew: boolean; argsDraft: string; envDraft: string; headerDraft: string };
  type PluginsEditor = { memoryEnabled: boolean; memoryBackend: string; values: Record<string, Record<string, string | boolean>>; secretValues: Record<string, Record<string, string>>; clearSecrets: Record<string, string[]> };
  type ProviderEditor = DesktopProviderUpdateRequest & { isNew: boolean };
  type SandboxEditor = {
    enabled: boolean;
    initFailureMode: "warn-disable" | "block";
    envFilePath: string;
    preserveExternalEnvFilePath: boolean;
    envInheritMode: "minimal" | "allowlist" | "full";
    envAllowText: string;
    envDenyText: string;
    networkAllowText: string;
    networkDenyText: string;
    denyReadText: string;
    allowWriteText: string;
    denyWriteText: string;
  };
  type SearchEngineEditor = DesktopWebSearchUpdateRequest["engines"][number] & { hasApiKey: boolean; apiKey: string; clearApiKey: boolean };
  type WebSearchEditor = Omit<DesktopWebSearchUpdateRequest, "engines"> & { engines: SearchEngineEditor[] };
  type MediaEngineEditor = DesktopMediaGenerateUpdateRequest["engines"][number] & { hasApiKey: boolean; apiKey: string; clearApiKey: boolean };
  type MediaEditor = Omit<DesktopMediaGenerateUpdateRequest, "engines"> & { engines: MediaEngineEditor[] };
  type TtsProviderEditor = DesktopTtsUpdateRequest["providers"][number] & { hasApiKey: boolean; apiKey: string; clearApiKey: boolean };
  type TtsEditor = Omit<DesktopTtsUpdateRequest, "providers"> & { providers: TtsProviderEditor[] };
  type QrModule = { toDataURL: (text: string, options?: Record<string, unknown>) => Promise<string> };

  let locale: Locale = ((stored) => stored ? normalizeLocale(stored) : initialLocale())(localStorage.getItem("molibot-desktop-locale"));
  let text = translator(locale);
  let status: DesktopStatus | null = null;
  let busy = false;
  let error = "";
  let ownershipText = "";
  let serviceEndpointText = "";
  let activeSection: SettingsSection = "general";
  let modelStates: Partial<Record<DesktopModelRoute, DesktopModelState>> = {};
  let modelsLoading = false;
  let switchingRoute: DesktopModelRoute | null = null;
  let loadedModelsEndpoint = "";
  let modelRoutingAdvanced: DesktopModelRoutingSettings | null = null;
  let modelRoutingDirty = false;
  let modelRoutingSaving = false;
  let modelRoutingMessage = "";
  let readiness: DesktopReadiness | null = null;
  let loadedReadinessEndpoint = "";
  let diagnosticsCopied = false;
  let runtimeEnv: DesktopRuntimeEnvSummary | null = null;
  let runtimeEnvEndpoint = "";
  let runtimeEnvLoading = false;
  let webProfiles: DesktopWebProfile[] = [];
  let webProfilesLoading = false;
  let webProfilesEndpoint = "";
  let patchingProfileId: string | null = null;
  let profileEdit: ProfileEditor | null = null;
  let profileSaving = false;
  let profileEditorLoading = false;
  let profileActionMessage = "";
  let usage: DesktopUsageSummary | null = null;
  let usageLoading = false;
  let usageEndpoint = "";
  let runHistory: DesktopRunHistoryItem[] = [];
  let runHistoryQuery = "";
  let runHistoryLoading = false;
  let runHistoryEndpoint = "";
  let trace: DesktopTraceSummary | null = null;
  let traceLoading = false;
  let traceEndpoint = "";
  let traceRange: DesktopTraceRange = "today";
  let sandbox: DesktopSandboxSummary | null = null;
  let sandboxEdit: SandboxEditor | null = null;
  let sandboxLoading = false;
  let sandboxEndpoint = "";
  let sandboxSaving = false;
  let sandboxDiagnosing = false;
  let sandboxActionMessage = "";
  let activeSandboxPreset: DesktopSandboxPreset | "custom" = "custom";
  let hostBash: DesktopHostBashSummary | null = null;
  let hostBashLoading = false;
  let hostBashEndpoint = "";
  let hostBashTogglingId: string | null = null;
  let tasks: DesktopTaskSummary | null = null;
  let tasksLoading = false;
  let tasksEndpoint = "";
  let taskSelected = new Set<string>();
  let taskEdit: (DesktopTaskSummary["items"][number] & { draftText: string; draftDelivery: string; draftSchedule: string; draftTimezone: string; draftSessionMode: string }) | null = null;
  let taskSession: DesktopTaskSession | null = null;
  let taskBusy = "";
  let taskQuery = "";
  let taskActionMessage = "";
  $: filteredTaskItems = tasks?.items.filter((item) => !taskQuery.trim() || [item.text, item.channel, item.botId, item.chatId, item.status, item.type].join("\n").toLowerCase().includes(taskQuery.trim().toLowerCase())) ?? [];
  let providers: DesktopProvidersSummary | null = null;
  let providersLoading = false;
  let providersEndpoint = "";
  let providerSaving = false;
  let providerTestingId: string | null = null;
  let providerActionMessage = "";
  let providerActionFailed = false;
  let providerEdit: ProviderEditor | null = null;
  let providerEditApiKey = "";
  let providerEditClearApiKey = false;
  let providerDiscoveredModels: string[] = [];
  let providerDiscovering = false;
  let providerGlobals: DesktopProviderGlobalsRequest = { providerMode: "pi", piProvider: "", piModel: "", defaultCustomProviderId: "" };
  let providerGlobalsDirty = false;
  let agents: DesktopAgentsSummary | null = null;
  let agentsLoading = false;
  let agentsEndpoint = "";
  let agentEdit: (DesktopAgentSaveRequest & { isNew: boolean; files: Record<string, string> }) | null = null;
  let agentSaving = false;
  let agentEditorLoading = false;
  let agentActionMessage = "";
  let mcp: DesktopMcpSummary | null = null;
  let mcpLoading = false;
  let mcpEndpoint = "";
  let mcpEdit: McpEditor | null = null;
  let mcpSaving = false;
  let mcpActionMessage = "";
  let skills: DesktopSkillsSummary | null = null;
  let skillsLoading = false;
  let skillsEndpoint = "";
  let skillsSearchDraft: DesktopSkillsSummary["search"] | null = null;
  let skillsSaving = false;
  let skillSavingId = "";
  // Pristine JSON snapshots so page-level save bars only appear when the draft
  // actually differs from the loaded value (dirty-gated), instead of showing
  // permanently just because a draft object exists.
  let skillsSearchPristine = "";
  let pluginsPristine = "";
  let sandboxPristine = "";
  let modelRoutingPristine = "";
  let skillsActionMessage = "";
  let memory: DesktopMemorySummary | null = null;
  let memoryLoading = false;
  let memoryEndpoint = "";
  let memoryItems: DesktopMemoryItem[] = [];
  let memoryEdit: DesktopMemoryItem | null = null;
  let memoryRejections: DesktopMemoryRejection[] = [];
  let memoryChannel = "";
  let memoryUserId = "";
  let memoryQuery = "";
  let memoryAllScopes = true;
  let memoryBusyAction = "";
  let memoryActionMessage = "";
  let memoryRejectionQuery = "";
  $: filteredMemoryRejections = memoryRejections.filter((item) => !memoryRejectionQuery.trim() || [item.reason, item.content, item.channel, item.externalUserId, item.tags.join(",")].join("\n").toLowerCase().includes(memoryRejectionQuery.trim().toLowerCase()));
  let channels: DesktopChannelsSummary | null = null;
  let channelsLoading = false;
  let channelsEndpoint = "";
  let channelEdit: ChannelEditor | null = null;
  let channelSaving = false;
  let channelEditorLoading = false;
  let channelTesting = false;
  let channelActionMessage = "";
  let channelQrLink = "";
  let channelQrImage = "";
  let channelQrLoading = false;
  let channelQrError = "";
  let qrModulePromise: Promise<QrModule> | null = null;
  let plugins: DesktopPluginsSummary | null = null;
  let pluginsLoading = false;
  let pluginsEndpoint = "";
  let pluginsEdit: PluginsEditor | null = null;
  let pluginsSaving = false;
  let pluginsActionMessage = "";
  let webSearch: DesktopWebSearchSummary | null = null;
  let webSearchEdit: WebSearchEditor | null = null;
  let webSearchLoading = false;
  let webSearchEndpoint = "";
  let imageGenerate: DesktopMediaGenerateSummary | null = null;
  let imageGenerateEdit: MediaEditor | null = null;
  let imageGenerateLoading = false;
  let imageGenerateEndpoint = "";
  let imageTasks: DesktopMediaTask[] = [];
  let mediaTaskDetail: DesktopMediaTask | null = null;
  let mediaPollTimer: ReturnType<typeof setInterval> | null = null;
  let videoGenerate: DesktopMediaGenerateSummary | null = null;
  let videoGenerateEdit: MediaEditor | null = null;
  let videoGenerateLoading = false;
  let videoGenerateEndpoint = "";
  let videoTasks: DesktopMediaTask[] = [];
  let mediaTaskBusy = "";
  let ttsGenerate: DesktopTtsSummary | null = null;
  let ttsGenerateEdit: TtsEditor | null = null;
  let ttsGenerateLoading = false;
  let ttsGenerateEndpoint = "";
  let ttsVoices: Array<{ id: string; label?: string; locale?: string; gender?: string }> = [];
  const XIAOMI_VOICES: Array<{ id: string; label: string; locale?: string; gender?: string }> = [
    { id: "mimo_default", label: "MiMo-默认", locale: "因部署集群而异" },
    { id: "冰糖", label: "冰糖", locale: "中文", gender: "女性" },
    { id: "茉莉", label: "茉莉", locale: "中文", gender: "女性" },
    { id: "苏打", label: "苏打", locale: "中文", gender: "男性" },
    { id: "白桦", label: "白桦", locale: "中文", gender: "男性" },
    { id: "Mia", label: "Mia", locale: "英文", gender: "女性" },
    { id: "Chloe", label: "Chloe", locale: "英文", gender: "女性" },
    { id: "Milo", label: "Milo", locale: "英文", gender: "男性" },
    { id: "Dean", label: "Dean", locale: "英文", gender: "男性" }
  ];
  let ttsTestProvider = "macos";
  function ttsProviderLabel(id: string, copy: typeof text): string {
    if (id === "macos") return copy.ttsProviderMacos;
    if (id === "xiaomi") return copy.ttsProviderXiaomi;
    return id;
  }
  let toolSettingsDirty = new Set<ToolSettingsSection>();
  let toolSettingsSaving = false;
  let toolSettingsMessage = "";
  let toolTestBusy = false;
  let toolTestResult: DesktopSettingsTestResponse | null = null;
  let toolTestQuery = "latest AI news";
  let toolTestEngine = "auto";
  let imageTestPrompt = "A calm futuristic workspace in soft morning light";
  let imageTestSize = "1024x1024";
  let videoTestPrompt = "A slow cinematic pan across a quiet coastal city at dawn";
  let ttsTestText = "你好，这是 Molibot 的语音合成测试。";
  let ttsTestAudioUrl = "";
  const WEB_SEARCH_ENGINE_LABELS: Record<string, keyof typeof text> = {
    duckduckgo: "searchEngineDuckDuckGo",
    brave: "searchEngineBrave",
    tavily: "searchEngineTavily",
    exa: "searchEngineExa",
    serper: "searchEngineSerper",
    baidu: "searchEngineBaidu",
    baidu_fast: "searchEngineBaiduFast",
    baidu_web: "searchEngineBaiduWeb",
    ark: "searchEngineArk",
    grok: "searchEngineGrok",
    bocha: "searchEngineBocha"
  };
  function webSearchEngineLabel(id: string, copy: typeof text): string {
    const key = WEB_SEARCH_ENGINE_LABELS[id];
    return key ? (copy[key] as string) : id;
  }
  const IMAGE_ENGINE_LABELS: Record<string, string> = {
    agnes: "Agnes Image",
    openai: "OpenAI Images",
    "openai-chat": "OpenAI Chat Format",
    google: "Google Imagen",
    volcengine: "Volcengine (Seedream)",
    modelscope: "ModelScope"
  };
  const VIDEO_ENGINE_LABELS: Record<string, string> = {
    agnes: "Agnes Video",
    volcengine: "Volcengine (Doubao)"
  };
  function mediaEngineLabel(kind: "image" | "video", id: string): string {
    const map = kind === "image" ? IMAGE_ENGINE_LABELS : VIDEO_ENGINE_LABELS;
    return map[id] ?? id;
  }
  let revealedSecrets = new Set<string>();
  function secretRevealed(key: string): boolean {
    return revealedSecrets.has(key);
  }
  function toggleRevealSecret(key: string): void {
    const next = new Set(revealedSecrets);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    revealedSecrets = next;
  }
  const THEME_STORAGE_KEY = "molibot-desktop-theme";
  let theme: DesktopTheme = normalizeTheme(localStorage.getItem(THEME_STORAGE_KEY));

  function applyTheme(value: DesktopTheme): void {
    const root = document.documentElement;
    if (value === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", value);
  }

  function changeTheme(value: DesktopTheme): void {
    theme = value;
    localStorage.setItem(THEME_STORAGE_KEY, value);
    applyTheme(value);
  }

  // Geist owns a single accent (blue-700), defined as --accent / --accent-soft
  // in styles.css per theme. No user-selectable accent palette.

  const THEME_PREVIEWS: { value: DesktopTheme; labelKey: "themeLight" | "themeDark" | "themeSystem" }[] = [
    { value: "light", labelKey: "themeLight" },
    { value: "dark", labelKey: "themeDark" },
    { value: "system", labelKey: "themeSystem" }
  ];

  const SETTINGS_NAV: { id: SettingsSection; icon: string }[] = [
    { id: "general", icon: "gear-six" },
    { id: "models", icon: "cpu" },
    { id: "providers", icon: "plugs" },
    { id: "agents", icon: "robot" },
    { id: "mcp", icon: "plugs-connected" },
    { id: "skills", icon: "magic-wand" },
    { id: "memory", icon: "brain" },
    { id: "channels", icon: "broadcast" },
    { id: "plugins", icon: "puzzle-piece" },
    { id: "webSearch", icon: "globe" },
    { id: "imageGenerate", icon: "image-square" },
    { id: "videoGenerate", icon: "film-slate" },
    { id: "ttsGenerate", icon: "waveform" },
    { id: "profiles", icon: "identification-card" },
    { id: "usage", icon: "chart-bar" },
    { id: "runHistory", icon: "clock-counter-clockwise" },
    { id: "trace", icon: "list-magnifying-glass" },
    { id: "sandbox", icon: "shield-check" },
    { id: "hostBash", icon: "terminal-window" },
    { id: "tasks", icon: "list-checks" },
    { id: "diagnostics", icon: "stethoscope" },
    { id: "runtimeEnv", icon: "package" }
  ];

  const SETTINGS_GROUPS: { id: "general" | "ai" | "channels" | "data" | "system"; sections: SettingsSection[] }[] = [
    { id: "general", sections: ["general"] },
    { id: "ai", sections: ["models", "providers", "usage", "trace", "mcp", "webSearch", "imageGenerate", "videoGenerate", "ttsGenerate"] },
    { id: "channels", sections: ["profiles", "channels"] },
    { id: "data", sections: ["agents", "memory", "skills", "runHistory", "tasks", "hostBash"] },
    { id: "system", sections: ["runtimeEnv", "sandbox", "plugins", "diagnostics"] }
  ];

  let settingsFilter = "";
  $: localizedSettingsNav = SETTINGS_NAV.map((item) => ({
    ...item,
    label: sectionLabel(item.id, text),
    locale
  }));
  $: filteredSettingsNav = localizedSettingsNav.filter((item) => {
    const query = settingsFilter.trim().toLocaleLowerCase(locale);
    return !query || `${item.label} ${item.id}`.toLocaleLowerCase(locale).includes(query);
  });
  $: localizedSettingsGroups = SETTINGS_GROUPS.map((group) => ({
    ...group,
    label: settingsGroupLabel(group.id, locale),
    items: group.sections.map((section) => filteredSettingsNav.find((item) => item.id === section)).filter((item): item is (typeof localizedSettingsNav)[number] => Boolean(item))
  })).filter((group) => group.items.length > 0);

  function settingsGroupLabel(group: (typeof SETTINGS_GROUPS)[number]["id"], currentLocale: Locale): string {
    const zh = currentLocale === "zh-CN";
    if (group === "ai") return zh ? "AI 引擎" : "AI Engine";
    if (group === "channels") return zh ? "渠道" : "Channels";
    if (group === "data") return zh ? "助手数据" : "Agent Data";
    if (group === "system") return zh ? "系统" : "System";
    return zh ? "总览" : "General";
  }

  function sectionLabel(section: SettingsSection, copy: typeof text): string {
    switch (section) {
      case "models": return copy.models;
      case "providers": return copy.providers;
      case "agents": return copy.agents;
      case "mcp": return copy.mcp;
      case "skills": return copy.skills;
      case "memory": return copy.memory;
      case "channels": return copy.channels;
      case "plugins": return copy.plugins;
      case "webSearch": return copy.webSearch;
      case "imageGenerate": return copy.imageGenerate;
      case "videoGenerate": return copy.videoGenerate;
      case "ttsGenerate": return copy.ttsGenerate;
      case "profiles": return copy.profiles;
      case "usage": return copy.usage;
      case "runHistory": return copy.runHistory;
      case "trace": return copy.trace;
      case "sandbox": return copy.sandbox;
      case "hostBash": return copy.hostBash;
      case "tasks": return copy.tasks;
      case "diagnostics": return copy.diagnostics;
      case "runtimeEnv": return copy.runtimeEnv;
      default: return copy.general;
    }
  }

  const LOCALE_STORAGE_KEY = "molibot-desktop-locale";

  function changeLocale(value: string): void {
    locale = normalizeLocale(value);
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  }
  const isSettings = new URLSearchParams(window.location.search).get("window") === "settings";
  const runningInTauri = "__TAURI_INTERNALS__" in window;

  function routeLabel(route: DesktopModelRoute, copy: typeof text): string {
    if (route === "text") return copy.routeText;
    if (route === "vision") return copy.routeVision;
    if (route === "stt") return copy.routeStt;
    if (route === "tts") return copy.routeTts;
    return copy.routeSubagent;
  }

  function externalChannelLabel(channel: DesktopExternalChannel, currentLocale: Locale): string {
    if (channel === "weixin") return currentLocale === "zh-CN" ? "微信" : "WeChat";
    if (channel === "feishu") return currentLocale === "zh-CN" ? "飞书" : "Feishu";
    if (channel === "qq") return "QQ";
    return "Telegram";
  }

  function serviceStateLabel(state: "disconnected" | "ready" | "incompatible" | "error" | undefined, copy: typeof text): string {
    if (state === "ready") return copy.diagStateReady;
    if (state === "incompatible") return copy.diagStateIncompatible;
    if (state === "error") return copy.diagStateError;
    return copy.diagStateDisconnected;
  }

  function usageWindowLabel(label: "today" | "yesterday" | "last7Days" | "last30Days", copy: typeof text): string {
    if (label === "today") return copy.usageWindow_today;
    if (label === "yesterday") return copy.usageWindow_yesterday;
    if (label === "last7Days") return copy.usageWindow_last7Days;
    return copy.usageWindow_last30Days;
  }

  function runHistoryOutcomeLabel(outcome: "success" | "partial" | "failed", copy: typeof text): string {
    if (outcome === "success") return copy.runHistoryOutcome_success;
    if (outcome === "partial") return copy.runHistoryOutcome_partial;
    return copy.runHistoryOutcome_failed;
  }

  function traceRangeLabel(range: DesktopTraceRange, copy: typeof text): string {
    if (range === "today") return copy.usageWindow_today;
    if (range === "yesterday") return copy.usageWindow_yesterday;
    if (range === "last7Days") return copy.usageWindow_last7Days;
    return copy.usageWindow_last30Days;
  }

  // --- Lightweight, dependency-free chart geometry helpers (Usage / Trace) ---
  // All charts are hand-rolled SVG so the Desktop bundle stays free of a chart
  // library. Trend paths render in a 0 0 100 CHART_H viewBox stretched to the
  // card width (non-scaling stroke keeps lines crisp); donuts use the classic
  // r = 100/2π circle so stroke-dasharray values are direct percentages.
  const CHART_H = 44;
  const CHART_PAD_TOP = 5;
  const CHART_PAD_BOTTOM = 4;
  const DONUT_R = 15.915;

  interface DonutSegment { key: string; color: string; value: number; len: number; offset: number; }

  /** Maps a value series to a smoothed SVG path across the 0–100 chart width. */
  function trendLinePath(values: number[], max: number): string {
    const n = values.length;
    if (n === 0) return "";
    const span = CHART_H - CHART_PAD_TOP - CHART_PAD_BOTTOM;
    const yFor = (v: number) => CHART_PAD_TOP + (1 - Math.min(1, max > 0 ? v / max : 0)) * span;
    if (n === 1) return `M0 ${yFor(values[0]).toFixed(2)} L100 ${yFor(values[0]).toFixed(2)}`;
    const pts: [number, number][] = values.map((v, i) => [(i / (n - 1)) * 100, yFor(v)]);
    // Catmull-Rom → cubic bezier for a gentle, non-overshooting curve.
    let d = `M${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
    for (let i = 0; i < pts.length - 1; i += 1) {
      const p0 = pts[i - 1] ?? pts[i];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2] ?? p2;
      const t = 0.16;
      const c1x = p1[0] + (p2[0] - p0[0]) * t;
      const c1y = p1[1] + (p2[1] - p0[1]) * t;
      const c2x = p2[0] - (p3[0] - p1[0]) * t;
      const c2y = p2[1] - (p3[1] - p1[1]) * t;
      d += ` C${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
    }
    return d;
  }

  /** Closes a trend line into a filled area down to the chart baseline. */
  function trendAreaPath(line: string): string {
    return line ? `${line} L100 ${CHART_H} L0 ${CHART_H} Z` : "";
  }

  /** Y coordinate for a single value, matching trendLinePath's scale. */
  function trendY(value: number, max: number): number {
    const span = CHART_H - CHART_PAD_TOP - CHART_PAD_BOTTOM;
    return CHART_PAD_TOP + (1 - Math.min(1, max > 0 ? value / max : 0)) * span;
  }

  /** Builds clockwise-from-top donut ring segments with percentage dash lengths. */
  function donutSegments(items: { key: string; color: string; value: number }[]): DonutSegment[] {
    const total = items.reduce((sum, item) => sum + Math.max(0, item.value), 0);
    if (total <= 0) return [];
    const segments: DonutSegment[] = [];
    let acc = 0;
    for (const item of items) {
      const value = Math.max(0, item.value);
      if (value === 0) continue;
      const len = (value / total) * 100;
      segments.push({ key: item.key, color: item.color, value, len, offset: 25 - acc });
      acc += len;
    }
    return segments;
  }

  function percentOf(value: number, total: number): number {
    return total > 0 ? Math.round((value / total) * 100) : 0;
  }

  // Usage derived chart data.
  $: usageDaily = usage?.daily ?? [];
  $: usageHasTrend = usageDaily.length >= 1;
  $: usageTokenMax = Math.max(1, ...usageDaily.map((day) => day.totalTokens));
  $: usageReqMax = Math.max(1, ...usageDaily.map((day) => day.requests));
  $: usageTokenLine = trendLinePath(usageDaily.map((day) => day.totalTokens), usageTokenMax);
  $: usageTokenArea = trendAreaPath(usageTokenLine);
  $: usageReqLine = trendLinePath(usageDaily.map((day) => day.requests), usageReqMax);
  $: usagePeakIndex = usageDaily.reduce((best, day, index) => (day.totalTokens > (usageDaily[best]?.totalTokens ?? -1) ? index : best), 0);
  $: usagePeakDay = usageDaily[usagePeakIndex] ?? null;
  $: usagePeakX = usageDaily.length > 1 ? (usagePeakIndex / (usageDaily.length - 1)) * 100 : 0;
  // Keep the floating peak label inside the card even when the peak sits at an edge.
  $: usagePeakTagX = Math.min(90, Math.max(10, usagePeakX));
  $: usagePeakY = usagePeakDay ? trendY(usagePeakDay.totalTokens, usageTokenMax) : 0;
  $: usageDistItems = usage
    ? [
        { key: "input", label: text.usageInput, value: usage.totals.inputTokens, color: "var(--chart-blue)" },
        { key: "output", label: text.usageOutput, value: usage.totals.outputTokens, color: "var(--chart-teal)" },
        { key: "cacheRead", label: text.usageCacheRead, value: usage.totals.cacheReadTokens, color: "var(--chart-purple)" },
        { key: "cacheWrite", label: text.usageCacheWrite, value: usage.totals.cacheWriteTokens, color: "var(--chart-orange)" }
      ]
    : [];
  $: usageDistTotal = usageDistItems.reduce((sum, item) => sum + item.value, 0);
  $: usageDistSegments = donutSegments(usageDistItems);
  $: usageCacheBase = usage ? usage.totals.inputTokens + usage.totals.cacheReadTokens : 0;
  $: usageCacheHit = usage && usageCacheBase > 0 ? usage.totals.cacheReadTokens / usageCacheBase : 0;
  $: usageWindowMax = usage ? Math.max(1, ...usage.windows.map((window) => window.totalTokens)) : 1;
  $: usageAvgPerDay = usageDaily.length > 0 ? usage!.totals.totalTokens / 30 : 0;

  // Trace derived chart data.
  $: traceActivityItems = trace
    ? [
        { key: "tools", label: text.traceToolCalls, value: trace.totals.toolCalls, color: "var(--chart-blue)" },
        { key: "models", label: text.traceModelCalls, value: trace.totals.modelCalls, color: "var(--chart-purple)" },
        { key: "skills", label: text.traceSkills, value: trace.totals.skillUsages, color: "var(--chart-teal)" },
        { key: "runs", label: text.traceRuns, value: trace.totals.runs, color: "var(--chart-indigo)" }
      ]
    : [];
  $: traceActivityMax = Math.max(1, ...traceActivityItems.map((item) => item.value));
  $: traceOutcomeItems = trace
    ? [
        { key: "ok", label: text.traceSucceeded, value: Math.max(0, trace.totals.executedToolCalls - trace.totals.failedTools), color: "var(--chart-green)" },
        { key: "failed", label: text.traceFailed, value: trace.totals.failedTools, color: "var(--chart-red)" },
        { key: "blocked", label: text.traceBlocked, value: trace.totals.blockedTools, color: "var(--chart-orange)" }
      ]
    : [];
  $: traceOutcomeTotal = traceOutcomeItems.reduce((sum, item) => sum + item.value, 0);
  $: traceOutcomeSegments = donutSegments(traceOutcomeItems);
  $: traceDurationMax = trace ? Math.max(1, trace.totals.avgToolDurationMs, trace.totals.avgModelDurationMs) : 1;
  $: traceCoverageItems = trace
    ? [
        { key: "bots", label: text.traceBots, value: trace.totals.bots, icon: "robot" },
        { key: "channels", label: text.traceChannels, value: trace.totals.channels, icon: "broadcast" },
        { key: "chats", label: text.traceChats, value: trace.totals.chats, icon: "chats-circle" },
        { key: "sessions", label: text.traceSessions, value: trace.totals.sessions, icon: "identification-card" }
      ]
    : [];

  function taskTypeLabel(type: "one-shot" | "periodic" | "immediate", copy: typeof text): string {
    if (type === "one-shot") return copy.taskType_oneShot;
    if (type === "periodic") return copy.taskType_periodic;
    return copy.taskType_immediate;
  }

  function taskStatusLabel(status: "pending" | "running" | "completed" | "skipped" | "error", copy: typeof text): string {
    if (status === "pending") return copy.taskStatus_pending;
    if (status === "running") return copy.taskStatus_running;
    if (status === "completed") return copy.taskStatus_completed;
    if (status === "skipped") return copy.taskStatus_skipped;
    return copy.taskStatus_error;
  }

  $: serviceReady = status?.service.state === "ready" && !!status?.service.endpoint;
  $: if (isSettings && (activeSection === "models" || activeSection === "agents") && serviceReady && status?.service.endpoint
    && status.service.endpoint !== loadedModelsEndpoint) {
    void loadModels(status.service.endpoint);
  }
  $: if (isSettings && activeSection === "general" && serviceReady && status?.service.endpoint
    && status.service.endpoint !== loadedReadinessEndpoint) {
    void loadReadiness(status.service.endpoint);
  }

  $: if (isSettings && activeSection === "profiles" && serviceReady && status?.service.endpoint
    && status.service.endpoint !== webProfilesEndpoint) {
    void loadWebProfiles(status.service.endpoint);
  }

  $: if (isSettings && activeSection === "channels" && serviceReady && status?.service.endpoint
    && status.service.endpoint !== agentsEndpoint) {
    void loadAgents(status.service.endpoint);
  }

  $: if (isSettings && activeSection === "profiles" && serviceReady && status?.service.endpoint
    && status.service.endpoint !== agentsEndpoint) {
    void loadAgents(status.service.endpoint);
  }

  $: if (isSettings && activeSection === "usage" && serviceReady && status?.service.endpoint
    && status.service.endpoint !== usageEndpoint) {
    void loadUsage(status.service.endpoint);
  }

  $: if (isSettings && activeSection === "runHistory" && serviceReady && status?.service.endpoint
    && status.service.endpoint !== runHistoryEndpoint) {
    void loadRunHistory(status.service.endpoint);
  }

  $: if (isSettings && activeSection === "trace" && serviceReady && status?.service.endpoint
    && status.service.endpoint !== traceEndpoint) {
    void loadTrace(status.service.endpoint);
  }

  $: activeSandboxPreset = sandboxEdit ? detectDesktopSandboxPreset(buildSandboxRequest(sandboxEdit)) : "custom";

  // Dirty-gated save affordances: true only when the working draft diverges from
  // the pristine loaded snapshot, so the sticky save bar appears on change.
  $: skillsSearchDirty = skillsSearchDraft !== null && JSON.stringify(skillsSearchDraft) !== skillsSearchPristine;
  $: pluginsDirty = pluginsEdit !== null && JSON.stringify(pluginsEdit) !== pluginsPristine;
  $: sandboxDirty = sandboxEdit !== null && JSON.stringify(sandboxEdit) !== sandboxPristine;

  $: if (isSettings && activeSection === "sandbox" && serviceReady && status?.service.endpoint
    && status.service.endpoint !== sandboxEndpoint) {
    void loadSandbox(status.service.endpoint);
  }

  $: if (isSettings && activeSection === "hostBash" && serviceReady && status?.service.endpoint
    && status.service.endpoint !== hostBashEndpoint) {
    void loadHostBash(status.service.endpoint);
  }

  $: if (isSettings && activeSection === "tasks" && serviceReady && status?.service.endpoint
    && status.service.endpoint !== tasksEndpoint) {
    void loadTasks(status.service.endpoint);
  }

  $: if (isSettings && activeSection === "providers" && serviceReady && status?.service.endpoint
    && status.service.endpoint !== providersEndpoint) {
    void loadProviders(status.service.endpoint);
  }

  $: if (isSettings && activeSection === "agents" && serviceReady && status?.service.endpoint
    && status.service.endpoint !== agentsEndpoint) {
    void loadAgents(status.service.endpoint);
  }

  $: if (isSettings && activeSection === "mcp" && serviceReady && status?.service.endpoint
    && status.service.endpoint !== mcpEndpoint) {
    void loadMcp(status.service.endpoint);
  }

  $: if (isSettings && activeSection === "skills" && serviceReady && status?.service.endpoint
    && status.service.endpoint !== skillsEndpoint) {
    void loadSkills(status.service.endpoint);
  }

  $: if (isSettings && activeSection === "memory" && serviceReady && status?.service.endpoint
    && status.service.endpoint !== memoryEndpoint) {
    void loadMemory(status.service.endpoint);
  }

  $: if (isSettings && activeSection === "channels" && serviceReady && status?.service.endpoint
    && status.service.endpoint !== channelsEndpoint) {
    void loadChannels(status.service.endpoint);
  }

  $: if (isSettings && activeSection === "plugins" && serviceReady && status?.service.endpoint
    && status.service.endpoint !== pluginsEndpoint) {
    void loadPlugins(status.service.endpoint);
  }

  $: if (isSettings && activeSection === "webSearch" && serviceReady && status?.service.endpoint
    && status.service.endpoint !== webSearchEndpoint) {
    void loadWebSearch(status.service.endpoint);
  }

  $: if (isSettings && activeSection === "imageGenerate" && serviceReady && status?.service.endpoint
    && status.service.endpoint !== imageGenerateEndpoint) {
    void loadImageGenerate(status.service.endpoint);
  }
  $: ensureMediaPolling("image");

  $: if (isSettings && activeSection === "videoGenerate" && serviceReady && status?.service.endpoint
    && status.service.endpoint !== videoGenerateEndpoint) {
    void loadVideoGenerate(status.service.endpoint);
  }
  $: ensureMediaPolling("video");

  $: if (isSettings && activeSection === "ttsGenerate" && serviceReady && status?.service.endpoint
    && status.service.endpoint !== ttsGenerateEndpoint) {
    void loadTts(status.service.endpoint);
  }

  $: if (isSettings && activeSection === "runtimeEnv" && serviceReady && status?.service.endpoint
    && status.service.endpoint !== runtimeEnvEndpoint) {
    void loadRuntimeEnv(status.service.endpoint);
  }

  async function loadReadiness(endpoint: string): Promise<void> {
    loadedReadinessEndpoint = endpoint;
    try {
      const [profiles, textModel] = await Promise.all([
        loadDesktopBootstrap(endpoint),
        loadDesktopModels(endpoint, "text")
      ]);
      readiness = summarizeDesktopReadiness(profiles, textModel);
    } catch (cause) {
      loadedReadinessEndpoint = "";
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  async function loadModels(endpoint: string): Promise<void> {
    loadedModelsEndpoint = endpoint;
    modelsLoading = true;
    error = "";
    try {
      const [states, routing] = await Promise.all([
        Promise.all(MODEL_ROUTES.map((route) => loadDesktopModels(endpoint, route))),
        loadDesktopModelRouting(endpoint)
      ]);
      const next: Partial<Record<DesktopModelRoute, DesktopModelState>> = {};
      MODEL_ROUTES.forEach((route, index) => (next[route] = states[index]));
      modelStates = next;
      modelRoutingAdvanced = routing;
      modelRoutingPristine = JSON.stringify(routing);
      modelRoutingDirty = false;
    } catch (cause) {
      loadedModelsEndpoint = "";
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      modelsLoading = false;
    }
  }

  async function copyDiagnostics(): Promise<void> {
    const summary = buildDiagnosticsSummary({
      serviceVersion: status?.service.version ?? null,
      ownership: status?.service.ownership ?? null,
      endpoint: status?.service.endpoint ?? null,
      state: status?.service.state ?? "disconnected"
    });
    try {
      await navigator.clipboard.writeText(summary);
      diagnosticsCopied = true;
      window.setTimeout(() => (diagnosticsCopied = false), 1500);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  async function loadWebProfiles(endpoint: string): Promise<void> {
    webProfilesEndpoint = endpoint;
    webProfilesLoading = true;
    error = "";
    try {
      webProfiles = await loadDesktopWebProfiles(endpoint);
    } catch (cause) {
      webProfilesEndpoint = "";
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      webProfilesLoading = false;
    }
  }

  async function loadUsage(endpoint: string): Promise<void> {
    usageEndpoint = endpoint;
    usageLoading = true;
    error = "";
    try {
      usage = await loadDesktopUsage(endpoint);
    } catch (cause) {
      usageEndpoint = "";
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      usageLoading = false;
    }
  }

  async function loadRunHistory(endpoint: string): Promise<void> {
    runHistoryEndpoint = endpoint;
    runHistoryLoading = true;
    error = "";
    try {
      runHistory = await loadDesktopRunHistory(endpoint);
    } catch (cause) {
      runHistoryEndpoint = "";
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      runHistoryLoading = false;
    }
  }

  async function loadTrace(endpoint: string): Promise<void> {
    traceLoading = true;
    error = "";
    try {
      trace = await loadDesktopTrace(endpoint, traceRange);
      traceEndpoint = endpoint;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      traceLoading = false;
    }
  }

  async function changeTraceRange(value: DesktopTraceRange): Promise<void> {
    traceRange = value;
    if (status?.service.endpoint) void loadTrace(status.service.endpoint);
  }

  async function loadSandbox(endpoint: string): Promise<void> {
    sandboxEndpoint = endpoint;
    sandboxLoading = true;
    error = "";
    try {
      sandbox = await loadDesktopSandbox(endpoint);
      sandboxEdit = sandboxSummaryToEditor(sandbox);
      sandboxPristine = JSON.stringify(sandboxEdit);
      sandboxActionMessage = "";
    } catch (cause) {
      sandboxEndpoint = "";
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      sandboxLoading = false;
    }
  }

  function sandboxSummaryToEditor(summary: DesktopSandboxSummary): SandboxEditor {
    return {
      enabled: summary.enabled,
      initFailureMode: summary.initFailureMode,
      envFilePath: summary.envFilePath ?? "",
      preserveExternalEnvFilePath: summary.envFilePathConfiguredExternally,
      envInheritMode: summary.env.inheritMode,
      envAllowText: summary.env.allow.join("\n"),
      envDenyText: summary.env.deny.join("\n"),
      networkAllowText: summary.network.allowedDomains.join("\n"),
      networkDenyText: summary.network.deniedDomains.join("\n"),
      denyReadText: summary.filesystem.denyRead.join("\n"),
      allowWriteText: summary.filesystem.allowWrite.join("\n"),
      denyWriteText: summary.filesystem.denyWrite.join("\n")
    };
  }

  function buildSandboxRequest(draft: SandboxEditor): DesktopSandboxUpdateRequest {
    const request: DesktopSandboxUpdateRequest = {
      enabled: draft.enabled,
      initFailureMode: draft.initFailureMode,
      env: {
        inheritMode: draft.envInheritMode,
        allow: parseDesktopSandboxList(draft.envAllowText),
        deny: parseDesktopSandboxList(draft.envDenyText)
      },
      network: {
        allowedDomains: parseDesktopSandboxList(draft.networkAllowText),
        deniedDomains: parseDesktopSandboxList(draft.networkDenyText)
      },
      filesystem: {
        denyRead: parseDesktopSandboxList(draft.denyReadText),
        allowWrite: parseDesktopSandboxList(draft.allowWriteText),
        denyWrite: parseDesktopSandboxList(draft.denyWriteText)
      }
    };
    if (!draft.preserveExternalEnvFilePath || draft.envFilePath.trim()) request.envFilePath = draft.envFilePath.trim();
    return request;
  }

  function updateSandboxEdit(updater: (draft: SandboxEditor) => SandboxEditor): void {
    if (sandboxEdit) sandboxEdit = updater(sandboxEdit);
  }

  function applySandboxPreset(name: DesktopSandboxPreset): void {
    const preset = applyDesktopSandboxPreset(name);
    if (!preset.env || !preset.network || !preset.filesystem) return;
    sandboxEdit = {
      enabled: preset.enabled ?? true,
      initFailureMode: preset.initFailureMode ?? "warn-disable",
      envFilePath: preset.envFilePath ?? ".env",
      preserveExternalEnvFilePath: false,
      envInheritMode: preset.env.inheritMode ?? "minimal",
      envAllowText: (preset.env.allow ?? []).join("\n"),
      envDenyText: (preset.env.deny ?? []).join("\n"),
      networkAllowText: (preset.network.allowedDomains ?? []).join("\n"),
      networkDenyText: (preset.network.deniedDomains ?? []).join("\n"),
      denyReadText: (preset.filesystem.denyRead ?? []).join("\n"),
      allowWriteText: (preset.filesystem.allowWrite ?? []).join("\n"),
      denyWriteText: (preset.filesystem.denyWrite ?? []).join("\n")
    };
    sandboxActionMessage = "";
  }

  function resetSandboxEditor(): void {
    if (sandbox) sandboxEdit = sandboxSummaryToEditor(sandbox);
    sandboxActionMessage = "";
  }

  // Revert the page-level draft to its pristine loaded snapshot (the "Discard"
  // action on the unsaved-changes save bar).
  function discardSkillsSearch(): void {
    if (skillsSearchPristine) skillsSearchDraft = JSON.parse(skillsSearchPristine);
    skillsActionMessage = "";
  }
  function discardPlugins(): void {
    if (pluginsPristine) pluginsEdit = JSON.parse(pluginsPristine);
    pluginsActionMessage = "";
  }
  function discardModelRouting(): void {
    if (!modelRoutingPristine) return;
    modelRoutingAdvanced = JSON.parse(modelRoutingPristine);
    modelRoutingDirty = false;
  }

  async function saveSandboxPolicy(): Promise<void> {
    const endpoint = status?.service.endpoint;
    if (!endpoint || !sandboxEdit || sandboxSaving) return;
    sandboxSaving = true;
    error = "";
    try {
      sandbox = await saveDesktopSandbox(endpoint, buildSandboxRequest(sandboxEdit));
      sandboxEdit = sandboxSummaryToEditor(sandbox);
      sandboxPristine = JSON.stringify(sandboxEdit);
      sandboxActionMessage = text.sandboxSaved;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      sandboxSaving = false;
    }
  }

  async function refreshSandboxDiagnostics(): Promise<void> {
    const endpoint = status?.service.endpoint;
    if (!endpoint || sandboxDiagnosing) return;
    sandboxDiagnosing = true;
    error = "";
    try {
      const refreshed = await loadDesktopSandbox(endpoint);
      sandbox = sandbox ? { ...sandbox, diagnostics: refreshed.diagnostics } : refreshed;
      sandboxActionMessage = text.sandboxDiagnosticsUpdated;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      sandboxDiagnosing = false;
    }
  }

  async function loadHostBash(endpoint: string): Promise<void> {
    hostBashEndpoint = endpoint;
    hostBashLoading = true;
    error = "";
    try {
      hostBash = await loadDesktopHostBash(endpoint);
    } catch (cause) {
      hostBashEndpoint = "";
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      hostBashLoading = false;
    }
  }

  async function toggleHostBashWhitelist(id: string, enabled: boolean): Promise<void> {
    const endpoint = status?.service.endpoint;
    if (!endpoint || hostBashTogglingId) return;
    hostBashTogglingId = id;
    error = "";
    try {
      hostBash = await toggleDesktopHostBashWhitelist(endpoint, id, enabled);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      hostBashTogglingId = null;
    }
  }

  async function loadTasks(endpoint: string): Promise<void> {
    tasksEndpoint = endpoint;
    tasksLoading = true;
    error = "";
    try {
      tasks = await loadDesktopTasks(endpoint);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      tasksLoading = false;
    }
  }

  function toggleTaskSelection(id: string): void {
    const next = new Set(taskSelected);
    next.has(id) ? next.delete(id) : next.add(id);
    taskSelected = next;
  }

  function beginTaskEdit(item: DesktopTaskSummary["items"][number]): void {
    taskEdit = { ...item, draftText: item.text, draftDelivery: item.delivery || "agent", draftSchedule: item.scheduleText, draftTimezone: item.timezone, draftSessionMode: item.sessionMode || (item.type === "periodic" ? "fresh" : "chat") };
  }

  async function executeTaskAction(action: "trigger" | "delete", ids: string[]): Promise<void> {
    const endpoint = status?.service.endpoint;
    if (!endpoint || taskBusy || ids.length === 0) return;
    if (action === "delete" && !window.confirm(text.tasksDeleteConfirm.replace("{count}", String(ids.length)))) return;
    taskBusy = action;
    error = "";
    try {
      const result = await runDesktopTaskAction(endpoint, { action, ids });
      tasks = result.summary;
      taskSelected = new Set([...taskSelected].filter((id) => !result.affected.includes(id)));
      taskActionMessage = `${action === "trigger" ? text.tasksTriggered : text.tasksDeleted}: ${result.affected.length}${result.failed.length ? ` · ${text.tasksFailed}: ${result.failed.length}` : ""}`;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      taskBusy = "";
    }
  }

  async function openTaskSession(taskId: string, executionId: string): Promise<void> {
    const endpoint = status?.service.endpoint;
    if (!endpoint || taskBusy) return;
    taskBusy = "session";
    error = "";
    try {
      taskSession = await loadDesktopTaskSession(endpoint, taskId, executionId);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      taskBusy = "";
    }
  }

  async function saveTaskEditor(): Promise<void> {
    const endpoint = status?.service.endpoint;
    if (!endpoint || !taskEdit || taskBusy) return;
    taskBusy = "update";
    error = "";
    try {
      const patch: { text: string; delivery: string; sessionMode: string; at?: string; schedule?: string; timezone?: string } = { text: taskEdit.draftText, delivery: taskEdit.draftDelivery, sessionMode: taskEdit.draftSessionMode };
      if (taskEdit.type === "one-shot") patch.at = taskEdit.draftSchedule;
      if (taskEdit.type === "periodic") { patch.schedule = taskEdit.draftSchedule; patch.timezone = taskEdit.draftTimezone; }
      const result = await runDesktopTaskAction(endpoint, { action: "update", id: taskEdit.id, patch });
      tasks = result.summary;
      taskEdit = null;
      taskActionMessage = text.tasksUpdated;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      taskBusy = "";
    }
  }

  async function loadProviders(endpoint: string): Promise<void> {
    providersEndpoint = endpoint;
    providersLoading = true;
    error = "";
    try {
      providers = await loadDesktopProviders(endpoint);
      if (!providerEdit && !providerGlobalsDirty) {
        providerGlobals = {
          providerMode: providers.providerMode,
          piProvider: providers.piProvider,
          piModel: providers.piModel,
          defaultCustomProviderId: providers.defaultCustomProviderId
        };
      }
    } catch (cause) {
      providersEndpoint = "";
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      providersLoading = false;
    }
  }

  function createProviderId(): string {
    return `custom-${Date.now().toString(36)}`;
  }

  function defaultProviderPath(protocol: "openai-compatible" | "anthropic"): string {
    return protocol === "anthropic" ? "/v1/messages" : "/v1/chat/completions";
  }

  function beginNewProvider(): void {
    providerEdit = {
      isNew: true,
      id: createProviderId(),
      name: "",
      enabled: true,
      protocol: "openai-compatible",
      baseUrl: "",
      models: [],
      defaultModel: "",
      path: "/v1/chat/completions",
      supportsThinking: null,
      thinkingFormat: null,
      reasoningEffortMap: {}
    };
    providerEditApiKey = "";
    providerEditClearApiKey = false;
    providerDiscoveredModels = [];
    providerActionMessage = "";
  }

  async function verifyProvider(providerId: string): Promise<void> {
    const endpoint = status?.service.endpoint;
    if (!endpoint || providerTestingId) return;
    providerTestingId = providerId;
    providerActionMessage = "";
    providerActionFailed = false;
    try {
      const result = await testDesktopProvider(endpoint, providerId);
      providerActionFailed = !result.ok;
      providerActionMessage = result.ok
        ? text.onboardingProviderTestOk
        : `${text.onboardingProviderTestFail}: ${result.error || result.message || text.unknownValue}`;
    } catch (cause) {
      providerActionFailed = true;
      providerActionMessage = cause instanceof Error ? cause.message : String(cause);
    } finally {
      providerTestingId = null;
    }
  }

  function beginProviderEdit(providerId: string): void {
    const provider = providers?.customProviders.find((item) => item.id === providerId);
    if (!provider) return;
    providerEdit = { ...providerItemToUpdateRequest(provider), isNew: false };
    providerEditApiKey = "";
    providerEditClearApiKey = false;
    providerDiscoveredModels = [];
    providerActionMessage = "";
  }

  function closeProviderEdit(): void {
    providerEdit = null;
    providerEditApiKey = "";
    providerEditClearApiKey = false;
    providerDiscoveredModels = [];
  }

  function onProviderOverlayKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape" && !providerSaving) closeProviderEdit();
  }

  function updateProviderEdit(updater: (draft: ProviderEditor) => ProviderEditor): void {
    if (!providerEdit) return;
    providerEdit = updater(providerEdit);
  }

  function addProviderModel(modelId = ""): void {
    if (!providerEdit) return;
    const id = modelId.trim();
    if (id && providerEdit.models.some((model) => model.id === id)) return;
    const model: DesktopProviderModel = {
      id,
      tags: ["text"],
      supportedRoles: ["system", "user", "assistant", "tool"],
      enabled: true,
      verification: {}
    };
    updateProviderEdit((draft) => ({ ...draft, models: [...draft.models, model] }));
  }

  function removeProviderModel(index: number): void {
    updateProviderEdit((draft) => {
      const models = draft.models.filter((_, modelIndex) => modelIndex !== index);
      return { ...draft, models, defaultModel: draft.defaultModel === draft.models[index]?.id ? models[0]?.id ?? "" : draft.defaultModel };
    });
  }

  function updateProviderModel(index: number, patch: Partial<DesktopProviderModel>): void {
    updateProviderEdit((draft) => ({
      ...draft,
      models: draft.models.map((model, modelIndex) => modelIndex === index ? { ...model, ...patch } : model)
    }));
  }

  function toggleProviderModelTag(index: number, tag: DesktopProviderModelTag): void {
    if (!providerEdit) return;
    const model = providerEdit.models[index];
    if (!model) return;
    const tags = model.tags.includes(tag) ? model.tags.filter((item) => item !== tag) : [...model.tags, tag];
    updateProviderModel(index, { tags: tags.length > 0 ? tags : ["text"] });
  }

  function toggleProviderModelRole(index: number, role: DesktopProviderModelRole): void {
    if (!providerEdit) return;
    const model = providerEdit.models[index];
    if (!model) return;
    const roles = model.supportedRoles ?? [];
    const next = roles.includes(role) ? roles.filter((item) => item !== role) : [...roles, role];
    updateProviderModel(index, { supportedRoles: next });
  }

  async function saveProviderEdit(): Promise<void> {
    const endpoint = status?.service.endpoint;
    if (!endpoint || !providerEdit || providerSaving) return;
    providerSaving = true;
    providerActionMessage = "";
    providerActionFailed = false;
    try {
      const { isNew, ...draft } = providerEdit;
      if (isNew) {
        const request: DesktopProviderCreateRequest = {
          ...draft,
          apiKey: providerEditApiKey.trim()
        };
        const result = await createDesktopProvider(endpoint, request);
        if (!result.ok) throw new Error(result.error || "Provider save failed");
        closeProviderEdit();
        providersEndpoint = "";
        await loadProviders(endpoint);
      } else {
        providers = await updateDesktopProvider(endpoint, {
          ...draft,
          apiKey: providerEditApiKey.trim() || undefined,
          clearApiKey: providerEditClearApiKey
        });
        providerGlobals = { ...providerGlobals, defaultCustomProviderId: providers.defaultCustomProviderId };
        closeProviderEdit();
      }
      providerActionMessage = text.providerSaved;
    } catch (cause) {
      providerActionFailed = true;
      providerActionMessage = cause instanceof Error ? cause.message : String(cause);
    } finally {
      providerSaving = false;
    }
  }

  async function removeProvider(providerId: string): Promise<void> {
    const endpoint = status?.service.endpoint;
    if (!endpoint || providerSaving || !window.confirm(text.providerDeleteConfirm)) return;
    providerSaving = true;
    try {
      providers = await deleteDesktopProvider(endpoint, providerId);
      providerGlobals = { ...providerGlobals, defaultCustomProviderId: providers.defaultCustomProviderId };
      if (providerEdit?.id === providerId) closeProviderEdit();
      providerActionFailed = false;
      providerActionMessage = text.providerDeleted;
    } catch (cause) {
      providerActionFailed = true;
      providerActionMessage = cause instanceof Error ? cause.message : String(cause);
    } finally {
      providerSaving = false;
    }
  }

  async function saveProviderGlobals(): Promise<void> {
    const endpoint = status?.service.endpoint;
    if (!endpoint || providerSaving) return;
    providerSaving = true;
    try {
      providers = await updateDesktopProviderGlobals(endpoint, providerGlobals);
      providerGlobals = {
        providerMode: providers.providerMode,
        piProvider: providers.piProvider,
        piModel: providers.piModel,
        defaultCustomProviderId: providers.defaultCustomProviderId
      };
      providerGlobalsDirty = false;
      providerActionFailed = false;
      providerActionMessage = text.providerGlobalsSaved;
    } catch (cause) {
      providerActionFailed = true;
      providerActionMessage = cause instanceof Error ? cause.message : String(cause);
    } finally {
      providerSaving = false;
    }
  }

  async function setProviderAsDefault(providerId: string): Promise<void> {
    const endpoint = status?.service.endpoint;
    if (!endpoint || providerSaving) return;
    providerGlobals = { ...providerGlobals, defaultCustomProviderId: providerId };
    await saveProviderGlobals();
  }

  async function discoverProviderModels(): Promise<void> {
    const endpoint = status?.service.endpoint;    if (!endpoint || !providerEdit || providerEdit.isNew || providerDiscovering) return;
    providerDiscovering = true;
    try {
      providerDiscoveredModels = await discoverDesktopProviderModels(endpoint, providerEdit.id);
      providerActionFailed = false;
      providerActionMessage = text.providerModelsDiscovered.replace("{count}", String(providerDiscoveredModels.length));
    } catch (cause) {
      providerActionFailed = true;
      providerActionMessage = cause instanceof Error ? cause.message : String(cause);
    } finally {
      providerDiscovering = false;
    }
  }

  async function verifyProviderModel(index: number): Promise<void> {
    const endpoint = status?.service.endpoint;
    const model = providerEdit?.models[index];
    if (!endpoint || !providerEdit || providerEdit.isNew || !model?.id.trim() || providerTestingId) return;
    providerTestingId = `${providerEdit.id}:${model.id}`;
    try {
      const result = await testDesktopProvider(endpoint, providerEdit.id, model.id);
      if (result.supportedRoles || result.verification) {
        updateProviderModel(index, {
          supportedRoles: result.supportedRoles ?? model.supportedRoles,
          verification: { ...model.verification, ...(result.verification ?? {}) }
        });
      }
      providerActionFailed = !result.ok;
      providerActionMessage = result.ok ? text.onboardingProviderTestOk : `${text.onboardingProviderTestFail}: ${result.error || result.message || text.unknownValue}`;
    } catch (cause) {
      providerActionFailed = true;
      providerActionMessage = cause instanceof Error ? cause.message : String(cause);
    } finally {
      providerTestingId = null;
    }
  }

  async function loadAgents(endpoint: string): Promise<void> {
    agentsEndpoint = endpoint;
    agentsLoading = true;
    error = "";
    try {
      agents = await loadDesktopAgents(endpoint);
    } catch (cause) {
      agentsEndpoint = "";
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      agentsLoading = false;
    }
  }

  function emptyAgentFiles(): Record<string, string> {
    return Object.fromEntries(AGENT_FILE_NAMES.map((name) => [name, ""]));
  }

  function beginNewAgent(): void {
    agentEdit = {
      isNew: true,
      id: `agent-${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10)}`,
      name: "",
      description: "",
      enabled: true,
      sandboxEnabled: null,
      modelRouting: { textModelKey: "", visionModelKey: "", sttModelKey: "" },
      files: emptyAgentFiles()
    };
    agentActionMessage = "";
  }

  async function beginAgentEdit(agentId: string): Promise<void> {
    const endpoint = status?.service.endpoint;
    const agent = agents?.items.find((item) => item.id === agentId);
    if (!endpoint || !agent || agentEditorLoading) return;
    agentEditorLoading = true;
    try {
      agentEdit = {
        isNew: false,
        previousId: agent.id,
        id: agent.id,
        name: agent.name,
        description: agent.description,
        enabled: agent.enabled,
        sandboxEnabled: agent.sandboxEnabled,
        modelRouting: { ...agent.modelRouting },
        files: { ...emptyAgentFiles(), ...(await loadDesktopAgentFiles(endpoint, agent.id)) }
      };
      agentActionMessage = "";
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      agentEditorLoading = false;
    }
  }

  function updateAgentEdit(updater: (draft: NonNullable<typeof agentEdit>) => NonNullable<typeof agentEdit>): void {
    if (agentEdit) agentEdit = updater(agentEdit);
  }

  async function saveAgentEditor(): Promise<void> {
    const endpoint = status?.service.endpoint;
    if (!endpoint || !agentEdit || agentSaving || !agentEdit.id.trim()) return;
    agentSaving = true;
    error = "";
    try {
      agents = await saveDesktopAgent(endpoint, {
        previousId: agentEdit.isNew ? undefined : agentEdit.previousId,
        id: agentEdit.id.trim(),
        name: agentEdit.name,
        description: agentEdit.description,
        enabled: agentEdit.enabled,
        sandboxEnabled: agentEdit.sandboxEnabled,
        modelRouting: agentEdit.modelRouting
      });
      await saveDesktopAgentFiles(endpoint, agentEdit.id.trim(), agentEdit.files);
      agentEdit = null;
      agentActionMessage = text.agentSaved;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      agentSaving = false;
    }
  }

  async function removeAgent(agentId: string): Promise<void> {
    const endpoint = status?.service.endpoint;
    if (!endpoint || agentSaving || !window.confirm(text.agentDeleteConfirm)) return;
    agentSaving = true;
    error = "";
    try {
      agents = await deleteDesktopAgent(endpoint, agentId);
      if (agentEdit?.previousId === agentId) agentEdit = null;
      agentActionMessage = text.agentDeleted;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      agentSaving = false;
    }
  }

  async function loadMcp(endpoint: string): Promise<void> {
    mcpEndpoint = endpoint;
    mcpLoading = true;
    error = "";
    try {
      mcp = await loadDesktopMcp(endpoint);
    } catch (cause) {
      mcpEndpoint = "";
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      mcpLoading = false;
    }
  }

  function beginNewMcp(): void {
    mcpEdit = { isNew: true, id: `mcp-${Math.random().toString(36).slice(2, 10)}`, name: "", enabled: true, transport: "stdio", toolNamePrefix: "", command: "", url: "", argsDraft: "", envDraft: "", headerDraft: "", clearEnvKeys: [], clearHeaderKeys: [] };
    mcpActionMessage = "";
  }

  function beginMcpEdit(server: DesktopMcpSummary["items"][number]): void {
    mcpEdit = { isNew: false, previousId: server.id, id: server.id, name: server.name, enabled: server.enabled, transport: server.transport, toolNamePrefix: server.toolNamePrefix, command: server.command, url: server.url, argsDraft: "", envDraft: "", headerDraft: "", clearEnvKeys: [], clearHeaderKeys: [] };
    mcpActionMessage = "";
  }

  function updateMcpEdit(updater: (draft: McpEditor) => McpEditor): void {
    if (mcpEdit) mcpEdit = updater(mcpEdit);
  }

  function parseReplacementMap(value: string): Record<string, string> | undefined {
    if (!value.trim()) return undefined;
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(text.mcpMapInvalid);
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).map(([key, item]) => [key.trim(), String(item ?? "")]).filter(([key]) => Boolean(key)));
  }

  async function saveMcpEditor(): Promise<void> {
    const endpoint = status?.service.endpoint;
    if (!endpoint || !mcpEdit || mcpSaving) return;
    mcpSaving = true;
    error = "";
    try {
      const args = mcpEdit.argsDraft.trim() ? mcpEdit.argsDraft.split("\n").map((value) => value.trim()).filter(Boolean) : mcpEdit.isNew ? [] : undefined;
      mcp = await saveDesktopMcp(endpoint, {
        previousId: mcpEdit.isNew ? undefined : mcpEdit.previousId,
        id: mcpEdit.id,
        name: mcpEdit.name,
        enabled: mcpEdit.enabled,
        transport: mcpEdit.transport,
        toolNamePrefix: mcpEdit.toolNamePrefix,
        command: mcpEdit.command,
        url: mcpEdit.url,
        args,
        clearArgs: mcpEdit.clearArgs,
        envValues: parseReplacementMap(mcpEdit.envDraft),
        clearEnvKeys: mcpEdit.clearEnvKeys,
        cwdValue: mcpEdit.cwdValue,
        clearCwd: mcpEdit.clearCwd,
        headerValues: parseReplacementMap(mcpEdit.headerDraft),
        clearHeaderKeys: mcpEdit.clearHeaderKeys
      });
      mcpEdit = null;
      mcpActionMessage = text.mcpSaved;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      mcpSaving = false;
    }
  }

  async function removeMcpServer(id: string): Promise<void> {
    const endpoint = status?.service.endpoint;
    if (!endpoint || mcpSaving || !window.confirm(text.mcpDeleteConfirm)) return;
    mcpSaving = true;
    try {
      mcp = await deleteDesktopMcp(endpoint, id);
      if (mcpEdit?.previousId === id) mcpEdit = null;
      mcpActionMessage = text.mcpDeleted;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      mcpSaving = false;
    }
  }

  async function loadSkills(endpoint: string): Promise<void> {
    skillsEndpoint = endpoint;
    skillsLoading = true;
    error = "";
    try {
      skills = await loadDesktopSkills(endpoint);
      skillsSearchDraft = { ...skills.search, providers: skills.search.providers.map((provider) => ({ ...provider, models: [...provider.models] })) };
      skillsSearchPristine = JSON.stringify(skillsSearchDraft);
    } catch (cause) {
      skillsEndpoint = "";
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      skillsLoading = false;
    }
  }

  async function toggleSkill(id: string, enabled: boolean): Promise<void> {
    const endpoint = status?.service.endpoint;
    if (!endpoint || skillSavingId) return;
    skillSavingId = id;
    error = "";
    try {
      skills = await updateDesktopSkills(endpoint, { kind: "skill", id, enabled });
      skillsActionMessage = text.skillsStatusSaved;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      skillSavingId = "";
    }
  }

  async function saveSkillsSearch(): Promise<void> {
    const endpoint = status?.service.endpoint;
    if (!endpoint || !skillsSearchDraft || skillsSaving) return;
    skillsSaving = true;
    error = "";
    try {
      skills = await updateDesktopSkills(endpoint, { kind: "search", localEnabled: skillsSearchDraft.localEnabled, apiEnabled: skillsSearchDraft.apiEnabled, apiProvider: skillsSearchDraft.apiProvider, apiModel: skillsSearchDraft.apiModel, maxTokens: skillsSearchDraft.maxTokens, temperature: skillsSearchDraft.temperature, timeoutMs: skillsSearchDraft.timeoutMs, minConfidence: skillsSearchDraft.minConfidence });
      skillsSearchDraft = { ...skills.search, providers: skills.search.providers.map((provider) => ({ ...provider, models: [...provider.models] })) };
      skillsSearchPristine = JSON.stringify(skillsSearchDraft);
      skillsActionMessage = text.skillsSearchSaved;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      skillsSaving = false;
    }
  }

  async function loadMemory(endpoint: string): Promise<void> {
    memoryEndpoint = endpoint;
    memoryLoading = true;
    error = "";
    try {
      const [summary, records, rejections] = await Promise.all([
        loadDesktopMemory(endpoint),
        runDesktopMemoryAction(endpoint, { action: "list", allScopes: true, limit: 200 }),
        loadDesktopMemoryRejections(endpoint)
      ]);
      memory = summary;
      memoryItems = records.items ?? [];
      memoryRejections = rejections.items;
    } catch (cause) {
      memoryEndpoint = "";
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      memoryLoading = false;
    }
  }

  async function refreshMemoryRecords(): Promise<void> {
    const endpoint = status?.service.endpoint;
    if (!endpoint || memoryBusyAction) return;
    memoryBusyAction = "search";
    error = "";
    try {
      const result = await runDesktopMemoryAction(endpoint, { action: memoryQuery.trim() ? "search" : "list", channel: memoryChannel, userId: memoryUserId, allScopes: memoryAllScopes, query: memoryQuery.trim(), limit: 200 });
      memoryItems = result.items ?? [];
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      memoryBusyAction = "";
    }
  }

  async function runMemoryMaintenance(action: "sync" | "flush" | "compact"): Promise<void> {
    const endpoint = status?.service.endpoint;
    if (!endpoint || memoryBusyAction) return;
    memoryBusyAction = action;
    error = "";
    try {
      const result = await runDesktopMemoryAction(endpoint, { action, channel: memoryChannel, userId: memoryUserId, allScopes: memoryAllScopes });
      memoryActionMessage = `${action}: ${JSON.stringify(result.sync ?? result.result ?? {})}`;
      const refreshed = await runDesktopMemoryAction(endpoint, { action: "list", channel: memoryChannel, userId: memoryUserId, allScopes: memoryAllScopes, limit: 200 });
      memoryItems = refreshed.items ?? [];
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      memoryBusyAction = "";
    }
  }

  async function saveMemoryItem(item: DesktopMemoryItem): Promise<void> {
    const endpoint = status?.service.endpoint;
    if (!endpoint || memoryBusyAction) return;
    memoryBusyAction = item.id;
    try {
      const result = await runDesktopMemoryAction(endpoint, { action: "update", channel: item.channel, userId: item.externalUserId, id: item.id, content: item.content, tags: item.tags, expiresAt: item.expiresAt || null });
      if (result.item) memoryItems = memoryItems.map((candidate) => candidate.id === item.id ? result.item! : candidate);
      memoryEdit = null;
      memoryActionMessage = text.memoryUpdated;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      memoryBusyAction = "";
    }
  }

  function beginMemoryEdit(item: DesktopMemoryItem): void {
    memoryEdit = { ...item, tags: [...item.tags] };
    memoryActionMessage = "";
  }

  async function deleteMemoryItem(item: DesktopMemoryItem): Promise<void> {
    const endpoint = status?.service.endpoint;
    if (!endpoint || memoryBusyAction || !window.confirm(text.memoryDeleteConfirm)) return;
    memoryBusyAction = item.id;
    try {
      await runDesktopMemoryAction(endpoint, { action: "delete", channel: item.channel, userId: item.externalUserId, id: item.id });
      memoryItems = memoryItems.filter((candidate) => candidate.id !== item.id);
      memoryActionMessage = text.memoryDeleted;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      memoryBusyAction = "";
    }
  }

  async function loadChannels(endpoint: string): Promise<void> {
    channelsEndpoint = endpoint;
    channelsLoading = true;
    error = "";
    try {
      channels = await loadDesktopChannels(endpoint);
    } catch (cause) {
      channelsEndpoint = "";
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      channelsLoading = false;
    }
  }

  function beginNewChannel(channel: DesktopExternalChannel): void {
    channelEdit = {
      isNew: true,
      channel,
      id: `${channel}-${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10)}`,
      name: "",
      enabled: true,
      agentId: "",
      sandboxEnabled: null,
      allowedChatIds: [],
      fields: channel === "weixin" ? { baseUrl: "https://ilinkai.weixin.qq.com" } : channel === "telegram" || channel === "feishu" ? { streamOutput: "true" } : {},
      secretValues: {},
      clearSecrets: [],
      files: emptyProfileFiles()
    };
    channelActionMessage = "";
  }

  async function beginChannelEdit(channel: DesktopExternalChannel, instanceId: string): Promise<void> {
    const endpoint = status?.service.endpoint;
    const instance = channels?.groups.find((group) => group.channel === channel)?.instances.find((item) => item.id === instanceId);
    if (!endpoint || !instance || channelEditorLoading) return;
    channelEditorLoading = true;
    try {
      channelEdit = {
        isNew: false,
        channel,
        previousId: instance.id,
        id: instance.id,
        name: instance.name,
        enabled: instance.enabled,
        agentId: instance.agentId,
        sandboxEnabled: instance.sandboxEnabled,
        allowedChatIds: [...instance.allowedChatIds],
        fields: { ...instance.fields },
        secretValues: {},
        clearSecrets: [],
        files: { ...emptyProfileFiles(), ...(await loadDesktopBotFiles(endpoint, channel, instance.id)) }
      };
      channelActionMessage = "";
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      channelEditorLoading = false;
    }
  }

  function updateChannelEdit(updater: (draft: ChannelEditor) => ChannelEditor): void {
    if (channelEdit) channelEdit = updater(channelEdit);
  }

  function toggleChannelSecretClear(key: string): void {
    updateChannelEdit((draft) => ({
      ...draft,
      clearSecrets: draft.clearSecrets?.includes(key)
        ? draft.clearSecrets.filter((item) => item !== key)
        : [...(draft.clearSecrets ?? []), key]
    }));
  }

  async function saveChannelEditor(): Promise<void> {
    const endpoint = status?.service.endpoint;
    if (!endpoint || !channelEdit || channelSaving || !channelEdit.id.trim()) return;
    channelSaving = true;
    error = "";
    try {
      channels = await saveDesktopChannel(endpoint, {
        channel: channelEdit.channel,
        previousId: channelEdit.isNew ? undefined : channelEdit.previousId,
        id: channelEdit.id.trim(),
        name: channelEdit.name,
        enabled: channelEdit.enabled,
        agentId: channelEdit.agentId,
        sandboxEnabled: channelEdit.sandboxEnabled,
        allowedChatIds: channelEdit.allowedChatIds,
        fields: channelEdit.fields,
        secretValues: channelEdit.secretValues,
        clearSecrets: channelEdit.clearSecrets
      });
      await saveDesktopBotFiles(endpoint, channelEdit.channel, channelEdit.id.trim(), channelEdit.files);
      channelEdit = null;
      channelActionMessage = text.channelSaved;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      channelSaving = false;
    }
  }

  async function removeChannelInstance(channel: DesktopExternalChannel, instanceId: string): Promise<void> {
    const endpoint = status?.service.endpoint;
    if (!endpoint || channelSaving || !window.confirm(text.channelDeleteConfirm)) return;
    channelSaving = true;
    try {
      channels = await deleteDesktopChannel(endpoint, channel, instanceId);
      if (channelEdit?.channel === channel && channelEdit.previousId === instanceId) channelEdit = null;
      channelActionMessage = text.channelDeleted;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      channelSaving = false;
    }
  }

  async function testChannelEditor(): Promise<void> {
    const endpoint = status?.service.endpoint;
    if (!endpoint || !channelEdit || channelEdit.channel !== "feishu" || channelTesting) return;
    channelTesting = true;
    try {
      const result = await testDesktopChannel(endpoint, {
        channel: channelEdit.channel,
        instanceId: channelEdit.previousId ?? channelEdit.id,
        fields: channelEdit.fields,
        secretValues: channelEdit.secretValues
      });
      channelActionMessage = result.ok ? `${text.channelTestPassed}${result.label ? ` · ${result.label}` : ""}` : `${text.channelTestFailed}: ${result.error ?? ""}`;
    } catch (cause) {
      channelActionMessage = `${text.channelTestFailed}: ${cause instanceof Error ? cause.message : String(cause)}`;
    } finally {
      channelTesting = false;
    }
  }

  async function generateChannelQr(): Promise<void> {
    const link = channelQrLink.replace(/\s+/g, "").trim();
    channelQrLink = link;
    channelQrImage = "";
    channelQrError = "";
    if (!link) {
      channelQrError = text.channelQrMissing;
      return;
    }
    channelQrLoading = true;
    try {
      qrModulePromise ??= import("qrcode") as Promise<QrModule>;
      const qr = await qrModulePromise;
      channelQrImage = await qr.toDataURL(link, { width: 320, margin: 2, errorCorrectionLevel: "M" });
    } catch (cause) {
      channelQrError = cause instanceof Error ? cause.message : String(cause);
    } finally {
      channelQrLoading = false;
    }
  }

  function clearChannelQr(): void {
    channelQrLink = "";
    channelQrImage = "";
    channelQrError = "";
  }

  async function loadPlugins(endpoint: string): Promise<void> {
    pluginsEndpoint = endpoint;
    pluginsLoading = true;
    error = "";
    try {
      plugins = await loadDesktopPlugins(endpoint);
      pluginsEdit = {
        memoryEnabled: plugins.memory.enabled,
        memoryBackend: plugins.memory.backend,
        values: Object.fromEntries(plugins.featureSettings.map((plugin) => [plugin.pluginKey, Object.fromEntries(plugin.fields.filter((field) => field.type !== "password").map((field) => [field.key, field.value]))])),
        secretValues: {},
        clearSecrets: {}
      };
      pluginsPristine = JSON.stringify(pluginsEdit);
    } catch (cause) {
      pluginsEndpoint = "";
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      pluginsLoading = false;
    }
  }

  function updatePluginValue(pluginKey: string, key: string, value: string | boolean): void {
    if (!pluginsEdit) return;
    pluginsEdit = { ...pluginsEdit, values: { ...pluginsEdit.values, [pluginKey]: { ...(pluginsEdit.values[pluginKey] ?? {}), [key]: value } } };
  }

  function updatePluginSecret(pluginKey: string, key: string, value: string): void {
    if (!pluginsEdit) return;
    pluginsEdit = { ...pluginsEdit, secretValues: { ...pluginsEdit.secretValues, [pluginKey]: { ...(pluginsEdit.secretValues[pluginKey] ?? {}), [key]: value } } };
  }

  function togglePluginSecretClear(pluginKey: string, key: string): void {
    if (!pluginsEdit) return;
    const current = pluginsEdit.clearSecrets[pluginKey] ?? [];
    pluginsEdit = { ...pluginsEdit, clearSecrets: { ...pluginsEdit.clearSecrets, [pluginKey]: current.includes(key) ? current.filter((item) => item !== key) : [...current, key] } };
  }

  async function savePluginsEditor(): Promise<void> {
    const endpoint = status?.service.endpoint;
    if (!endpoint || !pluginsEdit || pluginsSaving) return;
    pluginsSaving = true;
    error = "";
    try {
      plugins = await saveDesktopPlugins(endpoint, pluginsEdit);
      pluginsEdit = {
        memoryEnabled: plugins.memory.enabled,
        memoryBackend: plugins.memory.backend,
        values: Object.fromEntries(plugins.featureSettings.map((plugin) => [plugin.pluginKey, Object.fromEntries(plugin.fields.filter((field) => field.type !== "password").map((field) => [field.key, field.value]))])),
        secretValues: {},
        clearSecrets: {}
      };
      pluginsPristine = JSON.stringify(pluginsEdit);
      pluginsActionMessage = text.pluginsSaved;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      pluginsSaving = false;
    }
  }

  async function loadWebSearch(endpoint: string): Promise<void> {
    webSearchEndpoint = endpoint;
    webSearchLoading = true;
    error = "";
    try {
      webSearch = await loadDesktopWebSearch(endpoint);
      webSearchEdit = {
        enabled: webSearch.enabled,
        defaultRoute: webSearch.defaultRoute,
        defaultEngine: webSearch.defaultEngine,
        engineSelectionStrategy: webSearch.engineSelectionStrategy,
        maxResults: webSearch.maxResults,
        timeoutMs: webSearch.timeoutMs,
        retryTimeoutMs: webSearch.retryTimeoutMs,
        engines: webSearch.engines.map((engine) => ({ ...engine, apiKey: "", clearApiKey: false }))
      };
      toolTestEngine = webSearch.defaultEngine;
    } catch (cause) {
      webSearchEndpoint = "";
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      webSearchLoading = false;
    }
  }

  async function loadImageGenerate(endpoint: string): Promise<void> {
    imageGenerateEndpoint = endpoint;
    imageGenerateLoading = true;
    error = "";
    try {
      [imageGenerate, imageTasks] = await Promise.all([loadDesktopImageGenerate(endpoint), loadDesktopMediaTasks(endpoint, "image").catch(() => [])]);
      imageGenerateEdit = { enabled: imageGenerate.enabled, defaultEngine: imageGenerate.defaultEngine, engines: imageGenerate.engines.map((engine) => ({ ...engine, apiKey: "", clearApiKey: false })) };
    } catch (cause) {
      imageGenerateEndpoint = "";
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      imageGenerateLoading = false;
    }
  }

  async function loadVideoGenerate(endpoint: string): Promise<void> {
    videoGenerateEndpoint = endpoint;
    videoGenerateLoading = true;
    error = "";
    try {
      [videoGenerate, videoTasks] = await Promise.all([loadDesktopVideoGenerate(endpoint), loadDesktopMediaTasks(endpoint, "video").catch(() => [])]);
      videoGenerateEdit = { enabled: videoGenerate.enabled, defaultEngine: videoGenerate.defaultEngine, engines: videoGenerate.engines.map((engine) => ({ ...engine, apiKey: "", clearApiKey: false })) };
    } catch (cause) {
      videoGenerateEndpoint = "";
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      videoGenerateLoading = false;
    }
  }

  async function loadTts(endpoint: string): Promise<void> {
    ttsGenerateEndpoint = endpoint;
    ttsGenerateLoading = true;
    error = "";
    try {
      const [summary, voices] = await Promise.all([loadDesktopTts(endpoint), loadDesktopTtsVoices(endpoint).catch(() => [])]);
      ttsGenerate = summary;
      ttsVoices = voices;
      ttsGenerateEdit = { enabled: summary.enabled, defaultProvider: summary.defaultProvider, providers: summary.providers.map((provider) => ({ ...provider, apiKey: "", clearApiKey: false })) };
      ttsTestProvider = summary.defaultProvider;
    } catch (cause) {
      ttsGenerateEndpoint = "";
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      ttsGenerateLoading = false;
    }
  }

  function markToolSettingsDirty(section: ToolSettingsSection): void {
    toolSettingsDirty = new Set([...toolSettingsDirty, section]);
    toolSettingsMessage = "";
    toolTestResult = null;
    if (section === "ttsGenerate") ttsTestAudioUrl = "";
  }

  function webSearchRequest(): DesktopWebSearchUpdateRequest | null {
    if (!webSearchEdit) return null;
    return { ...webSearchEdit, engines: webSearchEdit.engines.map(({ hasApiKey: _hasApiKey, ...engine }) => engine) };
  }

  function mediaRequest(editor: MediaEditor | null): DesktopMediaGenerateUpdateRequest | null {
    if (!editor) return null;
    return { ...editor, engines: editor.engines.map(({ hasApiKey: _hasApiKey, ...engine }) => engine) };
  }

  function ttsRequest(): DesktopTtsUpdateRequest | null {
    if (!ttsGenerateEdit) return null;
    return { ...ttsGenerateEdit, providers: ttsGenerateEdit.providers.map(({ hasApiKey: _hasApiKey, ...provider }) => provider) };
  }

  async function saveToolSettings(): Promise<void> {
    const endpoint = status?.service.endpoint;
    const section = activeSection as ToolSettingsSection;
    if (!endpoint || !toolSettingsDirty.has(section) || toolSettingsSaving) return;
    toolSettingsSaving = true;
    error = "";
    try {
      if (section === "webSearch") {
        const request = webSearchRequest();
        if (request) { webSearch = await saveDesktopWebSearch(endpoint, request); webSearchEndpoint = ""; await loadWebSearch(endpoint); }
      } else if (section === "imageGenerate") {
        const request = mediaRequest(imageGenerateEdit);
        if (request) { imageGenerate = await saveDesktopImageGenerate(endpoint, request); imageGenerateEndpoint = ""; await loadImageGenerate(endpoint); }
      } else if (section === "videoGenerate") {
        const request = mediaRequest(videoGenerateEdit);
        if (request) { videoGenerate = await saveDesktopVideoGenerate(endpoint, request); videoGenerateEndpoint = ""; await loadVideoGenerate(endpoint); }
      } else {
        const request = ttsRequest();
        if (request) { ttsGenerate = await saveDesktopTts(endpoint, request); ttsGenerateEndpoint = ""; await loadTts(endpoint); }
      }
      toolSettingsDirty = new Set([...toolSettingsDirty].filter((item) => item !== section));
      toolSettingsMessage = text.toolSettingsSaved;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      toolSettingsSaving = false;
    }
  }

  async function testToolSettings(section: ToolSettingsSection): Promise<void> {
    const endpoint = status?.service.endpoint;
    if (!endpoint || toolTestBusy) return;
    toolTestBusy = true;
    toolTestResult = null;
    error = "";
    try {
      if (section === "webSearch") {
        const request = webSearchRequest();
        if (request) toolTestResult = await testDesktopWebSearchSettings(endpoint, request, toolTestQuery, toolTestEngine);
      } else if (section === "imageGenerate") {
        const request = mediaRequest(imageGenerateEdit);
        if (request) toolTestResult = await testDesktopImageGenerateSettings(endpoint, request, imageTestPrompt, request.defaultEngine, imageTestSize);
        imageTasks = await loadDesktopMediaTasks(endpoint, "image").catch(() => imageTasks);
      } else if (section === "videoGenerate") {
        const request = mediaRequest(videoGenerateEdit);
        if (request) toolTestResult = await testDesktopVideoGenerateSettings(endpoint, request, videoTestPrompt, request.defaultEngine);
        videoTasks = await loadDesktopMediaTasks(endpoint, "video").catch(() => videoTasks);
      } else {
        const request = ttsRequest();
        if (request) {
          toolTestResult = await testDesktopTtsSettings(endpoint, request, ttsTestText, ttsTestProvider);
          ttsTestAudioUrl = desktopTtsAudioUrl(endpoint, toolTestResult);
        }
      }
    } catch (cause) {
      toolTestResult = { ok: false, error: cause instanceof Error ? cause.message : String(cause) };
    } finally {
      toolTestBusy = false;
    }
  }

  async function removeMediaTask(kind: DesktopMediaTaskKind, taskId: string): Promise<void> {
    const endpoint = status?.service.endpoint;
    if (!endpoint || mediaTaskBusy) return;
    mediaTaskBusy = taskId;
    error = "";
    try {
      await deleteDesktopMediaTask(endpoint, kind, taskId);
      if (kind === "image") imageTasks = imageTasks.filter((task) => task.id !== taskId);
      else videoTasks = videoTasks.filter((task) => task.id !== taskId);
      if (mediaTaskDetail?.id === taskId) mediaTaskDetail = null;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      mediaTaskBusy = "";
    }
  }

  function mediaTaskList(kind: "image" | "video"): DesktopMediaTask[] {
    return kind === "image" ? imageTasks : videoTasks;
  }

  function refreshMediaTaskDetail(kind: "image" | "video"): void {
    if (!mediaTaskDetail) return;
    const current = mediaTaskList(kind).find((task) => task.id === mediaTaskDetail!.id);
    mediaTaskDetail = current ?? null;
  }

  async function pollMediaTasks(kind: "image" | "video"): Promise<void> {
    const endpoint = status?.service.endpoint;
    if (!endpoint) return;
    try {
      const tasks = await loadDesktopMediaTasks(endpoint, kind);
      if (kind === "image") imageTasks = tasks;
      else videoTasks = tasks;
      refreshMediaTaskDetail(kind);
    } catch {
      // keep last-known list on transient errors
    }
  }

  function ensureMediaPolling(kind: "image" | "video"): void {
    const list = mediaTaskList(kind);
    const hasProcessing = list.some((task) => task.status === "processing");
    if (hasProcessing && !mediaPollTimer) {
      mediaPollTimer = setInterval(() => { void pollMediaTasks(kind); }, 5000);
    } else if (!hasProcessing && mediaPollTimer) {
      clearInterval(mediaPollTimer);
      mediaPollTimer = null;
    }
  }

  function openMediaTaskDetail(task: DesktopMediaTask): void {
    mediaTaskDetail = task;
  }

  function closeMediaTaskDetail(): void {
    mediaTaskDetail = null;
  }

  function onMediaTaskOverlayKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") closeMediaTaskDetail();
  }

  async function loadRuntimeEnv(endpoint: string): Promise<void> {
    runtimeEnvEndpoint = endpoint;
    runtimeEnvLoading = true;
    error = "";
    try {
      runtimeEnv = await loadDesktopRuntimeEnv(endpoint);
    } catch (cause) {
      runtimeEnvEndpoint = "";
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      runtimeEnvLoading = false;
    }
  }

  $: runHistoryCounts = {
    total: runHistory.length,
    success: runHistory.filter((item) => item.reflectionOutcome === "success").length,
    partial: runHistory.filter((item) => item.reflectionOutcome === "partial").length,
    failed: runHistory.filter((item) => item.reflectionOutcome === "failed").length
  };
  $: filteredRunHistory = runHistory.filter((item) => {
    const query = runHistoryQuery.trim().toLocaleLowerCase(locale);
    if (!query) return true;
    return [item.botId, item.chatId, item.stopReason, item.reflectionOutcome, item.reflectionSummary, ...item.toolNames, ...item.failedToolNames]
      .join("\n")
      .toLocaleLowerCase(locale)
      .includes(query);
  });

  async function toggleProfile(profile: DesktopWebProfile): Promise<void> {
    const endpoint = status?.service.endpoint;
    if (!endpoint || patchingProfileId) return;
    patchingProfileId = profile.id;
    error = "";
    try {
      const updated = await patchDesktopWebProfile(endpoint, profile.id, { enabled: !profile.enabled });
      webProfiles = webProfiles.map((item) => (item.id === updated.id ? updated : item));
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      patchingProfileId = null;
    }
  }

  function newProfileId(): string {
    const suffix = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
    return `web-${suffix}`;
  }

  function emptyProfileFiles(): Record<string, string> {
    return Object.fromEntries(PROFILE_FILE_NAMES.map((name) => [name, ""]));
  }

  function beginNewProfile(): void {
    profileEdit = { isNew: true, id: newProfileId(), name: "", enabled: true, agentId: "", files: emptyProfileFiles() };
    profileActionMessage = "";
  }

  async function beginProfileEdit(profile: DesktopWebProfile): Promise<void> {
    const endpoint = status?.service.endpoint;
    if (!endpoint || profileEditorLoading) return;
    profileEditorLoading = true;
    profileActionMessage = "";
    try {
      profileEdit = {
        previousId: profile.id,
        isNew: false,
        id: profile.id,
        name: profile.name,
        enabled: profile.enabled,
        agentId: profile.agentId,
        sandboxEnabled: profile.sandboxEnabled,
        files: { ...emptyProfileFiles(), ...(await loadDesktopProfileFiles(endpoint, profile.id)) }
      };
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      profileEditorLoading = false;
    }
  }

  function updateProfileEdit(updater: (draft: ProfileEditor) => ProfileEditor): void {
    if (profileEdit) profileEdit = updater(profileEdit);
  }

  async function saveProfileEditor(): Promise<void> {
    const endpoint = status?.service.endpoint;
    if (!endpoint || !profileEdit || profileSaving || !profileEdit.id.trim()) return;
    profileSaving = true;
    error = "";
    try {
      const saved = await saveDesktopWebProfile(endpoint, {
        previousId: profileEdit.isNew ? undefined : profileEdit.previousId,
        id: profileEdit.id.trim(),
        name: profileEdit.name.trim(),
        enabled: profileEdit.enabled,
        agentId: profileEdit.agentId,
        sandboxEnabled: profileEdit.sandboxEnabled
      });
      await saveDesktopProfileFiles(endpoint, saved.id, profileEdit.files);
      webProfilesEndpoint = "";
      await loadWebProfiles(endpoint);
      profileEdit = null;
      profileActionMessage = text.profileSaved;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      profileSaving = false;
    }
  }

  async function removeProfile(profileId: string): Promise<void> {
    const endpoint = status?.service.endpoint;
    if (!endpoint || profileSaving || !window.confirm(text.profileDeleteConfirm)) return;
    profileSaving = true;
    error = "";
    try {
      await deleteDesktopWebProfile(endpoint, profileId);
      webProfiles = webProfiles.filter((profile) => profile.id !== profileId);
      if (profileEdit?.previousId === profileId) profileEdit = null;
      profileActionMessage = text.profileDeleted;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      profileSaving = false;
    }
  }

  async function changeModel(route: DesktopModelRoute, event: Event): Promise<void> {
    const endpoint = status?.service.endpoint;
    if (!endpoint || switchingRoute) return;
    switchingRoute = route;
    error = "";
    try {
      modelStates = { ...modelStates, [route]: await switchDesktopModel(endpoint, (event.currentTarget as HTMLSelectElement).value, route) };
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      switchingRoute = null;
    }
  }

  function updateAdvancedModelRouting(updater: (draft: DesktopModelRoutingSettings) => DesktopModelRoutingSettings): void {
    if (!modelRoutingAdvanced) return;
    modelRoutingAdvanced = updater(modelRoutingAdvanced);
    modelRoutingDirty = true;
    modelRoutingMessage = "";
  }

  function textModelContextWindow(): number {
    const fallback = modelRoutingAdvanced?.compaction.defaultContextWindow ?? 0;
    const textState = modelStates.text;
    if (!textState) return fallback;
    const current = textState.options.find((option) => option.key === textState.currentKey);
    return current?.contextWindow ?? fallback;
  }

  function compactionTriggerPreview(): { window: number; trigger: number; reason: string; fromModel: boolean } {
    const window = textModelContextWindow();
    const pct = modelRoutingAdvanced?.compaction.thresholdPercent ?? 75;
    const reserve = modelRoutingAdvanced?.compaction.reserveTokens ?? 8192;
    const pctLimit = Math.floor(window * pct / 100);
    const resLimit = window - reserve;
    const trigger = Math.min(pctLimit, resLimit);
    return {
      window,
      trigger,
      reason: pctLimit <= resLimit ? text.modelCompactionReasonThreshold : text.modelCompactionReasonReserve,
      fromModel: window !== (modelRoutingAdvanced?.compaction.defaultContextWindow ?? 0)
    };
  }

  function timezoneOptions(): string[] {
    try {
      const supported = Intl.supportedValuesOf("timeZone") as string[];
      return [...new Set([...commonTimezones(), ...supported])];
    } catch {
      return commonTimezones();
    }
  }

  function commonTimezones(): string[] {
    return ["UTC", "Asia/Shanghai", "Asia/Hong_Kong", "Asia/Tokyo", "Asia/Singapore", "Europe/London", "Europe/Paris", "America/New_York", "America/Los_Angeles", "America/Chicago"];
  }

  async function saveAdvancedModelRouting(): Promise<void> {
    const endpoint = status?.service.endpoint;
    if (!endpoint || !modelRoutingAdvanced || modelRoutingSaving) return;
    modelRoutingSaving = true;
    modelRoutingMessage = "";
    error = "";
    try {
      const { textOptions: _textOptions, ...request } = modelRoutingAdvanced;
      modelRoutingAdvanced = await saveDesktopModelRouting(endpoint, request satisfies DesktopModelRoutingUpdateRequest);
      modelRoutingPristine = JSON.stringify(modelRoutingAdvanced);
      modelRoutingDirty = false;
      modelRoutingMessage = text.modelRoutingSaved;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      modelRoutingSaving = false;
    }
  }

  $: text = translator(locale);
  $: ownershipText = !status?.service.ownership
    ? text.unavailable
    : status.service.ownership === "managed"
      ? text.managed
      : text.external;
  $: serviceEndpointText = status?.service.endpoint ?? (status ? text.unavailable : text.serviceStarting);

  async function refreshStatus(): Promise<void> {
    error = "";
    if (!runningInTauri) {
      const previewEnabled = import.meta.env.VITE_MOLIBOT_PREVIEW === "1";
      status = {
        service: {
          endpoint: previewEnabled ? `${window.location.origin}/molibot-api` : null,
          ownership: previewEnabled ? "managed" : null,
          state: previewEnabled ? "ready" : "disconnected",
          version: previewEnabled ? "preview" : null
        },
        launchAtLogin: false
      };
      return;
    }
    try {
      status = await invoke<DesktopStatus>("desktop_status");
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  async function setLoginStart(enabled: boolean): Promise<boolean> {
    if (!status) throw new Error("Desktop status is unavailable");
    if (busy) return status.launchAtLogin;
    if (!runningInTauri) {
      status = { ...status, launchAtLogin: enabled };
      return enabled;
    }
    busy = true;
    error = "";
    try {
      const actual = await invoke<boolean>("set_login_start", { enabled });
      status = { ...status, launchAtLogin: actual };
      return actual;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
      throw cause;
    } finally {
      busy = false;
    }
  }

  function toggleLoginStart(): void {
    if (!status || busy) return;
    void setLoginStart(!status.launchAtLogin).catch(() => {});
  }

  function openSettings(section?: string): void {
    if (section) localStorage.setItem("molibot-desktop-settings-section", section);
    if (runningInTauri) {
      void invoke("open_settings");
      return;
    }
    window.location.search = "?window=settings";
  }

  function onThemeStorage(event: StorageEvent): void {
    if (event.key === LOCALE_STORAGE_KEY) {
      locale = normalizeLocale(event.newValue);
      return;
    }
    if (event.key !== THEME_STORAGE_KEY) return;
    theme = normalizeTheme(event.newValue);
    applyTheme(theme);
  }

  onMount(() => {
    applyTheme(theme);
    window.addEventListener("storage", onThemeStorage);
    void refreshStatus();
    const timer = window.setInterval(() => void refreshStatus(), 1000);
    if (isSettings) {
      const pendingSection = localStorage.getItem("molibot-desktop-settings-section");
      if (pendingSection) {
        localStorage.removeItem("molibot-desktop-settings-section");
        activeSection = pendingSection as SettingsSection;
      }
    }
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("storage", onThemeStorage);
    };
  });
</script>

<svelte:head>
  <title>{isSettings ? text.settings : text.appName}</title>
</svelte:head>

{#if isSettings}
  <main class="settings-layout">
    <aside class="settings-sidebar">
      <div class="settings-titlebar-space" aria-hidden="true"></div>
      <div class="settings-search">
        <i class="ph ph-magnifying-glass" aria-hidden="true"></i>
        <input bind:value={settingsFilter} aria-label={text.settingsSearch} placeholder={text.settingsSearch} />
        {#if settingsFilter}
          <button type="button" aria-label={text.clearSettingsSearch} onclick={() => (settingsFilter = "")}><i class="ph-fill ph-x-circle"></i></button>
        {/if}
      </div>
      <nav class="settings-nav-list" aria-label={text.settings}>
        {#each localizedSettingsGroups as group (group.id)}
          <p class="settings-nav-group-label">{group.label}</p>
          {#each group.items as item (item.id)}
            <button class:active={activeSection === item.id} class="settings-nav" type="button" onclick={() => (activeSection = item.id)}>
              <span class="nav-tile" aria-hidden="true"><i class={`ph-fill ph-${item.icon}`}></i></span>
              <span class="nav-label">{item.label}</span>
            </button>
          {/each}
        {:else}
          <p class="settings-search-empty">{text.settingsSearchEmpty}</p>
        {/each}
      </nav>
      <div class="settings-sidebar-footer">
        <div class="brand-mark" aria-hidden="true">M</div>
        <div class="settings-sidebar-footer-copy"><strong>{text.appName}</strong><small>{text.settings}</small></div>
        <span class="status-dot" data-state={status?.service.state ?? "disconnected"} aria-hidden="true"></span>
      </div>
    </aside>
    <section class="settings-content">
      <header class="page-header settings-page-header">
        <h2>{sectionLabel(activeSection, text)}</h2>
      </header>

      <div class="settings-scroll">

      {#if activeSection === "general"}
        <div class="settings-card">
          <div class="settings-row">
            <strong>{text.uiLanguage}</strong>
            <select class="row-select" value={locale} aria-label={text.uiLanguage} onchange={(event) => changeLocale((event.currentTarget as HTMLSelectElement).value)}>
              <option value="zh-CN">简体中文</option>
              <option value="en">English</option>
            </select>
          </div>
          <div class="settings-row">
            <div>
              <strong>{text.launchAtLogin}</strong>
              <p>{text.launchAtLoginDescription}</p>
            </div>
            <button
              class:active={status?.launchAtLogin}
              class="switch"
              type="button"
              role="switch"
              aria-label={text.launchAtLogin}
              aria-checked={status?.launchAtLogin ?? false}
              disabled={!status || busy}
              onclick={toggleLoginStart}
            >
              <span></span>
            </button>
          </div>
        </div>

        <p class="settings-group-title">{text.theme}</p>
        <div class="settings-card appearance-card">
          <div class="appearance-block">
            <p class="appearance-label">{text.theme}</p>
            <div class="theme-grid">
              {#each THEME_PREVIEWS as preview (preview.value)}
                <button
                  type="button"
                  class="theme-swatch"
                  class:active={theme === preview.value}
                  data-theme-preview={preview.value}
                  aria-pressed={theme === preview.value}
                  onclick={() => changeTheme(preview.value)}
                >
                  <span class="theme-preview" aria-hidden="true"><span class="tp-side"></span><span class="tp-body"></span></span>
                  <span class="theme-name">{text[preview.labelKey]}</span>
                </button>
              {/each}
            </div>
          </div>
        </div>

        <p class="settings-group-title">{text.service}</p>
        <div class="settings-card">
          <div class="settings-row service-row">
            <div>
              <strong>{text.service}</strong>
              <p>{serviceEndpointText}</p>
            </div>
            <span class="status-badge" data-state={status?.service.state ?? "disconnected"}>
              {ownershipText}
            </span>
          </div>
        </div>

        {#if serviceReady && readiness}
          <p class="settings-group-title">{text.readiness}</p>
          <div class="settings-card">
            <div class="settings-row">
              <div>
                <strong>{text.readinessModel}</strong>
                {#if !readiness.hasModel}<p>{text.readinessModelMissingHint}</p>{/if}
              </div>
              <span class="status-badge" data-state={readiness.hasModel ? "ready" : "error"}>
                {readiness.hasModel ? readiness.modelLabel || text.readinessReady : text.readinessMissing}
              </span>
            </div>
            <div class="settings-row">
              <div>
                <strong>{text.readinessProfile}</strong>
                {#if !readiness.hasProfile}<p>{text.readinessProfileMissingHint}</p>{/if}
              </div>
              <span class="status-badge" data-state={readiness.hasProfile ? "ready" : "error"}>
                {readiness.hasProfile ? `${readiness.profileCount} ${text.profilesUnit}`.trim() : text.readinessMissing}
              </span>
            </div>
          </div>
        {/if}
      {:else if activeSection === "models"}
        <p class="settings-section-hint">{text.modelsHint}</p>
        {#if !serviceReady}
          <div class="settings-card"><div class="settings-row"><p>{text.modelsUnavailable}</p></div></div>
        {:else}
          <div class="settings-card">
            {#each MODEL_ROUTES as route (route)}
              <div class="settings-row">
                <div>
                  <strong>{routeLabel(route, text)}</strong>
                </div>
                <select
                  value={modelStates[route]?.currentKey ?? ""}
                  disabled={modelsLoading || switchingRoute !== null || !modelStates[route]}
                  onchange={(event) => changeModel(route, event)}
                >
                  {#each modelStates[route]?.options ?? [] as option (option.key)}
                    <option value={option.key}>{option.label}</option>
                  {/each}
                </select>
              </div>
            {/each}
          </div>
          {#if modelRoutingAdvanced}
            <p class="settings-group-title">{text.modelSubagentLevels}</p>
            <div class="settings-card">
              {#each [
                { key: "subagentHaikuModelKey", label: text.modelLevelHaiku },
                { key: "subagentSonnetModelKey", label: text.modelLevelSonnet },
                { key: "subagentOpusModelKey", label: text.modelLevelOpus },
                { key: "subagentThinkingModelKey", label: text.modelLevelThinking }
              ] as level (level.key)}
                <div class="settings-row">
                  <div><strong>{level.label}</strong></div>
                  <select value={modelRoutingAdvanced[level.key as keyof DesktopModelRoutingSettings] as string} onchange={(event) => updateAdvancedModelRouting((draft) => ({ ...draft, [level.key]: event.currentTarget.value }))}>
                    <option value="">{text.modelUseSubagentFallback}</option>
                    {#each modelRoutingAdvanced.textOptions as option (option.key)}<option value={option.key}>{option.label}</option>{/each}
                  </select>
                </div>
              {/each}
            </div>

            <p class="settings-group-title">{text.modelRuntimeDefaults}</p>
            <div class="settings-card">
              <div class="settings-row">
                <div><strong>{text.modelFallbackPolicy}</strong><p>{text.modelFallbackHint}</p></div>
                <select value={modelRoutingAdvanced.modelFallback.mode} onchange={(event) => updateAdvancedModelRouting((draft) => ({ ...draft, modelFallback: { ...draft.modelFallback, mode: event.currentTarget.value as DesktopModelRoutingSettings["modelFallback"]["mode"] } }))}>
                  <option value="off">{text.modelFallbackOff}</option><option value="same-provider">{text.modelFallbackSame}</option><option value="any-enabled">{text.modelFallbackAny}</option>
                </select>
              </div>
              <label class="settings-row"><div><strong>{text.modelFirstTokenTimeout}</strong><p>{text.modelFirstTokenTimeoutHint}</p></div><input class="row-input model-number-input" type="number" min="0" step="1000" value={modelRoutingAdvanced.modelFallback.firstTokenTimeoutMs} oninput={(event) => updateAdvancedModelRouting((draft) => ({ ...draft, modelFallback: { ...draft.modelFallback, firstTokenTimeoutMs: Number(event.currentTarget.value) } }))} /></label>
              <div class="settings-row">
                <div><strong>{text.modelDefaultThinking}</strong></div>
                <select value={modelRoutingAdvanced.defaultThinkingLevel} onchange={(event) => updateAdvancedModelRouting((draft) => ({ ...draft, defaultThinkingLevel: event.currentTarget.value as DesktopModelRoutingSettings["defaultThinkingLevel"] }))}>
                  <option value="off">{text.thinkingOff}</option><option value="low">{text.thinkingLow}</option><option value="medium">{text.thinkingMedium}</option><option value="high">{text.thinkingHigh}</option>
                </select>
              </div>
            </div>

            <p class="settings-group-title">{text.modelCompaction}</p>
            <div class="settings-card provider-editor">
              <div class="settings-row"><div><strong>{text.modelCompactionEnabled}</strong><p>{text.modelCompactionEnabledHint}</p></div><button class:active={modelRoutingAdvanced.compaction.enabled} class="switch" type="button" role="switch" aria-label={text.modelCompactionEnabled} aria-checked={modelRoutingAdvanced.compaction.enabled} onclick={() => updateAdvancedModelRouting((draft) => ({ ...draft, compaction: { ...draft.compaction, enabled: !draft.compaction.enabled } }))}><span></span></button></div>
              <div class="settings-row"><div><strong>{text.modelCompactionModel}</strong></div><select value={modelRoutingAdvanced.compactionModelKey} onchange={(event) => updateAdvancedModelRouting((draft) => ({ ...draft, compactionModelKey: event.currentTarget.value }))}><option value="">{text.modelUseTextRoute}</option>{#each modelRoutingAdvanced.textOptions as option (option.key)}<option value={option.key}>{option.label}</option>{/each}</select></div>
              <div class="settings-form model-routing-number-grid">
                {#each [
                  { key: "defaultContextWindow", label: text.modelDefaultContext, min: 1024, step: 1000 },
                  { key: "thresholdPercent", label: text.modelCompactionThreshold, min: 10, step: 5 },
                  { key: "reserveTokens", label: text.modelReserveTokens, min: 1024, step: 256 },
                  { key: "keepRecentTokens", label: text.modelKeepRecentTokens, min: 2048, step: 512 }
                ] as field (field.key)}
                  <label class="settings-field"><span>{field.label}</span><input type="number" min={field.min} step={field.step} value={modelRoutingAdvanced.compaction[field.key as keyof typeof modelRoutingAdvanced.compaction]} oninput={(event) => updateAdvancedModelRouting((draft) => ({ ...draft, compaction: { ...draft.compaction, [field.key]: Number(event.currentTarget.value) } }))} /></label>
                {/each}
              </div>
              <div class="routing-preview-callout">
                <strong>{text.modelCompactionPreview}</strong> — {text.modelCompactionPreviewWindow} <strong>{(compactionTriggerPreview().window / 1000)}K</strong>，{text.modelCompactionFires} <strong>{(compactionTriggerPreview().trigger / 1000).toFixed(compactionTriggerPreview().trigger % 1000 !== 0 ? 1 : 0)}K</strong>（{compactionTriggerPreview().reason}）
                <span class="routing-preview-note">{compactionTriggerPreview().fromModel ? text.modelCompactionWindowFromMetadata : text.modelCompactionWindowFromDefault}</span>
              </div>
            </div>

            <p class="settings-group-title">{text.modelRuntimeEnvironment}</p>
            <div class="settings-card"><label class="settings-row"><div><strong>{text.modelTimezone}</strong><p>{text.modelTimezoneHint}</p></div><select class="row-input model-timezone-input" value={modelRoutingAdvanced.timezone} onchange={(event) => updateAdvancedModelRouting((draft) => ({ ...draft, timezone: (event.currentTarget as HTMLSelectElement).value }))}>{#if modelRoutingAdvanced.timezone && !timezoneOptions().includes(modelRoutingAdvanced.timezone)}<option value={modelRoutingAdvanced.timezone}>{modelRoutingAdvanced.timezone}</option>{/if}{#each timezoneOptions() as tz (tz)}<option value={tz}>{tz}</option>{/each}</select></label></div>
            {#if modelRoutingMessage}<p class="settings-action-message">{modelRoutingMessage}</p>{/if}
          {/if}
        {/if}
      {:else if activeSection === "providers"}
        <p class="settings-section-hint">{text.providersHint}</p>
        {#if !serviceReady}
          <div class="settings-card"><div class="settings-row"><p>{text.providersUnavailable}</p></div></div>
        {:else if providersLoading || !providers}
          <div class="settings-card"><div class="settings-row"><p>{text.loading}</p></div></div>
        {:else}
          <div class="settings-card">
            <div class="settings-row">
              <div><strong>{text.providersMode}</strong></div>
              <select value={providerGlobals.providerMode} onchange={(event) => { providerGlobals = { ...providerGlobals, providerMode: (event.currentTarget as HTMLSelectElement).value === "custom" ? "custom" : "pi" }; providerGlobalsDirty = true; }}>
                <option value="pi">{text.providersModePi}</option>
                <option value="custom">{text.providersModeCustom}</option>
              </select>
            </div>
          </div>
          <p class="settings-group-title">{text.providerBuiltinTitle}</p>
          <div class="settings-card">
            <label class="settings-row"><strong>{text.providersPiProvider}</strong><select value={providerGlobals.piProvider} onchange={(event) => { const piProvider = (event.currentTarget as HTMLSelectElement).value; const piModel = providers?.builtinProviders.find((provider) => provider.id === piProvider)?.models[0] ?? ""; providerGlobals = { ...providerGlobals, piProvider, piModel }; providerGlobalsDirty = true; }}><option value="">—</option>{#each providers.builtinProviders as provider (provider.id)}<option value={provider.id}>{provider.name}</option>{/each}</select></label>
            <label class="settings-row"><strong>{text.providersPiModel}</strong><select value={providerGlobals.piModel} onchange={(event) => { providerGlobals = { ...providerGlobals, piModel: (event.currentTarget as HTMLSelectElement).value }; providerGlobalsDirty = true; }}><option value="">—</option>{#each providers.builtinProviders.find((provider) => provider.id === providerGlobals.piProvider)?.models ?? [] as model (model)}<option value={model}>{model}</option>{/each}</select></label>
          </div>
          <div class="channel-section-head provider-section-head">
            <div><p class="settings-group-title">{text.providerSelfHostedTitle}</p><p class="settings-section-hint">{text.providerSelfHostedHint}</p></div>
            <button class="secondary-button" type="button" disabled={providerEdit !== null} onclick={beginNewProvider}>{text.providerAdd}</button>
          </div>
          <div class="settings-card">
            <label class="settings-row">
              <strong>{text.providerSetDefault}</strong>
              <select value={providerGlobals.defaultCustomProviderId} onchange={(event) => { providerGlobals = { ...providerGlobals, defaultCustomProviderId: (event.currentTarget as HTMLSelectElement).value }; providerGlobalsDirty = true; }}>
                <option value="">—</option>
                {#each providers.customProviders.filter((provider) => provider.enabled) as provider (provider.id)}
                  <option value={provider.id}>{provider.name}</option>
                {/each}
              </select>
            </label>
          </div>
          {#if providers.customProviders.length === 0}
            <div class="settings-card"><div class="settings-row"><p>{text.providersEmpty}</p></div></div>
          {:else}
            <div class="settings-card">
              {#each providers.customProviders as provider (provider.id)}
                <div class="settings-row">
                  <div class="profile-info">
                    <strong>{provider.name}{provider.isDefault ? ` · ${text.providersDefault}` : ""}</strong>
                    <p>{text.providerProtocol}: {provider.protocol} · {provider.baseUrl}</p>
                    <p>{text.providerModels}: {provider.modelCount}{provider.defaultModel ? ` · ${text.providerDefaultModel}: ${provider.defaultModel}` : ""}</p>
                    <p>{text.providerApiKey}: {provider.hasApiKey ? text.providerApiKeyConfigured : text.providerApiKeyMissing}</p>
                  </div>
                  <div class="settings-row-actions">
                    <span class="status-badge" data-state={provider.enabled ? "ready" : "disconnected"}>{provider.enabled ? text.providerEnabled : text.providerDisabled}</span>
                    <button class="secondary-button" type="button" onclick={() => beginProviderEdit(provider.id)}>{text.providerEdit}</button>
                    <button class="secondary-button" type="button" disabled={provider.isDefault || providerSaving} onclick={() => void setProviderAsDefault(provider.id)}>{text.providersSetDefault}</button>
                    <button class="secondary-button" type="button" disabled={providerTestingId !== null || !provider.hasApiKey} onclick={() => void verifyProvider(provider.id)}>
                      {providerTestingId === provider.id ? text.onboardingProviderTesting : text.onboardingProviderTest}
                    </button>
                    <button class="secondary-button danger-action" type="button" disabled={providerSaving} onclick={() => void removeProvider(provider.id)}>{text.providerDelete}</button>
                  </div>
                </div>
              {/each}
            </div>
          {/if}
          {#if providerEdit}
            <div class="modal-overlay provider-modal-overlay" role="dialog" aria-modal="true" tabindex="-1" aria-label={providerEdit.isNew ? text.providerCreateTitle : text.providerEditTitle} onclick={(event) => { if (event.target === event.currentTarget && !providerSaving) closeProviderEdit(); }} onkeydown={onProviderOverlayKeydown}>
            <form id="desktop-provider-edit-form" class="modal-card provider-modal-card" onsubmit={(event) => { event.preventDefault(); void saveProviderEdit(); }}>
              <header class="modal-head provider-modal-head">
                <div><strong>{providerEdit.isNew ? text.providerCreateTitle : text.providerEditTitle}</strong><p>{text.providerSelfHostedHint}</p></div>
                <button class="modal-close" type="button" aria-label={text.cancel} disabled={providerSaving} onclick={closeProviderEdit}><i class="ph ph-x"></i></button>
              </header>
              <div class="modal-body provider-modal-body">
              <div class="settings-form provider-editor-grid">
                <label class="settings-field"><span>{text.providerId}</span><input value={providerEdit.id} disabled={!providerEdit.isNew} oninput={(event) => updateProviderEdit((draft) => ({ ...draft, id: (event.currentTarget as HTMLInputElement).value }))} /></label>
                <label class="settings-field"><span>{text.onboardingProviderName}</span><input value={providerEdit.name} oninput={(event) => updateProviderEdit((draft) => ({ ...draft, name: (event.currentTarget as HTMLInputElement).value }))} /></label>
                <label class="settings-field"><span>{text.onboardingProviderProtocol}</span><select value={providerEdit.protocol} onchange={(event) => updateProviderEdit((draft) => { const protocol = (event.currentTarget as HTMLSelectElement).value === "anthropic" ? "anthropic" : "openai-compatible"; const oldDefaultPath = defaultProviderPath(draft.protocol); return { ...draft, protocol, path: !draft.path.trim() || draft.path === oldDefaultPath ? defaultProviderPath(protocol) : draft.path }; })}><option value="openai-compatible">{text.protocolOpenaiCompatible}</option><option value="anthropic">{text.protocolAnthropic}</option></select></label>
                <label class="settings-field"><span>{text.onboardingProviderBaseUrl}</span><input value={providerEdit.baseUrl} oninput={(event) => updateProviderEdit((draft) => ({ ...draft, baseUrl: (event.currentTarget as HTMLInputElement).value }))} /></label>
                <label class="settings-field"><span>{text.providerPath}</span><input value={providerEdit.path} oninput={(event) => updateProviderEdit((draft) => ({ ...draft, path: (event.currentTarget as HTMLInputElement).value }))} /></label>
                <label class="settings-field"><span>{providerEdit.isNew ? text.onboardingProviderApiKey : text.providerReplaceApiKey}</span><input type="password" bind:value={providerEditApiKey} autocomplete="new-password" />{#if providerEdit.isNew}<small>{text.providerCreateKeyHint}</small>{/if}</label>
                <label class="settings-field"><span>{text.providerDefaultModel}</span><select value={providerEdit.defaultModel} onchange={(event) => updateProviderEdit((draft) => ({ ...draft, defaultModel: (event.currentTarget as HTMLSelectElement).value }))}><option value="">—</option>{#each providerEdit.models as model, i (`${i}:${model.id}`)}<option value={model.id}>{model.id || text.providerModelId}</option>{/each}</select></label>
                <label class="settings-field"><span>{text.providerThinkingSupport}</span><select value={providerEdit.supportsThinking === null ? "auto" : providerEdit.supportsThinking ? "enabled" : "disabled"} onchange={(event) => { const value = (event.currentTarget as HTMLSelectElement).value; updateProviderEdit((draft) => ({ ...draft, supportsThinking: value === "auto" ? null : value === "enabled" })); }}><option value="auto">{text.providerThinkingAuto}</option><option value="enabled">{text.providerThinkingEnabled}</option><option value="disabled">{text.providerThinkingDisabled}</option></select></label>
                <label class="settings-field"><span>{text.providerThinkingFormat}</span><select value={providerEdit.thinkingFormat ?? ""} onchange={(event) => updateProviderEdit((draft) => ({ ...draft, thinkingFormat: ((event.currentTarget as HTMLSelectElement).value || null) as DesktopProviderUpdateRequest["thinkingFormat"] }))}><option value="">{text.providerThinkingAuto}</option>{#each PROVIDER_THINKING_FORMATS as format (format)}<option value={format}>{format}</option>{/each}</select></label>
              </div>
              <div class="provider-inline-options">
                <div class="inline-switch-row"><span>{text.providerEnabledLabel}</span><button class:active={providerEdit.enabled} class="switch" type="button" role="switch" aria-label={text.providerEnabledLabel} aria-checked={providerEdit.enabled} onclick={() => updateProviderEdit((draft) => ({ ...draft, enabled: !draft.enabled }))}><span></span></button></div>
                {#if !providerEdit.isNew}<label><input type="checkbox" bind:checked={providerEditClearApiKey} /> {text.providerClearApiKey}</label>{/if}
              </div>
              <p class="settings-group-title provider-subtitle">{text.providerReasoningMap}</p>
              <div class="settings-form provider-reasoning-grid">
                <label class="settings-field"><span>{text.providerReasoningLow}</span><input value={providerEdit.reasoningEffortMap.low ?? ""} oninput={(event) => updateProviderEdit((draft) => ({ ...draft, reasoningEffortMap: { ...draft.reasoningEffortMap, low: (event.currentTarget as HTMLInputElement).value } }))} /></label>
                <label class="settings-field"><span>{text.providerReasoningMedium}</span><input value={providerEdit.reasoningEffortMap.medium ?? ""} oninput={(event) => updateProviderEdit((draft) => ({ ...draft, reasoningEffortMap: { ...draft.reasoningEffortMap, medium: (event.currentTarget as HTMLInputElement).value } }))} /></label>
                <label class="settings-field"><span>{text.providerReasoningHigh}</span><input value={providerEdit.reasoningEffortMap.high ?? ""} oninput={(event) => updateProviderEdit((draft) => ({ ...draft, reasoningEffortMap: { ...draft.reasoningEffortMap, high: (event.currentTarget as HTMLInputElement).value } }))} /></label>
              </div>
              <div class="provider-editor-toolbar provider-model-toolbar">
                <div><strong>{text.providerCustomModelsTitle}</strong><p>{text.providerCustomModelsHint}</p></div>
                <div class="settings-row-actions">
                  <button class="secondary-button" type="button" onclick={() => addProviderModel()}>{text.providerAddModel}</button>
                  <button class="secondary-button" type="button" disabled={providerEdit.isNew || providerDiscovering || !providers.customProviders.find((item) => item.id === providerEdit?.id)?.hasApiKey} title={providerEdit.isNew ? text.providerSaveBeforeRemote : undefined} onclick={() => void discoverProviderModels()}>{providerDiscovering ? text.loading : text.providerPullModels}</button>
                </div>
              </div>
              {#if providerDiscoveredModels.length > 0}
                <div class="provider-discovered-models">
                  {#each providerDiscoveredModels as modelId (modelId)}
                    <button type="button" class="model-chip" disabled={providerEdit.models.some((model) => model.id === modelId)} onclick={() => addProviderModel(modelId)}>+ {modelId}</button>
                  {/each}
                </div>
              {/if}
              <div class="provider-model-list">
                {#each providerEdit.models as model, index (`${index}:${model.id}`)}
                  <div class="provider-model-card">
                    <div class="provider-model-head">
                      <input class="row-input" value={model.id} placeholder={text.providerModelId} oninput={(event) => updateProviderModel(index, { id: (event.currentTarget as HTMLInputElement).value })} />
                      <input class="row-input context-input" type="number" min="1" value={model.contextWindow ?? ""} placeholder={text.providerModelContext} oninput={(event) => { const value = Number((event.currentTarget as HTMLInputElement).value); updateProviderModel(index, { contextWindow: Number.isFinite(value) && value > 0 ? value : undefined }); }} />
                      <button class:active={model.enabled} class="switch" type="button" role="switch" aria-label={text.providerModelEnabled} aria-checked={model.enabled} onclick={() => updateProviderModel(index, { enabled: !model.enabled })}><span></span></button>
                    </div>
                    <div class="provider-model-tags">
                      {#each PROVIDER_MODEL_TAGS as tag (tag)}
                        <button type="button" class:active={model.tags.includes(tag)} class="model-chip" onclick={() => toggleProviderModelTag(index, tag)}>{tag}</button>
                      {/each}
                    </div>
                    {#if Object.keys(model.verification ?? {}).length > 0}
                      <div class="provider-model-verify">
                        {#each PROVIDER_MODEL_TAGS as tag (tag)}
                          {#if model.verification?.[tag]}
                            <span class="model-chip verify-{model.verification[tag]}">{tag} · {model.verification[tag] === "passed" ? text.providerModelVerifyPassed : model.verification[tag] === "failed" ? text.providerModelVerifyFailed : text.providerModelVerifyUntested}</span>
                          {/if}
                        {/each}
                      </div>
                    {/if}
                    <div class="provider-model-roles-row">
                      <span class="provider-model-roles-label">{text.providerModelRoles}</span>
                      <div class="provider-model-roles">
                        {#each PROVIDER_MODEL_ROLES as role (role)}
                          <button type="button" class:active={(model.supportedRoles ?? []).includes(role)} class="model-chip" onclick={() => toggleProviderModelRole(index, role)}>{role}</button>
                        {/each}
                      </div>
                    </div>
                    <div class="provider-model-actions">
                      <button class="secondary-button" type="button" disabled={providerEdit.isNew || !model.id.trim() || providerTestingId !== null} title={providerEdit.isNew ? text.providerSaveBeforeRemote : undefined} onclick={() => void verifyProviderModel(index)}>{providerTestingId === `${providerEdit.id}:${model.id}` ? text.onboardingProviderTesting : text.onboardingProviderTest}</button>
                      <button class="secondary-button danger-action" type="button" onclick={() => removeProviderModel(index)}>{text.providerModelRemove}</button>
                    </div>
                  </div>
                {/each}
              </div>
              {#if providerActionMessage}<p class:run-history-failed={providerActionFailed} class="settings-action-message provider-modal-message">{providerActionMessage}</p>{/if}
              </div>
              <footer class="provider-modal-foot">
                <button class="secondary-button" type="button" disabled={providerSaving} onclick={closeProviderEdit}>{text.cancel}</button>
                <button class="primary-button" type="submit" disabled={providerSaving || !providerEdit.id.trim() || !providerEdit.name.trim() || !providerEdit.baseUrl.trim() || (providerEdit.isNew && !providerEditApiKey.trim())}>{providerSaving ? text.onboardingProviderSaving : text.save}</button>
              </footer>
            </form>
            </div>
          {/if}
          {#if providerActionMessage && !providerEdit}
            <p class:run-history-failed={providerActionFailed} class="settings-action-message">{providerActionMessage}</p>
          {/if}
        {/if}
      {:else if activeSection === "agents"}
        <p class="settings-section-hint">{text.agentsHint}</p>
        {#if serviceReady && !agentEdit}<div class="settings-section-actions"><button class="secondary-button" type="button" onclick={beginNewAgent}>{text.agentAdd}</button></div>{/if}
        {#if !serviceReady}
          <div class="settings-card"><div class="settings-row"><p>{text.agentsUnavailable}</p></div></div>
        {:else if agentsLoading || !agents}
          <div class="settings-card"><div class="settings-row"><p>{text.loading}</p></div></div>
        {:else if agents.counts.total === 0}
          <div class="settings-card"><div class="settings-row"><p>{text.agentsEmpty}</p></div></div>
        {:else}
          <div class="settings-card">
            <div class="settings-row"><strong>{text.agentsTotal}</strong><span class="diag-value">{agents.counts.total} · {text.agentsEnabledCount}: {agents.counts.enabled}</span></div>
          </div>
          <div class="settings-card">
            {#each agents.items as agent (agent.id)}
              <div class="settings-row">
                <div class="profile-info">
                  <strong>{agent.name}</strong>
                  {#if agent.description}<p>{agent.description}</p>{/if}
                  <p>{text.agentSandbox}: {agent.sandboxEnabled === null ? text.agentSandboxInherit : agent.sandboxEnabled ? text.yes : text.no} · {text.agentModelOverrides}: {agent.modelOverrides}</p>
                </div>
                <span class="status-badge" data-state={agent.enabled ? "ready" : "disconnected"}>{agent.enabled ? text.providerEnabled : text.providerDisabled}</span>
                <div class="settings-row-actions">
                  <button class="secondary-button" type="button" disabled={agentEditorLoading} onclick={() => void beginAgentEdit(agent.id)}>{text.agentEdit}</button>
                  <button class="secondary-button danger-action" type="button" disabled={agentSaving} onclick={() => void removeAgent(agent.id)}>{text.agentDelete}</button>
                </div>
              </div>
            {/each}
          </div>
        {/if}
        {#if agentEdit}
          <form id="desktop-agent-form" class="settings-card provider-editor" aria-label={sectionLabel("agents", text)} onsubmit={(event) => { event.preventDefault(); void saveAgentEditor(); }}>
            <header class="entity-editor-head"><strong>{sectionLabel("agents", text)}</strong><button class="modal-close" type="button" aria-label={text.cancel} disabled={agentSaving} onclick={() => (agentEdit = null)}><i class="ph ph-x"></i></button></header>
            <div class="settings-form">
              <label class="settings-field"><span>{text.agentId}</span><input value={agentEdit.id} disabled={!agentEdit.isNew} oninput={(event) => updateAgentEdit((draft) => ({ ...draft, id: (event.currentTarget as HTMLInputElement).value }))} /></label>
              <label class="settings-field"><span>{text.agentName}</span><input value={agentEdit.name} oninput={(event) => updateAgentEdit((draft) => ({ ...draft, name: (event.currentTarget as HTMLInputElement).value }))} /></label>
              <label class="settings-field settings-field-wide"><span>{text.agentDescription}</span><textarea rows="3" value={agentEdit.description} oninput={(event) => updateAgentEdit((draft) => ({ ...draft, description: (event.currentTarget as HTMLTextAreaElement).value }))}></textarea></label>
              <label class="settings-field"><span>{text.profileSandbox}</span><select value={agentEdit.sandboxEnabled === null ? "inherit" : agentEdit.sandboxEnabled ? "on" : "off"} onchange={(event) => { const value = (event.currentTarget as HTMLSelectElement).value; updateAgentEdit((draft) => ({ ...draft, sandboxEnabled: value === "inherit" ? null : value === "on" })); }}><option value="inherit">{text.profileSandboxInherit}</option><option value="on">{text.profileSandboxOn}</option><option value="off">{text.profileSandboxOff}</option></select></label>
              {#each [{ key: "textModelKey", route: "text", label: text.agentTextModel }, { key: "visionModelKey", route: "vision", label: text.agentVisionModel }, { key: "sttModelKey", route: "stt", label: text.agentSttModel }] as field (field.key)}
                <label class="settings-field"><span>{field.label}</span><select value={agentEdit.modelRouting[field.key as keyof typeof agentEdit.modelRouting]} onchange={(event) => updateAgentEdit((draft) => ({ ...draft, modelRouting: { ...draft.modelRouting, [field.key]: (event.currentTarget as HTMLSelectElement).value } }))}><option value="">{text.agentFollowGlobal}</option>{#each modelStates[field.route as DesktopModelRoute]?.options ?? [] as option (option.key)}<option value={option.key}>{option.label}</option>{/each}</select></label>
              {/each}
            </div>
            <div class="provider-inline-options"><div class="inline-switch-row"><span>{text.agentEnabled}</span><button class:active={agentEdit.enabled} class="switch" type="button" role="switch" aria-label={text.agentEnabled} aria-checked={agentEdit.enabled} onclick={() => updateAgentEdit((draft) => ({ ...draft, enabled: !draft.enabled }))}><span></span></button></div></div>
            <div class="provider-editor-toolbar"><strong>{text.agentFiles}</strong></div>
            <div class="profile-files-editor">
              {#each AGENT_FILE_NAMES as fileName (fileName)}
                <label class="settings-field"><span>{fileName}</span><textarea rows="7" value={agentEdit.files[fileName] ?? ""} oninput={(event) => updateAgentEdit((draft) => ({ ...draft, files: { ...draft.files, [fileName]: (event.currentTarget as HTMLTextAreaElement).value } }))}></textarea></label>
              {/each}
            </div>
            <footer class="entity-editor-foot"><button class="secondary-button" type="button" disabled={agentSaving} onclick={() => (agentEdit = null)}>{text.cancel}</button><button class="primary-button" type="submit" disabled={agentSaving || !agentEdit.id.trim()}>{agentSaving ? text.onboardingProviderSaving : text.save}</button></footer>
          </form>
        {/if}
        {#if agentActionMessage}<p class="settings-action-message">{agentActionMessage}</p>{/if}
      {:else if activeSection === "mcp"}
        <p class="settings-section-hint">{text.mcpHint}</p>
        {#if !serviceReady}
          <div class="settings-card"><div class="settings-row"><p>{text.mcpUnavailable}</p></div></div>
        {:else if mcpLoading || !mcp}
          <div class="settings-card"><div class="settings-row"><p>{text.loading}</p></div></div>
        {:else}
          <div class="channel-section-head">
            <p class="settings-section-hint">{text.mcpTotal}: {mcp.counts.total} · {text.agentsEnabledCount}: {mcp.counts.enabled} · {text.mcpStdio}: {mcp.counts.stdio} · {text.mcpHttp}: {mcp.counts.http}</p>
            <button class="secondary-button" type="button" disabled={mcpEdit !== null} onclick={beginNewMcp}>{text.mcpAdd}</button>
          </div>
          {#if mcp.counts.total === 0}
            <div class="settings-card"><div class="settings-row"><p>{text.mcpEmpty}</p></div></div>
          {:else}
            <div class="settings-card">
              {#each mcp.items as server (server.id)}
                <div class="settings-row">
                  <div class="profile-info">
                    <strong>{server.name}</strong>
                    {#if server.transport === "stdio"}
                      <p>{text.mcpStdio} · {text.mcpCommand}: {server.command || text.unavailable} · {text.mcpArgs}: {server.argCount} · {text.mcpEnvKeys}: {server.envKeyCount}</p>
                    {:else}
                      <p>{text.mcpHttp} · {text.mcpUrl}: {server.url || text.unavailable} · {text.mcpHeaders}: {server.headerCount}</p>
                    {/if}
                    {#if server.toolNamePrefix}<p>{text.mcpPrefix}: {server.toolNamePrefix}</p>{/if}
                  </div>
                  <div class="settings-row-actions"><span class="status-badge" data-state={server.enabled ? "ready" : "disconnected"}>{server.enabled ? text.providerEnabled : text.providerDisabled}</span><button class="secondary-button" type="button" onclick={() => beginMcpEdit(server)}>{text.channelEdit}</button><button class="secondary-button danger-action" type="button" onclick={() => void removeMcpServer(server.id)}>{text.channelDelete}</button></div>
                </div>
              {/each}
            </div>
          {/if}
          {#if mcpEdit}
            {@const savedMcp = mcp.items.find((item) => item.id === mcpEdit?.previousId)}
            <form id="desktop-mcp-form" class="settings-card provider-editor" aria-label={sectionLabel("mcp", text)} onsubmit={(event) => { event.preventDefault(); void saveMcpEditor(); }}>
              <header class="entity-editor-head"><strong>{sectionLabel("mcp", text)}</strong><button class="modal-close" type="button" aria-label={text.cancel} disabled={mcpSaving} onclick={() => (mcpEdit = null)}><i class="ph ph-x"></i></button></header>
              <div class="settings-form">
                <label class="settings-field"><span>{text.mcpId}</span><input value={mcpEdit.id} disabled={!mcpEdit.isNew} oninput={(event) => updateMcpEdit((draft) => ({ ...draft, id: event.currentTarget.value }))} /></label>
                <label class="settings-field"><span>{text.mcpName}</span><input value={mcpEdit.name} oninput={(event) => updateMcpEdit((draft) => ({ ...draft, name: event.currentTarget.value }))} /></label>
                <label class="settings-field"><span>{text.mcpTransport}</span><select value={mcpEdit.transport} onchange={(event) => updateMcpEdit((draft) => ({ ...draft, transport: event.currentTarget.value as "stdio" | "http" }))}><option value="stdio">stdio</option><option value="http">http</option></select></label>
                <label class="settings-field"><span>{text.mcpPrefix}</span><input value={mcpEdit.toolNamePrefix} oninput={(event) => updateMcpEdit((draft) => ({ ...draft, toolNamePrefix: event.currentTarget.value }))} /></label>
              </div>
              <div class="provider-inline-options"><div class="inline-switch-row"><span>{text.mcpEnabled}</span><button class:active={mcpEdit.enabled} class="switch" type="button" role="switch" aria-label={text.mcpEnabled} aria-checked={mcpEdit.enabled} onclick={() => updateMcpEdit((draft) => ({ ...draft, enabled: !draft.enabled }))}><span></span></button></div></div>
              {#if mcpEdit.transport === "stdio"}
                <div class="settings-form">
                  <label class="settings-field settings-field-wide"><span>{text.mcpCommand}</span><input value={mcpEdit.command} oninput={(event) => updateMcpEdit((draft) => ({ ...draft, command: event.currentTarget.value }))} /></label>
                  <label class="settings-field settings-field-wide"><span>{text.mcpArgsReplace}</span><textarea rows="4" value={mcpEdit.argsDraft} placeholder={savedMcp?.argCount ? text.mcpPreserveConfigured.replace("{count}", String(savedMcp.argCount)) : text.mcpOnePerLine} oninput={(event) => updateMcpEdit((draft) => ({ ...draft, argsDraft: event.currentTarget.value }))}></textarea>{#if savedMcp?.argCount}<label class="inline-check"><input type="checkbox" checked={Boolean(mcpEdit.clearArgs)} onchange={(event) => updateMcpEdit((draft) => ({ ...draft, clearArgs: event.currentTarget.checked }))} /> {text.mcpClearConfigured}</label>{/if}</label>
                  <label class="settings-field settings-field-wide"><span>{text.mcpCwdReplace}</span><input type="password" value={mcpEdit.cwdValue ?? ""} placeholder={savedMcp?.cwdConfigured ? text.channelSecretConfigured : ""} autocomplete="off" oninput={(event) => updateMcpEdit((draft) => ({ ...draft, cwdValue: event.currentTarget.value }))} />{#if savedMcp?.cwdConfigured}<label class="inline-check"><input type="checkbox" checked={Boolean(mcpEdit.clearCwd)} onchange={(event) => updateMcpEdit((draft) => ({ ...draft, clearCwd: event.currentTarget.checked }))} /> {text.mcpClearConfigured}</label>{/if}</label>
                  <label class="settings-field settings-field-wide"><span>{text.mcpEnvReplace}</span><textarea rows="4" value={mcpEdit.envDraft} placeholder={text.mcpMapPlaceholder} oninput={(event) => updateMcpEdit((draft) => ({ ...draft, envDraft: event.currentTarget.value }))}></textarea>{#each savedMcp?.envKeys ?? [] as key (key)}<label class="inline-check"><input type="checkbox" checked={mcpEdit.clearEnvKeys?.includes(key)} onchange={() => updateMcpEdit((draft) => ({ ...draft, clearEnvKeys: draft.clearEnvKeys?.includes(key) ? draft.clearEnvKeys.filter((item) => item !== key) : [...(draft.clearEnvKeys ?? []), key] }))} /> {text.mcpClearKey}: {key}</label>{/each}</label>
                </div>
              {:else}
                <div class="settings-form">
                  <label class="settings-field settings-field-wide"><span>{text.mcpUrl}</span><input value={mcpEdit.url} oninput={(event) => updateMcpEdit((draft) => ({ ...draft, url: event.currentTarget.value }))} /></label>
                  <label class="settings-field settings-field-wide"><span>{text.mcpHeadersReplace}</span><textarea rows="4" value={mcpEdit.headerDraft} placeholder={text.mcpMapPlaceholder} oninput={(event) => updateMcpEdit((draft) => ({ ...draft, headerDraft: event.currentTarget.value }))}></textarea>{#each savedMcp?.headerKeys ?? [] as key (key)}<label class="inline-check"><input type="checkbox" checked={mcpEdit.clearHeaderKeys?.includes(key)} onchange={() => updateMcpEdit((draft) => ({ ...draft, clearHeaderKeys: draft.clearHeaderKeys?.includes(key) ? draft.clearHeaderKeys.filter((item) => item !== key) : [...(draft.clearHeaderKeys ?? []), key] }))} /> {text.mcpClearKey}: {key}</label>{/each}</label>
                </div>
              {/if}
              <footer class="entity-editor-foot"><button class="secondary-button" type="button" disabled={mcpSaving} onclick={() => (mcpEdit = null)}>{text.cancel}</button><button class="primary-button" type="submit" disabled={mcpSaving || !mcpEdit.id.trim() || (mcpEdit.transport === "stdio" ? !mcpEdit.command.trim() : !mcpEdit.url.trim())}>{mcpSaving ? text.onboardingProviderSaving : text.save}</button></footer>
            </form>
          {/if}
          {#if mcpActionMessage}<p class="settings-action-message">{mcpActionMessage}</p>{/if}
        {/if}
      {:else if activeSection === "skills"}
        <p class="settings-section-hint">{text.skillsHint}</p>
        {#if !serviceReady}
          <div class="settings-card"><div class="settings-row"><p>{text.skillsUnavailable}</p></div></div>
        {:else if skillsLoading || !skills}
          <div class="settings-card"><div class="settings-row"><p>{text.loading}</p></div></div>
        {:else}
          <div class="settings-card">
            <div class="settings-row"><strong>{text.skillsTotal}</strong><span class="diag-value">{skills.counts.total} · {text.agentsEnabledCount}: {skills.counts.enabled} · {text.skillScopeGlobal}: {skills.counts.global} · {text.skillScopeBot}: {skills.counts.bot} · {text.skillScopeChat}: {skills.counts.chat}</span></div>
          </div>
          {#if skillsSearchDraft}
            {@const selectedSkillProvider = skillsSearchDraft.providers.find((provider) => provider.id === skillsSearchDraft?.apiProvider)}
            <form id="desktop-skills-search-form" class="settings-card provider-editor" onsubmit={(event) => { event.preventDefault(); void saveSkillsSearch(); }}>
              <div class="provider-editor-toolbar"><strong>{text.skillsSearchConfig}</strong></div>
              <div class="settings-row"><strong>{text.skillSearchLocal}</strong><button class:active={skillsSearchDraft.localEnabled} class="switch" type="button" role="switch" aria-label={text.skillSearchLocal} aria-checked={skillsSearchDraft.localEnabled} onclick={() => (skillsSearchDraft = skillsSearchDraft ? { ...skillsSearchDraft, localEnabled: !skillsSearchDraft.localEnabled } : null)}><span></span></button></div>
              <div class="settings-row"><strong>{text.skillSearchApi}</strong><button class:active={skillsSearchDraft.apiEnabled} class="switch" type="button" role="switch" aria-label={text.skillSearchApi} aria-checked={skillsSearchDraft.apiEnabled} onclick={() => (skillsSearchDraft = skillsSearchDraft ? { ...skillsSearchDraft, apiEnabled: !skillsSearchDraft.apiEnabled } : null)}><span></span></button></div>
              <div class="settings-form">
                <label class="settings-field"><span>{text.skillsSearchProvider}</span><select value={skillsSearchDraft.apiProvider} onchange={(event) => { const provider = skillsSearchDraft?.providers.find((item) => item.id === event.currentTarget.value); if (skillsSearchDraft) skillsSearchDraft = { ...skillsSearchDraft, apiProvider: provider?.id ?? "", apiModel: provider?.models.includes(skillsSearchDraft.apiModel) ? skillsSearchDraft.apiModel : provider?.defaultModel ?? provider?.models[0] ?? "" }; }}><option value="">{text.unavailable}</option>{#each skillsSearchDraft.providers as provider (provider.id)}<option value={provider.id}>{provider.name}</option>{/each}</select></label>
                <label class="settings-field"><span>{text.skillsSearchModel}</span><select value={skillsSearchDraft.apiModel} onchange={(event) => { if (skillsSearchDraft) skillsSearchDraft = { ...skillsSearchDraft, apiModel: event.currentTarget.value }; }}><option value="">{text.unavailable}</option>{#each selectedSkillProvider?.models ?? [] as model (model)}<option value={model}>{model}</option>{/each}</select></label>
                <label class="settings-field"><span>{text.skillsMaxTokens}</span><input type="number" min="128" max="4096" value={skillsSearchDraft.maxTokens} oninput={(event) => { if (skillsSearchDraft) skillsSearchDraft = { ...skillsSearchDraft, maxTokens: Number(event.currentTarget.value) }; }} /></label>
                <label class="settings-field"><span>{text.skillsTemperature}</span><input type="number" min="0" max="1" step="0.1" value={skillsSearchDraft.temperature} oninput={(event) => { if (skillsSearchDraft) skillsSearchDraft = { ...skillsSearchDraft, temperature: Number(event.currentTarget.value) }; }} /></label>
                <label class="settings-field"><span>{text.skillsTimeout}</span><input type="number" min="1000" max="60000" step="500" value={skillsSearchDraft.timeoutMs} oninput={(event) => { if (skillsSearchDraft) skillsSearchDraft = { ...skillsSearchDraft, timeoutMs: Number(event.currentTarget.value) }; }} /></label>
                <label class="settings-field"><span>{text.skillsConfidence}</span><input type="number" min="0" max="1" step="0.05" value={skillsSearchDraft.minConfidence} oninput={(event) => { if (skillsSearchDraft) skillsSearchDraft = { ...skillsSearchDraft, minConfidence: Number(event.currentTarget.value) }; }} /></label>
              </div>
            </form>
          {/if}
          {#if skills.counts.total === 0}
            <div class="settings-card"><div class="settings-row"><p>{text.skillsEmpty}</p></div></div>
          {:else}
            <div class="settings-card">
              {#each skills.items as skill (skill.id)}
                <div class="settings-row">
                  <div class="profile-info">
                    <strong>{skill.name}</strong>
                    {#if skill.description}<p>{skill.description}</p>{/if}
                    <p>{skill.scope === "global" ? text.skillScopeGlobal : skill.scope === "bot" ? text.skillScopeBot : text.skillScopeChat}{skill.botId ? ` · ${skill.botId}` : ""}{skill.chatId ? ` / ${skill.chatId}` : ""}{skill.mcpServerCount > 0 ? ` · ${text.skillMcpServers}: ${skill.mcpServerCount}` : ""}</p>
                  </div>
                  <button class:active={skill.enabled} class="switch" type="button" role="switch" aria-label={skill.name} aria-checked={skill.enabled} disabled={skillSavingId === skill.id} onclick={() => void toggleSkill(skill.id, !skill.enabled)}><span></span></button>
                </div>
              {/each}
            </div>
          {/if}
          {#if skillsActionMessage}<p class="settings-action-message">{skillsActionMessage}</p>{/if}
        {/if}
      {:else if activeSection === "memory"}
        <p class="settings-section-hint">{text.memoryHint}</p>
        {#if !serviceReady}
          <div class="settings-card"><div class="settings-row"><p>{text.memoryUnavailable}</p></div></div>
        {:else if memoryLoading || !memory}
          <div class="settings-card"><div class="settings-row"><p>{text.loading}</p></div></div>
        {:else}
          <div class="settings-card">
            <div class="settings-row"><strong>{text.memoryRuntimeEnabled}</strong><span class="status-badge" data-state={memory.enabled ? "ready" : "disconnected"}>{memory.enabled ? text.yes : text.no}</span></div>
            <div class="settings-row"><strong>{text.memoryConfigEnabled}</strong><span class="status-badge" data-state={memory.configEnabled ? "ready" : "disconnected"}>{memory.configEnabled ? text.yes : text.no}</span></div>
            <div class="settings-row"><strong>{text.memoryBackend}</strong><span class="diag-value">{memory.backend || text.unavailable}</span></div>
          </div>
          <div class="settings-card">
            <div class="settings-row"><strong>{text.memoryCapHybrid}</strong><span class="status-badge" data-state={memory.capabilities.hybridSearch ? "ready" : "disconnected"}>{memory.capabilities.hybridSearch ? text.yes : text.no}</span></div>
            <div class="settings-row"><strong>{text.memoryCapVector}</strong><span class="status-badge" data-state={memory.capabilities.vectorSearch ? "ready" : "disconnected"}>{memory.capabilities.vectorSearch ? text.yes : text.no}</span></div>
            <div class="settings-row"><strong>{text.memoryCapFlush}</strong><span class="status-badge" data-state={memory.capabilities.incrementalFlush ? "ready" : "disconnected"}>{memory.capabilities.incrementalFlush ? text.yes : text.no}</span></div>
            <div class="settings-row"><strong>{text.memoryCapLayered}</strong><span class="status-badge" data-state={memory.capabilities.layeredMemory ? "ready" : "disconnected"}>{memory.capabilities.layeredMemory ? text.yes : text.no}</span></div>
          </div>
          <div class="settings-card provider-editor">
            <div class="provider-editor-toolbar"><strong>{text.memoryOperations}</strong></div>
            <div class="settings-form">
              <label class="settings-field"><span>{text.memoryChannel}</span><input bind:value={memoryChannel} placeholder={text.memoryChannelPlaceholder} /></label>
              <label class="settings-field"><span>{text.memoryUserId}</span><input bind:value={memoryUserId} placeholder={text.memoryUserIdPlaceholder} /></label>
              <label class="settings-field settings-field-wide"><span>{text.memorySearch}</span><input bind:value={memoryQuery} placeholder={text.memorySearchHint} /></label>
            </div>
            <div class="settings-row"><strong>{text.memoryAllScopes}</strong><button class:active={memoryAllScopes} class="switch" type="button" role="switch" aria-label={text.memoryAllScopes} aria-checked={memoryAllScopes} onclick={() => (memoryAllScopes = !memoryAllScopes)}><span></span></button></div>
            <div class="provider-inline-options">
              <button class="secondary-button" type="button" disabled={Boolean(memoryBusyAction)} onclick={() => void refreshMemoryRecords()}>{text.memorySearchButton}</button>
              <button class="secondary-button" type="button" disabled={Boolean(memoryBusyAction)} onclick={() => void runMemoryMaintenance("sync")}>{text.memorySync}</button>
              <button class="secondary-button" type="button" disabled={Boolean(memoryBusyAction)} onclick={() => void runMemoryMaintenance("flush")}>{text.memoryFlush}</button>
              <button class="secondary-button" type="button" disabled={Boolean(memoryBusyAction)} onclick={() => void runMemoryMaintenance("compact")}>{text.memoryCompact}</button>
            </div>
          </div>
          <div class="settings-card provider-editor">
            <div class="provider-editor-toolbar"><strong>{text.memoryRecords} · {memoryItems.length}</strong></div>
            {#if memoryItems.length === 0}
              <div class="settings-row"><p>{text.memoryNoRecords}</p></div>
            {:else}
              {#each memoryItems as item (item.id)}
                <div class="memory-record">
                  <div class="settings-row"><div class="profile-info"><strong>{item.channel}:{item.externalUserId}</strong><p>{item.layer} · {item.updatedAt?.replace("T", " ").slice(0, 19)}{item.hasConflict ? ` · ${text.memoryConflict}` : ""}</p><p class="memory-record-preview">{item.content}</p></div><div class="settings-row-actions"><button class="secondary-button" type="button" disabled={Boolean(memoryBusyAction)} onclick={() => beginMemoryEdit(item)}>{text.channelEdit}</button><button class="secondary-button danger-action" type="button" disabled={Boolean(memoryBusyAction)} onclick={() => void deleteMemoryItem(item)}>{text.channelDelete}</button></div></div>
                </div>
              {/each}
            {/if}
          </div>
          {#if memoryEdit}
            <form id="desktop-memory-form" class="settings-card provider-editor" aria-label={sectionLabel("memory", text)} onsubmit={(event) => { event.preventDefault(); if (memoryEdit) void saveMemoryItem(memoryEdit); }}>
              <header class="entity-editor-head"><div><strong>{sectionLabel("memory", text)}</strong><p>{memoryEdit.channel}:{memoryEdit.externalUserId}</p></div><button class="modal-close" type="button" aria-label={text.cancel} disabled={Boolean(memoryBusyAction)} onclick={() => (memoryEdit = null)}><i class="ph ph-x"></i></button></header>
              <div class="settings-form">
                <label class="settings-field settings-field-wide"><span>{text.memoryContent}</span><textarea rows="8" bind:value={memoryEdit.content}></textarea></label>
                <label class="settings-field"><span>{text.memoryTags}</span><input value={memoryEdit.tags.join(",")} oninput={(event) => { if (memoryEdit) memoryEdit = { ...memoryEdit, tags: event.currentTarget.value.split(",").map((value) => value.trim()).filter(Boolean) }; }} /></label>
                <label class="settings-field"><span>{text.memoryExpires}</span><input bind:value={memoryEdit.expiresAt} /></label>
              </div>
              <footer class="entity-editor-foot"><button class="secondary-button" type="button" disabled={Boolean(memoryBusyAction)} onclick={() => (memoryEdit = null)}>{text.cancel}</button><button class="primary-button" type="submit" disabled={Boolean(memoryBusyAction) || !memoryEdit.content.trim()}>{memoryBusyAction ? text.onboardingProviderSaving : text.save}</button></footer>
            </form>
          {/if}
          <div class="settings-card provider-editor">
            <div class="provider-editor-toolbar"><strong>{text.memoryRejections} · {memoryRejections.length}</strong></div>
            <label class="settings-field settings-field-wide"><span>{text.memoryRejectionSearch}</span><input bind:value={memoryRejectionQuery} /></label>
            {#if filteredMemoryRejections.length === 0}<div class="settings-row"><p>{text.memoryNoRejections}</p></div>{:else}{#each filteredMemoryRejections as item, index (`${item.createdAt}:${index}`)}<div class="memory-record"><div class="settings-row"><div class="profile-info"><strong>{item.action} · {item.channel}:{item.externalUserId}</strong><p>{item.createdAt?.replace("T", " ").slice(0, 19)} · {item.reason}</p></div></div><p class="memory-rejection-content">{item.content || text.unavailable}</p>{#if item.tags.length}<p class="settings-section-hint">{item.tags.join(", ")}</p>{/if}</div>{/each}{/if}
          </div>
          {#if memoryActionMessage}<p class="settings-action-message">{memoryActionMessage}</p>{/if}
        {/if}
      {:else if activeSection === "channels"}
        <p class="settings-section-hint">{text.channelsHint}</p>
        {#if !serviceReady}
          <div class="settings-card"><div class="settings-row"><p>{text.channelsUnavailable}</p></div></div>
        {:else if channelsLoading || !channels}
          <div class="settings-card"><div class="settings-row"><p>{text.loading}</p></div></div>
        {:else}
          <div class="settings-card">
            <div class="settings-row"><strong>{text.channelsTotal}</strong><span class="diag-value">{channels.counts.totalInstances} · {text.agentsEnabledCount}: {channels.counts.enabledInstances}</span></div>
          </div>
          {#each DESKTOP_CHANNELS as channel (channel)}
            {@const group = channels.groups.find((item) => item.channel === channel)}
            <div class="channel-section-head">
              <p class="settings-section-hint">{externalChannelLabel(channel, locale)} · {group?.enabled ?? 0}/{group?.total ?? 0}</p>
              <button class="secondary-button" type="button" disabled={channelEdit !== null} onclick={() => beginNewChannel(channel)}>{text.channelAdd}</button>
            </div>
            {#if !group || group.instances.length === 0}
              <div class="settings-card"><div class="settings-row"><p>{text.channelsEmpty}</p></div></div>
            {:else}
              <div class="settings-card">
                {#each group.instances as inst (inst.id)}
                  <div class="settings-row">
                    <div class="profile-info">
                      <strong>{inst.name}</strong>
                      <p>{inst.agentId ? `${text.channelLinkedAgent}: ${inst.agentId}` : text.noLinkedAgent} · {text.channelAllowedChats}: {inst.allowedChatCount} · {text.channelSandbox}: {inst.sandboxEnabled === null ? text.agentSandboxInherit : inst.sandboxEnabled ? text.yes : text.no}</p>
                    </div>
                    <div class="settings-row-actions">
                      <span class="status-badge" data-state={inst.enabled ? "ready" : "disconnected"}>{inst.enabled ? text.providerEnabled : text.providerDisabled}</span>
                      <button class="secondary-button" type="button" disabled={channelEditorLoading} onclick={() => void beginChannelEdit(channel, inst.id)}>{text.channelEdit}</button>
                      <button class="secondary-button danger-action" type="button" disabled={channelSaving} onclick={() => void removeChannelInstance(channel, inst.id)}>{text.channelDelete}</button>
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          {/each}
          {#if channelEdit}
            {@const savedInstance = channels.groups.find((group) => group.channel === channelEdit?.channel)?.instances.find((instance) => instance.id === channelEdit?.previousId)}
            <form id="desktop-channel-form" class="settings-card provider-editor" aria-label={sectionLabel("channels", text)} onsubmit={(event) => { event.preventDefault(); void saveChannelEditor(); }}>
              <header class="entity-editor-head"><strong>{sectionLabel("channels", text)} · {externalChannelLabel(channelEdit.channel, locale)}</strong><button class="modal-close" type="button" aria-label={text.cancel} disabled={channelSaving} onclick={() => (channelEdit = null)}><i class="ph ph-x"></i></button></header>
              <div class="settings-form">
                <label class="settings-field"><span>{text.channelInstanceId}</span><input value={channelEdit.id} disabled={!channelEdit.isNew} oninput={(event) => updateChannelEdit((draft) => ({ ...draft, id: (event.currentTarget as HTMLInputElement).value }))} /></label>
                <label class="settings-field"><span>{text.channelInstanceName}</span><input value={channelEdit.name} oninput={(event) => updateChannelEdit((draft) => ({ ...draft, name: (event.currentTarget as HTMLInputElement).value }))} /></label>
                <label class="settings-field"><span>{text.channelLinkedAgent}</span><select value={channelEdit.agentId} onchange={(event) => updateChannelEdit((draft) => ({ ...draft, agentId: (event.currentTarget as HTMLSelectElement).value }))}><option value="">{text.profileNoAgent}</option>{#each agents?.items.filter((agent) => agent.enabled) ?? [] as agent (agent.id)}<option value={agent.id}>{agent.name}</option>{/each}</select></label>
                <label class="settings-field"><span>{text.profileSandbox}</span><select value={channelEdit.sandboxEnabled === null ? "inherit" : channelEdit.sandboxEnabled ? "on" : "off"} onchange={(event) => { const value = (event.currentTarget as HTMLSelectElement).value; updateChannelEdit((draft) => ({ ...draft, sandboxEnabled: value === "inherit" ? null : value === "on" })); }}><option value="inherit">{text.profileSandboxInherit}</option><option value="on">{text.profileSandboxOn}</option><option value="off">{text.profileSandboxOff}</option></select></label>
                <label class="settings-field settings-field-wide"><span>{text.channelAllowedChatIds}</span><textarea rows="3" value={channelEdit.allowedChatIds.join("\n")} placeholder={text.channelAllowedChatHint} oninput={(event) => updateChannelEdit((draft) => ({ ...draft, allowedChatIds: (event.currentTarget as HTMLTextAreaElement).value.split(/[\n,]/).map((value) => value.trim()).filter(Boolean) }))}></textarea></label>
              </div>
              <div class="provider-inline-options"><div class="inline-switch-row"><span>{text.channelEnabled}</span><button class:active={channelEdit.enabled} class="switch" type="button" role="switch" aria-label={text.channelEnabled} aria-checked={channelEdit.enabled} onclick={() => updateChannelEdit((draft) => ({ ...draft, enabled: !draft.enabled }))}><span></span></button></div></div>
              <div class="provider-editor-toolbar"><strong>{text.channelCredentials}</strong>{#if channelEdit.channel === "feishu"}<button class="secondary-button" type="button" disabled={channelTesting} onclick={() => void testChannelEditor()}>{channelTesting ? text.loading : text.channelTest}</button>{/if}</div>
              <div class="settings-form">
                {#each CHANNEL_FIELD_CONFIG[channelEdit.channel].visible as key (key)}
                  {#if key === "streamOutput"}
                    <label class="settings-field"><span>{text.channelStreamOutput}</span><select value={channelEdit.fields[key] ?? "true"} onchange={(event) => updateChannelEdit((draft) => ({ ...draft, fields: { ...draft.fields, [key]: (event.currentTarget as HTMLSelectElement).value } }))}><option value="true">{text.yes}</option><option value="false">{text.no}</option></select></label>
                  {:else}
                    <label class="settings-field"><span>{key === "appId" ? text.channelAppId : text.channelBaseUrl}</span><input value={channelEdit.fields[key] ?? ""} oninput={(event) => updateChannelEdit((draft) => ({ ...draft, fields: { ...draft.fields, [key]: (event.currentTarget as HTMLInputElement).value } }))} /></label>
                  {/if}
                {/each}
                {#each CHANNEL_FIELD_CONFIG[channelEdit.channel].secret as key (key)}
                  <label class="settings-field">
                    <span>{key === "token" ? text.channelToken : key === "appSecret" ? text.channelAppSecret : key === "verificationToken" ? text.channelVerificationToken : key === "encryptKey" ? text.channelEncryptKey : text.channelClientSecret}</span>
                    <input type="password" value={channelEdit.secretValues?.[key] ?? ""} placeholder={savedInstance?.configuredSecrets.includes(key) ? text.channelSecretConfigured : ""} autocomplete="new-password" oninput={(event) => updateChannelEdit((draft) => ({ ...draft, secretValues: { ...(draft.secretValues ?? {}), [key]: (event.currentTarget as HTMLInputElement).value } }))} />
                    {#if savedInstance?.configuredSecrets.includes(key)}<label class="inline-check"><input type="checkbox" checked={channelEdit.clearSecrets?.includes(key)} onchange={() => toggleChannelSecretClear(key)} /> {text.channelClearSecret}</label>{/if}
                  </label>
                {/each}
              </div>
              <div class="provider-editor-toolbar"><strong>{text.channelBotFiles}</strong></div>
              <div class="profile-files-editor">
                {#each PROFILE_FILE_NAMES as fileName (fileName)}
                  <label class="settings-field"><span>{fileName}</span><textarea rows="7" value={channelEdit.files[fileName] ?? ""} oninput={(event) => updateChannelEdit((draft) => ({ ...draft, files: { ...draft.files, [fileName]: (event.currentTarget as HTMLTextAreaElement).value } }))}></textarea></label>
                {/each}
              </div>
              {#if channelEdit.channel === "weixin"}
                <div class="provider-editor-toolbar"><strong>{text.channelQrTitle}</strong></div>
                <p class="settings-section-hint">{text.channelQrHint}</p>
                <label class="settings-field settings-field-wide"><span>{text.channelQrLink}</span><textarea rows="3" bind:value={channelQrLink} placeholder={text.channelQrLinkPlaceholder}></textarea></label>
                <div class="settings-row-actions channel-qr-actions">
                  <button class="secondary-button" type="button" disabled={channelQrLoading} onclick={() => void generateChannelQr()}>{channelQrLoading ? text.loading : text.channelQrGenerate}</button>
                  <button class="secondary-button" type="button" onclick={clearChannelQr}>{text.channelQrClear}</button>
                  {#if channelQrLink}<a class="secondary-button" href={channelQrLink} target="_blank" rel="noreferrer">{text.channelQrOpen}</a>{/if}
                </div>
                {#if channelQrImage}<div class="channel-qr-result"><img src={channelQrImage} alt="WeChat login QR code" /><p>{text.channelQrScan}</p></div>{/if}
                {#if channelQrError}<p class="settings-action-message error-text">{channelQrError}</p>{/if}
              {/if}
              <footer class="entity-editor-foot"><button class="secondary-button" type="button" disabled={channelSaving} onclick={() => (channelEdit = null)}>{text.cancel}</button><button class="primary-button" type="submit" disabled={channelSaving || !channelEdit.id.trim()}>{channelSaving ? text.onboardingProviderSaving : text.save}</button></footer>
            </form>
          {/if}
          {#if channelActionMessage}<p class="settings-action-message">{channelActionMessage}</p>{/if}
        {/if}
      {:else if activeSection === "plugins"}
        <p class="settings-section-hint">{text.pluginsHint}</p>
        {#if !serviceReady}
          <div class="settings-card"><div class="settings-row"><p>{text.pluginsUnavailable}</p></div></div>
        {:else if pluginsLoading || !plugins}
          <div class="settings-card"><div class="settings-row"><p>{text.loading}</p></div></div>
        {:else}
          <div class="settings-card">
            <div class="settings-row"><strong>{text.pluginsTotal}</strong><span class="diag-value">{plugins.counts.total} · {text.pluginsActive}: {plugins.counts.active} · {text.pluginsExternal}: {plugins.counts.external}</span></div>
          </div>
          {#if pluginsEdit}
            <form id="desktop-plugins-form" class="settings-card provider-editor" onsubmit={(event) => { event.preventDefault(); void savePluginsEditor(); }}>
              <div class="provider-editor-toolbar"><strong>{text.pluginsMemorySettings}</strong></div>
              <div class="settings-row"><strong>{text.pluginsMemoryEnabled}</strong><button class:active={pluginsEdit.memoryEnabled} class="switch" type="button" role="switch" aria-label={text.pluginsMemoryEnabled} aria-checked={pluginsEdit.memoryEnabled} onclick={() => { if (pluginsEdit) pluginsEdit = { ...pluginsEdit, memoryEnabled: !pluginsEdit.memoryEnabled }; }}><span></span></button></div>
              <div class="settings-form"><label class="settings-field settings-field-wide"><span>{text.memoryBackend}</span><select value={pluginsEdit.memoryBackend} onchange={(event) => { if (pluginsEdit) pluginsEdit = { ...pluginsEdit, memoryBackend: event.currentTarget.value }; }}>{#each plugins.memory.backends as backend (backend.value)}<option value={backend.value}>{backend.label}</option>{/each}</select></label></div>
              {#each plugins.featureSettings as plugin (plugin.pluginKey)}
                <div class="provider-editor-toolbar"><div><strong>{plugin.name}</strong>{#if plugin.description}<p class="settings-section-hint">{plugin.description}</p>{/if}</div></div>
                <div class="settings-form">
                  {#each plugin.fields as field (`${plugin.pluginKey}:${field.key}`)}
                    {#if field.type === "boolean"}
                      <div class="settings-row settings-field-wide"><div><strong>{field.label}</strong>{#if field.description}<p>{field.description}</p>{/if}</div><button class:active={Boolean(pluginsEdit.values[plugin.pluginKey]?.[field.key])} class="switch" type="button" role="switch" aria-label={field.label} aria-checked={Boolean(pluginsEdit.values[plugin.pluginKey]?.[field.key])} onclick={() => updatePluginValue(plugin.pluginKey, field.key, !Boolean(pluginsEdit?.values[plugin.pluginKey]?.[field.key]))}><span></span></button></div>
                    {:else if field.type === "select"}
                      <label class="settings-field"><span>{field.label}{field.required ? " *" : ""}</span><select value={String(pluginsEdit.values[plugin.pluginKey]?.[field.key] ?? field.value)} onchange={(event) => updatePluginValue(plugin.pluginKey, field.key, event.currentTarget.value)}>{#each field.options as option (option.value)}<option value={option.value}>{option.label}</option>{/each}</select>{#if field.description}<small>{field.description}</small>{/if}</label>
                    {:else if field.type === "password"}
                      <label class="settings-field"><span>{field.label}{field.required ? " *" : ""}</span><input type="password" value={pluginsEdit.secretValues[plugin.pluginKey]?.[field.key] ?? ""} placeholder={field.configured ? text.channelSecretConfigured : field.placeholder} autocomplete="new-password" oninput={(event) => updatePluginSecret(plugin.pluginKey, field.key, event.currentTarget.value)} />{#if field.configured}<label class="inline-check"><input type="checkbox" checked={pluginsEdit.clearSecrets[plugin.pluginKey]?.includes(field.key)} onchange={() => togglePluginSecretClear(plugin.pluginKey, field.key)} /> {text.channelClearSecret}</label>{/if}{#if field.description}<small>{field.description}</small>{/if}</label>
                    {:else}
                      <label class="settings-field"><span>{field.label}{field.required ? " *" : ""}</span><input value={String(pluginsEdit.values[plugin.pluginKey]?.[field.key] ?? field.value)} placeholder={field.placeholder} oninput={(event) => updatePluginValue(plugin.pluginKey, field.key, event.currentTarget.value)} />{#if field.description}<small>{field.description}</small>{/if}</label>
                    {/if}
                  {/each}
                </div>
              {/each}
            </form>
          {/if}
          {#if plugins.items.length === 0}
            <div class="settings-card"><div class="settings-row"><p>{text.pluginsEmpty}</p></div></div>
          {:else}
            <div class="settings-card">
              {#each plugins.items as item (`${item.kind}:${item.key}`)}
                <div class="settings-row">
                  <div class="profile-info"><strong>{item.name}{item.version ? ` · ${item.version}` : ""}</strong><p>{item.kind === "channel" ? text.pluginKindChannel : item.kind === "provider" ? text.pluginKindProvider : item.kind === "memory-backend" ? text.pluginKindMemoryBackend : text.pluginKindFeature} · {item.source === "external" ? text.pluginsExternal : text.pluginsBuiltIn}{item.description ? ` · ${item.description}` : ""}{item.error ? ` · ${item.error}` : ""}</p></div>
                  <span class="status-badge" data-state={item.status === "active" ? "ready" : item.status === "error" ? "error" : "disconnected"}>{item.status === "active" ? text.pluginStatusActive : item.status === "error" ? text.pluginStatusError : text.pluginStatusDiscovered}</span>
                </div>
              {/each}
            </div>
          {/if}
          {#if pluginsActionMessage}<p class="settings-action-message">{pluginsActionMessage}</p>{/if}
        {/if}
      {:else if activeSection === "webSearch"}
        <p class="settings-section-hint">{text.webSearchHint}</p>
        {#if !serviceReady}
          <div class="settings-card"><div class="settings-row"><p>{text.webSearchUnavailable}</p></div></div>
        {:else if webSearchLoading || !webSearchEdit}
          <div class="settings-card"><div class="settings-row"><p>{text.loading}</p></div></div>
        {:else}
          <div class="settings-card">
            <div class="settings-row"><div><strong>{text.webSearchEnabled}</strong></div><button class:active={webSearchEdit.enabled} class="switch" type="button" role="switch" aria-checked={webSearchEdit.enabled} aria-label={text.webSearchEnabled} onclick={() => { if (webSearchEdit) webSearchEdit = { ...webSearchEdit, enabled: !webSearchEdit.enabled }; markToolSettingsDirty("webSearch"); }}><span></span></button></div>
            <div class="settings-row"><strong>{text.webSearchDefaultRoute}</strong><select bind:value={webSearchEdit.defaultRoute} onchange={() => markToolSettingsDirty("webSearch")}><option value="auto">{text.searchRouteAuto}</option><option value="china">{text.searchRouteChina}</option><option value="global">{text.searchRouteGlobal}</option><option value="official_docs">{text.searchRouteOfficialDocs}</option><option value="research">{text.searchRouteResearch}</option></select></div>
            <div class="settings-row"><strong>{text.webSearchDefaultEngine}</strong><select bind:value={webSearchEdit.defaultEngine} onchange={() => markToolSettingsDirty("webSearch")}><option value="auto">{text.searchEngineAuto}</option>{#each webSearchEdit.engines as engine (engine.id)}<option value={engine.id}>{webSearchEngineLabel(engine.id, text)}</option>{/each}</select></div>
            <div class="settings-row"><strong>{text.webSearchStrategy}</strong><select bind:value={webSearchEdit.engineSelectionStrategy} onchange={() => markToolSettingsDirty("webSearch")}><option value="priority">{text.searchStrategyPriority}</option><option value="random">{text.searchStrategyRandom}</option><option value="round_robin">{text.searchStrategyRoundRobin}</option></select></div>
          </div>
          <p class="settings-group-title">{text.toolLimits}</p>
          <div class="settings-card"><label class="settings-row"><strong>{text.webSearchMaxResults}</strong><input class="row-input model-number-input" type="number" min="1" max="20" bind:value={webSearchEdit.maxResults} oninput={() => markToolSettingsDirty("webSearch")} /></label><label class="settings-row"><strong>{text.toolTimeout}</strong><input class="row-input model-number-input" type="number" min="1000" max="120000" bind:value={webSearchEdit.timeoutMs} oninput={() => markToolSettingsDirty("webSearch")} /></label><label class="settings-row"><strong>{text.toolRetryTimeout}</strong><input class="row-input model-number-input" type="number" min="1000" max="180000" bind:value={webSearchEdit.retryTimeoutMs} oninput={() => markToolSettingsDirty("webSearch")} /></label></div>
          <p class="settings-group-title">{text.webSearchEngines}</p>
          <div class="settings-card tool-engine-list">{#each webSearchEdit.engines as engine (engine.id)}<details class="tool-engine-card"><summary><span>{webSearchEngineLabel(engine.id, text)}</span><span class="status-badge" data-state={engine.enabled ? "ready" : "disconnected"}>{engine.enabled ? text.providerEnabled : text.providerDisabled}</span></summary><div class="tool-engine-body"><div class="settings-row"><strong>{text.providerEnabledLabel}</strong><button class:active={engine.enabled} class="switch" type="button" role="switch" aria-checked={engine.enabled} aria-label={webSearchEngineLabel(engine.id, text)} onclick={() => { if (webSearchEdit) webSearchEdit = { ...webSearchEdit, engines: webSearchEdit.engines.map((item) => item.id === engine.id ? { ...item, enabled: !item.enabled } : item) }; markToolSettingsDirty("webSearch"); }}><span></span></button></div><div class="settings-form"><label class="settings-field settings-field-wide"><span>{text.toolBaseUrl}</span><input bind:value={engine.baseUrl} oninput={() => markToolSettingsDirty("webSearch")} /></label><label class="settings-field settings-field-wide"><span>{text.webSearchApiKey}</span><div class="secret-input"><input type={secretRevealed(`webSearch:${engine.id}`) ? "text" : "password"} bind:value={engine.apiKey} placeholder={engine.hasApiKey ? text.channelSecretConfigured : ""} autocomplete="new-password" oninput={() => markToolSettingsDirty("webSearch")} /><button class="secret-reveal" type="button" aria-label={text.toggleReveal} onclick={(event) => { event.preventDefault(); toggleRevealSecret(`webSearch:${engine.id}`); }}><i class={`ph ${secretRevealed(`webSearch:${engine.id}`) ? "ph-eye-slash" : "ph-eye"}`}></i></button></div>{#if engine.hasApiKey}<label class="inline-check"><input type="checkbox" bind:checked={engine.clearApiKey} onchange={() => markToolSettingsDirty("webSearch")} /> {text.channelClearSecret}</label>{/if}</label></div></div></details>{/each}</div>
          <p class="settings-group-title">{text.toolTest}</p><div class="settings-card tool-test-card"><div class="settings-form"><label class="settings-field"><span>{text.webSearchDefaultEngine}</span><select bind:value={toolTestEngine}><option value="auto">{text.searchEngineAuto}</option>{#each webSearchEdit.engines as engine (engine.id)}<option value={engine.id}>{webSearchEngineLabel(engine.id, text)}</option>{/each}</select></label><label class="settings-field"><span>{text.toolTestQuery}</span><input bind:value={toolTestQuery} /></label></div><div class="settings-row-actions tool-test-actions"><button class="secondary-button" type="button" disabled={toolTestBusy} onclick={() => void testToolSettings("webSearch")}>{toolTestBusy ? text.loading : text.toolTest}</button></div>{#if toolTestResult}<pre class:run-history-failed={!toolTestResult.ok} class="tool-test-result">{JSON.stringify(toolTestResult.result ?? toolTestResult.error, null, 2)}</pre>{/if}</div>
        {/if}
      {:else if activeSection === "imageGenerate"}
        <p class="settings-section-hint">{text.imageGenerateHint}</p>
        {#if !serviceReady}
          <div class="settings-card"><div class="settings-row"><p>{text.imageGenerateUnavailable}</p></div></div>
        {:else if imageGenerateLoading || !imageGenerateEdit}
          <div class="settings-card"><div class="settings-row"><p>{text.loading}</p></div></div>
        {:else}
          <div class="settings-card"><div class="settings-row"><strong>{text.webSearchEnabled}</strong><button class:active={imageGenerateEdit.enabled} class="switch" type="button" role="switch" aria-checked={imageGenerateEdit.enabled} aria-label={text.imageGenerate} onclick={() => { if (imageGenerateEdit) imageGenerateEdit = { ...imageGenerateEdit, enabled: !imageGenerateEdit.enabled }; markToolSettingsDirty("imageGenerate"); }}><span></span></button></div><div class="settings-row"><strong>{text.webSearchDefaultEngine}</strong><select bind:value={imageGenerateEdit.defaultEngine} onchange={() => markToolSettingsDirty("imageGenerate")}><option value="auto">{text.mediaEngineAuto}</option>{#each imageGenerateEdit.engines as engine (engine.id)}<option value={engine.id}>{mediaEngineLabel("image", engine.id)}</option>{/each}</select></div></div>
          <p class="settings-group-title">{text.mediaEngines}</p><div class="settings-card tool-engine-list">{#each imageGenerateEdit.engines as engine (engine.id)}<details class="tool-engine-card"><summary><span>{mediaEngineLabel("image", engine.id)}</span><span class="status-badge" data-state={engine.enabled ? "ready" : "disconnected"}>{engine.enabled ? text.providerEnabled : text.providerDisabled}</span></summary><div class="tool-engine-body"><div class="settings-row"><strong>{text.providerEnabledLabel}</strong><button class:active={engine.enabled} class="switch" type="button" role="switch" aria-checked={engine.enabled} aria-label={mediaEngineLabel("image", engine.id)} onclick={() => { if (imageGenerateEdit) imageGenerateEdit = { ...imageGenerateEdit, engines: imageGenerateEdit.engines.map((item) => item.id === engine.id ? { ...item, enabled: !item.enabled } : item) }; markToolSettingsDirty("imageGenerate"); }}><span></span></button></div><div class="settings-form"><label class="settings-field"><span>{text.toolBaseUrl}</span><input bind:value={engine.baseUrl} oninput={() => markToolSettingsDirty("imageGenerate")} /></label><label class="settings-field"><span>{text.toolModel}</span><input bind:value={engine.model} oninput={() => markToolSettingsDirty("imageGenerate")} /></label><label class="settings-field settings-field-wide"><span>{text.webSearchApiKey}</span><div class="secret-input"><input type={secretRevealed(`image:${engine.id}`) ? "text" : "password"} bind:value={engine.apiKey} placeholder={engine.hasApiKey ? text.channelSecretConfigured : ""} autocomplete="new-password" oninput={() => markToolSettingsDirty("imageGenerate")} /><button class="secret-reveal" type="button" aria-label={text.toggleReveal} onclick={(event) => { event.preventDefault(); toggleRevealSecret(`image:${engine.id}`); }}><i class={`ph ${secretRevealed(`image:${engine.id}`) ? "ph-eye-slash" : "ph-eye"}`}></i></button></div>{#if engine.hasApiKey}<label class="inline-check"><input type="checkbox" bind:checked={engine.clearApiKey} onchange={() => markToolSettingsDirty("imageGenerate")} /> {text.channelClearSecret}</label>{/if}</label></div></div></details>{/each}</div>
          <p class="settings-group-title">{text.toolTest}</p><div class="settings-card tool-test-card"><div class="settings-form"><label class="settings-field settings-field-wide"><span>{text.toolPrompt}</span><input bind:value={imageTestPrompt} /></label><label class="settings-field"><span>{text.toolImageSize}</span><select bind:value={imageTestSize}><option value="1024x1024">1024 × 1024</option><option value="1536x1024">1536 × 1024</option><option value="1024x1536">1024 × 1536</option></select></label></div><div class="settings-row-actions tool-test-actions"><button class="secondary-button" type="button" disabled={toolTestBusy} onclick={() => void testToolSettings("imageGenerate")}>{toolTestBusy ? text.loading : text.toolTest}</button></div>{#if toolTestResult}<pre class:run-history-failed={!toolTestResult.ok} class="tool-test-result">{JSON.stringify(toolTestResult.result ?? toolTestResult.error, null, 2)}</pre>{/if}</div>
          <p class="settings-group-title">{text.mediaTasks}</p>{#if imageTasks.length === 0}<div class="settings-card"><div class="settings-row"><p>{text.mediaTasksEmpty}</p></div></div>{:else}<div class="settings-card">{#each imageTasks as task (task.id)}<div class="settings-row media-task-row"><div class="profile-info"><strong>{mediaEngineLabel("image", task.engine)} · {task.status === "completed" ? text.mediaTaskCompleted : task.status === "failed" ? text.mediaTaskFailed : text.mediaTaskProcessing}</strong><p>{task.prompt}</p><p>{task.createdAt.slice(0, 19).replace("T", " ")}</p>{#if task.errorMessage}<p class="run-history-failed">{task.errorMessage}</p>{/if}</div><div class="settings-row-actions">{#if task.resultUrl}<a class="secondary-button" href={task.resultUrl} target="_blank" rel="noreferrer">{text.mediaTaskResult}</a>{/if}<button class="secondary-button" type="button" onclick={() => openMediaTaskDetail(task)}>{text.mediaTaskView}</button><button class="secondary-button danger-action" type="button" disabled={mediaTaskBusy === task.id} onclick={() => void removeMediaTask("image", task.id)}>{text.mediaTaskDelete}</button></div></div>{/each}</div>{/if}
          {#if mediaTaskDetail && mediaTaskDetail.kind === "image"}
            <div class="modal-overlay" role="dialog" aria-modal="true" tabindex="-1" aria-label={text.mediaTaskDetail} onclick={() => closeMediaTaskDetail()} onkeydown={onMediaTaskOverlayKeydown}><div class="modal-card" tabindex="-1" role="presentation" onclick={(event) => event.stopPropagation()} onkeydown={(event) => event.stopPropagation()}><header class="modal-head"><strong>{text.mediaTaskDetail}</strong><button class="modal-close" type="button" aria-label={text.cancel} onclick={() => closeMediaTaskDetail()}><i class="ph ph-x"></i></button></header><div class="modal-body media-task-detail">{#if mediaTaskDetail.resultUrl && mediaTaskDetail.status === "completed"}<img class="media-task-preview" src={mediaTaskDetail.resultUrl} alt={mediaTaskDetail.prompt} />{/if}<div class="settings-row"><strong>{text.mediaTaskEngine}</strong><span>{mediaEngineLabel("image", mediaTaskDetail.engine)}</span></div><div class="settings-row"><strong>{text.mediaTaskStatus}</strong><span>{mediaTaskDetail.status === "completed" ? text.mediaTaskCompleted : mediaTaskDetail.status === "failed" ? text.mediaTaskFailed : text.mediaTaskProcessing}</span></div><div class="settings-row"><strong>{text.mediaTaskPrompt}</strong><span>{mediaTaskDetail.prompt}</span></div>{#if mediaTaskDetail.errorMessage}<div class="settings-row"><strong>{text.mediaTaskError}</strong><span class="run-history-failed">{mediaTaskDetail.errorMessage}</span></div>{/if}<div class="settings-row"><strong>{text.mediaTaskCreatedAt}</strong><span>{mediaTaskDetail.createdAt.slice(0, 19).replace("T", " ")}</span></div><div class="settings-row"><strong>{text.mediaTaskUpdatedAt}</strong><span>{mediaTaskDetail.updatedAt.slice(0, 19).replace("T", " ")}</span></div>{#if mediaTaskDetail.resultUrl}<div class="settings-row-actions media-task-detail-actions"><a class="secondary-button" href={mediaTaskDetail.resultUrl} target="_blank" rel="noreferrer">{text.mediaTaskDownload}</a></div>{/if}</div></div></div>
          {/if}
        {/if}
      {:else if activeSection === "videoGenerate"}
        <p class="settings-section-hint">{text.videoGenerateHint}</p>
        {#if !serviceReady}
          <div class="settings-card"><div class="settings-row"><p>{text.videoGenerateUnavailable}</p></div></div>
        {:else if videoGenerateLoading || !videoGenerateEdit}
          <div class="settings-card"><div class="settings-row"><p>{text.loading}</p></div></div>
        {:else}
          <div class="settings-card"><div class="settings-row"><strong>{text.webSearchEnabled}</strong><button class:active={videoGenerateEdit.enabled} class="switch" type="button" role="switch" aria-checked={videoGenerateEdit.enabled} aria-label={text.videoGenerate} onclick={() => { if (videoGenerateEdit) videoGenerateEdit = { ...videoGenerateEdit, enabled: !videoGenerateEdit.enabled }; markToolSettingsDirty("videoGenerate"); }}><span></span></button></div><div class="settings-row"><strong>{text.webSearchDefaultEngine}</strong><select bind:value={videoGenerateEdit.defaultEngine} onchange={() => markToolSettingsDirty("videoGenerate")}><option value="auto">{text.mediaEngineAuto}</option>{#each videoGenerateEdit.engines as engine (engine.id)}<option value={engine.id}>{mediaEngineLabel("video", engine.id)}</option>{/each}</select></div></div>
          <p class="settings-group-title">{text.mediaEngines}</p><div class="settings-card tool-engine-list">{#each videoGenerateEdit.engines as engine (engine.id)}<details class="tool-engine-card"><summary><span>{mediaEngineLabel("video", engine.id)}</span><span class="status-badge" data-state={engine.enabled ? "ready" : "disconnected"}>{engine.enabled ? text.providerEnabled : text.providerDisabled}</span></summary><div class="tool-engine-body"><div class="settings-row"><strong>{text.providerEnabledLabel}</strong><button class:active={engine.enabled} class="switch" type="button" role="switch" aria-checked={engine.enabled} aria-label={mediaEngineLabel("video", engine.id)} onclick={() => { if (videoGenerateEdit) videoGenerateEdit = { ...videoGenerateEdit, engines: videoGenerateEdit.engines.map((item) => item.id === engine.id ? { ...item, enabled: !item.enabled } : item) }; markToolSettingsDirty("videoGenerate"); }}><span></span></button></div><div class="settings-form"><label class="settings-field"><span>{text.toolBaseUrl}</span><input bind:value={engine.baseUrl} oninput={() => markToolSettingsDirty("videoGenerate")} /></label><label class="settings-field"><span>{text.toolModel}</span><input bind:value={engine.model} oninput={() => markToolSettingsDirty("videoGenerate")} /></label><label class="settings-field settings-field-wide"><span>{text.webSearchApiKey}</span><div class="secret-input"><input type={secretRevealed(`video:${engine.id}`) ? "text" : "password"} bind:value={engine.apiKey} placeholder={engine.hasApiKey ? text.channelSecretConfigured : ""} autocomplete="new-password" oninput={() => markToolSettingsDirty("videoGenerate")} /><button class="secret-reveal" type="button" aria-label={text.toggleReveal} onclick={(event) => { event.preventDefault(); toggleRevealSecret(`video:${engine.id}`); }}><i class={`ph ${secretRevealed(`video:${engine.id}`) ? "ph-eye-slash" : "ph-eye"}`}></i></button></div>{#if engine.hasApiKey}<label class="inline-check"><input type="checkbox" bind:checked={engine.clearApiKey} onchange={() => markToolSettingsDirty("videoGenerate")} /> {text.channelClearSecret}</label>{/if}</label></div></div></details>{/each}</div>
          <p class="settings-group-title">{text.toolTest}</p><div class="settings-card tool-test-card"><div class="settings-form"><label class="settings-field settings-field-wide"><span>{text.toolPrompt}</span><input bind:value={videoTestPrompt} /></label></div><div class="settings-row-actions tool-test-actions"><button class="secondary-button" type="button" disabled={toolTestBusy} onclick={() => void testToolSettings("videoGenerate")}>{toolTestBusy ? text.loading : text.toolTest}</button></div>{#if toolTestResult}<pre class:run-history-failed={!toolTestResult.ok} class="tool-test-result">{JSON.stringify(toolTestResult.result ?? toolTestResult.error, null, 2)}</pre>{/if}</div>
          <p class="settings-group-title">{text.mediaTasks}</p>{#if videoTasks.length === 0}<div class="settings-card"><div class="settings-row"><p>{text.mediaTasksEmpty}</p></div></div>{:else}<div class="settings-card">{#each videoTasks as task (task.id)}<div class="settings-row media-task-row"><div class="profile-info"><strong>{mediaEngineLabel("video", task.engine)} · {task.status === "completed" ? text.mediaTaskCompleted : task.status === "failed" ? text.mediaTaskFailed : text.mediaTaskProcessing}</strong><p>{task.prompt}</p><p>{text.mediaTaskProgress}: {task.progress ?? 0}% · {task.createdAt.slice(0, 19).replace("T", " ")}</p>{#if task.errorMessage}<p class="run-history-failed">{task.errorMessage}</p>{/if}</div><div class="settings-row-actions">{#if task.resultUrl}<a class="secondary-button" href={task.resultUrl} target="_blank" rel="noreferrer">{text.mediaTaskResult}</a>{/if}<button class="secondary-button" type="button" onclick={() => openMediaTaskDetail(task)}>{text.mediaTaskView}</button><button class="secondary-button danger-action" type="button" disabled={mediaTaskBusy === task.id} onclick={() => void removeMediaTask("video", task.id)}>{text.mediaTaskDelete}</button></div></div>{/each}</div>{/if}
          {#if mediaTaskDetail && mediaTaskDetail.kind === "video"}
            <div class="modal-overlay" role="dialog" aria-modal="true" tabindex="-1" aria-label={text.mediaTaskDetail} onclick={() => closeMediaTaskDetail()} onkeydown={onMediaTaskOverlayKeydown}><div class="modal-card" tabindex="-1" role="presentation" onclick={(event) => event.stopPropagation()} onkeydown={(event) => event.stopPropagation()}><header class="modal-head"><strong>{text.mediaTaskDetail}</strong><button class="modal-close" type="button" aria-label={text.cancel} onclick={() => closeMediaTaskDetail()}><i class="ph ph-x"></i></button></header><div class="modal-body media-task-detail">{#if mediaTaskDetail.resultUrl && mediaTaskDetail.status === "completed"}<video class="media-task-preview" controls src={mediaTaskDetail.resultUrl}><track kind="captions" /></video>{/if}<div class="settings-row"><strong>{text.mediaTaskEngine}</strong><span>{mediaEngineLabel("video", mediaTaskDetail.engine)}</span></div><div class="settings-row"><strong>{text.mediaTaskStatus}</strong><span>{mediaTaskDetail.status === "completed" ? text.mediaTaskCompleted : mediaTaskDetail.status === "failed" ? text.mediaTaskFailed : text.mediaTaskProcessing}</span></div><div class="settings-row"><strong>{text.mediaTaskProgress}</strong><span>{mediaTaskDetail.progress ?? 0}%</span></div><div class="settings-row"><strong>{text.mediaTaskPrompt}</strong><span>{mediaTaskDetail.prompt}</span></div>{#if mediaTaskDetail.errorMessage}<div class="settings-row"><strong>{text.mediaTaskError}</strong><span class="run-history-failed">{mediaTaskDetail.errorMessage}</span></div>{/if}<div class="settings-row"><strong>{text.mediaTaskCreatedAt}</strong><span>{mediaTaskDetail.createdAt.slice(0, 19).replace("T", " ")}</span></div><div class="settings-row"><strong>{text.mediaTaskUpdatedAt}</strong><span>{mediaTaskDetail.updatedAt.slice(0, 19).replace("T", " ")}</span></div>{#if mediaTaskDetail.resultUrl}<div class="settings-row-actions media-task-detail-actions"><a class="secondary-button" href={mediaTaskDetail.resultUrl} target="_blank" rel="noreferrer">{text.mediaTaskDownload}</a></div>{/if}</div></div></div>
          {/if}
        {/if}
      {:else if activeSection === "ttsGenerate"}
        <p class="settings-section-hint">{text.ttsGenerateHint}</p>
        {#if !serviceReady}
          <div class="settings-card"><div class="settings-row"><p>{text.ttsGenerateUnavailable}</p></div></div>
        {:else if ttsGenerateLoading || !ttsGenerateEdit}
          <div class="settings-card"><div class="settings-row"><p>{text.loading}</p></div></div>
        {:else}
          <div class="settings-card"><div class="settings-row"><strong>{text.webSearchEnabled}</strong><button class:active={ttsGenerateEdit.enabled} class="switch" type="button" role="switch" aria-checked={ttsGenerateEdit.enabled} aria-label={text.ttsGenerate} onclick={() => { if (ttsGenerateEdit) ttsGenerateEdit = { ...ttsGenerateEdit, enabled: !ttsGenerateEdit.enabled }; markToolSettingsDirty("ttsGenerate"); }}><span></span></button></div><div class="settings-row"><strong>{text.ttsDefaultProvider}</strong><select bind:value={ttsGenerateEdit.defaultProvider} onchange={() => markToolSettingsDirty("ttsGenerate")}>{#each ttsGenerateEdit.providers as provider (provider.id)}<option value={provider.id}>{ttsProviderLabel(provider.id, text)}</option>{/each}</select></div></div>
          <p class="settings-group-title">{text.ttsProviders}</p><div class="settings-card tool-engine-list">{#each ttsGenerateEdit.providers as provider (provider.id)}<details class="tool-engine-card" open={provider.id === ttsGenerateEdit.defaultProvider}><summary><span>{ttsProviderLabel(provider.id, text)}</span><span class="status-badge" data-state={provider.enabled ? "ready" : "disconnected"}>{provider.enabled ? text.providerEnabled : text.providerDisabled}</span></summary><div class="tool-engine-body"><div class="settings-row"><strong>{text.providerEnabledLabel}</strong><button class:active={provider.enabled} class="switch" type="button" role="switch" aria-checked={provider.enabled} aria-label={ttsProviderLabel(provider.id, text)} onclick={() => { if (ttsGenerateEdit) ttsGenerateEdit = { ...ttsGenerateEdit, providers: ttsGenerateEdit.providers.map((item) => item.id === provider.id ? { ...item, enabled: !item.enabled } : item) }; markToolSettingsDirty("ttsGenerate"); }}><span></span></button></div><div class="settings-form">{#if provider.id === "macos"}<label class="settings-field"><span>{text.ttsVoice}</span><select bind:value={provider.voice} onchange={() => markToolSettingsDirty("ttsGenerate")}><option value="">{text.ttsSystemVoices}</option>{#each ttsVoices as voice (voice.id)}<option value={voice.id}>{voice.label ?? voice.id}{voice.locale ? ` · ${voice.locale}` : ""}</option>{/each}</select></label>{:else}<label class="settings-field"><span>{text.toolBaseUrl}</span><input bind:value={provider.baseUrl} oninput={() => markToolSettingsDirty("ttsGenerate")} /></label><label class="settings-field"><span>{text.toolModel}</span><input bind:value={provider.model} oninput={() => markToolSettingsDirty("ttsGenerate")} /></label><label class="settings-field"><span>{text.ttsVoice}</span><select bind:value={provider.voice} onchange={() => markToolSettingsDirty("ttsGenerate")}>{#each XIAOMI_VOICES as voice (voice.id)}<option value={voice.id}>{voice.label}{voice.gender ? ` · ${voice.gender}` : ""}{voice.locale ? ` · ${voice.locale}` : ""}</option>{/each}</select></label><label class="settings-field"><span>{text.webSearchApiKey}</span><div class="secret-input"><input type={secretRevealed(`tts:${provider.id}`) ? "text" : "password"} bind:value={provider.apiKey} placeholder={provider.hasApiKey ? text.channelSecretConfigured : ""} autocomplete="new-password" oninput={() => markToolSettingsDirty("ttsGenerate")} /><button class="secret-reveal" type="button" aria-label={text.toggleReveal} onclick={(event) => { event.preventDefault(); toggleRevealSecret(`tts:${provider.id}`); }}><i class={`ph ${secretRevealed(`tts:${provider.id}`) ? "ph-eye-slash" : "ph-eye"}`}></i></button></div>{#if provider.hasApiKey}<label class="inline-check"><input type="checkbox" bind:checked={provider.clearApiKey} onchange={() => markToolSettingsDirty("ttsGenerate")} /> {text.channelClearSecret}</label>{/if}</label>{/if}<label class="settings-field"><span>{text.ttsFormat}</span><select bind:value={provider.format} onchange={() => markToolSettingsDirty("ttsGenerate")}><option value="wav">WAV</option><option value="mp3">MP3</option><option value="aiff">AIFF</option><option value="m4a">M4A</option><option value="caf">CAF</option></select></label></div></div></details>{/each}</div>
          <p class="settings-group-title">{text.toolTest}</p><div class="settings-card tool-test-card"><div class="settings-form"><label class="settings-field"><span>{text.ttsTestProvider}</span><select bind:value={ttsTestProvider}>{#each ttsGenerateEdit.providers as provider (provider.id)}<option value={provider.id}>{ttsProviderLabel(provider.id, text)}</option>{/each}</select></label><label class="settings-field"><span>{text.toolTestText}</span><input bind:value={ttsTestText} /></label></div><div class="settings-row-actions tool-test-actions"><button class="secondary-button" type="button" disabled={toolTestBusy} onclick={() => void testToolSettings("ttsGenerate")}>{toolTestBusy ? text.loading : text.toolTest}</button></div>{#if ttsTestAudioUrl}<audio class="tool-test-audio" controls src={ttsTestAudioUrl}>{text.ttsAudioUnsupported}</audio>{/if}{#if toolTestResult}<pre class:run-history-failed={!toolTestResult.ok} class="tool-test-result">{JSON.stringify(toolTestResult.result ?? toolTestResult.error, null, 2)}</pre>{/if}</div>
        {/if}
      {:else if activeSection === "profiles"}
        <p class="settings-section-hint">{text.profilesHint}</p>
        {#if serviceReady && !profileEdit}
          <div class="settings-section-actions"><button class="secondary-button" type="button" onclick={beginNewProfile}>{text.profileAdd}</button></div>
        {/if}
        {#if !serviceReady}
          <div class="settings-card"><div class="settings-row"><p>{text.profilesUnavailable}</p></div></div>
        {:else if webProfilesLoading}
          <div class="settings-card"><div class="settings-row"><p>{text.loading}</p></div></div>
        {:else if webProfiles.length === 0}
          <div class="settings-card"><div class="settings-row"><p>{text.profilesEmpty}</p></div></div>
        {:else}
          {#if !hasEnabledWebProfile(webProfiles)}
            <div class="settings-card"><div class="settings-row"><p class="error-message">{text.profilesNoneEnabled}</p></div></div>
          {/if}
          <div class="settings-card">
            {#each webProfiles as profile (profile.id)}
              <div class="settings-row">
                <div class="profile-info">
                  <strong>{profile.name}</strong>
                  <p>{profile.agentName ? `${text.linkedAgent}: ${profile.agentName}` : text.noLinkedAgent}</p>
                  <div class="profile-edit-actions">
                    <button class="secondary-button" type="button" disabled={profileEditorLoading} onclick={() => void beginProfileEdit(profile)}>{text.profileEdit}</button>
                    <button class="secondary-button danger-action" type="button" disabled={profileSaving} onclick={() => void removeProfile(profile.id)}>{text.profileDelete}</button>
                  </div>
                </div>
                <button
                  class:active={profile.enabled}
                  class="switch"
                  type="button"
                  role="switch"
                  aria-label={profile.name}
                  aria-checked={profile.enabled}
                  disabled={patchingProfileId === profile.id}
                  onclick={() => void toggleProfile(profile)}
                >
                  <span></span>
                </button>
              </div>
            {/each}
          </div>
        {/if}
        {#if profileEdit}
          <form id="desktop-profile-form" class="settings-card provider-editor" aria-label={sectionLabel("profiles", text)} onsubmit={(event) => { event.preventDefault(); void saveProfileEditor(); }}>
            <header class="entity-editor-head"><strong>{sectionLabel("profiles", text)}</strong><button class="modal-close" type="button" aria-label={text.cancel} disabled={profileSaving} onclick={() => (profileEdit = null)}><i class="ph ph-x"></i></button></header>
            <div class="settings-form">
              <label class="settings-field"><span>{text.profileId}</span><input value={profileEdit.id} disabled={!profileEdit.isNew} oninput={(event) => updateProfileEdit((draft) => ({ ...draft, id: (event.currentTarget as HTMLInputElement).value }))} /></label>
              <label class="settings-field"><span>{text.profileName}</span><input value={profileEdit.name} oninput={(event) => updateProfileEdit((draft) => ({ ...draft, name: (event.currentTarget as HTMLInputElement).value }))} /></label>
              <label class="settings-field"><span>{text.profileAgent}</span><select value={profileEdit.agentId} onchange={(event) => updateProfileEdit((draft) => ({ ...draft, agentId: (event.currentTarget as HTMLSelectElement).value }))}><option value="">{text.profileNoAgent}</option>{#each agents?.items.filter((agent) => agent.enabled) ?? [] as agent (agent.id)}<option value={agent.id}>{agent.name}</option>{/each}</select></label>
              <label class="settings-field"><span>{text.profileSandbox}</span><select value={profileEdit.sandboxEnabled === undefined ? "inherit" : profileEdit.sandboxEnabled ? "on" : "off"} onchange={(event) => { const value = (event.currentTarget as HTMLSelectElement).value; updateProfileEdit((draft) => ({ ...draft, sandboxEnabled: value === "inherit" ? undefined : value === "on" })); }}><option value="inherit">{text.profileSandboxInherit}</option><option value="on">{text.profileSandboxOn}</option><option value="off">{text.profileSandboxOff}</option></select></label>
            </div>
            <div class="provider-inline-options"><div class="inline-switch-row"><span>{text.profileEnabled}</span><button class:active={profileEdit.enabled} class="switch" type="button" role="switch" aria-label={text.profileEnabled} aria-checked={profileEdit.enabled} onclick={() => updateProfileEdit((draft) => ({ ...draft, enabled: !draft.enabled }))}><span></span></button></div></div>
            <div class="provider-editor-toolbar"><strong>{text.profileFiles}</strong></div>
            <div class="profile-files-editor">
              {#each PROFILE_FILE_NAMES as fileName (fileName)}
                <label class="settings-field"><span>{fileName}</span><textarea rows="7" value={profileEdit.files[fileName] ?? ""} oninput={(event) => updateProfileEdit((draft) => ({ ...draft, files: { ...draft.files, [fileName]: (event.currentTarget as HTMLTextAreaElement).value } }))}></textarea></label>
              {/each}
            </div>
            <footer class="entity-editor-foot"><button class="secondary-button" type="button" disabled={profileSaving} onclick={() => (profileEdit = null)}>{text.cancel}</button><button class="primary-button" type="submit" disabled={profileSaving || !profileEdit.id.trim()}>{profileSaving ? text.onboardingProviderSaving : text.save}</button></footer>
          </form>
        {/if}
        {#if profileActionMessage}<p class="settings-action-message">{profileActionMessage}</p>{/if}
      {:else if activeSection === "usage"}
        <p class="settings-section-hint">{text.usageHint}</p>
        {#if !serviceReady}
          <div class="settings-card"><div class="settings-row"><p>{text.usageUnavailable}</p></div></div>
        {:else if usageLoading}
          <div class="settings-card"><div class="settings-row"><p>{text.loading}</p></div></div>
        {:else if !usage}
          <div class="settings-card"><div class="settings-row"><p>{text.usageEmpty}</p></div></div>
        {:else}
          <div class="chart-kpi-grid">
            <div class="chart-kpi" style="--kpi-accent:var(--chart-blue)">
              <span class="chart-kpi-label">{text.usageRequests}</span>
              <strong class="chart-kpi-value">{formatTokenCount(usage.totals.requests)}</strong>
              <span class="chart-kpi-foot">{text.usageWindow_last30Days}</span>
            </div>
            <div class="chart-kpi" style="--kpi-accent:var(--chart-teal)">
              <span class="chart-kpi-label">{text.usageTotalTokens}</span>
              <strong class="chart-kpi-value">{formatTokenCount(usage.totals.totalTokens)}</strong>
              <span class="chart-kpi-foot">{text.usageInput} {formatTokenCount(usage.totals.inputTokens)} · {text.usageOutput} {formatTokenCount(usage.totals.outputTokens)}</span>
            </div>
            <div class="chart-kpi" style="--kpi-accent:var(--chart-purple)">
              <span class="chart-kpi-label">{text.usageCacheHitRatio}</span>
              <strong class="chart-kpi-value">{Math.round(usageCacheHit * 100)}%</strong>
              <span class="chart-kpi-foot">{text.usageCacheRead} {formatTokenCount(usage.totals.cacheReadTokens)}</span>
            </div>
            <div class="chart-kpi" style="--kpi-accent:var(--chart-orange)">
              <span class="chart-kpi-label">{text.usageAvgPerDay}</span>
              <strong class="chart-kpi-value">{formatTokenCount(usageAvgPerDay)}</strong>
              <span class="chart-kpi-foot">{text.usageWindow_last30Days}</span>
            </div>
          </div>

          <div class="settings-card chart-card">
            <div class="chart-card-head">
              <div><strong>{text.usageTrendTitle}</strong><p>{text.usageTrendDesc}</p></div>
              <div class="chart-legend-inline">
                <span class="legend-chip"><span class="legend-line" style="--dot:var(--chart-blue)"></span>{text.usageTotalTokens}</span>
                <span class="legend-chip"><span class="legend-line legend-line-dash" style="--dot:var(--chart-teal)"></span>{text.usageRequests}</span>
              </div>
            </div>
            {#if usageHasTrend}
              <div class="trend-wrap">
                <svg class="trend-svg" viewBox="0 0 100 44" preserveAspectRatio="none" aria-hidden="true">
                  <defs>
                    <linearGradient id="usageTrendFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stop-color="var(--chart-blue)" stop-opacity="0.26" />
                      <stop offset="100%" stop-color="var(--chart-blue)" stop-opacity="0" />
                    </linearGradient>
                  </defs>
                  <line class="trend-grid" x1="0" y1="5" x2="100" y2="5" vector-effect="non-scaling-stroke" />
                  <line class="trend-grid" x1="0" y1="24.5" x2="100" y2="24.5" vector-effect="non-scaling-stroke" />
                  <line class="trend-grid" x1="0" y1="40" x2="100" y2="40" vector-effect="non-scaling-stroke" />
                  <path class="trend-area" d={usageTokenArea} fill="url(#usageTrendFill)" />
                  <path class="trend-line trend-line-req" d={usageReqLine} vector-effect="non-scaling-stroke" />
                  <path class="trend-line trend-line-token" d={usageTokenLine} vector-effect="non-scaling-stroke" />
                  {#if usagePeakDay && usageDaily.length > 1}<line class="trend-peak-guide" x1={usagePeakX} y1="0" x2={usagePeakX} y2="44" vector-effect="non-scaling-stroke" />{/if}
                </svg>
                {#if usagePeakDay && usageDaily.length > 1}
                  <div class="trend-peak-tag" style="left:{usagePeakTagX}%">
                    <strong>{formatTokenCount(usagePeakDay.totalTokens)}</strong>
                    <small>{text.usagePeak} · {usagePeakDay.date.slice(5)}</small>
                  </div>
                {/if}
                <div class="trend-axis">
                  <span>{usageDaily[0]?.date.slice(5)}</span>
                  <span>{usageDaily[usageDaily.length - 1]?.date.slice(5)}</span>
                </div>
              </div>
            {:else}
              <p class="chart-empty">{text.usageNoTrend}</p>
            {/if}
            <p class="chart-caption">{text.usageGeneratedAt}: {usage.generatedAt.slice(0, 19).replace("T", " ")} · {usage.timezone}</p>
          </div>

          <div class="usage-split">
            <div class="settings-card chart-card">
              <div class="chart-card-head"><div><strong>{text.usageDistribution}</strong></div></div>
              <div class="donut-block">
                <div class="donut-wrap">
                  <svg class="donut-svg" viewBox="0 0 42 42" role="img" aria-label={text.usageDistribution}>
                    <circle class="donut-track" cx="21" cy="21" r={DONUT_R} />
                    {#each usageDistSegments as seg (seg.key)}
                      <circle class="donut-seg" cx="21" cy="21" r={DONUT_R} stroke={seg.color} stroke-dasharray="{seg.len} {100 - seg.len}" stroke-dashoffset={seg.offset} />
                    {/each}
                  </svg>
                  <div class="donut-center">
                    <strong>{formatTokenCount(usage.totals.totalTokens)}</strong>
                    <small>{text.usageTotalTokens}</small>
                  </div>
                </div>
                <ul class="chart-legend">
                  {#each usageDistItems as item (item.key)}
                    <li>
                      <span class="legend-dot" style="background:{item.color}"></span>
                      <span class="legend-name">{item.label}</span>
                      <span class="legend-value">{formatTokenCount(item.value)}<em>{percentOf(item.value, usageDistTotal)}%</em></span>
                    </li>
                  {/each}
                </ul>
              </div>
            </div>

            <div class="settings-card chart-card">
              <div class="chart-card-head"><div><strong>{text.usageWindowCompare}</strong></div></div>
              <div class="window-bars">
                {#each usage.windows as window (window.label)}
                  <div class="window-bar-row">
                    <div class="window-bar-meta">
                      <strong>{usageWindowLabel(window.label, text)}</strong>
                      <span>{formatTokenCount(window.requests)} {text.usageRequests}</span>
                    </div>
                    <div class="window-bar-track" title={`${formatTokenCount(window.totalTokens)} ${text.usageTokens}`}>
                      <span class="window-seg" style="width:{percentOf(window.inputTokens, usageWindowMax)}%; background:var(--chart-blue)"></span>
                      <span class="window-seg" style="width:{percentOf(window.outputTokens, usageWindowMax)}%; background:var(--chart-teal)"></span>
                      <span class="window-seg" style="width:{percentOf(window.cacheReadTokens, usageWindowMax)}%; background:var(--chart-purple)"></span>
                      <span class="window-seg" style="width:{percentOf(window.cacheWriteTokens, usageWindowMax)}%; background:var(--chart-orange)"></span>
                    </div>
                    <span class="window-bar-total">{formatTokenCount(window.totalTokens)}</span>
                  </div>
                {/each}
              </div>
            </div>
          </div>
        {/if}
      {:else if activeSection === "runHistory"}
        <p class="settings-section-hint">{text.runHistoryHint}</p>
        {#if !serviceReady}
          <div class="settings-card"><div class="settings-row"><p>{text.runHistoryUnavailable}</p></div></div>
        {:else if runHistoryLoading}
          <div class="settings-card"><div class="settings-row"><p>{text.loading}</p></div></div>
        {:else if runHistory.length === 0}
          <div class="settings-card"><div class="settings-row"><p>{text.runHistoryEmpty}</p></div></div>
        {:else}
          <div class="settings-card">
            <div class="settings-row">
              <div><strong>{text.runHistoryTotal}</strong></div>
              <div class="run-history-counts">
                <span class="status-badge" data-state="ready">{text.runHistorySuccess}: {runHistoryCounts.success}</span>
                <span class="status-badge">{text.runHistoryPartial}: {runHistoryCounts.partial}</span>
                <span class="status-badge" data-state="error">{text.runHistoryFailed}: {runHistoryCounts.failed}</span>
              </div>
            </div>
          </div>
          <div class="settings-card provider-editor"><div class="settings-form"><label class="settings-field settings-field-wide"><span>{text.runHistoryFilter}</span><input bind:value={runHistoryQuery} placeholder={text.runHistoryFilterHint} /></label></div></div>
          {#if filteredRunHistory.length === 0}
            <div class="settings-card"><div class="settings-row"><p>{text.runHistoryNoMatches}</p></div></div>
          {:else}
          <div class="settings-card">
            {#each filteredRunHistory as item (item.runId)}
              <div class="settings-row run-history-row">
                <div class="run-history-item">
                  <div class="run-history-head">
                    <strong>{item.botId} / {item.chatId}</strong>
                    <span class="status-badge" data-state={item.reflectionOutcome === "success" ? "ready" : item.reflectionOutcome === "failed" ? "error" : "disconnected"}>{runHistoryOutcomeLabel(item.reflectionOutcome, text)}</span>
                  </div>
                  <p class="run-history-meta">
                    {item.createdAt.slice(0, 19).replace("T", " ")} · {formatDurationMs(item.durationMs)} · {item.stopReason}
                    {#if item.usedFallbackModel} · {text.runHistoryFallback}{/if}
                  </p>
                  {#if item.reflectionSummary}<p class="run-history-summary">{item.reflectionSummary}</p>{/if}
                  {#if item.toolNames.length > 0}<p class="run-history-tools">{text.runHistoryTools}: {item.toolNames.join(", ")}</p>{/if}
                  {#if item.failedToolNames.length > 0}<p class="run-history-tools run-history-failed">{text.runHistoryFailedTools}: {item.failedToolNames.join(", ")}</p>{/if}
                </div>
              </div>
            {/each}
          </div>
          {/if}
        {/if}
      {:else if activeSection === "trace"}
        <p class="settings-section-hint">{text.traceHint}</p>
        <div class="settings-card">
          <div class="settings-row">
            <div>
              <strong>{text.traceRange}</strong>
              <p>{trace ? `${trace.window.startDate} → ${trace.window.endDate} · ${trace.timezone}` : ""}</p>
            </div>
            <select value={traceRange} disabled={traceLoading} aria-label={text.traceRange} onchange={(event) => void changeTraceRange((event.currentTarget as HTMLSelectElement).value as DesktopTraceRange)}>
              {#each TRACE_RANGES as range (range)}
                <option value={range}>{traceRangeLabel(range, text)}</option>
              {/each}
            </select>
          </div>
        </div>
        {#if !serviceReady}
          <div class="settings-card"><div class="settings-row"><p>{text.traceUnavailable}</p></div></div>
        {:else if traceLoading}
          <div class="settings-card"><div class="settings-row"><p>{text.loading}</p></div></div>
        {:else if !trace}
          <div class="settings-card"><div class="settings-row"><p>{text.traceEmpty}</p></div></div>
        {:else}
          <div class="chart-kpi-grid">
            <div class="chart-kpi" style="--kpi-accent:var(--chart-indigo)">
              <span class="chart-kpi-label">{text.traceFacts}</span>
              <strong class="chart-kpi-value">{formatTokenCount(trace.totals.facts)}</strong>
              <span class="chart-kpi-foot">{formatTokenCount(trace.totals.runs)} {text.traceRuns}</span>
            </div>
            <div class="chart-kpi" style="--kpi-accent:var(--chart-blue)">
              <span class="chart-kpi-label">{text.traceToolCalls}</span>
              <strong class="chart-kpi-value">{formatTokenCount(trace.totals.toolCalls)}</strong>
              <span class="chart-kpi-foot">{text.traceFailed} {trace.totals.failedTools} · {text.traceBlocked} {trace.totals.blockedTools}</span>
            </div>
            <div class="chart-kpi" style="--kpi-accent:var(--chart-purple)">
              <span class="chart-kpi-label">{text.traceModelCalls}</span>
              <strong class="chart-kpi-value">{formatTokenCount(trace.totals.modelCalls)}</strong>
              <span class="chart-kpi-foot">{formatTokenCount(trace.totals.totalTokens)} {text.usageTokens}</span>
            </div>
            <div class="chart-kpi" style="--kpi-accent:var(--chart-teal)">
              <span class="chart-kpi-label">{text.traceSkills}</span>
              <strong class="chart-kpi-value">{formatTokenCount(trace.totals.skillUsages)}</strong>
              <span class="chart-kpi-foot">{formatTokenCount(trace.totals.distinctSkills)} {text.traceDistinct}</span>
            </div>
          </div>

          <div class="settings-card chart-card">
            <div class="chart-card-head"><div><strong>{text.traceActivity}</strong></div></div>
            <div class="hbar-list">
              {#each traceActivityItems as item (item.key)}
                <div class="hbar-row">
                  <span class="hbar-label">{item.label}</span>
                  <div class="hbar-track"><span class="hbar-fill" style="width:{Math.max(2, percentOf(item.value, traceActivityMax))}%; background:{item.color}"></span></div>
                  <span class="hbar-value">{formatTokenCount(item.value)}</span>
                </div>
              {/each}
            </div>
          </div>

          <div class="chart-split">
            <div class="settings-card chart-card">
              <div class="chart-card-head"><div><strong>{text.traceToolOutcome}</strong></div></div>
              <div class="donut-block">
                <div class="donut-wrap">
                  <svg class="donut-svg" viewBox="0 0 42 42" role="img" aria-label={text.traceToolOutcome}>
                    <circle class="donut-track" cx="21" cy="21" r={DONUT_R} />
                    {#each traceOutcomeSegments as seg (seg.key)}
                      <circle class="donut-seg" cx="21" cy="21" r={DONUT_R} stroke={seg.color} stroke-dasharray="{seg.len} {100 - seg.len}" stroke-dashoffset={seg.offset} />
                    {/each}
                  </svg>
                  <div class="donut-center">
                    <strong>{formatTokenCount(trace.totals.toolCalls)}</strong>
                    <small>{text.traceToolCalls}</small>
                  </div>
                </div>
                <ul class="chart-legend">
                  {#each traceOutcomeItems as item (item.key)}
                    <li>
                      <span class="legend-dot" style="background:{item.color}"></span>
                      <span class="legend-name">{item.label}</span>
                      <span class="legend-value">{formatTokenCount(item.value)}<em>{percentOf(item.value, traceOutcomeTotal)}%</em></span>
                    </li>
                  {/each}
                </ul>
              </div>
            </div>

            <div class="settings-card chart-card">
              <div class="chart-card-head"><div><strong>{text.traceCoverage}</strong></div></div>
              <div class="coverage-grid">
                {#each traceCoverageItems as item (item.key)}
                  <div class="coverage-tile">
                    <span class="coverage-icon"><i class="ph ph-{item.icon}"></i></span>
                    <strong>{formatTokenCount(item.value)}</strong>
                    <small>{item.label}</small>
                  </div>
                {/each}
              </div>
            </div>
          </div>

          <div class="settings-card chart-card">
            <div class="chart-card-head"><div><strong>{text.traceDurationCompare}</strong></div></div>
            <div class="hbar-list">
              <div class="hbar-row">
                <span class="hbar-label">{text.traceTool}</span>
                <div class="hbar-track"><span class="hbar-fill" style="width:{Math.max(2, percentOf(trace.totals.avgToolDurationMs, traceDurationMax))}%; background:var(--chart-blue)"></span></div>
                <span class="hbar-value">{formatDurationMs(trace.totals.avgToolDurationMs)}</span>
              </div>
              <div class="hbar-row">
                <span class="hbar-label">{text.traceModel}</span>
                <div class="hbar-track"><span class="hbar-fill" style="width:{Math.max(2, percentOf(trace.totals.avgModelDurationMs, traceDurationMax))}%; background:var(--chart-purple)"></span></div>
                <span class="hbar-value">{formatDurationMs(trace.totals.avgModelDurationMs)}</span>
              </div>
            </div>
          </div>
        {/if}
      {:else if activeSection === "sandbox"}
        <p class="settings-section-hint">{text.sandboxHint}</p>
        {#if !serviceReady}
          <div class="settings-card"><div class="settings-row"><p>{text.sandboxUnavailable}</p></div></div>
        {:else if sandboxLoading || !sandbox || !sandboxEdit}
          <div class="settings-card"><div class="settings-row"><p>{text.loading}</p></div></div>
        {:else}
          <form id="desktop-sandbox-form" class="sandbox-form" onsubmit={(event) => { event.preventDefault(); void saveSandboxPolicy(); }}>
          <div class="channel-section-head sandbox-section-head"><div><p class="settings-group-title">{text.sandboxPresets}</p><p class="settings-section-hint">{text.sandboxPresetsHint}</p></div>{#if activeSandboxPreset === "custom"}<span class="status-badge" data-state="disconnected">{text.sandboxPresetCustom}</span>{/if}</div>
          <div class="sandbox-presets">
            {#each [
              { id: "observe", icon: "eye", title: text.sandboxPresetObserve, description: text.sandboxPresetObserveHint },
              { id: "build", icon: "hammer", title: text.sandboxPresetBuild, description: text.sandboxPresetBuildHint },
              { id: "strict", icon: "lock-key", title: text.sandboxPresetStrict, description: text.sandboxPresetStrictHint }
            ] as preset (preset.id)}
              <button class:active={activeSandboxPreset === preset.id} class="sandbox-preset-card" type="button" aria-pressed={activeSandboxPreset === preset.id} onclick={() => applySandboxPreset(preset.id as DesktopSandboxPreset)}>
                <span class="sandbox-preset-icon"><i class="ph ph-{preset.icon}"></i></span>
                <span><strong>{preset.title}</strong><small>{preset.description}</small></span>
              </button>
            {/each}
          </div>

          <p class="settings-group-title">{text.sandboxRuntime}</p>
          <div class="settings-card provider-editor">
            <div class="settings-row">
              <div>
                <strong>{text.sandboxEnabled}</strong>
                <p>{text.sandboxEnabledDesc}</p>
              </div>
              <button
                class:active={sandboxEdit.enabled}
                class="switch"
                type="button"
                role="switch"
                aria-label={text.sandboxEnabled}
                aria-checked={sandboxEdit.enabled}
                onclick={() => updateSandboxEdit((draft) => ({ ...draft, enabled: !draft.enabled }))}
              >
                <span></span>
              </button>
            </div>
            <label class="settings-row"><div><strong>{text.sandboxInitFailure}</strong><p>{text.sandboxInitFailureHint}</p></div><select value={sandboxEdit.initFailureMode} onchange={(event) => updateSandboxEdit((draft) => ({ ...draft, initFailureMode: event.currentTarget.value as SandboxEditor["initFailureMode"] }))}><option value="warn-disable">{text.sandboxInitWarnDisable}</option><option value="block">{text.sandboxInitBlock}</option></select></label>
            <label class="settings-row"><div><strong>{text.sandboxEnvInherit}</strong><p>{text.sandboxEnvInheritHint}</p></div><select value={sandboxEdit.envInheritMode} onchange={(event) => updateSandboxEdit((draft) => ({ ...draft, envInheritMode: event.currentTarget.value as SandboxEditor["envInheritMode"] }))}><option value="minimal">{text.sandboxEnvMinimal}</option><option value="allowlist">{text.sandboxEnvAllowlist}</option><option value="full">{text.sandboxEnvFull}</option></select></label>
          </div>

          <p class="settings-group-title">{text.sandboxEnvironment}</p>
          <div class="settings-card provider-editor">
            <div class="settings-form sandbox-policy-form">
              <label class="settings-field settings-field-wide"><span>{text.sandboxEnvFile}</span><input value={sandboxEdit.envFilePath} placeholder=".env" oninput={(event) => updateSandboxEdit((draft) => ({ ...draft, envFilePath: event.currentTarget.value }))} /><small>{sandboxEdit.preserveExternalEnvFilePath && !sandboxEdit.envFilePath ? text.sandboxEnvPathExternal : text.sandboxEnvPathHint}</small></label>
              <label class="settings-field"><span>{text.sandboxEnvAllow}</span><textarea rows="6" value={sandboxEdit.envAllowText} placeholder={'OPENAI_API_KEY\nTAVILY_API_KEY'} oninput={(event) => updateSandboxEdit((draft) => ({ ...draft, envAllowText: event.currentTarget.value }))}></textarea></label>
              <label class="settings-field"><span>{text.sandboxEnvDeny}</span><textarea rows="6" value={sandboxEdit.envDenyText} placeholder={'TELEGRAM_BOT_TOKEN\nMOLIBOT_*'} oninput={(event) => updateSandboxEdit((draft) => ({ ...draft, envDenyText: event.currentTarget.value }))}></textarea></label>
            </div>
          </div>

          <div class="sandbox-policy-grid">
            <div class="settings-card provider-editor">
              <div class="provider-editor-toolbar"><div><strong>{text.sandboxNetwork}</strong><p>{text.sandboxNetworkHint}</p></div></div>
              <div class="settings-form sandbox-policy-form single-column">
                <label class="settings-field"><span>{text.sandboxNetworkAllow}</span><textarea rows="8" value={sandboxEdit.networkAllowText} oninput={(event) => updateSandboxEdit((draft) => ({ ...draft, networkAllowText: event.currentTarget.value }))}></textarea></label>
                <label class="settings-field"><span>{text.sandboxNetworkDeny}</span><textarea rows="4" value={sandboxEdit.networkDenyText} oninput={(event) => updateSandboxEdit((draft) => ({ ...draft, networkDenyText: event.currentTarget.value }))}></textarea></label>
              </div>
            </div>
            <div class="settings-card provider-editor">
              <div class="provider-editor-toolbar"><div><strong>{text.sandboxFilesystem}</strong><p>{text.sandboxFilesystemHint}</p></div></div>
              <div class="settings-form sandbox-policy-form single-column">
                <label class="settings-field"><span>{text.sandboxFilesystemAllowWrite}</span><textarea rows="4" value={sandboxEdit.allowWriteText} oninput={(event) => updateSandboxEdit((draft) => ({ ...draft, allowWriteText: event.currentTarget.value }))}></textarea></label>
                <label class="settings-field"><span>{text.sandboxFilesystemDenyRead}</span><textarea rows="4" value={sandboxEdit.denyReadText} oninput={(event) => updateSandboxEdit((draft) => ({ ...draft, denyReadText: event.currentTarget.value }))}></textarea></label>
                <label class="settings-field"><span>{text.sandboxFilesystemDenyWrite}</span><textarea rows="4" value={sandboxEdit.denyWriteText} oninput={(event) => updateSandboxEdit((draft) => ({ ...draft, denyWriteText: event.currentTarget.value }))}></textarea></label>
              </div>
            </div>
          </div>

          <div class="channel-section-head sandbox-section-head"><div><p class="settings-group-title">{text.sandboxDiagnostics}</p><p class="settings-section-hint">{text.sandboxDiagnosticsHint}</p></div><button class="secondary-button" type="button" disabled={sandboxDiagnosing} onclick={() => void refreshSandboxDiagnostics()}>{sandboxDiagnosing ? text.loading : text.sandboxRunDiagnostics}</button></div>
          <div class="settings-card">
            <div class="settings-row"><strong>{text.sandboxSupported}</strong><span class="status-badge" data-state={sandbox.diagnostics.supportedPlatform ? "ready" : "error"}>{sandbox.diagnostics.supportedPlatform ? text.yes : text.no}</span></div>
            <div class="settings-row"><strong>{text.sandboxDeps}</strong><span class="status-badge" data-state={sandbox.diagnostics.dependenciesAvailable ? "ready" : "error"}>{sandbox.diagnostics.dependenciesAvailable ? text.yes : text.no}</span></div>
            <div class="settings-row"><strong>{text.sandboxInitialized}</strong><span class="status-badge" data-state={!sandbox.enabled || sandbox.diagnostics.sandboxInitialized ? "ready" : "error"}>{sandbox.diagnostics.sandboxInitialized ? text.yes : sandbox.enabled ? text.no : text.sandboxDisabledState}</span></div>
            {#if sandbox.diagnostics.sandboxError}<div class="settings-row"><strong>{text.sandboxError}</strong><span class="diag-value run-history-failed">{sandbox.diagnostics.sandboxError}</span></div>{/if}
            <div class="settings-row"><strong>{text.sandboxEnvFile}</strong><span class="diag-value">{sandbox.diagnostics.envFileExists ? text.sandboxEnvFileExists : text.sandboxEnvFileMissing} · {sandbox.diagnostics.envKeysInjected}/{sandbox.diagnostics.envKeysAvailable} {text.sandboxEnvKeysInjected} · {sandbox.diagnostics.envKeysDenied} {text.sandboxDenied}</span></div>
          </div>
          {#if sandboxActionMessage}<p class="settings-action-message">{sandboxActionMessage}</p>{/if}
          </form>
        {/if}
      {:else if activeSection === "hostBash"}
        <p class="settings-section-hint">{text.hostBashHint}</p>
        {#if !serviceReady}
          <div class="settings-card"><div class="settings-row"><p>{text.hostBashUnavailable}</p></div></div>
        {:else if hostBashLoading || !hostBash}
          <div class="settings-card"><div class="settings-row"><p>{text.loading}</p></div></div>
        {:else}
          <div class="settings-card">
            <div class="settings-row"><strong>{text.hostBashPending}</strong><span class="diag-value">{hostBash.counts.pending}</span></div>
            <div class="settings-row"><strong>{text.hostBashWhitelist}</strong><span class="diag-value">{hostBash.counts.whitelistEnabled}/{hostBash.counts.whitelist} {text.hostBashEnabled}</span></div>
            <div class="settings-row"><strong>{text.hostBashHistory}</strong><span class="diag-value">{hostBash.counts.history}</span></div>
          </div>
          {#if hostBash.whitelist.length === 0}
            <div class="settings-card"><div class="settings-row"><p>{text.hostBashWhitelistEmpty}</p></div></div>
          {:else}
            <div class="settings-card">
              {#each hostBash.whitelist as item (item.id)}
                <div class="settings-row">
                  <div class="profile-info">
                    <strong>{item.displayName || item.toolId}</strong>
                    <p>{item.toolId} · {item.approvalMode} · {text.hostBashFs}: {item.permissions.filesystem} · {text.hostBashNet}: {item.permissions.network} · {text.hostBashEnv}: {item.permissions.envAllowlist}</p>
                    {#if item.reason}<p>{item.reason}</p>{/if}
                  </div>
                  <button
                    class:active={item.enabled}
                    class="switch"
                    type="button"
                    role="switch"
                    aria-label={item.displayName || item.toolId}
                    aria-checked={item.enabled}
                    disabled={hostBashTogglingId === item.id}
                    onclick={() => void toggleHostBashWhitelist(item.id, !item.enabled)}
                  >
                    <span></span>
                  </button>
                </div>
              {/each}
            </div>
          {/if}
        {/if}
      {:else if activeSection === "tasks"}
        <p class="settings-section-hint">{text.tasksHint}</p>
        {#if !serviceReady}
          <div class="settings-card"><div class="settings-row"><p>{text.tasksUnavailable}</p></div></div>
        {:else if tasksLoading || !tasks}
          <div class="settings-card"><div class="settings-row"><p>{text.loading}</p></div></div>
        {:else}
          <div class="settings-card">
            <div class="settings-row"><strong>{text.tasksTotal}</strong><span class="diag-value">{tasks.counts.total}</span></div>
            <div class="settings-row"><strong>{text.tasksByStatus}</strong><span class="diag-value">{text.taskStatusPending}: {tasks.counts.byStatus.pending} · {text.taskStatusRunning}: {tasks.counts.byStatus.running} · {text.taskStatusCompleted}: {tasks.counts.byStatus.completed} · {text.taskStatusError}: {tasks.counts.byStatus.error}</span></div>
            <div class="settings-row"><strong>{text.tasksByScope}</strong><span class="diag-value">{text.taskScopeWorkspace}: {tasks.counts.byScope.workspace} · {text.taskScopeChat}: {tasks.counts.byScope.chatScratch}</span></div>
          </div>
          <div class="settings-card provider-editor">
            <div class="settings-form"><label class="settings-field settings-field-wide"><span>{text.tasksFilter}</span><input bind:value={taskQuery} placeholder={text.tasksFilterHint} /></label></div>
            <div class="task-bulk-bar">
              <span class="task-bulk-count"><i class="ph ph-check-square" aria-hidden="true"></i>{taskSelected.size}</span>
              <button class="tertiary-button" type="button" disabled={filteredTaskItems.length === 0} onclick={() => (taskSelected = new Set(filteredTaskItems.map((item) => item.id)))}>{text.tasksSelectAll}</button>
              <button class="tertiary-button" type="button" disabled={taskSelected.size === 0} onclick={() => (taskSelected = new Set())}>{text.tasksClearSelection}</button>
              <span class="task-bulk-spacer"></span>
              <button class="secondary-button" type="button" disabled={taskSelected.size === 0 || Boolean(taskBusy)} onclick={() => void executeTaskAction("trigger", [...taskSelected])}>{text.tasksTriggerSelected}</button>
              <button class="secondary-button danger-action" type="button" disabled={taskSelected.size === 0 || Boolean(taskBusy)} onclick={() => void executeTaskAction("delete", [...taskSelected])}>{text.tasksDeleteSelected}</button>
            </div>
          </div>
          {#if filteredTaskItems.length === 0}
            <div class="settings-card"><div class="settings-row"><p>{text.tasksEmpty}</p></div></div>
          {:else}
            <div class="settings-card">
              {#each filteredTaskItems as task (task.id)}
                <div class="settings-row">
                  <label class="inline-check task-select"><input type="checkbox" checked={taskSelected.has(task.id)} onchange={() => toggleTaskSelection(task.id)} /><span class="sr-only">{text.tasksSelect}</span></label>
                  <div class="profile-info">
                    <strong>{task.channel} / {task.botId}{task.chatId ? ` / ${task.chatId}` : ""}</strong>
                    <p>{taskTypeLabel(task.type, text)} · {task.scheduleText || task.delivery} · {task.timezone}</p>
                    <p>{taskStatusLabel(task.status, text)}{task.runCount > 0 ? ` · ${text.tasksRunCount}: ${task.runCount}` : ""}{task.lastTriggeredAt ? ` · ${text.tasksLastTriggered}: ${task.lastTriggeredAt.slice(0, 19).replace("T", " ")}` : ""}</p>
                    <p class="task-text-preview" title={task.text}>{task.text.split(/\r?\n/)[0] || task.text}</p>
                    {#if task.lastError}<p class="run-history-failed">{task.lastError}</p>{/if}
                    <div class="task-execution-list">
                      <strong>{text.tasksExecutions}</strong>
                      {#if task.executions.length === 0}
                        <p>{text.tasksNoExecutions}</p>
                      {:else}
                        {#each task.executions.slice(0, 5) as execution (execution.id)}
                          <div class="task-execution-row">
                            <span>{execution.status} · {execution.startedAt.slice(0, 19).replace("T", " ")}</span>
                            <span>{text.tasksRunCount}: {execution.attempt}/{execution.maxAttempts}</span>
                            <button class="task-session-link" type="button" title={execution.sessionId} disabled={Boolean(taskBusy) || !execution.sessionId} onclick={() => void openTaskSession(task.id, execution.id)}>
                              {text.tasksSession}: {execution.sessionId || text.tasksSessionCleaned}
                            </button>
                            {#if execution.lastError}<span class="run-history-failed">{execution.lastError}</span>{/if}
                          </div>
                        {/each}
                      {/if}
                    </div>
                  </div>
                  <div class="row-icon-actions">
                    <button class="row-icon-btn" type="button" title={text.tasksTrigger} aria-label={text.tasksTrigger} disabled={Boolean(taskBusy)} onclick={() => void executeTaskAction("trigger", [task.id])}><i class="ph ph-play" aria-hidden="true"></i></button>
                    <button class="row-icon-btn" type="button" title={text.channelEdit} aria-label={text.channelEdit} disabled={Boolean(taskBusy) || taskEdit !== null} onclick={() => beginTaskEdit(task)}><i class="ph ph-pencil-simple" aria-hidden="true"></i></button>
                    <button class="row-icon-btn danger-action" type="button" title={text.channelDelete} aria-label={text.channelDelete} disabled={Boolean(taskBusy)} onclick={() => void executeTaskAction("delete", [task.id])}><i class="ph ph-trash" aria-hidden="true"></i></button>
                  </div>
                </div>
              {/each}
            </div>
          {/if}
          {#if taskEdit}
            <form id="desktop-task-form" class="settings-card provider-editor" aria-label={sectionLabel("tasks", text)} onsubmit={(event) => { event.preventDefault(); void saveTaskEditor(); }}>
              <header class="entity-editor-head"><strong>{sectionLabel("tasks", text)} · {taskEdit.channel} / {taskEdit.botId}</strong><button class="modal-close" type="button" aria-label={text.cancel} disabled={Boolean(taskBusy)} onclick={() => (taskEdit = null)}><i class="ph ph-x"></i></button></header>
              <label class="settings-field settings-field-wide"><span>{text.tasksText}</span><textarea rows="6" bind:value={taskEdit.draftText}></textarea></label>
              <div class="settings-form"><label class="settings-field"><span>{text.tasksDelivery}</span><select bind:value={taskEdit.draftDelivery}><option value="agent">agent</option><option value="text">text</option></select></label><label class="settings-field"><span>{text.tasksSessionMode}</span><select bind:value={taskEdit.draftSessionMode}><option value="chat">chat</option><option value="fresh">fresh</option></select></label>{#if taskEdit.type !== "immediate"}<label class="settings-field"><span>{text.tasksSchedule}</span><input bind:value={taskEdit.draftSchedule} /></label>{/if}{#if taskEdit.type === "periodic"}<label class="settings-field"><span>{text.tasksTimezone}</span><select bind:value={taskEdit.draftTimezone}>{#if taskEdit.draftTimezone && !timezoneOptions().includes(taskEdit.draftTimezone)}<option value={taskEdit.draftTimezone}>{taskEdit.draftTimezone}</option>{/if}{#each timezoneOptions() as tz (tz)}<option value={tz}>{tz}</option>{/each}</select></label>{/if}</div>
              <footer class="entity-editor-foot"><button class="secondary-button" type="button" disabled={Boolean(taskBusy)} onclick={() => (taskEdit = null)}>{text.cancel}</button><button class="primary-button" type="submit" disabled={Boolean(taskBusy) || !taskEdit.draftText.trim()}>{taskBusy ? text.onboardingProviderSaving : text.save}</button></footer>
            </form>
          {/if}
          {#if taskActionMessage}<p class="settings-action-message">{taskActionMessage}</p>{/if}
          {#if taskSession}
            <div class="modal-overlay" role="dialog" aria-modal="true" tabindex="-1" aria-label={text.tasksSession} onclick={() => (taskSession = null)} onkeydown={(event) => { if (event.key === "Escape") taskSession = null; }}>
              <div class="modal-card" tabindex="-1" role="presentation" onclick={(event) => event.stopPropagation()} onkeydown={(event) => event.stopPropagation()}>
                <header class="modal-head">
                  <strong>{text.tasksSession} · {taskSession.sessionId}</strong>
                  <button class="modal-close" type="button" aria-label={text.cancel} onclick={() => (taskSession = null)}><i class="ph ph-x"></i></button>
                </header>
                <div class="modal-body task-session-detail">
                  {#if taskSession.messages.length === 0}
                    <p>{text.tasksSessionCleaned}</p>
                  {:else}
                    {#each taskSession.messages as message, index (`${index}-${message.role}`)}
                      <div class="task-session-message">
                        <strong>{message.role || "message"}</strong>
                        <p>{message.content}</p>
                      </div>
                    {/each}
                  {/if}
                </div>
              </div>
            </div>
          {/if}
        {/if}
      {:else if activeSection === "runtimeEnv"}
        <p class="settings-section-hint">{text.runtimeEnvHint}</p>
        {#if !serviceReady}
          <div class="settings-card"><div class="settings-row"><p>{text.unavailable}</p></div></div>
        {:else if runtimeEnvLoading || !runtimeEnv}
          <div class="settings-card"><div class="settings-row"><p>{text.loading}</p></div></div>
        {:else}
          <div class="settings-card">
            <div class="settings-row">
              <strong>{text.runtimeDepStatusInstalled}: {runtimeEnv.counts.installed}</strong>
              <span class="diag-value">{text.runtimeDepStatusMissing}: {runtimeEnv.counts.missing} · {runtimeEnv.counts.total} {text.runtimeDepTotal}</span>
            </div>
          </div>
          <div class="settings-card">
            {#each runtimeEnv.dependencies as dep (dep.id)}
              <div class="settings-row runtime-dep-row">
                <div class="profile-info">
                  <strong>{dep.name}</strong>
                  <span class="status-badge" data-state={dep.status === "installed" ? "ready" : dep.status === "missing" ? "error" : "incompatible"}>
                    {dep.status === "installed" ? text.runtimeDepStatusInstalled : dep.status === "missing" ? text.runtimeDepStatusMissing : text.runtimeDepStatusUnknown}
                  </span>
                  <p>{text.runtimeDepPurpose}: {dep.purpose}</p>
                  <p>{text.runtimeDepVersion}: {dep.version || "—"} · {text.runtimeDepSource}: {dep.source} · {text.runtimeDepSize}: {dep.estimatedSize}</p>
                  {#if dep.installCommand}
                    <p class="runtime-install-command"><code>{dep.installCommand}</code></p>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
          <p class="settings-section-hint">{text.runtimeDepInstallDeferred}</p>
        {/if}
      {:else}
        <p class="settings-section-hint">{text.diagnosticsHint}</p>
        <div class="settings-card">
          <div class="settings-row">
            <strong>{text.diagServiceVersion}</strong>
            <span class="diag-value">{status?.service.version ?? text.unknownValue}</span>
          </div>
          <div class="settings-row">
            <strong>{text.diagOwnership}</strong>
            <span class="diag-value">{ownershipText}</span>
          </div>
          <div class="settings-row">
            <strong>{text.diagEndpoint}</strong>
            <span class="diag-value">{status?.service.endpoint ?? text.unavailable}</span>
          </div>
          <div class="settings-row">
            <strong>{text.diagState}</strong>
            <span class="status-badge" data-state={status?.service.state ?? "disconnected"}>{serviceStateLabel(status?.service.state, text)}</span>
          </div>
        </div>
        <div class="diag-actions">
          <button class="secondary-button" type="button" onclick={copyDiagnostics}>
            {diagnosticsCopied ? text.copied : text.copyDiagnostics}
          </button>
        </div>
      {/if}

      {#if toolSettingsMessage && ["webSearch", "imageGenerate", "videoGenerate", "ttsGenerate"].includes(activeSection)}<p class="settings-action-message">{toolSettingsMessage}</p>{/if}
      {#if error}<p class="error-message">{error}</p>{/if}
      {#if toolSettingsDirty.has(activeSection as ToolSettingsSection)}
        <footer class="settings-footbar">
          <span class="settings-footbar-label">{text.settingsUnsaved}</span>
          <div class="settings-footbar-actions">
            <button class="primary-button" type="button" disabled={toolSettingsSaving} onclick={() => void saveToolSettings()}>{toolSettingsSaving ? text.onboardingProviderSaving : text.save}</button>
          </div>
        </footer>
      {:else if activeSection === "models" && modelRoutingDirty}
        <footer class="settings-footbar">
          <span class="settings-footbar-label">{text.settingsUnsaved}</span>
          <div class="settings-footbar-actions">
            <button class="secondary-button" type="button" disabled={modelRoutingSaving} onclick={discardModelRouting}>{text.discardChanges}</button>
            <button class="primary-button" type="button" disabled={modelRoutingSaving} onclick={() => void saveAdvancedModelRouting()}>{modelRoutingSaving ? text.onboardingProviderSaving : text.save}</button>
          </div>
        </footer>
      {:else if activeSection === "plugins" && pluginsDirty}
        <footer class="settings-footbar">
          <span class="settings-footbar-label">{text.settingsUnsaved}</span>
          <div class="settings-footbar-actions">
            <button class="secondary-button" type="button" disabled={pluginsSaving} onclick={discardPlugins}>{text.discardChanges}</button>
            <button class="primary-button" type="submit" form="desktop-plugins-form" disabled={pluginsSaving}>{pluginsSaving ? text.onboardingProviderSaving : text.save}</button>
          </div>
        </footer>
      {:else if activeSection === "skills" && skillsSearchDirty}
        <footer class="settings-footbar">
          <span class="settings-footbar-label">{text.settingsUnsaved}</span>
          <div class="settings-footbar-actions">
            <button class="secondary-button" type="button" disabled={skillsSaving} onclick={discardSkillsSearch}>{text.discardChanges}</button>
            <button class="primary-button" type="submit" form="desktop-skills-search-form" disabled={skillsSaving}>{skillsSaving ? text.onboardingProviderSaving : text.save}</button>
          </div>
        </footer>
      {:else if activeSection === "providers" && providerGlobalsDirty}
        <footer class="settings-footbar">
          <span class="settings-footbar-label">{text.settingsUnsaved}</span>
          <div class="settings-footbar-actions">
            <button class="primary-button" type="button" disabled={providerSaving} onclick={() => void saveProviderGlobals()}>{providerSaving ? text.onboardingProviderSaving : text.providerSaveGlobal}</button>
          </div>
        </footer>
      {:else if activeSection === "sandbox" && sandboxDirty}
        <footer class="settings-footbar">
          <span class="settings-footbar-label">{text.settingsUnsaved}</span>
          <div class="settings-footbar-actions">
            <button class="secondary-button" type="button" disabled={sandboxSaving} onclick={resetSandboxEditor}>{text.discardChanges}</button>
            <button class="primary-button" type="submit" form="desktop-sandbox-form" disabled={sandboxSaving || (!sandboxEdit?.preserveExternalEnvFilePath && !sandboxEdit?.envFilePath.trim())}>{sandboxSaving ? text.onboardingProviderSaving : text.sandboxSave}</button>
          </div>
        </footer>
      {:else if shouldShowServiceReconnect(serviceReady)}
        <footer class="settings-footbar settings-footbar-notice">
          <button class="secondary-button" type="button" onclick={refreshStatus}>{text.reconnectService}</button>
        </footer>
      {/if}
      </div>
    </section>
  </main>
{:else}
  <ChatView
    copy={text}
    serviceEndpoint={status?.service.endpoint ?? null}
    serviceState={status?.service.state ?? "disconnected"}
    launchAtLogin={status?.launchAtLogin ?? false}
    launchAtLoginBusy={busy}
    setLaunchAtLogin={setLoginStart}
    {openSettings}
  />
{/if}
