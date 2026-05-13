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

  function fallbackRoutingOptions(requiredTag: ModelCapabilityTag): ModelRouteOption[] {
    return allModelOptions().filter((m) => m.tags.includes(requiredTag) || requiredTag === "text").map((m) => ({ key: m.key, label: m.label }));
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

<div class="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8 sm:px-10 sm:py-10">
  <header class="flex flex-col gap-3">
    <Badge variant="secondary" class="w-fit">Unified model pool</Badge>
    <div class="flex max-w-3xl flex-col gap-2">
      <h1 class="text-3xl font-semibold tracking-tight text-foreground">AI Routing & Prompt</h1>
      <p class="text-sm leading-6 text-muted-foreground">
        Built-in and custom models are mixed in one pool. Pick the best model per capability; Molibot chooses the native transport from the selected route key.
      </p>
    </div>
    <a class="text-sm font-medium text-primary hover:underline" href="/settings/ai/providers">Manage providers</a>
  </header>

  {#if loading}
    <p class="py-8 text-sm text-muted-foreground">Loading routing settings...</p>
  {:else}
    {@const pool = enabledProviderCounts()}
    <form class="space-y-6" onsubmit={(e) => { e.preventDefault(); save(); }}>
      <Card>
        <CardHeader>
          <div class="flex items-center justify-between gap-3">
            <div>
              <CardTitle>Active pool</CardTitle>
              <CardDescription>One routing surface</CardDescription>
            </div>
            <Badge variant="default">{pool.models} enabled models</Badge>
          </div>
        </CardHeader>
        <CardContent class="space-y-4">
          <div class="grid gap-3 sm:grid-cols-3">
            <div class="rounded-lg border bg-muted/40 p-3 text-center">
              <div class="text-xs text-muted-foreground">Built-in providers</div>
              <div class="text-2xl font-bold text-foreground">{pool.builtin}</div>
            </div>
            <div class="rounded-lg border bg-muted/40 p-3 text-center">
              <div class="text-xs text-muted-foreground">Custom providers</div>
              <div class="text-2xl font-bold text-foreground">{pool.custom}</div>
            </div>
            <div class="rounded-lg border bg-muted/40 p-3 text-center">
              <div class="text-xs text-muted-foreground">Fallback policy</div>
              <div class="text-sm font-semibold text-foreground">{fallbackPolicyText(form.modelFallback.mode)}</div>
            </div>
          </div>
          <div class="rounded-lg border bg-muted/40 px-3 py-3 text-xs text-muted-foreground">
            <strong class="text-foreground">How it works:</strong> `pi|provider|model` routes use built-in pi-ai transports. `custom|provider|model` routes use OpenAI-compatible provider settings. They can be mixed freely below.
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Capability routing</CardTitle>
          <CardDescription>Choose concrete models</CardDescription>
        </CardHeader>
        <CardContent>
          <div class="grid gap-4 md:grid-cols-2">
            {#each routeCards as card}
              {@const options = routingOptions(card.route)}
              <div class="rounded-lg border bg-muted/40 p-4">
                <div class="flex items-center justify-between gap-3 mb-3">
                  <div>
                    <h3 class="text-sm font-semibold text-foreground">{card.title}</h3>
                    <p class="text-xs text-muted-foreground">{card.description}</p>
                  </div>
                  <Badge variant="outline" class="text-[10px]">{transportLabel(modelRoutingValue(card.route))}</Badge>
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
                <p class="mt-2 text-xs text-muted-foreground">{routeSummary(card.route)}</p>
              </div>
            {/each}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Subagent model levels</CardTitle>
          <CardDescription>Map delegation tiers</CardDescription>
        </CardHeader>
        <CardContent class="space-y-4">
          <div class="rounded-lg border bg-muted/40 px-3 py-3 text-xs text-muted-foreground">
            <strong class="text-foreground">How subagents choose models:</strong> Built-in roles reference levels such as `haiku` and `sonnet`, not Claude-specific model IDs. Map each level to any text-capable model in your pool. Empty levels fall back to the Subagent fallback route, then the text route.
          </div>
          <div class="grid gap-4 md:grid-cols-2">
            {#each subagentLevelCards as card}
              {@const options = routingOptions("subagent")}
              <div class="rounded-lg border bg-muted/40 p-4">
                <div class="flex items-center justify-between gap-3 mb-3">
                  <div>
                    <h3 class="text-sm font-semibold text-foreground">{card.title}</h3>
                    <p class="text-xs text-muted-foreground">{card.description}</p>
                  </div>
                  <Badge variant="outline" class="text-[10px]">{transportLabel(subagentLevelValue(card.level))}</Badge>
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Runtime defaults</CardTitle>
          <CardDescription>Fallback, thinking, and context</CardDescription>
        </CardHeader>
        <CardContent>
          <div class="grid gap-4 md:grid-cols-2">
            <div class="grid gap-1.5">
              <Label for="rt-fallback">Model fallback policy</Label>
              <NativeSelect id="rt-fallback" bind:value={form.modelFallback.mode}>
                <NativeSelectOption value="off">Off - fail on the selected model</NativeSelectOption>
                <NativeSelectOption value="same-provider">Same provider only</NativeSelectOption>
                <NativeSelectOption value="any-enabled">Any enabled provider</NativeSelectOption>
              </NativeSelect>
              <p class="text-xs text-muted-foreground">Same-provider is the default: retries stay inside the selected provider.</p>
            </div>

            <div class="grid gap-1.5">
              <Label for="rt-thinking">Default thinking</Label>
              <NativeSelect id="rt-thinking" bind:value={form.defaultThinkingLevel}>
                <NativeSelectOption value="off">Off</NativeSelectOption>
                <NativeSelectOption value="low">Low</NativeSelectOption>
                <NativeSelectOption value="medium">Medium</NativeSelectOption>
                <NativeSelectOption value="high">High</NativeSelectOption>
              </NativeSelect>
              <p class="text-xs text-muted-foreground">Applies only when the selected model or custom provider explicitly supports thinking.</p>
            </div>

            <div class="grid gap-1.5">
              <Label>Automatic compaction</Label>
              <div class="flex items-center gap-3 rounded-lg border px-3 py-2">
                <Checkbox id="rt-compact" bind:checked={form.compaction.enabled} />
                <Label for="rt-compact" class="text-sm">Summarize older turns when context gets tight.</Label>
              </div>
            </div>

            <div class="grid gap-1.5">
              <Label for="rt-default-cw">Default context window</Label>
              <Input id="rt-default-cw" type="number" min="1024" step="1000" bind:value={form.compaction.defaultContextWindow} />
              <p class="text-xs text-muted-foreground">Fallback context window when the model doesn't report one. Default 200000 (200K).</p>
            </div>

            <div class="grid gap-1.5">
              <Label for="rt-threshold">Compaction threshold (%)</Label>
              <Input id="rt-threshold" type="number" min="10" max="95" step="5" bind:value={form.compaction.thresholdPercent} />
              <p class="text-xs text-muted-foreground">Trigger compaction when context exceeds this % of the model's context window. Default 75%.</p>
            </div>

            <div class="grid gap-1.5">
              <Label for="rt-reserve">Reserve tokens</Label>
              <Input id="rt-reserve" type="number" min="1024" step="256" bind:value={form.compaction.reserveTokens} />
              <p class="text-xs text-muted-foreground">Safety margin for model output. Also caps the trigger line at (window − reserve). Default 8192.</p>
            </div>

            <div class="grid gap-1.5">
              <Label for="rt-keep">Keep recent tokens</Label>
              <Input id="rt-keep" type="number" min="2048" step="512" bind:value={form.compaction.keepRecentTokens} />
              <p class="text-xs text-muted-foreground">Recent turns preserved verbatim during compaction. Default 20000.</p>
            </div>

            {#if true}
              {@const preview = compactionTriggerPreview()}
              <div class="rounded-lg border bg-muted/40 px-3 py-3 text-xs text-muted-foreground md:col-span-2">
                <strong class="text-foreground">Trigger preview</strong> — current text model context window: <strong class="text-foreground">{(preview.window / 1000)}K</strong>, compaction fires when estimated tokens &gt; <strong class="text-foreground">{(preview.trigger / 1000).toFixed(preview.trigger % 1000 !== 0 ? 1 : 0)}K</strong> ({preview.reason})

                {#if preview.fromModel}
                  <span class="ml-1">(window from model metadata)</span>
                {:else}
                  <span class="ml-1">(using default context window)</span>
                {/if}
              </div>
            {/if}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Compatibility fallback</CardTitle>
          <CardDescription>Legacy default anchor</CardDescription>
        </CardHeader>
        <CardContent>
          <div class="grid gap-4 md:grid-cols-2">
            <div class="grid gap-1.5">
              <Label for="rt-mode">Legacy default source</Label>
              <NativeSelect id="rt-mode" bind:value={form.providerMode}>
                <NativeSelectOption value="pi">Built-in transport fallback</NativeSelectOption>
                <NativeSelectOption value="custom">Custom provider fallback</NativeSelectOption>
              </NativeSelect>
              <p class="text-xs text-muted-foreground">Used only when a text route is empty or no longer matches a configured model.</p>
            </div>

            <div class="grid gap-1.5">
              <Label for="rt-pi-provider">Built-in fallback provider</Label>
              <NativeSelect id="rt-pi-provider" bind:value={form.piModelProvider} onchange={onPiProviderChanged}>
                {#each visiblePiProviders() as provider}
                  <NativeSelectOption value={provider.id}>{provider.name}</NativeSelectOption>
                {/each}
              </NativeSelect>
            </div>

            <div class="grid gap-1.5 md:col-span-2">
              <Label for="rt-pi-model">Built-in fallback model</Label>
              <NativeSelect id="rt-pi-model" bind:value={form.piModelName}>
                {#each providerModels[form.piModelProvider] ?? [] as model}
                  <NativeSelectOption value={model}>{model}</NativeSelectOption>
                {/each}
              </NativeSelect>
              {#if visiblePiProviders().length === 0}
                <p class="text-xs text-destructive">No enabled built-in provider. Enable one in Providers if you want this anchor to work.</p>
              {/if}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Agent persona</CardTitle>
          <CardDescription>Global system prompt</CardDescription>
        </CardHeader>
        <CardContent class="space-y-4">
          <div class="grid gap-1.5">
            <Label for="rt-tz">Runtime timezone</Label>
            <NativeSelect id="rt-tz" bind:value={form.timezone}>
              {#each timeZoneOptions as zone}
                <NativeSelectOption value={zone}>{zone}</NativeSelectOption>
              {/each}
            </NativeSelect>
            <p class="text-xs text-muted-foreground">
              Used for per-message <code class="font-mono">&lt;env&gt;</code> time injection, task scheduling, and usage/date views.
            </p>
          </div>

          <div class="grid gap-1.5">
            <Label for="rt-prompt">System prompt</Label>
            <Textarea id="rt-prompt" class="min-h-[200px] font-mono text-sm" bind:value={form.systemPrompt} placeholder="You are Molibot..." />
          </div>
        </CardContent>
      </Card>

      <div class="flex items-center justify-between gap-3">
        <div class="flex items-center gap-2">
          {#if message}
            <span class="text-sm text-emerald-600 dark:text-emerald-400">{message}</span>
          {/if}
          {#if error}
            <span class="text-sm text-destructive">{error}</span>
          {/if}
        </div>
        <Button type="submit" variant="default" size="lg" disabled={saving}>
          {saving ? "Saving..." : "Save Routing"}
        </Button>
      </div>
    </form>
  {/if}
</div>
