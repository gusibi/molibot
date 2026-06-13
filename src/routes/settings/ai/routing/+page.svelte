<script lang="ts">
  import { onMount } from "svelte";
  import { Alert, AlertDescription } from "$lib/components/ui/alert";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "$lib/components/ui/card";
  import { Checkbox } from "$lib/components/ui/checkbox";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { NativeSelect, NativeSelectOption } from "$lib/components/ui/native-select";
  import { Textarea } from "$lib/components/ui/textarea";
  import { locale } from "$lib/ui/i18n";

  type ProviderMode = "pi" | "custom";
  type ModelRole = "system" | "user" | "assistant" | "tool" | "developer";
  type ThinkingSupportMode = "auto" | "enabled" | "disabled";
  type ThinkingFormat = "auto" | "openai" | "openrouter" | "deepseek" | "zai" | "qwen" | "qwen-chat-template";
  type ThinkingEffortLevel = "low" | "medium" | "high";
  type DefaultThinkingLevel = "off" | "low" | "medium" | "high";
  type ModelCapabilityTag = "text" | "vision" | "audio_input" | "stt" | "tts" | "tool";
  type ModelFallbackMode = "off" | "same-provider" | "any-enabled";
  type ModelRoute = "text" | "vision" | "stt" | "tts" | "subagent";
  type SubagentModelLevel = "haiku" | "sonnet" | "opus" | "thinking";

  interface ProviderModelForm { id: string; tags: ModelCapabilityTag[]; supportedRoles: ModelRole[]; }

  interface CustomProviderForm {
    id: string; name: string; enabled: boolean; baseUrl: string; apiKey: string;
    models: ProviderModelForm[]; defaultModel: string; path: string;
    supportsThinking?: boolean; thinkingSupportMode: ThinkingSupportMode;
    thinkingFormat: ThinkingFormat; reasoningEffortMap: Partial<Record<ThinkingEffortLevel, string>>;
  }

  interface AIForm {
    providerMode: ProviderMode; piModelProvider: string; piModelName: string;
    defaultThinkingLevel: DefaultThinkingLevel; defaultCustomProviderId: string;
    customProviders: CustomProviderForm[];
    modelRouting: {
      textModelKey: string; visionModelKey: string; sttModelKey: string; ttsModelKey: string;
      subagentModelKey: string; subagentHaikuModelKey: string; subagentSonnetModelKey: string;
      subagentOpusModelKey: string; subagentThinkingModelKey: string;
    };
    modelFallback: { mode: ModelFallbackMode };
    compaction: { enabled: boolean; thresholdPercent: number; reserveTokens: number; keepRecentTokens: number; defaultContextWindow: number };
    systemPrompt: string; timezone: string;
  }

  interface MetaResponse { providers: Array<{ id: string; name: string }>; providerModels: Record<string, string[]>; capabilityTags: ModelCapabilityTag[]; }
  interface ModelRouteOption { key: string; label: string; contextWindow?: number; }
  interface ModelSwitchResponse { ok: boolean; error?: string; routes?: Record<"text" | "vision" | "stt" | "tts" | "subagent", { currentKey: string; options: ModelRouteOption[] }>; }

  const COPY = {
    "zh-CN": {
      eyebrow: "统一模型池",
      title: "AI 路由与提示词",
      desc: "内置模型与自定义模型混合在同一个池中。为每种能力选择最佳模型；Molibot 将根据所选的路由 Key 自动选择对应的传输通道。",
      manageProviders: "管理服务商 →",
      loading: "正在加载路由设置...",
      activePoolTitle: "活动模型池",
      activePoolDesc: "统一路由界面",
      enabledModels: "个启用的模型",
      builtinProviders: "内置服务商",
      customProviders: "自定义服务商",
      fallbackPolicy: "兜底策略",
      howItWorksTitle: "工作原理：",
      howItWorksDesc: "`pi|provider|model` 路由使用内置的 pi-ai 传输通道；`custom|provider|model` 路由则使用符合 OpenAI 规范的自定义服务商设置。您可以在下方自由组合它们。",
      capabilityRoutingTitle: "能力路由",
      capabilityRoutingDesc: "为特定能力绑定具体模型",
      primaryText: "主文本模型",
      primaryTextDesc: "主对话、工具调用和任务规划",
      noTextModel: "无可用文本模型",
      vision: "视觉",
      visionDesc: "图像理解兜底模型",
      noVisionModel: "无可用视觉模型",
      stt: "语音转文本 (STT)",
      sttDesc: "音频转录路由模型",
      noSttModel: "无可用 STT 模型",
      tts: "文本转语音 (TTS)",
      ttsDesc: "语音合成路由模型",
      noTtsModel: "未配置 TTS 模型",
      subagentFallback: "子智能体兜底",
      subagentFallbackDesc: "当子智能体级别未映射时的兜底模型",
      useTextFallback: "使用主文本模型兜底",
      subagentsLevelTitle: "子智能体模型级别",
      subagentsLevelDesc: "映射不同委派层级的模型",
      subagentsExplanationTitle: "子智能体如何选择模型：",
      subagentsExplanationDesc: "内置角色使用 `haiku`、`sonnet` 等抽象层级，而不是特定服务商的模型 ID。将每个层级映射到模型池中的任意文本模型。未配置的层级将依次退化到子智能体兜底路由、主文本模型路由。",
      useSubagentFallback: "使用子智能体兜底路由",
      haikuTitle: "Haiku (轻量)",
      haikuDesc: "快速、低成本的轻量任务委派",
      sonnetTitle: "Sonnet (均衡)",
      sonnetDesc: "平衡规划、执行和审查的委派",
      opusTitle: "Opus (强力)",
      opusDesc: "最高能力级别的委派层级",
      thinkingTitle: "Thinking (推理)",
      thinkingDesc: "重推理的委派任务",
      runtimeDefaultsTitle: "运行时默认设置",
      runtimeDefaultsDesc: "兜底、推理和上下文窗口",
      fallbackPolicyLabel: "模型兜底策略",
      fallbackOff: "关闭 — 直接在所选模型上报错",
      fallbackSame: "仅限同服务商",
      fallbackAny: "任意已启用的服务商",
      fallbackHint: "默认为“仅限同服务商”：重试保留在所选服务商内部。",
      defaultThinkingLabel: "默认推理力度",
      thinkingOff: "关闭",
      thinkingLow: "低 (Low)",
      thinkingMedium: "中 (Medium)",
      thinkingHigh: "高 (High)",
      thinkingHint: "仅在所选模型或自定义服务商明确支持 Thinking/Reasoning 时生效。",
      autoCompactionLabel: "自动上下文压缩",
      autoCompactionDesc: "当上下文紧张时，自动对较早的对话轮次进行摘要压缩。",
      defaultCwLabel: "默认上下文窗口",
      defaultCwHint: "当模型未报告上下文窗口时的兜底值。默认 200000 (200K)。",
      thresholdLabel: "压缩触发阈值 (%)",
      thresholdHint: "当上下文占用超过模型上下文窗口的此百分比时触发压缩。默认 75%。",
      reserveTokensLabel: "保留 Token 数",
      reserveTokensHint: "为模型输出留出的安全余量。触发线也会被限制在 (窗口 - 保留数)。默认 8192。",
      keepRecentLabel: "保留最近对话 Token 数",
      keepRecentHint: "压缩时将完整保留的最近对话 Token 数量。默认 20000。",
      previewTitle: "触发预览",
      currentTextCw: "当前文本模型上下文窗口：",
      compactionFires: "当估算的 Token 数超过",
      compactionReason: "时触发压缩",
      windowFromMetadata: "窗口大小来自模型元数据",
      windowFromDefault: "使用默认上下文窗口",
      compactionEnabled: "已启用",
      compactionDisabled: "已禁用",
      compabilityFallbackTitle: "兼容性兜底 (Legacy)",
      compabilityFallbackDesc: "历史遗留的默认锚点",
      legacySourceLabel: "历史默认来源",
      legacyPiFallback: "内置 pi-ai 传输通道兜底",
      legacyCustomFallback: "自定义服务商兜底",
      legacySourceHint: "仅在路由 Key 为空或不再匹配任何已配置模型时作为最终后备使用。",
      legacyPiProviderLabel: "内置兜底服务商",
      legacyPiModelLabel: "内置兜底模型",
      noBuiltinProviderError: "未启用任何内置服务商。如果您希望此锚点生效，请在“服务商”页面中启用至少一个。",
      agentPersonaTitle: "智能体设定",
      agentPersonaDesc: "全局系统提示词及环境",
      timezoneLabel: "运行时时区",
      timezoneHint: "用于单条消息的 `<env>` 时间注入、任务调度以及使用量/日期展示。",
      systemPromptLabel: "系统提示词 (System Prompt)",
      systemPromptPlaceholder: "例如：你是一个简洁而有帮助的助手...",
      saving: "保存中...",
      saveBtn: "保存路由设置",
      failedLoadSettings: "加载配置失败",
      failedLoadMeta: "加载 AI 元数据失败",
      failedLoadRoutes: "加载模型路由选项失败",
      failedSave: "保存 AI 路由设置失败",
      savedSuccess: "AI 路由设置已保存。"
    },
    "en-US": {
      eyebrow: "Unified model pool",
      title: "AI Routing & Prompt",
      desc: "Built-in and custom models are mixed in one pool. Pick the best model per capability; Molibot chooses the native transport from the selected route key.",
      manageProviders: "Manage providers →",
      loading: "Loading routing settings...",
      activePoolTitle: "Active pool",
      activePoolDesc: "One routing surface",
      enabledModels: "enabled models",
      builtinProviders: "Built-in providers",
      customProviders: "Custom providers",
      fallbackPolicy: "Fallback policy",
      howItWorksTitle: "How it works:",
      howItWorksDesc: "`pi|provider|model` routes use built-in pi-ai transports. `custom|provider|model` routes use OpenAI-compatible provider settings. They can be mixed freely below.",
      capabilityRoutingTitle: "Capability routing",
      capabilityRoutingDesc: "Choose concrete models",
      primaryText: "Primary text",
      primaryTextDesc: "Main conversation, tools, and planning",
      noTextModel: "No text model available",
      vision: "Vision",
      visionDesc: "Image understanding fallback",
      noVisionModel: "No vision model available",
      stt: "Speech-to-text",
      sttDesc: "Audio transcription route",
      noSttModel: "No STT model available",
      tts: "Text-to-speech",
      ttsDesc: "Voice synthesis route",
      noTtsModel: "No TTS model configured",
      subagentFallback: "Subagent fallback",
      subagentFallbackDesc: "Fallback when a subagent model level is not mapped",
      useTextFallback: "Use text route fallback",
      subagentsLevelTitle: "Subagent model levels",
      subagentsLevelDesc: "Map delegation tiers",
      subagentsExplanationTitle: "How subagents choose models:",
      subagentsExplanationDesc: "Built-in roles reference levels such as `haiku` and `sonnet`, not Claude-specific model IDs. Map each level to any text-capable model in your pool. Empty levels fall back to the Subagent fallback route, then the text route.",
      useSubagentFallback: "Use subagent fallback",
      haikuTitle: "Haiku",
      haikuDesc: "Fast, low-cost scout-style delegation",
      sonnetTitle: "Sonnet",
      sonnetDesc: "Balanced planning, worker, and review delegation",
      opusTitle: "Opus",
      opusDesc: "Highest-capability delegation tier",
      thinkingTitle: "Thinking",
      thinkingDesc: "Reasoning-heavy delegated tasks",
      runtimeDefaultsTitle: "Runtime defaults",
      runtimeDefaultsDesc: "Fallback, thinking, and context",
      fallbackPolicyLabel: "Model fallback policy",
      fallbackOff: "Off — fail on the selected model",
      fallbackSame: "Same provider only",
      fallbackAny: "Any enabled provider",
      fallbackHint: "Same-provider is the default: retries stay inside the selected provider.",
      defaultThinkingLabel: "Default thinking",
      thinkingOff: "Off",
      thinkingLow: "Low",
      thinkingMedium: "Medium",
      thinkingHigh: "High",
      thinkingHint: "Applies only when the selected model or custom provider explicitly supports thinking.",
      autoCompactionLabel: "Automatic compaction",
      autoCompactionDesc: "Summarize older turns when context gets tight.",
      defaultCwLabel: "Default context window",
      defaultCwHint: "Fallback context window when the model doesn't report one. Default 200000 (200K).",
      thresholdLabel: "Compaction threshold (%)",
      thresholdHint: "Trigger compaction when context exceeds this % of the model's context window. Default 75%.",
      reserveTokensLabel: "Reserve tokens",
      reserveTokensHint: "Safety margin for model output. Also caps the trigger line at (window − reserve). Default 8192.",
      keepRecentLabel: "Keep recent tokens",
      keepRecentHint: "Recent turns preserved verbatim during compaction. Default 20000.",
      previewTitle: "Trigger preview",
      currentTextCw: "current text model context window:",
      compactionFires: "compaction fires when estimated tokens >",
      compactionReason: "reason",
      windowFromMetadata: "(window from model metadata)",
      windowFromDefault: "(using default context window)",
      compactionEnabled: "Enabled",
      compactionDisabled: "Disabled",
      compabilityFallbackTitle: "Compatibility fallback",
      compabilityFallbackDesc: "Legacy default anchor",
      legacySourceLabel: "Legacy default source",
      legacyPiFallback: "Built-in transport fallback",
      legacyCustomFallback: "Custom provider fallback",
      legacySourceHint: "Used only when a text route is empty or no longer matches a configured model.",
      legacyPiProviderLabel: "Built-in fallback provider",
      legacyPiModelLabel: "Built-in fallback model",
      noBuiltinProviderError: "No enabled built-in provider. Enable one in Providers if you want this anchor to work.",
      agentPersonaTitle: "Agent persona",
      agentPersonaDesc: "Global system prompt",
      timezoneLabel: "Runtime timezone",
      timezoneHint: "Used for per-message <env> time injection, task scheduling, and usage/date views.",
      systemPromptLabel: "System prompt",
      systemPromptPlaceholder: "You are Molibot...",
      saving: "Saving...",
      saveBtn: "Save Routing",
      failedLoadSettings: "Failed to load settings",
      failedLoadMeta: "Failed to load AI metadata",
      failedLoadRoutes: "Failed to load model routing options",
      failedSave: "Failed to save AI settings",
      savedSuccess: "AI routing settings saved."
    }
  } as const;

  let loading = true; let saving = false; let error = ""; let message = "";
  let providers: Array<{ id: string; name: string }> = [];
  let providerModels: Record<string, string[]> = {};
  let routeOptions: Record<ModelRoute, ModelRouteOption[]> = { text: [], vision: [], stt: [], tts: [], subagent: [] };
  let capabilityTags: ModelCapabilityTag[] = ["text", "vision", "stt", "tts", "tool"];

  const preferredTimeZones = ["UTC", "Asia/Shanghai", "Asia/Tokyo", "Europe/London", "Europe/Berlin", "America/Los_Angeles", "America/New_York", "America/Chicago", "America/Denver", "Australia/Sydney"];

  function listSupportedTimeZones(): string[] {
    if (typeof Intl.supportedValuesOf === "function") {
      try { const values = Intl.supportedValuesOf("timeZone"); if (values.length > 0) return values; } catch { /* fallback */ }
    }
    return preferredTimeZones;
  }

  function buildTimeZoneOptions(selected: string): string[] {
    const out: string[] = []; const seen = new Set<string>();
    const push = (value: string): void => { const n = String(value ?? "").trim(); if (!n || seen.has(n)) return; seen.add(n); out.push(n); };
    push(selected);
    for (const zone of preferredTimeZones) push(zone);
    for (const zone of listSupportedTimeZones()) push(zone);
    return out;
  }

  let timeZoneOptions: string[] = buildTimeZoneOptions(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");

  let form: AIForm = {
    providerMode: "pi", piModelProvider: "anthropic", piModelName: "claude-sonnet-4-20250514",
    defaultThinkingLevel: "off", defaultCustomProviderId: "", customProviders: [],
    modelRouting: { textModelKey: "", visionModelKey: "", sttModelKey: "", ttsModelKey: "", subagentModelKey: "", subagentHaikuModelKey: "", subagentSonnetModelKey: "", subagentOpusModelKey: "", subagentThinkingModelKey: "" },
    modelFallback: { mode: "same-provider" },
    compaction: { enabled: true, thresholdPercent: 75, reserveTokens: 8192, keepRecentTokens: 20000, defaultContextWindow: 200000 },
    systemPrompt: "You are Molibot, a concise and helpful assistant.",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  };

  $: copy = COPY[$locale] ?? COPY["en-US"];

  function onPiProviderChanged(): void {
    const models = providerModels[form.piModelProvider] ?? [];
    if (models.length > 0 && !models.includes(form.piModelName)) form.piModelName = models[0];
  }

  function enabledBuiltinProviderIds(): string[] {
    return form.customProviders.filter((p) => p.enabled && providers.some((row) => row.id === p.id)).map((p) => p.id);
  }

  function visiblePiProviders(): Array<{ id: string; name: string }> {
    const enabledIds = new Set(enabledBuiltinProviderIds());
    const filtered = providers.filter((p) => enabledIds.has(p.id));
    if (filtered.length > 0) return filtered;
    return providers.filter((p) => p.id === form.piModelProvider);
  }

  function ensurePiProviderEnabled(): void {
    const visible = visiblePiProviders();
    if (!visible.some((p) => p.id === form.piModelProvider)) form.piModelProvider = visible[0]?.id ?? form.piModelProvider;
  }

  function allModelOptions(): Array<{ key: string; label: string; tags: ModelCapabilityTag[] }> {
    const out: Array<{ key: string; label: string; tags: ModelCapabilityTag[] }> = [
      { key: `pi|${form.piModelProvider}|${form.piModelName}`, label: `[PI] ${form.piModelProvider} / ${form.piModelName}`, tags: ["text", "vision"] as ModelCapabilityTag[] },
    ];
    for (const cp of form.customProviders.filter((p) => p.enabled)) {
      for (const m of cp.models) {
        const isBuiltin = providers.some((p) => p.id === cp.id);
        out.push({ key: `${isBuiltin ? "pi" : "custom"}|${cp.id}|${m.id}`, label: `${isBuiltin ? "[PI]" : "[Custom]"} ${cp.name} / ${m.id}`, tags: m.tags });
      }
    }
    return out;
  }

  function fallbackRoutingOptions(requiredTag: string): ModelRouteOption[] {
    return allModelOptions().filter((m) => m.tags.includes(requiredTag as ModelCapabilityTag) || requiredTag === "text").map((m) => ({ key: m.key, label: m.label }));
  }

  $: routeCards = [
    { route: "text", title: copy.primaryText, description: copy.primaryTextDesc, emptyText: copy.noTextModel },
    { route: "vision", title: copy.vision, description: copy.visionDesc, emptyText: copy.noVisionModel },
    { route: "stt", title: copy.stt, description: copy.sttDesc, emptyText: copy.noSttModel },
    { route: "tts", title: copy.tts, description: copy.ttsDesc, emptyText: copy.noTtsModel },
    { route: "subagent", title: copy.subagentFallback, description: copy.subagentFallbackDesc, emptyText: copy.noTextModel },
  ] as Array<{ route: ModelRoute; title: string; description: string; emptyText: string }>;

  $: subagentLevelCards = [
    { level: "haiku", title: copy.haikuTitle, description: copy.haikuDesc },
    { level: "sonnet", title: copy.sonnetTitle, description: copy.sonnetDesc },
    { level: "opus", title: copy.opusTitle, description: copy.opusDesc },
    { level: "thinking", title: copy.thinkingTitle, description: copy.thinkingDesc },
  ] as Array<{ level: SubagentModelLevel; title: string; description: string }>;

  function routingOptions(route: ModelRoute): ModelRouteOption[] {
    const fromServer = routeOptions[route] ?? [];
    if (fromServer.length > 0) return fromServer;
    return fallbackRoutingOptions(route);
  }

  function modelRoutingValue(route: ModelRoute): string {
    return route === "text" ? form.modelRouting.textModelKey
      : route === "vision" ? form.modelRouting.visionModelKey
      : route === "stt" ? form.modelRouting.sttModelKey
      : route === "tts" ? form.modelRouting.ttsModelKey
      : form.modelRouting.subagentModelKey;
  }

  function setModelRoutingValue(route: ModelRoute, value: string): void {
    form.modelRouting = { ...form.modelRouting, [route === "text" ? "textModelKey" : route === "vision" ? "visionModelKey" : route === "stt" ? "sttModelKey" : route === "tts" ? "ttsModelKey" : "subagentModelKey"]: value };
  }

  function subagentLevelValue(level: SubagentModelLevel): string {
    return level === "haiku" ? form.modelRouting.subagentHaikuModelKey
      : level === "sonnet" ? form.modelRouting.subagentSonnetModelKey
      : level === "opus" ? form.modelRouting.subagentOpusModelKey
      : form.modelRouting.subagentThinkingModelKey;
  }

  function setSubagentLevelValue(level: SubagentModelLevel, value: string): void {
    form.modelRouting = { ...form.modelRouting, [level === "haiku" ? "subagentHaikuModelKey" : level === "sonnet" ? "subagentSonnetModelKey" : level === "opus" ? "subagentOpusModelKey" : "subagentThinkingModelKey"]: value };
  }

  function selectedRouteOption(route: ModelRoute): ModelRouteOption | undefined {
    const selected = modelRoutingValue(route);
    return routingOptions(route).find((row) => row.key === selected);
  }

  function transportLabel(key: string): string {
    if (!key) return copy.thinkingOff; // Wait, actually is "Not set" or similar
    if (key.startsWith("pi|")) return copy.zhCN ? "内置" : "Built-in";
    if (key.startsWith("custom|")) return copy.zhCN ? "自定义" : "Custom";
    return copy.zhCN ? "兜底" : "Fallback";
  }

  function providerFromKey(key: string): string { const [, p = ""] = key.split("|"); return p || (copy.zhCN ? "未选择" : "not selected"); }
  function modelFromKey(key: string): string { const parts = key.split("|"); return parts.slice(2).join("|") || (copy.zhCN ? "未选择" : "not selected"); }

  function routeSummary(route: ModelRoute): string {
    const option = selectedRouteOption(route);
    if (!option) return routingOptions(route).length > 0 ? (copy.zhCN ? "未保存" : "Not saved yet") : (copy.zhCN ? "无可用模型" : "No model available");
    return `${transportLabel(option.key)} / ${providerFromKey(option.key)} / ${modelFromKey(option.key)}`;
  }

  function textModelContextWindow(): number {
    const option = selectedRouteOption("text");
    return option?.contextWindow ?? 200000;
  }

  function compactionTriggerPreview(): { window: number; trigger: number; reason: string; fromModel: boolean } {
    const win = textModelContextWindow();
    const pct = form.compaction.thresholdPercent || 75;
    const reserve = form.compaction.reserveTokens || 8192;
    const pctLimit = Math.floor(win * pct / 100);
    const resLimit = win - reserve;
    const trigger = Math.min(pctLimit, resLimit);
    return {
      window: win,
      trigger,
      reason: pctLimit <= resLimit ? (copy.zhCN ? "阈值百分比" : "threshold %") : (copy.zhCN ? "保留容量" : "reserve"),
      fromModel: win !== form.compaction.defaultContextWindow
    };
  }

  function enabledProviderCounts(): { builtin: number; custom: number; models: number } {
    let builtin = 0; let custom = 0; let models = 0;
    for (const p of form.customProviders) {
      if (!p.enabled) continue;
      if (providers.some((row) => row.id === p.id)) builtin += 1; else custom += 1;
      models += p.models.filter((m) => m.id.trim()).length;
    }
    return { builtin, custom, models };
  }

  function fallbackPolicyText(mode: ModelFallbackMode): string {
    if (mode === "off") return copy.fallbackOff;
    if (mode === "any-enabled") return copy.fallbackAny;
    return copy.fallbackSame;
  }

  function ensureRoutingDefaults(): void {
    const text = routingOptions("text");
    if (!text.some((r) => r.key === form.modelRouting.textModelKey)) setModelRoutingValue("text", text[0]?.key ?? "");
    const vision = routingOptions("vision");
    if (!vision.some((v) => v.key === form.modelRouting.visionModelKey)) setModelRoutingValue("vision", vision[0]?.key ?? "");
    const stt = routingOptions("stt");
    if (!stt.some((v) => v.key === form.modelRouting.sttModelKey)) setModelRoutingValue("stt", stt[0]?.key ?? "");
    const tts = routingOptions("tts");
    if (!tts.some((v) => v.key === form.modelRouting.ttsModelKey)) setModelRoutingValue("tts", tts[0]?.key ?? "");
    const subagent = routingOptions("subagent");
    if (form.modelRouting.subagentModelKey && !subagent.some((v) => v.key === form.modelRouting.subagentModelKey)) setModelRoutingValue("subagent", "");
    for (const row of subagentLevelCards) {
      const current = subagentLevelValue(row.level);
      if (current && !subagent.some((v) => v.key === current)) setSubagentLevelValue(row.level, "");
    }
  }

  async function loadAll(): Promise<void> {
    loading = true; error = ""; message = "";
    try {
      const [settingsRes, metaRes] = await Promise.all([fetch("/api/settings"), fetch("/api/settings/ai-meta")]);
      const settingsData = await settingsRes.json();
      const metaData = (await metaRes.json()) as MetaResponse & { ok: boolean; error?: string };
      if (!settingsData.ok) throw new Error(settingsData.error || copy.failedLoadSettings);
      if (!metaData.ok) throw new Error(metaData.error || copy.failedLoadMeta);

      const modelSwitchRes = await fetch("/api/settings/model-switch");
      const modelSwitchData = (await modelSwitchRes.json()) as ModelSwitchResponse;
      if (!modelSwitchData.ok) throw new Error(modelSwitchData.error || copy.failedLoadRoutes);
      routeOptions = {
        text: modelSwitchData.routes?.text.options ?? [], vision: modelSwitchData.routes?.vision.options ?? [],
        stt: modelSwitchData.routes?.stt.options ?? [], tts: modelSwitchData.routes?.tts.options ?? [],
        subagent: modelSwitchData.routes?.subagent.options ?? [],
      };

      providers = metaData.providers ?? [];
      providerModels = metaData.providerModels ?? {};
      capabilityTags = metaData.capabilityTags ?? capabilityTags;

      const s = settingsData.settings;
      const loadedProviders = (s.customProviders ?? []) as Array<CustomProviderForm & { supportedRoles?: ModelRole[] }>;
      form = {
        providerMode: s.providerMode, piModelProvider: s.piModelProvider, piModelName: s.piModelName,
        defaultThinkingLevel: s.defaultThinkingLevel ?? "off", defaultCustomProviderId: s.defaultCustomProviderId ?? "",
        customProviders: loadedProviders.map((cp) => ({
          ...cp,
          enabled: providers.some((p) => p.id === cp.id) ? cp.enabled === true : cp.enabled !== false,
          models: Array.isArray(cp.models) ? cp.models.map((m: any) => ({ id: String(m.id ?? m), tags: Array.isArray(m.tags) ? m.tags : ["text"], supportedRoles: Array.isArray(m.supportedRoles) ? m.supportedRoles : ["system", "user", "assistant", "tool"] })) : [],
          defaultModel: cp.defaultModel ?? "",
          thinkingSupportMode: cp.supportsThinking === true ? "enabled" : cp.supportsThinking === false ? "disabled" : "auto",
          thinkingFormat: (cp.thinkingFormat as ThinkingFormat | undefined) ?? "auto",
          reasoningEffortMap: cp.reasoningEffortMap && typeof cp.reasoningEffortMap === "object" ? cp.reasoningEffortMap : {},
        })),
        modelRouting: {
          textModelKey: s.modelRouting?.textModelKey ?? "", visionModelKey: s.modelRouting?.visionModelKey ?? "",
          sttModelKey: s.modelRouting?.sttModelKey ?? "", ttsModelKey: s.modelRouting?.ttsModelKey ?? "",
          subagentModelKey: s.modelRouting?.subagentModelKey ?? "",
          subagentHaikuModelKey: s.modelRouting?.subagentHaikuModelKey ?? "", subagentSonnetModelKey: s.modelRouting?.subagentSonnetModelKey ?? "",
          subagentOpusModelKey: s.modelRouting?.subagentOpusModelKey ?? "", subagentThinkingModelKey: s.modelRouting?.subagentThinkingModelKey ?? "",
        },
        modelFallback: { mode: s.modelFallback?.mode === "off" || s.modelFallback?.mode === "any-enabled" ? s.modelFallback.mode : "same-provider" },
        compaction: { enabled: s.compaction?.enabled ?? true, thresholdPercent: Number(s.compaction?.thresholdPercent ?? 75), reserveTokens: Number(s.compaction?.reserveTokens ?? 8192), keepRecentTokens: Number(s.compaction?.keepRecentTokens ?? 20000), defaultContextWindow: Number(s.compaction?.defaultContextWindow ?? 200000) },
        systemPrompt: s.systemPrompt,
        timezone: s.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
      };

      onPiProviderChanged();
      ensurePiProviderEnabled();
      ensureRoutingDefaults();
      timeZoneOptions = buildTimeZoneOptions(form.timezone);
    } catch (e) { error = e instanceof Error ? e.message : String(e); }
    finally { loading = false; }
  }

  async function save(): Promise<void> {
    saving = true; error = ""; message = "";
    try {
      ensureRoutingDefaults();
      const res = await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || copy.failedSave);
      message = copy.savedSuccess;
      await loadAll();
    } catch (e) { error = e instanceof Error ? e.message : String(e); }
    finally { saving = false; }
  }

  $: timeZoneOptions = buildTimeZoneOptions(form.timezone);
  onMount(loadAll);
