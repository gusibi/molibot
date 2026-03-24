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
        | "zai"
        | "qwen"
        | "qwen-chat-template";
    type ThinkingEffortLevel = "low" | "medium" | "high";
    type DefaultThinkingLevel = "off" | "low" | "medium" | "high";
    type ModelCapabilityTag = "text" | "vision" | "stt" | "tts" | "tool";

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

    let loading = true;
    let saving = false;
    let error = "";
    let message = "";

    let providers: Array<{ id: string; name: string }> = [];
    let providerModels: Record<string, string[]> = {};
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
                out.push({
                    key: `custom|${cp.id}|${m.id}`,
                    label: `[Custom] ${cp.name} / ${m.id}`,
                    tags: m.tags,
                });
            }
        }

        return out;
    }

    function routingOptions(
        requiredTag: ModelCapabilityTag,
    ): Array<{ key: string; label: string }> {
        return allModelOptions()
            .filter(
                (m) => m.tags.includes(requiredTag) || requiredTag === "text",
            )
            .map((m) => ({ key: m.key, label: m.label }));
    }

    function ensureRoutingDefaults(): void {
        const all = allModelOptions();
        const allKeys = new Set(all.map((m) => m.key));

        const textFallback = all[0]?.key ?? "";
        if (!allKeys.has(form.modelRouting.textModelKey))
            form.modelRouting.textModelKey = textFallback;

        const vision = routingOptions("vision");
        if (!vision.some((v) => v.key === form.modelRouting.visionModelKey)) {
            form.modelRouting.visionModelKey = vision[0]?.key ?? "";
        }

        const stt = routingOptions("stt");
        if (!stt.some((v) => v.key === form.modelRouting.sttModelKey)) {
            form.modelRouting.sttModelKey = stt[0]?.key ?? "";
        }

        const tts = routingOptions("tts");
        if (!tts.some((v) => v.key === form.modelRouting.ttsModelKey)) {
            form.modelRouting.ttsModelKey = tts[0]?.key ?? "";
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

<PageShell widthClass="max-w-4xl" gapClass="space-y-8">
    <header>
        <h1 class="text-3xl font-bold tracking-tight text-white">
            AI Routing & Prompt
        </h1>
        <p class="mt-2 text-sm text-slate-400">
            Configure system prompts and delegate modalities to specific models.
        </p>
    </header>

    {#if loading}
        <div
            class="rounded-2xl border border-white/10 bg-white/[0.02] px-6 py-5 text-sm text-slate-300"
        >
            Loading routing settings...
        </div>
    {:else}
        <form class="space-y-6" on:submit|preventDefault={save}>
            <!-- Core Settings Card -->
            <section
                class="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6 shadow-sm"
            >
                <h2
                    class="mb-5 text-sm font-semibold uppercase tracking-wider text-slate-500"
                >
                    Core Engine
                </h2>

                <div class="grid gap-5 md:grid-cols-2">
                    <label class="grid gap-2 text-sm">
                        <span class="font-medium text-slate-300"
                            >Provider mode</span
                        >
                        <select
                            class="rounded-xl border border-white/10 bg-black/20 px-4 py-2.5 outline-none transition-colors focus:border-emerald-500/50 focus:bg-white/5"
                            bind:value={form.providerMode}
                        >
                            <option value="pi">Platform Interface (PI)</option>
                            <option value="custom">Custom Providers</option>
                        </select>
                    </label>

                    <label class="grid gap-2 text-sm">
                        <span class="font-medium text-slate-300"
                            >PI provider</span
                        >
                        <select
                            class="rounded-xl border border-white/10 bg-black/20 px-4 py-2.5 outline-none transition-colors focus:border-emerald-500/50 focus:bg-white/5 disabled:opacity-50"
                            bind:value={form.piModelProvider}
                            on:change={onPiProviderChanged}
                            disabled={form.providerMode === "custom"}
                        >
                            {#each visiblePiProviders() as provider}
                                <option value={provider.id}
                                    >{provider.name}</option
                                >
                            {/each}
                        </select>
                    </label>

                    <label class="grid gap-2 text-sm md:col-span-2">
                        <span class="font-medium text-slate-300"
                            >PI model fallback</span
                        >
                        <select
                            class="rounded-xl border border-white/10 bg-black/20 px-4 py-2.5 outline-none transition-colors focus:border-emerald-500/50 focus:bg-white/5 disabled:opacity-50"
                            bind:value={form.piModelName}
                            disabled={form.providerMode === "custom"}
                        >
                            {#each providerModels[form.piModelProvider] ?? [] as model}
                                <option value={model}>{model}</option>
                            {/each}
                        </select>
                        <span class="text-xs text-slate-500"
                            >Used if routing keys fail to match a known model.</span
                        >
                        {#if visiblePiProviders().length === 0}
                            <span class="text-xs text-amber-300"
                                >No enabled built-in provider. Enable at least
                                one in Providers page.</span
                            >
                        {/if}
                    </label>

                    <label class="grid gap-2 text-sm">
                        <span class="font-medium text-slate-300"
                            >Default thinking</span
                        >
                        <select
                            class="rounded-xl border border-white/10 bg-black/20 px-4 py-2.5 outline-none transition-colors focus:border-emerald-500/50 focus:bg-white/5"
                            bind:value={form.defaultThinkingLevel}
                        >
                            <option value="off">Off</option>
                            <option value="low">Low</option>
                            <option value="medium">Medium</option>
                            <option value="high">High</option>
                        </select>
                        <span class="text-xs text-slate-500"
                            >只会对明确声明支持 thinking 的模型生效。</span
                        >
                    </label>
                </div>
            </section>

            <!-- Advanced Routing Card -->
            <section
                class="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6 shadow-sm"
            >
                <h2
                    class="mb-5 text-sm font-semibold uppercase tracking-wider text-slate-500"
                >
                    Capability Routing
                </h2>

                <div class="grid gap-5 md:grid-cols-2">
                    <label class="grid gap-2 text-sm">
                        <span class="font-medium text-slate-300"
                            >Primary text model</span
                        >
                        <select
                            class="rounded-xl border border-white/10 bg-black/20 px-4 py-2.5 outline-none transition-colors focus:border-emerald-500/50 focus:bg-white/5"
                            bind:value={form.modelRouting.textModelKey}
                        >
                            {#each routingOptions("text") as row}
                                <option value={row.key}>{row.label}</option>
                            {/each}
                        </select>
                    </label>

                    <label class="grid gap-2 text-sm">
                        <span class="font-medium text-slate-300"
                            >Vision model</span
                        >
                        <select
                            class="rounded-xl border border-white/10 bg-black/20 px-4 py-2.5 outline-none transition-colors focus:border-emerald-500/50 focus:bg-white/5"
                            bind:value={form.modelRouting.visionModelKey}
                        >
                            {#each routingOptions("vision") as row}
                                <option value={row.key}>{row.label}</option>
                            {/each}
                        </select>
                    </label>

                    <label class="grid gap-2 text-sm">
                        <span class="font-medium text-slate-300"
                            >Speech-to-text (STT)</span
                        >
                        <select
                            class="rounded-xl border border-white/10 bg-black/20 px-4 py-2.5 outline-none transition-colors focus:border-emerald-500/50 focus:bg-white/5"
                            bind:value={form.modelRouting.sttModelKey}
                        >
                            {#each routingOptions("stt") as row}
                                <option value={row.key}>{row.label}</option>
                            {/each}
                        </select>
                    </label>

                    <label class="grid gap-2 text-sm">
                        <span class="font-medium text-slate-300"
                            >Text-to-speech (TTS)</span
                        >
                        <select
                            class="rounded-xl border border-white/10 bg-black/20 px-4 py-2.5 outline-none transition-colors focus:border-emerald-500/50 focus:bg-white/5"
                            bind:value={form.modelRouting.ttsModelKey}
                        >
                            {#each routingOptions("tts") as row}
                                <option value={row.key}>{row.label}</option>
                            {/each}
                        </select>
                    </label>
                </div>
            </section>

            <section
                class="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6 shadow-sm"
            >
                <h2
                    class="mb-5 text-sm font-semibold uppercase tracking-wider text-slate-500"
                >
                    Context Compaction
                </h2>

                <div class="grid gap-5 md:grid-cols-2">
                    <label class="grid gap-2 text-sm md:col-span-2">
                        <span class="font-medium text-slate-300"
                            >Automatic compaction</span
                        >
                        <label class="inline-flex items-center gap-3 text-sm text-slate-300">
                            <input
                                type="checkbox"
                                class="h-4 w-4 rounded border-white/10 bg-black/20"
                                bind:checked={form.compaction.enabled}
                            />
                            <span>Summarize older turns when the context window gets tight.</span>
                        </label>
                    </label>

                    <label class="grid gap-2 text-sm">
                        <span class="font-medium text-slate-300"
                            >Reserve tokens</span
                        >
                        <input
                            type="number"
                            min="1024"
                            step="256"
                            class="rounded-xl border border-white/10 bg-black/20 px-4 py-2.5 outline-none transition-colors focus:border-emerald-500/50 focus:bg-white/5"
                            bind:value={form.compaction.reserveTokens}
                        />
                        <span class="text-xs text-slate-500"
                            >Leave headroom for the next model response.</span
                        >
                    </label>

                    <label class="grid gap-2 text-sm">
                        <span class="font-medium text-slate-300"
                            >Keep recent tokens</span
                        >
                        <input
                            type="number"
                            min="2048"
                            step="512"
                            class="rounded-xl border border-white/10 bg-black/20 px-4 py-2.5 outline-none transition-colors focus:border-emerald-500/50 focus:bg-white/5"
                            bind:value={form.compaction.keepRecentTokens}
                        />
                        <span class="text-xs text-slate-500"
                            >Newest messages kept verbatim instead of summarized.</span
                        >
                    </label>
                </div>
            </section>

            <!-- System Prompt Card -->
            <section
                class="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6 shadow-sm"
            >
                <h2
                    class="mb-5 text-sm font-semibold uppercase tracking-wider text-slate-500"
                >
                    Agent Persona
                </h2>

                <label class="grid gap-2 text-sm">
                    <span class="font-medium text-slate-300"
                        >Global System Prompt</span
                    >
                    <textarea
                        class="min-h-[160px] resize-y rounded-xl border border-white/10 bg-black/20 px-4 py-3 font-mono text-xs leading-relaxed outline-none transition-colors focus:border-emerald-500/50 focus:bg-white/5"
                        bind:value={form.systemPrompt}
                        placeholder="You are Molibot..."
                    ></textarea>
                </label>
            </section>

            <!-- Action Footer -->
            <div
                class="sticky bottom-6 z-10 flex items-center justify-between rounded-2xl border border-white/10 bg-[#1e1e1e]/90 p-4 shadow-xl backdrop-blur-md"
            >
                <div class="flex items-center gap-3">
                    {#if message}
                        <span
                            class="flex items-center gap-1.5 text-sm font-medium text-emerald-400"
                        >
                            <span
                                class="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/20 text-xs"
                                >✓</span
                            >
                            {message}
                        </span>
                    {/if}
                    {#if error}
                        <span
                            class="flex items-center gap-1.5 text-sm font-medium text-rose-400"
                        >
                            <span
                                class="flex h-5 w-5 items-center justify-center rounded-full bg-rose-500/20 text-xs text-rose-300"
                                >!</span
                            >
                            {error}
                        </span>
                    {/if}
                </div>
                <Button
                    type="submit"
                    variant="default"
                    size="lg"
                    disabled={saving}
                >
                    {saving ? "Deploying Core..." : "Save Config"}
                </Button>
            </div>
        </form>
    {/if}
</PageShell>
