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

  const routeCards: Array<{ route: ModelRoute; title: string; description: string; emptyText: string }> = [
    { route: "text", title: "Primary text", description: "Main conversation, tools, and planning", emptyText: "No text model available" },
    { route: "vision", title: "Vision", description: "Image understanding fallback", emptyText: "No vision model available" },
    { route: "stt", title: "Speech-to-text", description: "Audio transcription route", emptyText: "No STT model available" },
    { route: "tts", title: "Text-to-speech", description: "Voice synthesis route", emptyText: "No TTS model configured" },
    { route: "subagent", title: "Subagent fallback", description: "Fallback when a subagent model level is not mapped", emptyText: "No text model available" },
  ];

  const subagentLevelCards: Array<{ level: SubagentModelLevel; title: string; description: string }> = [
    { level: "haiku", title: "Haiku", description: "Fast, low-cost scout-style delegation" },
    { level: "sonnet", title: "Sonnet", description: "Balanced planning, worker, and review delegation" },
    { level: "opus", title: "Opus", description: "Highest-capability delegation tier" },
    { level: "thinking", title: "Thinking", description: "Reasoning-heavy delegated tasks" },
  ];

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
    if (!key) return "Not set";
    if (key.startsWith("pi|")) return "Built-in";
    if (key.startsWith("custom|")) return "Custom";
    return "Fallback";
  }

  function providerFromKey(key: string): string { const [, p = ""] = key.split("|"); return p || "not selected"; }
  function modelFromKey(key: string): string { const parts = key.split("|"); return parts.slice(2).join("|") || "not selected"; }

  function routeSummary(route: ModelRoute): string {
    const option = selectedRouteOption(route);
    if (!option) return routingOptions(route).length > 0 ? "Not saved yet" : "No model available";
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
      reason: pctLimit <= resLimit ? "threshold %" : "reserve",
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
    if (mode === "off") return "Do not retry another model";
    if (mode === "any-enabled") return "Retry across the whole enabled model pool";
    return "Retry only inside the same provider";
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
      if (!settingsData.ok) throw new Error(settingsData.error || "Failed to load settings");
      if (!metaData.ok) throw new Error(metaData.error || "Failed to load AI metadata");

      const modelSwitchRes = await fetch("/api/settings/model-switch");
      const modelSwitchData = (await modelSwitchRes.json()) as ModelSwitchResponse;
      if (!modelSwitchData.ok) throw new Error(modelSwitchData.error || "Failed to load model routing options");
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
      if (!data.ok) throw new Error(data.error || "Failed to save AI settings");
      message = "AI routing settings saved.";
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
    <span class="routing-badge">Unified model pool</span>
    <h1 class="routing-hero-title">AI Routing & Prompt</h1>
    <p class="routing-hero-desc">
      Built-in and custom models are mixed in one pool. Pick the best model per capability; Molibot chooses the native transport from the selected route key.
    </p>
    <a class="routing-hero-link" href="/settings/ai/providers">Manage providers →</a>
  </header>

  {#if loading}
    <p class="routing-loading">Loading routing settings...</p>
  {:else}
    {@const pool = enabledProviderCounts()}
    <form class="routing-form" id="routing-form" onsubmit={(e) => { e.preventDefault(); save(); }}>

      <!-- Active Pool -->
      <section class="routing-card">
        <div class="routing-card-header">
          <div>
            <h2 class="routing-card-title">Active pool</h2>
            <p class="routing-card-desc">One routing surface</p>
          </div>
          <span class="routing-badge-accent">{pool.models} enabled models</span>
        </div>
        <div class="routing-metrics">
          <div class="routing-metric">
            <div class="routing-metric-label">Built-in providers</div>
            <div class="routing-metric-value">{pool.builtin}</div>
          </div>
          <div class="routing-metric">
            <div class="routing-metric-label">Custom providers</div>
            <div class="routing-metric-value">{pool.custom}</div>
          </div>
          <div class="routing-metric">
            <div class="routing-metric-label">Fallback policy</div>
            <div class="routing-metric-policy">{fallbackPolicyText(form.modelFallback.mode)}</div>
          </div>
        </div>
        <div class="routing-callout">
          <strong>How it works:</strong> `pi|provider|model` routes use built-in pi-ai transports. `custom|provider|model` routes use OpenAI-compatible provider settings. They can be mixed freely below.
        </div>
      </section>

      <!-- Capability Routing -->
      <section class="routing-card">
        <div class="routing-card-header">
          <div>
            <h2 class="routing-card-title">Capability routing</h2>
            <p class="routing-card-desc">Choose concrete models</p>
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
                    <NativeSelectOption value="">Use text route fallback</NativeSelectOption>
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
            <h2 class="routing-card-title">Subagent model levels</h2>
            <p class="routing-card-desc">Map delegation tiers</p>
          </div>
        </div>
        <div class="routing-callout">
          <strong>How subagents choose models:</strong> Built-in roles reference levels such as `haiku` and `sonnet`, not Claude-specific model IDs. Map each level to any text-capable model in your pool. Empty levels fall back to the Subagent fallback route, then the text route.
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
                <NativeSelectOption value="">Use subagent fallback</NativeSelectOption>
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
            <h2 class="routing-card-title">Runtime defaults</h2>
            <p class="routing-card-desc">Fallback, thinking, and context</p>
          </div>
        </div>
        <div class="routing-form-grid">
          <div class="routing-form-group">
            <Label for="rt-fallback">Model fallback policy</Label>
            <NativeSelect id="rt-fallback" bind:value={form.modelFallback.mode}>
              <NativeSelectOption value="off">Off — fail on the selected model</NativeSelectOption>
              <NativeSelectOption value="same-provider">Same provider only</NativeSelectOption>
              <NativeSelectOption value="any-enabled">Any enabled provider</NativeSelectOption>
            </NativeSelect>
            <p class="routing-form-hint">Same-provider is the default: retries stay inside the selected provider.</p>
          </div>

          <div class="routing-form-group">
            <Label for="rt-thinking">Default thinking</Label>
            <NativeSelect id="rt-thinking" bind:value={form.defaultThinkingLevel}>
              <NativeSelectOption value="off">Off</NativeSelectOption>
              <NativeSelectOption value="low">Low</NativeSelectOption>
              <NativeSelectOption value="medium">Medium</NativeSelectOption>
              <NativeSelectOption value="high">High</NativeSelectOption>
            </NativeSelect>
            <p class="routing-form-hint">Applies only when the selected model or custom provider explicitly supports thinking.</p>
          </div>

          <div class="routing-form-group">
            <Label>Automatic compaction</Label>
            <div class="routing-checkbox-row">
              <Checkbox id="rt-compact" bind:checked={form.compaction.enabled} />
              <Label for="rt-compact" class="routing-checkbox-label">Summarize older turns when context gets tight.</Label>
            </div>
          </div>

          <div class="routing-form-group">
            <Label for="rt-default-cw">Default context window</Label>
            <Input id="rt-default-cw" type="number" min="1024" step="1000" bind:value={form.compaction.defaultContextWindow} />
            <p class="routing-form-hint">Fallback context window when the model doesn't report one. Default 200000 (200K).</p>
          </div>

          <div class="routing-form-group">
            <Label for="rt-threshold">Compaction threshold (%)</Label>
            <Input id="rt-threshold" type="number" min="10" max="95" step="5" bind:value={form.compaction.thresholdPercent} />
            <p class="routing-form-hint">Trigger compaction when context exceeds this % of the model's context window. Default 75%.</p>
          </div>

          <div class="routing-form-group">
            <Label for="rt-reserve">Reserve tokens</Label>
            <Input id="rt-reserve" type="number" min="1024" step="256" bind:value={form.compaction.reserveTokens} />
            <p class="routing-form-hint">Safety margin for model output. Also caps the trigger line at (window − reserve). Default 8192.</p>
          </div>

          <div class="routing-form-group">
            <Label for="rt-keep">Keep recent tokens</Label>
            <Input id="rt-keep" type="number" min="2048" step="512" bind:value={form.compaction.keepRecentTokens} />
            <p class="routing-form-hint">Recent turns preserved verbatim during compaction. Default 20000.</p>
          </div>

          {#if true}
            {@const preview = compactionTriggerPreview()}
            <div class="routing-preview-callout">
              <strong>Trigger preview</strong> — current text model context window:
              <strong>{(preview.window / 1000)}K</strong>,
              compaction fires when estimated tokens &gt;
              <strong>{(preview.trigger / 1000).toFixed(preview.trigger % 1000 !== 0 ? 1 : 0)}K</strong>
              ({preview.reason})
              {#if preview.fromModel}
                <span class="routing-preview-note">(window from model metadata)</span>
              {:else}
                <span class="routing-preview-note">(using default context window)</span>
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
              <h2 class="routing-card-title">Compatibility fallback</h2>
              <p class="routing-card-desc">Legacy default anchor</p>
            </div>
            <span class="routing-accordion-chevron" aria-hidden="true">▾</span>
          </summary>
          <div class="routing-accordion-body">
            <div class="routing-form-grid">
              <div class="routing-form-group">
                <Label for="rt-mode">Legacy default source</Label>
                <NativeSelect id="rt-mode" bind:value={form.providerMode}>
                  <NativeSelectOption value="pi">Built-in transport fallback</NativeSelectOption>
                  <NativeSelectOption value="custom">Custom provider fallback</NativeSelectOption>
                </NativeSelect>
                <p class="routing-form-hint">Used only when a text route is empty or no longer matches a configured model.</p>
              </div>

              <div class="routing-form-group">
                <Label for="rt-pi-provider">Built-in fallback provider</Label>
                <NativeSelect id="rt-pi-provider" bind:value={form.piModelProvider} onchange={onPiProviderChanged}>
                  {#each visiblePiProviders() as provider}
                    <NativeSelectOption value={provider.id}>{provider.name}</NativeSelectOption>
                  {/each}
                </NativeSelect>
              </div>

              <div class="routing-form-group routing-form-group--full">
                <Label for="rt-pi-model">Built-in fallback model</Label>
                <NativeSelect id="rt-pi-model" bind:value={form.piModelName}>
                  {#each providerModels[form.piModelProvider] ?? [] as model}
                    <NativeSelectOption value={model}>{model}</NativeSelectOption>
                  {/each}
                </NativeSelect>
                {#if visiblePiProviders().length === 0}
                  <p class="routing-form-error">No enabled built-in provider. Enable one in Providers if you want this anchor to work.</p>
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
            <h2 class="routing-card-title">Agent persona</h2>
            <p class="routing-card-desc">Global system prompt</p>
          </div>
        </div>
        <div class="routing-form-group">
          <Label for="rt-tz">Runtime timezone</Label>
          <NativeSelect id="rt-tz" bind:value={form.timezone}>
            {#each timeZoneOptions as zone}
              <NativeSelectOption value={zone}>{zone}</NativeSelectOption>
            {/each}
          </NativeSelect>
          <p class="routing-form-hint">
            Used for per-message <code>&lt;env&gt;</code> time injection, task scheduling, and usage/date views.
          </p>
        </div>
        <div class="routing-form-group">
          <Label for="rt-prompt">System prompt</Label>
          <Textarea id="rt-prompt" class="routing-prompt-editor" bind:value={form.systemPrompt} placeholder="You are Molibot..." />
        </div>
      </section>

    </form>

    <!-- Fixed Footer Bar -->
    <div class="settings-footbar">
      <div class="settings-footbar-status">
        {#if message}
          <span class="settings-footbar-ok">{message}</span>
        {/if}
        {#if error}
          <span class="settings-footbar-error">{error}</span>
        {/if}
      </div>
      <button type="submit" form="routing-form" class="settings-footbar-btn" disabled={saving}>
        {saving ? "Saving..." : "Save Routing"}
      </button>
    </div>
  {/if}
</div>

<style>
  /* ── Page Shell ── */
  .routing-page {
    max-width: 56rem;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  /* ── Hero Header ── */
  .routing-hero {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin-bottom: 0.5rem;
  }

  .routing-badge {
    display: inline-flex;
    align-self: flex-start;
    padding: 0.125rem 0.625rem;
    border-radius: 9999px;
    background: color-mix(in oklab, var(--primary) 12%, var(--card));
    color: var(--primary);
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.04em;
  }

  .routing-hero-title {
    font-family: var(--font-serif);
    font-size: 2rem;
    font-weight: 700;
    letter-spacing: -0.02em;
    color: var(--foreground);
    margin: 0;
    line-height: 1.15;
  }

  .routing-hero-desc {
    font-size: 0.9375rem;
    line-height: 1.65;
    color: var(--muted-foreground);
    max-width: 42rem;
    margin: 0;
  }

  .routing-hero-link {
    display: inline-flex;
    align-self: flex-start;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--primary);
    text-decoration: none;
    transition: opacity 160ms ease;
  }

  .routing-hero-link:hover { opacity: 0.75; }

  .routing-loading {
    padding: 2.5rem 0;
    font-size: 0.875rem;
    color: var(--muted-foreground);
  }

  /* ── Form ── */
  .routing-form {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  /* ── Card Sections ── */
  .routing-card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 0.625rem;
    padding: 1.5rem;
    box-shadow: 0 1px 3px rgba(0,0,0,0.02), 0 1px 2px rgba(0,0,0,0.04);
  }

  .routing-card-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 1.25rem;
  }

  .routing-card-title {
    font-family: var(--font-serif);
    font-size: 1.125rem;
    font-weight: 700;
    letter-spacing: -0.01em;
    color: var(--foreground);
    margin: 0 0 0.25rem;
    line-height: 1.25;
  }

  .routing-card-desc {
    font-size: 0.8125rem;
    color: var(--muted-foreground);
    margin: 0;
  }

  /* ── Badges ── */
  .routing-badge-accent {
    display: inline-flex;
    align-items: center;
    padding: 0.25rem 0.625rem;
    border-radius: 0.25rem;
    background: color-mix(in oklab, var(--primary) 12%, var(--card));
    color: var(--primary);
    font-size: 0.6875rem;
    font-weight: 600;
    white-space: nowrap;
  }

  .routing-badge-outline {
    display: inline-flex;
    align-items: center;
    padding: 0.125rem 0.5rem;
    border-radius: 0.25rem;
    border: 1px solid var(--border);
    background: var(--background);
    color: var(--muted-foreground);
    font-size: 0.625rem;
    font-weight: 600;
    white-space: nowrap;
  }

  /* ── Metric Grid (Active Pool) ── */
  .routing-metrics {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.75rem;
    margin-bottom: 1rem;
  }

  .routing-metric {
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: color-mix(in oklab, var(--card) 70%, var(--background));
    padding: 0.75rem;
    text-align: center;
  }

  .routing-metric-label {
    font-size: 0.6875rem;
    color: var(--muted-foreground);
    margin-bottom: 0.25rem;
  }

  .routing-metric-value {
    font-size: 1.75rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--foreground);
    line-height: 1.2;
  }

  .routing-metric-policy {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--foreground);
    line-height: 1.4;
  }

  /* ── Callout ── */
  .routing-callout {
    border-radius: 0.5rem;
    border: 1px solid var(--border);
    background: color-mix(in oklab, var(--card) 70%, var(--background));
    padding: 0.75rem 0.875rem;
    font-size: 0.75rem;
    line-height: 1.6;
    color: var(--muted-foreground);
  }

  .routing-callout strong {
    color: var(--foreground);
  }

  /* ── Field Grid (routes / subagent levels) ── */
  .routing-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 1rem;
  }

  .routing-field-card {
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: color-mix(in oklab, var(--card) 70%, var(--background));
    padding: 1rem;
  }

  .routing-field-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }

  .routing-field-title {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--foreground);
    margin: 0 0 0.125rem;
  }

  .routing-field-desc {
    font-size: 0.75rem;
    color: var(--muted-foreground);
    margin: 0;
  }

  .routing-field-status {
    margin-top: 0.5rem;
    font-size: 0.6875rem;
    color: var(--muted-foreground);
    font-family: var(--font-mono);
  }

  /* ── Form Fields ── */
  .routing-form-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 1.25rem;
  }

  .routing-form-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .routing-form-group--full {
    grid-column: 1 / -1;
  }

  .routing-form-hint {
    font-size: 0.75rem;
    color: var(--muted-foreground);
    line-height: 1.5;
    margin: 0;
  }

  .routing-form-error {
    font-size: 0.75rem;
    color: hsl(0 84% 60%);
    margin: 0;
  }

  .routing-checkbox-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    padding: 0.5rem 0.75rem;
  }

  :global(.routing-checkbox-label) {
    font-size: 0.8125rem;
    font-weight: 400;
    color: var(--foreground);
  }

  /* ── Compaction Preview ── */
  .routing-preview-callout {
    grid-column: 1 / -1;
    border-radius: 0.5rem;
    border: 1px solid var(--border);
    background: color-mix(in oklab, var(--card) 70%, var(--background));
    padding: 0.75rem 0.875rem;
    font-size: 0.75rem;
    line-height: 1.6;
    color: var(--muted-foreground);
  }

  .routing-preview-callout strong {
    color: var(--foreground);
  }

  .routing-preview-note {
    margin-left: 0.25rem;
    opacity: 0.7;
  }

  /* ── Accordion (Compatibility fallback) ── */
  .routing-accordion {
    margin: -1.5rem;
  }

  .routing-accordion-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 1.5rem;
    cursor: pointer;
    user-select: none;
    transition: background-color 150ms ease;
  }

  .routing-accordion-header:hover {
    background: color-mix(in oklab, var(--foreground) 3%, transparent);
  }

  .routing-accordion-chevron {
    font-size: 0.75rem;
    color: var(--muted-foreground);
    transition: transform 200ms ease;
    flex-shrink: 0;
    margin-top: 0.125rem;
  }

  .routing-accordion:not([open]) .routing-accordion-chevron {
    transform: rotate(-90deg);
  }

  .routing-accordion-body {
    padding: 0 1.5rem 1.5rem;
  }

  /* ── System Prompt Editor ── */
  :global(.routing-prompt-editor) {
    min-height: 200px;
    font-family: var(--font-mono);
    font-size: 0.8125rem;
    background: var(--background);
  }

  /* ── Responsive ── */
  @media (max-width: 768px) {
    .routing-metrics { grid-template-columns: 1fr; }
    .routing-grid { grid-template-columns: 1fr; }
    .routing-form-grid { grid-template-columns: 1fr; }
  }
</style>