</script>

<div class="routing-page">
  <!-- Hero Header -->
  <header class="routing-hero">
    <span class="routing-badge">{copy.eyebrow}</span>
    <h1 class="routing-hero-title">{copy.title}</h1>
    <p class="routing-hero-desc">
      {copy.desc}
    </p>
    <a class="routing-hero-link" href="/settings/ai/providers">{copy.manageProviders}</a>
  </header>

  {#if loading}
    <p class="routing-loading">{copy.loading}</p>
  {:else}
    {@const pool = enabledProviderCounts()}
    <form class="routing-form" id="routing-form" onsubmit={(e) => { e.preventDefault(); void save(); }}>

      <!-- Active Pool -->
      <section class="routing-card">
        <div class="routing-card-header">
          <div>
            <h2 class="routing-card-title">{copy.activePoolTitle}</h2>
            <p class="routing-card-desc">{copy.activePoolDesc}</p>
          </div>
          <span class="routing-badge-accent">{pool.models} {copy.enabledModels}</span>
        </div>
        <div class="routing-metrics">
          <div class="routing-metric">
            <div class="routing-metric-label">{copy.builtinProviders}</div>
            <div class="routing-metric-value">{pool.builtin}</div>
          </div>
          <div class="routing-metric">
            <div class="routing-metric-label">{copy.customProviders}</div>
            <div class="routing-metric-value">{pool.custom}</div>
          </div>
          <div class="routing-metric">
            <div class="routing-metric-label">{copy.fallbackPolicy}</div>
            <div class="routing-metric-policy">{fallbackPolicyText(form.modelFallback.mode)}</div>
          </div>
        </div>
        <div class="routing-callout">
          <strong>{copy.howItWorksTitle}</strong> {copy.howItWorksDesc}
        </div>
      </section>

      <!-- Capability Routing -->
      <section class="routing-card">
        <div class="routing-card-header">
          <div>
            <h2 class="routing-card-title">{copy.capabilityRoutingTitle}</h2>
            <p class="routing-card-desc">{copy.capabilityRoutingDesc}</p>
          </div>
        </div>
        <div class="routing-grid">
          {#each routeCards as card}
            {@const options = routingOptions(card.route)}
            <div class="routing-field-card">
              <div class="routing-field-header">
                <div>
                  <h3 class="routing-field-title">{card.title}</h3>
                  <p class="routing-field-desc">{card.description}</p>
                </div>
                <span class="routing-badge-outline">{transportLabel(modelRoutingValue(card.route))}</span>
              </div>
              <NativeSelect
                value={modelRoutingValue(card.route)}
                disabled={options.length === 0}
                onchange={(e) => setModelRoutingValue(card.route, (e.currentTarget as HTMLSelectElement).value)}
              >
                {#if options.length === 0}
                  <NativeSelectOption value="">{card.emptyText}</NativeSelectOption>
                {:else}
                  {#if card.route === "subagent"}
                    <NativeSelectOption value="">{copy.useTextFallback}</NativeSelectOption>
                  {/if}
                  {#each options as row}
                    <NativeSelectOption value={row.key}>{row.label}</NativeSelectOption>
                  {/each}
                {/if}
              </NativeSelect>
              <p class="routing-field-status">{routeSummary(card.route)}</p>
            </div>
          {/each}
        </div>
      </section>

      <!-- Subagent Model Levels -->
      <section class="routing-card">
        <div class="routing-card-header">
          <div>
            <h2 class="routing-card-title">{copy.subagentsLevelTitle}</h2>
            <p class="routing-card-desc">{copy.subagentsLevelDesc}</p>
          </div>
        </div>
        <div class="routing-callout">
          <strong>{copy.subagentsExplanationTitle}</strong> {copy.subagentsExplanationDesc}
        </div>
        <div class="routing-grid">
          {#each subagentLevelCards as card}
            {@const options = routingOptions("subagent")}
            <div class="routing-field-card">
              <div class="routing-field-header">
                <div>
                  <h3 class="routing-field-title">{card.title}</h3>
                  <p class="routing-field-desc">{card.description}</p>
                </div>
                <span class="routing-badge-outline">{transportLabel(subagentLevelValue(card.level))}</span>
              </div>
              <NativeSelect
                value={subagentLevelValue(card.level)}
                disabled={options.length === 0}
                onchange={(e) => setSubagentLevelValue(card.level, (e.currentTarget as HTMLSelectElement).value)}
              >
                <NativeSelectOption value="">{copy.useSubagentFallback}</NativeSelectOption>
                {#each options as row}
                  <NativeSelectOption value={row.key}>{row.label}</NativeSelectOption>
                {/each}
              </NativeSelect>
            </div>
          {/each}
        </div>
      </section>

      <!-- Runtime Defaults -->
      <section class="routing-card">
        <div class="routing-card-header">
          <div>
            <h2 class="routing-card-title">{copy.runtimeDefaultsTitle}</h2>
            <p class="routing-card-desc">{copy.runtimeDefaultsDesc}</p>
          </div>
        </div>
        <div class="routing-form-grid">
          <div class="routing-form-group">
            <Label for="rt-fallback">{copy.fallbackPolicyLabel}</Label>
            <NativeSelect id="rt-fallback" bind:value={form.modelFallback.mode}>
              <NativeSelectOption value="off">{copy.fallbackOff}</NativeSelectOption>
              <NativeSelectOption value="same-provider">{copy.fallbackSame}</NativeSelectOption>
              <NativeSelectOption value="any-enabled">{copy.fallbackAny}</NativeSelectOption>
            </NativeSelect>
            <p class="routing-form-hint">{copy.fallbackHint}</p>
          </div>

          <div class="routing-form-group">
            <Label for="rt-thinking">{copy.defaultThinkingLabel}</Label>
            <NativeSelect id="rt-thinking" bind:value={form.defaultThinkingLevel}>
              <NativeSelectOption value="off">{copy.thinkingOff}</NativeSelectOption>
              <NativeSelectOption value="low">{copy.thinkingLow}</NativeSelectOption>
              <NativeSelectOption value="medium">{copy.thinkingMedium}</NativeSelectOption>
              <NativeSelectOption value="high">{copy.thinkingHigh}</NativeSelectOption>
            </NativeSelect>
            <p class="routing-form-hint">{copy.thinkingHint}</p>
          </div>

          <div class="routing-form-group">
            <Label>{copy.autoCompactionLabel}</Label>
            <div class="routing-checkbox-row">
              <Checkbox id="rt-compact" bind:checked={form.compaction.enabled} />
              <Label for="rt-compact" class="routing-checkbox-label">{copy.autoCompactionDesc}</Label>
            </div>
          </div>

          <div class="routing-form-group">
            <Label for="rt-default-cw">{copy.defaultCwLabel}</Label>
            <Input id="rt-default-cw" type="number" min="1024" step="1000" bind:value={form.compaction.defaultContextWindow} />
            <p class="routing-form-hint">{copy.defaultCwHint}</p>
          </div>

          <div class="routing-form-group">
            <Label for="rt-threshold">{copy.thresholdLabel}</Label>
            <Input id="rt-threshold" type="number" min="10" max="95" step="5" bind:value={form.compaction.thresholdPercent} />
            <p class="routing-form-hint">{copy.thresholdHint}</p>
          </div>

          <div class="routing-form-group">
            <Label for="rt-reserve">{copy.reserveTokensLabel}</Label>
            <Input id="rt-reserve" type="number" min="1024" step="256" bind:value={form.compaction.reserveTokens} />
            <p class="routing-form-hint">{copy.reserveTokensHint}</p>
          </div>

          <div class="routing-form-group">
            <Label for="rt-keep">{copy.keepRecentLabel}</Label>
            <Input id="rt-keep" type="number" min="2048" step="512" bind:value={form.compaction.keepRecentTokens} />
            <p class="routing-form-hint">{copy.keepRecentHint}</p>
          </div>

          {#if true}
            {@const preview = compactionTriggerPreview()}
            <div class="routing-preview-callout">
              <strong>{copy.previewTitle}</strong> — {copy.currentTextCw}
              <strong>{(preview.window / 1000)}K</strong>,
              {copy.compactionFires}
              <strong>{(preview.trigger / 1000).toFixed(preview.trigger % 1000 !== 0 ? 1 : 0)}K</strong>
              ({copy.compactionReason}: {preview.reason})
              {#if preview.fromModel}
                <span class="routing-preview-note">{copy.windowFromMetadata}</span>
              {:else}
                <span class="routing-preview-note">{copy.windowFromDefault}</span>
              {/if}
            </div>
          {/if}
        </div>
      </section>

      <!-- Compatibility Fallback -->
      <section class="routing-card">
        <details class="routing-accordion" open>
          <summary class="routing-accordion-header">
            <div>
              <h2 class="routing-card-title">{copy.compabilityFallbackTitle}</h2>
              <p class="routing-card-desc">{copy.compabilityFallbackDesc}</p>
            </div>
            <span class="routing-accordion-chevron" aria-hidden="true">▾</span>
          </summary>
          <div class="routing-accordion-body">
            <div class="routing-form-grid">
              <div class="routing-form-group">
                <Label for="rt-mode">{copy.legacySourceLabel}</Label>
                <NativeSelect id="rt-mode" bind:value={form.providerMode}>
                  <NativeSelectOption value="pi">{copy.legacyPiFallback}</NativeSelectOption>
                  <NativeSelectOption value="custom">{copy.legacyCustomFallback}</NativeSelectOption>
                </NativeSelect>
                <p class="routing-form-hint">{copy.legacySourceHint}</p>
              </div>

              <div class="routing-form-group">
                <Label for="rt-pi-provider">{copy.legacyPiProviderLabel}</Label>
                <NativeSelect id="rt-pi-provider" bind:value={form.piModelProvider} onchange={onPiProviderChanged}>
                  {#each visiblePiProviders() as provider}
                    <NativeSelectOption value={provider.id}>{provider.name}</NativeSelectOption>
                  {/each}
                </NativeSelect>
              </div>

              <div class="routing-form-group routing-form-group--full">
                <Label for="rt-pi-model">{copy.legacyPiModelLabel}</Label>
                <NativeSelect id="rt-pi-model" bind:value={form.piModelName}>
                  {#each providerModels[form.piModelProvider] ?? [] as model}
                    <NativeSelectOption value={model}>{model}</NativeSelectOption>
                  {/each}
                </NativeSelect>
                {#if visiblePiProviders().length === 0}
                  <p class="routing-form-error">{copy.noBuiltinProviderError}</p>
                {/if}
              </div>
            </div>
          </div>
        </details>
      </section>

      <!-- Agent Persona -->
      <section class="routing-card">
        <div class="routing-card-header">
          <div>
            <h2 class="routing-card-title">{copy.agentPersonaTitle}</h2>
            <p class="routing-card-desc">{copy.agentPersonaDesc}</p>
          </div>
        </div>
        <div class="routing-form-group">
          <Label for="rt-tz">{copy.timezoneLabel}</Label>
          <NativeSelect id="rt-tz" bind:value={form.timezone}>
            {#each timeZoneOptions as zone}
              <NativeSelectOption value={zone}>{zone}</NativeSelectOption>
            {/each}
          </NativeSelect>
          <p class="routing-form-hint">
            {copy.timezoneHint}
          </p>
        </div>
        <div class="routing-form-group">
          <Label for="rt-prompt">{copy.systemPromptLabel}</Label>
          <Textarea id="rt-prompt" class="routing-prompt-editor" bind:value={form.systemPrompt} placeholder={copy.systemPromptPlaceholder} />
        </div>
      </section>

    </form>
  {/if}
</div>

{#if !loading}
  <!-- Fixed Footer Bar -->
  <footer class="settings-footbar">
    <div class="settings-footbar-status">
      {#if message}
        <span class="settings-footbar-ok">{message}</span>
      {/if}
      {#if error}
        <span class="settings-footbar-error">{error}</span>
      {/if}
    </div>
    <button type="submit" form="routing-form" class="settings-footbar-btn" disabled={saving}>
      {saving ? copy.saving : copy.saveBtn}
    </button>
  </footer>
{/if}
