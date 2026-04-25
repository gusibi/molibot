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
    type ModelRoute = "text" | "vision" | "stt" | "tts";

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
            "text" | "vision" | "stt" | "tts",
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
    };
    let capabilityTags: ModelCapabilityTag[] = [
        "text",
        "vision",
        "stt",
        "tts",
        "tool",
    ];

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
                : form.modelRouting.ttsModelKey;
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
                    : "ttsModelKey"]: value,
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
            };

            onPiProviderChanged();
            ensurePiProviderEnabled();
            ensureRoutingDefaults();
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

<style>
  :global(.ai-routing-page) {
    --panel-bg: color-mix(in oklab, var(--card) 88%, transparent);
    --panel-soft: color-mix(in oklab, var(--muted) 78%, transparent);
    --copy-muted: var(--muted-foreground);
  }

  .routing-hero,
  .section-heading,
  .route-card-head,
  .action-footer {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
  }

  .routing-hero h1,
  .section-heading h2,
  .route-card h3 {
    margin: 0;
    color: var(--foreground);
    letter-spacing: 0;
  }

  .routing-hero h1 {
    font-size: clamp(1.8rem, 4vw, 2.4rem);
    font-weight: 760;
  }

  .hero-copy,
  .route-card p,
  .field small,
  .route-summary {
    color: var(--copy-muted);
  }

  .hero-copy {
    margin-top: 0.5rem;
    max-width: 48rem;
    font-size: 0.95rem;
    line-height: 1.65;
  }

  .eyebrow {
    margin: 0 0 0.35rem;
    color: var(--muted-foreground);
    font-size: 0.72rem;
    font-weight: 720;
    letter-spacing: 0;
    text-transform: uppercase;
  }

  .manage-link,
  .status-pill,
  .transport-chip {
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--panel-bg);
    color: var(--foreground);
    font-size: 0.78rem;
    font-weight: 700;
    white-space: nowrap;
  }

  .manage-link {
    padding: 0.6rem 0.85rem;
    text-decoration: none;
  }

  .status-pill,
  .transport-chip {
    padding: 0.35rem 0.65rem;
  }

  .settings-panel {
    border: 1px solid var(--border);
    border-radius: 1rem;
    background: var(--panel-bg);
    padding: clamp(1rem, 2.6vw, 1.5rem);
    box-shadow: var(--shadow-sm);
  }

  .muted-panel,
  .subtle-panel {
    background: var(--panel-soft);
  }

  .pool-grid,
  .route-grid,
  .settings-grid {
    display: grid;
    gap: 1rem;
  }

  .pool-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    margin-top: 1.25rem;
  }

  .route-grid,
  .settings-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    margin-top: 1.25rem;
  }

  .metric-tile,
  .route-card {
    border: 1px solid var(--border);
    border-radius: 0.85rem;
    background: color-mix(in oklab, var(--card) 76%, transparent);
  }

  .metric-tile {
    padding: 1rem;
  }

  .metric-tile span {
    display: block;
    color: var(--muted-foreground);
    font-size: 0.76rem;
  }

  .metric-tile strong {
    display: block;
    margin-top: 0.35rem;
    color: var(--foreground);
    font-size: 1.2rem;
    line-height: 1.35;
  }

  .info-strip {
    display: flex;
    gap: 0.5rem;
    margin-top: 1rem;
    border: 1px solid color-mix(in oklab, var(--ring) 22%, var(--border));
    border-radius: 0.85rem;
    background: color-mix(in oklab, var(--accent) 28%, transparent);
    color: var(--foreground);
    padding: 0.85rem 1rem;
    font-size: 0.82rem;
    line-height: 1.55;
  }

  .route-card {
    padding: 1rem;
  }

  .route-card h3 {
    font-size: 1rem;
    font-weight: 740;
  }

  .route-card p {
    margin: 0.25rem 0 0;
    font-size: 0.8rem;
  }

  .route-summary {
    margin: 0.65rem 0 0;
    word-break: break-word;
    font-size: 0.76rem;
    line-height: 1.45;
  }

  .field {
    display: grid;
    gap: 0.5rem;
    color: var(--foreground);
    font-size: 0.9rem;
  }

  .field > span {
    font-weight: 700;
  }

  .field small {
    font-size: 0.76rem;
    line-height: 1.45;
  }

  .wide-field {
    grid-column: 1 / -1;
  }

  .control {
    width: 100%;
    border: 1px solid var(--input);
    border-radius: 0.75rem;
    background: var(--card);
    color: var(--foreground);
    padding: 0.68rem 0.85rem;
    outline: none;
  }

  .control:focus {
    border-color: var(--ring);
    box-shadow: 0 0 0 1px color-mix(in oklab, var(--ring) 22%, transparent);
  }

  .inline-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.65rem;
    color: var(--foreground);
  }

  .inline-toggle input {
    width: 1rem;
    height: 1rem;
  }

  .prompt-area {
    min-height: 11rem;
    resize: vertical;
    font-family: var(--font-mono);
    font-size: 0.78rem;
    line-height: 1.7;
  }

  .action-footer {
    position: sticky;
    bottom: 1.5rem;
    z-index: 10;
    align-items: center;
    border: 1px solid var(--border);
    border-radius: 1rem;
    background: color-mix(in oklab, var(--card) 92%, transparent);
    padding: 1rem;
    box-shadow: var(--shadow);
    backdrop-filter: blur(14px);
  }

  .status-line {
    min-width: 0;
  }

  .success-text {
    color: color-mix(in oklab, var(--primary) 78%, var(--foreground));
    font-size: 0.85rem;
    font-weight: 700;
  }

  .error-text,
  .warning-text {
    color: var(--destructive);
    font-size: 0.85rem;
    font-weight: 700;
  }

  @media (max-width: 760px) {
    .routing-hero,
    .section-heading,
    .route-card-head,
    .action-footer,
    .info-strip {
      flex-direction: column;
      align-items: stretch;
    }

    .pool-grid,
    .route-grid,
    .settings-grid {
      grid-template-columns: 1fr;
    }

    .manage-link,
    .action-footer :global(button) {
      width: 100%;
    }
  }
</style>
