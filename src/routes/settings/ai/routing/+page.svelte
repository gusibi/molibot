<script lang="ts">
    import { onMount } from "svelte";
    import PageShell from "$lib/ui/PageShell.svelte";
    import Button from "$lib/ui/Button.svelte";

    type ProviderMode = "pi" | "custom";
    type ModelRole = "system" | "user" | "assistant" | "tool" | "developer";
    type ThinkingSupportMode = "auto" | "enabled" | "disabled";
    type ThinkingFormat =
        | "auto"
        | "openai"
        | "openrouter"
        | "deepseek"
        | "zai"
        | "qwen"
        | "qwen-chat-template";
    type ThinkingEffortLevel = "low" | "medium" | "high";
    type DefaultThinkingLevel = "off" | "low" | "medium" | "high";
    type ModelCapabilityTag = "text" | "vision" | "audio_input" | "stt" | "tts" | "tool";
    type ModelFallbackMode = "off" | "same-provider" | "any-enabled";
    type ModelRoute = "text" | "vision" | "stt" | "tts" | "subagent";
    type SubagentModelLevel = "haiku" | "sonnet" | "opus" | "thinking";

    interface ProviderModelForm {
        id: string;
        tags: ModelCapabilityTag[];
        supportedRoles: ModelRole[];
    }

    interface CustomProviderForm {
        id: string;
        name: string;
        enabled: boolean;
        baseUrl: string;
        apiKey: string;
        models: ProviderModelForm[];
        defaultModel: string;
        path: string;
        supportsThinking?: boolean;
        thinkingSupportMode: ThinkingSupportMode;
        thinkingFormat: ThinkingFormat;
        reasoningEffortMap: Partial<Record<ThinkingEffortLevel, string>>;
    }

    interface AIForm {
        providerMode: ProviderMode;
        piModelProvider: string;
        piModelName: string;
        defaultThinkingLevel: DefaultThinkingLevel;
        defaultCustomProviderId: string;
        customProviders: CustomProviderForm[];
        modelRouting: {
            textModelKey: string;
            visionModelKey: string;
            sttModelKey: string;
            ttsModelKey: string;
            subagentModelKey: string;
            subagentHaikuModelKey: string;
            subagentSonnetModelKey: string;
            subagentOpusModelKey: string;
            subagentThinkingModelKey: string;
        };
        modelFallback: {
            mode: ModelFallbackMode;
        };
        compaction: {
            enabled: boolean;
            reserveTokens: number;
            keepRecentTokens: number;
        };
        systemPrompt: string;
        timezone: string;
    }

    interface MetaResponse {
        providers: Array<{ id: string; name: string }>;
        providerModels: Record<string, string[]>;
        capabilityTags: ModelCapabilityTag[];
    }

    interface ModelRouteOption {
        key: string;
        label: string;
    }

    interface ModelSwitchResponse {
        ok: boolean;
        error?: string;
        routes?: Record<
            "text" | "vision" | "stt" | "tts" | "subagent",
            {
                currentKey: string;
                options: ModelRouteOption[];
            }
        >;
    }

    let loading = true;
    let saving = false;
    let error = "";
    let message = "";

    let providers: Array<{ id: string; name: string }> = [];
    let providerModels: Record<string, string[]> = {};
    let routeOptions: Record<ModelRoute, ModelRouteOption[]> = {
        text: [],
        vision: [],
        stt: [],
        tts: [],
        subagent: [],
    };
    let capabilityTags: ModelCapabilityTag[] = [
        "text",
        "vision",
        "stt",
        "tts",
        "tool",
    ];

    const preferredTimeZones = [
        "UTC",
        "Asia/Shanghai",
        "Asia/Tokyo",
        "Europe/London",
        "Europe/Berlin",
        "America/Los_Angeles",
        "America/New_York",
        "America/Chicago",
        "America/Denver",
        "Australia/Sydney",
    ];

    function listSupportedTimeZones(): string[] {
        if (typeof Intl.supportedValuesOf === "function") {
            try {
                const values = Intl.supportedValuesOf("timeZone");
                if (values.length > 0) return values;
            } catch {
                // Fallback to a small stable list below.
            }
        }
        return preferredTimeZones;
    }

    function buildTimeZoneOptions(selected: string): string[] {
        const out: string[] = [];
        const seen = new Set<string>();
        const push = (value: string): void => {
            const normalized = String(value ?? "").trim();
            if (!normalized || seen.has(normalized)) return;
            seen.add(normalized);
            out.push(normalized);
        };

        push(selected);
        for (const zone of preferredTimeZones) push(zone);
        for (const zone of listSupportedTimeZones()) push(zone);
        return out;
    }

    let timeZoneOptions: string[] = buildTimeZoneOptions(
        Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    );

    let form: AIForm = {
        providerMode: "pi",
        piModelProvider: "anthropic",
        piModelName: "claude-sonnet-4-20250514",
        defaultThinkingLevel: "off",
        defaultCustomProviderId: "",
        customProviders: [],
        modelRouting: {
            textModelKey: "",
            visionModelKey: "",
            sttModelKey: "",
            ttsModelKey: "",
            subagentModelKey: "",
            subagentHaikuModelKey: "",
            subagentSonnetModelKey: "",
            subagentOpusModelKey: "",
            subagentThinkingModelKey: "",
        },
        modelFallback: {
            mode: "same-provider",
        },
        compaction: {
            enabled: true,
            reserveTokens: 16384,
            keepRecentTokens: 20000,
        },
        systemPrompt: "You are Molibot, a concise and helpful assistant.",
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    };

    function onPiProviderChanged(): void {
        const models = providerModels[form.piModelProvider] ?? [];
        if (models.length > 0 && !models.includes(form.piModelName)) {
            form.piModelName = models[0];
        }
    }

    function enabledBuiltinProviderIds(): string[] {
        return form.customProviders
            .filter((p) => p.enabled && providers.some((row) => row.id === p.id))
            .map((p) => p.id);
    }

    function visiblePiProviders(): Array<{ id: string; name: string }> {
        const enabledIds = new Set(enabledBuiltinProviderIds());
        const filtered = providers.filter((p) => enabledIds.has(p.id));
        if (filtered.length > 0) return filtered;
        return providers.filter((p) => p.id === form.piModelProvider);
    }

    function ensurePiProviderEnabled(): void {
        const visible = visiblePiProviders();
        if (!visible.some((p) => p.id === form.piModelProvider)) {
            form.piModelProvider = visible[0]?.id ?? form.piModelProvider;
        }
    }

    function allModelOptions(): Array<{
        key: string;
        label: string;
        tags: ModelCapabilityTag[];
    }> {
        const out: Array<{
            key: string;
            label: string;
            tags: ModelCapabilityTag[];
        }> = [
            {
                key: `pi|${form.piModelProvider}|${form.piModelName}`,
                label: `[PI] ${form.piModelProvider} / ${form.piModelName}`,
                tags: ["text", "vision"],
            },
        ];

        for (const cp of form.customProviders.filter((p) => p.enabled)) {
            for (const m of cp.models) {
                const isBuiltin = providers.some((provider) => provider.id === cp.id);
                out.push({
                    key: `${isBuiltin ? "pi" : "custom"}|${cp.id}|${m.id}`,
                    label: `${isBuiltin ? "[PI]" : "[Custom]"} ${cp.name} / ${m.id}`,
                    tags: m.tags,
                });
            }
        }

        return out;
    }

    function fallbackRoutingOptions(
        requiredTag: ModelCapabilityTag,
    ): ModelRouteOption[] {
        return allModelOptions()
            .filter(
                (m) => m.tags.includes(requiredTag) || requiredTag === "text",
            )
            .map((m) => ({ key: m.key, label: m.label }));
    }

    const routeCards: Array<{
        route: ModelRoute;
        title: string;
        description: string;
        emptyText: string;
    }> = [
        {
            route: "text",
            title: "Primary text",
            description: "Main conversation, tools, and planning",
            emptyText: "No text model available",
        },
        {
            route: "vision",
            title: "Vision",
            description: "Image understanding fallback",
            emptyText: "No vision model available",
        },
        {
            route: "stt",
            title: "Speech-to-text",
            description: "Audio transcription route",
            emptyText: "No STT model available",
        },
        {
            route: "tts",
            title: "Text-to-speech",
            description: "Voice synthesis route",
            emptyText: "No TTS model configured",
        },
        {
            route: "subagent",
            title: "Subagent fallback",
            description: "Fallback when a subagent model level is not mapped",
            emptyText: "No text model available",
        },
    ];

    const subagentLevelCards: Array<{
        level: SubagentModelLevel;
        title: string;
        description: string;
    }> = [
        {
            level: "haiku",
            title: "Haiku",
            description: "Fast, low-cost scout-style delegation",
        },
        {
            level: "sonnet",
            title: "Sonnet",
            description: "Balanced planning, worker, and review delegation",
        },
        {
            level: "opus",
            title: "Opus",
            description: "Highest-capability delegation tier",
        },
        {
            level: "thinking",
            title: "Thinking",
            description: "Reasoning-heavy delegated tasks",
        },
    ];

    function routingOptions(route: ModelRoute): ModelRouteOption[] {
        const fromServer = routeOptions[route] ?? [];
        if (fromServer.length > 0) return fromServer;
        return fallbackRoutingOptions(route);
    }

    function modelRoutingValue(route: ModelRoute): string {
        return route === "text"
            ? form.modelRouting.textModelKey
            : route === "vision"
              ? form.modelRouting.visionModelKey
              : route === "stt"
                ? form.modelRouting.sttModelKey
                : route === "tts"
                  ? form.modelRouting.ttsModelKey
                  : form.modelRouting.subagentModelKey;
    }

    function setModelRoutingValue(route: ModelRoute, value: string): void {
        form.modelRouting = {
            ...form.modelRouting,
            [route === "text"
                ? "textModelKey"
                : route === "vision"
                  ? "visionModelKey"
                  : route === "stt"
                    ? "sttModelKey"
                    : route === "tts"
                      ? "ttsModelKey"
                      : "subagentModelKey"]: value,
        };
    }

    function subagentLevelValue(level: SubagentModelLevel): string {
        return level === "haiku"
            ? form.modelRouting.subagentHaikuModelKey
            : level === "sonnet"
              ? form.modelRouting.subagentSonnetModelKey
              : level === "opus"
                ? form.modelRouting.subagentOpusModelKey
                : form.modelRouting.subagentThinkingModelKey;
    }

    function setSubagentLevelValue(level: SubagentModelLevel, value: string): void {
        form.modelRouting = {
            ...form.modelRouting,
            [level === "haiku"
                ? "subagentHaikuModelKey"
                : level === "sonnet"
                  ? "subagentSonnetModelKey"
                  : level === "opus"
                    ? "subagentOpusModelKey"
                    : "subagentThinkingModelKey"]: value,
        };
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

    function providerFromKey(key: string): string {
        const [, provider = ""] = key.split("|");
        return provider || "not selected";
    }

    function modelFromKey(key: string): string {
        const parts = key.split("|");
        return parts.slice(2).join("|") || "not selected";
    }

    function routeSummary(route: ModelRoute): string {
        const option = selectedRouteOption(route);
        if (!option) return routingOptions(route).length > 0 ? "Not saved yet" : "No model available";
        return `${transportLabel(option.key)} / ${providerFromKey(option.key)} / ${modelFromKey(option.key)}`;
    }

    function enabledProviderCounts(): { builtin: number; custom: number; models: number } {
        let builtin = 0;
        let custom = 0;
        let models = 0;
        for (const provider of form.customProviders) {
            if (!provider.enabled) continue;
            if (providers.some((row) => row.id === provider.id)) builtin += 1;
            else custom += 1;
            models += provider.models.filter((model) => model.id.trim()).length;
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
        if (!text.some((row) => row.key === form.modelRouting.textModelKey))
            setModelRoutingValue("text", text[0]?.key ?? "");

        const vision = routingOptions("vision");
        if (!vision.some((v) => v.key === form.modelRouting.visionModelKey)) {
            setModelRoutingValue("vision", vision[0]?.key ?? "");
        }

        const stt = routingOptions("stt");
        if (!stt.some((v) => v.key === form.modelRouting.sttModelKey)) {
            setModelRoutingValue("stt", stt[0]?.key ?? "");
        }

        const tts = routingOptions("tts");
        if (!tts.some((v) => v.key === form.modelRouting.ttsModelKey)) {
            setModelRoutingValue("tts", tts[0]?.key ?? "");
        }

        const subagent = routingOptions("subagent");
        if (form.modelRouting.subagentModelKey && !subagent.some((v) => v.key === form.modelRouting.subagentModelKey)) {
            setModelRoutingValue("subagent", "");
        }
        for (const row of subagentLevelCards) {
            const current = subagentLevelValue(row.level);
            if (current && !subagent.some((v) => v.key === current)) {
                setSubagentLevelValue(row.level, "");
            }
        }
    }

    async function loadAll(): Promise<void> {
        loading = true;
        error = "";
        message = "";

        try {
            const [settingsRes, metaRes] = await Promise.all([
                fetch("/api/settings"),
                fetch("/api/settings/ai-meta"),
            ]);

            const settingsData = await settingsRes.json();
            const metaData = (await metaRes.json()) as MetaResponse & {
                ok: boolean;
                error?: string;
            };

            if (!settingsData.ok)
                throw new Error(
                    settingsData.error || "Failed to load settings",
                );
            if (!metaData.ok)
                throw new Error(metaData.error || "Failed to load AI metadata");

            const modelSwitchRes = await fetch("/api/settings/model-switch");
            const modelSwitchData = (await modelSwitchRes.json()) as ModelSwitchResponse;
            if (!modelSwitchData.ok) {
                throw new Error(modelSwitchData.error || "Failed to load model routing options");
            }
            routeOptions = {
                text: modelSwitchData.routes?.text.options ?? [],
                vision: modelSwitchData.routes?.vision.options ?? [],
                stt: modelSwitchData.routes?.stt.options ?? [],
                tts: modelSwitchData.routes?.tts.options ?? [],
                subagent: modelSwitchData.routes?.subagent.options ?? [],
            };

            providers = metaData.providers ?? [];
            providerModels = metaData.providerModels ?? {};
            capabilityTags = metaData.capabilityTags ?? capabilityTags;

            const s = settingsData.settings;
            const loadedProviders = (s.customProviders ?? []) as Array<
                CustomProviderForm & { supportedRoles?: ModelRole[] }
            >;

            form = {
                providerMode: s.providerMode,
                piModelProvider: s.piModelProvider,
                piModelName: s.piModelName,
                defaultThinkingLevel: s.defaultThinkingLevel ?? "off",
                defaultCustomProviderId: s.defaultCustomProviderId ?? "",
                customProviders: loadedProviders.map((cp) => ({
                    ...cp,
                    enabled: providers.some((p) => p.id === cp.id)
                        ? cp.enabled === true
                        : cp.enabled !== false,
                    models: Array.isArray(cp.models)
                        ? cp.models.map((m: any) => ({
                              id: String(m.id ?? m),
                              tags: Array.isArray(m.tags) ? m.tags : ["text"],
                              supportedRoles: Array.isArray(m.supportedRoles)
                                  ? m.supportedRoles
                                  : ["system", "user", "assistant", "tool"],
                          }))
                        : [],
                    defaultModel: cp.defaultModel ?? "",
                    thinkingSupportMode:
                        cp.supportsThinking === true
                            ? "enabled"
                            : cp.supportsThinking === false
                              ? "disabled"
                              : "auto",
                    thinkingFormat:
                        (cp.thinkingFormat as ThinkingFormat | undefined) ??
                        "auto",
                    reasoningEffortMap:
                        cp.reasoningEffortMap &&
                        typeof cp.reasoningEffortMap === "object"
                            ? cp.reasoningEffortMap
                            : {},
                })),
                modelRouting: {
                    textModelKey: s.modelRouting?.textModelKey ?? "",
                    visionModelKey: s.modelRouting?.visionModelKey ?? "",
                    sttModelKey: s.modelRouting?.sttModelKey ?? "",
                    ttsModelKey: s.modelRouting?.ttsModelKey ?? "",
                    subagentModelKey: s.modelRouting?.subagentModelKey ?? "",
                    subagentHaikuModelKey: s.modelRouting?.subagentHaikuModelKey ?? "",
                    subagentSonnetModelKey: s.modelRouting?.subagentSonnetModelKey ?? "",
                    subagentOpusModelKey: s.modelRouting?.subagentOpusModelKey ?? "",
                    subagentThinkingModelKey: s.modelRouting?.subagentThinkingModelKey ?? "",
                },
                modelFallback: {
                    mode:
                        s.modelFallback?.mode === "off" ||
                        s.modelFallback?.mode === "any-enabled"
                            ? s.modelFallback.mode
                            : "same-provider",
                },
                compaction: {
                    enabled: s.compaction?.enabled ?? true,
                    reserveTokens: Number(s.compaction?.reserveTokens ?? 16384),
                    keepRecentTokens: Number(s.compaction?.keepRecentTokens ?? 20000),
                },
                systemPrompt: s.systemPrompt,
                timezone: s.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
            };

            onPiProviderChanged();
            ensurePiProviderEnabled();
            ensureRoutingDefaults();
            timeZoneOptions = buildTimeZoneOptions(form.timezone);
        } catch (e) {
            error = e instanceof Error ? e.message : String(e);
        } finally {
            loading = false;
        }
    }

    async function save(): Promise<void> {
        saving = true;
        error = "";
        message = "";

        try {
            ensureRoutingDefaults();
            const res = await fetch("/api/settings", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(form),
            });
            const data = await res.json();
            if (!data.ok)
                throw new Error(data.error || "Failed to save AI settings");
            message = "AI routing settings saved.";
            await loadAll();
        } catch (e) {
            error = e instanceof Error ? e.message : String(e);
        } finally {
            saving = false;
        }
    }

    $: timeZoneOptions = buildTimeZoneOptions(form.timezone);

    onMount(loadAll);
</script>

<PageShell widthClass="max-w-6xl" gapClass="space-y-6" className="ai-routing-page">
    <header class="routing-hero">
        <div>
            <p class="eyebrow">Unified model pool</p>
            <h1>AI Routing & Prompt</h1>
            <p class="hero-copy">
                Built-in and custom models are mixed in one pool. Pick the best
                model per capability; Molibot chooses the native transport from
                the selected route key.
            </p>
        </div>
        <a class="manage-link" href="/settings/ai/providers">Manage providers</a>
    </header>

    {#if loading}
        <div class="settings-panel muted-panel">Loading routing settings...</div>
    {:else}
        {@const pool = enabledProviderCounts()}
        <form class="space-y-6" on:submit|preventDefault={save}>
            <section class="settings-panel">
                <div class="section-heading">
                    <div>
                        <p class="eyebrow">Active pool</p>
                        <h2>One routing surface</h2>
                    </div>
                    <span class="status-pill">{pool.models} enabled models</span>
                </div>

                <div class="pool-grid">
                    <div class="metric-tile">
                        <span>Built-in providers</span>
                        <strong>{pool.builtin}</strong>
                    </div>
                    <div class="metric-tile">
                        <span>Custom providers</span>
                        <strong>{pool.custom}</strong>
                    </div>
                    <div class="metric-tile">
                        <span>Fallback policy</span>
                        <strong>{fallbackPolicyText(form.modelFallback.mode)}</strong>
                    </div>
                </div>

                <div class="info-strip">
                    <strong>How it works:</strong>
                    <span>
                        `pi|provider|model` routes use built-in pi-ai transports.
                        `custom|provider|model` routes use OpenAI-compatible
                        provider settings. They can be mixed freely below.
                    </span>
                </div>
            </section>

            <section class="settings-panel">
                <div class="section-heading">
                    <div>
                        <p class="eyebrow">Capability routing</p>
                        <h2>Choose concrete models</h2>
                    </div>
                </div>

                <div class="route-grid">
                    {#each routeCards as card}
                        {@const options = routingOptions(card.route)}
                        <div class="route-card">
                            <div class="route-card-head">
                                <div>
                                    <h3>{card.title}</h3>
                                    <p>{card.description}</p>
                                </div>
                                <span class="transport-chip">
                                    {transportLabel(modelRoutingValue(card.route))}
                                </span>
                            </div>

                            <select
                                class="control"
                                value={modelRoutingValue(card.route)}
                                disabled={options.length === 0}
                                on:change={(event) =>
                                    setModelRoutingValue(
                                        card.route,
                                        (event.currentTarget as HTMLSelectElement).value,
                                    )}
                            >
                                {#if options.length === 0}
                                    <option value="">{card.emptyText}</option>
                                {:else}
                                    {#if card.route === "subagent"}
                                        <option value="">Use text route fallback</option>
                                    {/if}
                                    {#each options as row}
                                        <option value={row.key}>{row.label}</option>
                                    {/each}
                                {/if}
                            </select>

                            <p class="route-summary">{routeSummary(card.route)}</p>
                        </div>
                    {/each}
                </div>
            </section>

            <section class="settings-panel">
                <div class="section-heading">
                    <div>
                        <p class="eyebrow">Subagent model levels</p>
                        <h2>Map delegation tiers</h2>
                    </div>
                </div>

                <div class="info-strip">
                    <strong>How subagents choose models:</strong>
                    <span>
                        Built-in roles reference levels such as `haiku` and `sonnet`, not Claude-specific model IDs.
                        Map each level to any text-capable model in your pool. Empty levels fall back to the Subagent fallback route, then the text route.
                    </span>
                </div>

                <div class="route-grid">
                    {#each subagentLevelCards as card}
                        {@const options = routingOptions("subagent")}
                        <div class="route-card">
                            <div class="route-card-head">
                                <div>
                                    <h3>{card.title}</h3>
                                    <p>{card.description}</p>
                                </div>
                                <span class="transport-chip">
                                    {transportLabel(subagentLevelValue(card.level))}
                                </span>
                            </div>

                            <select
                                class="control"
                                value={subagentLevelValue(card.level)}
                                disabled={options.length === 0}
                                on:change={(event) =>
                                    setSubagentLevelValue(
                                        card.level,
                                        (event.currentTarget as HTMLSelectElement).value,
                                    )}
                            >
                                <option value="">Use subagent fallback</option>
                                {#each options as row}
                                    <option value={row.key}>{row.label}</option>
                                {/each}
                            </select>
                        </div>
                    {/each}
                </div>
            </section>

            <section class="settings-panel">
                <div class="section-heading">
                    <div>
                        <p class="eyebrow">Runtime defaults</p>
                        <h2>Fallback, thinking, and context</h2>
                    </div>
                </div>

                <div class="settings-grid">
                    <label class="field">
                        <span>Model fallback policy</span>
                        <select class="control" bind:value={form.modelFallback.mode}>
                            <option value="off">Off - fail on the selected model</option>
                            <option value="same-provider">Same provider only</option>
                            <option value="any-enabled">Any enabled provider</option>
                        </select>
                        <small>
                            Same-provider is the default: retries stay inside
                            the selected provider unless you explicitly allow
                            cross-provider fallback.
                        </small>
                    </label>

                    <label class="field">
                        <span>Default thinking</span>
                        <select class="control" bind:value={form.defaultThinkingLevel}>
                            <option value="off">Off</option>
                            <option value="low">Low</option>
                            <option value="medium">Medium</option>
                            <option value="high">High</option>
                        </select>
                        <small>
                            Applies only when the selected model or custom
                            provider explicitly supports thinking.
                        </small>
                    </label>

                    <div class="field">
                        <span>Automatic compaction</span>
                        <label class="inline-toggle">
                            <input type="checkbox" bind:checked={form.compaction.enabled} />
                            <span>Summarize older turns when context gets tight.</span>
                        </label>
                    </div>

                    <label class="field">
                        <span>Reserve tokens</span>
                        <input
                            class="control"
                            type="number"
                            min="1024"
                            step="256"
                            bind:value={form.compaction.reserveTokens}
                        />
                        <small>Headroom kept for the next model response.</small>
                    </label>

                    <label class="field">
                        <span>Keep recent tokens</span>
                        <input
                            class="control"
                            type="number"
                            min="2048"
                            step="512"
                            bind:value={form.compaction.keepRecentTokens}
                        />
                        <small>Recent turns preserved verbatim.</small>
                    </label>
                </div>
            </section>

            <section class="settings-panel subtle-panel">
                <div class="section-heading">
                    <div>
                        <p class="eyebrow">Compatibility fallback</p>
                        <h2>Legacy default anchor</h2>
                    </div>
                </div>

                <div class="settings-grid">
                    <label class="field">
                        <span>Legacy default source</span>
                        <select class="control" bind:value={form.providerMode}>
                            <option value="pi">Built-in transport fallback</option>
                            <option value="custom">Custom provider fallback</option>
                        </select>
                        <small>
                            Used only when a text route is empty or no longer
                            matches a configured model.
                        </small>
                    </label>

                    <label class="field">
                        <span>Built-in fallback provider</span>
                        <select
                            class="control"
                            bind:value={form.piModelProvider}
                            on:change={onPiProviderChanged}
                        >
                            {#each visiblePiProviders() as provider}
                                <option value={provider.id}>{provider.name}</option>
                            {/each}
                        </select>
                    </label>

                    <label class="field wide-field">
                        <span>Built-in fallback model</span>
                        <select class="control" bind:value={form.piModelName}>
                            {#each providerModels[form.piModelProvider] ?? [] as model}
                                <option value={model}>{model}</option>
                            {/each}
                        </select>
                        {#if visiblePiProviders().length === 0}
                            <small class="warning-text">
                                No enabled built-in provider. Enable one in
                                Providers if you want this anchor to work.
                            </small>
                        {/if}
                    </label>
                </div>
            </section>

            <section class="settings-panel">
                <div class="section-heading">
                    <div>
                        <p class="eyebrow">Agent persona</p>
                        <h2>Global system prompt</h2>
                    </div>
                </div>

                <label class="field">
                    <span>Runtime timezone</span>
                    <select
                        class="control"
                        bind:value={form.timezone}
                    >
                        {#each timeZoneOptions as zone}
                            <option value={zone}>{zone}</option>
                        {/each}
                    </select>
                    <small>
                        Used for per-message <code>&lt;env&gt;</code> time injection,
                        task scheduling, and usage/date views. Choose an IANA
                        timezone such as <code>Asia/Shanghai</code> or
                        <code>America/Los_Angeles</code>.
                    </small>
                </label>

                <label class="field">
                    <textarea
                        class="control prompt-area"
                        bind:value={form.systemPrompt}
                        placeholder="You are Molibot..."
                    ></textarea>
                </label>
            </section>

            <div class="action-footer">
                <div class="status-line">
                    {#if message}
                        <span class="success-text">✓ {message}</span>
                    {/if}
                    {#if error}
                        <span class="error-text">! {error}</span>
                    {/if}
                </div>
                <Button type="submit" variant="default" size="lg" disabled={saving}>
                    {saving ? "Saving..." : "Save Routing"}
                </Button>
            </div>
        </form>
    {/if}
</PageShell>
