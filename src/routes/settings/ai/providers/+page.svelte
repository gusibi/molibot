<script lang="ts">
    import { onMount } from "svelte";

    type ProviderMode = "pi" | "custom";
    type ModelRole = "system" | "user" | "assistant" | "tool" | "developer";
    type ModelCapabilityTag =
        | "text"
        | "vision"
        | "audio_input"
        | "stt"
        | "tts"
        | "tool";
    type ModelCapabilityVerification = "untested" | "passed" | "failed";

    interface ProviderModelForm {
        id: string;
        tags: ModelCapabilityTag[];
        supportedRoles: ModelRole[];
        verification?: Partial<
            Record<ModelCapabilityTag, ModelCapabilityVerification>
        >;
    }

    interface CustomProviderForm {
        id: string;
        name: string;
        baseUrl: string;
        apiKey: string;
        models: ProviderModelForm[];
        defaultModel: string;
        path: string;
    }

    interface AIForm {
        providerMode: ProviderMode;
        piModelProvider: string;
        piModelName: string;
        defaultCustomProviderId: string;
        customProviders: CustomProviderForm[];
        modelRouting: {
            textModelKey: string;
            visionModelKey: string;
            sttModelKey: string;
            ttsModelKey: string;
        };
        systemPrompt: string;
    }

    interface MetaResponse {
        providers: Array<{ id: string; name: string }>;
        providerModels: Record<string, string[]>;
        capabilityTags: ModelCapabilityTag[];
    }

    interface ProviderTestResult {
        ok: boolean;
        status: number | null;
        message: string;
        supportedRoles: ModelRole[];
        verification: Partial<
            Record<ModelCapabilityTag, ModelCapabilityVerification>
        >;
    }

    let loading = true;
    let saving = false;
    let testingModelKey = "";
    let selectedProviderId = "";
    let providerSearch = "";
    let error = "";
    let message = "";

    let capabilityTags: ModelCapabilityTag[] = [
        "text",
        "vision",
        "audio_input",
        "stt",
        "tts",
        "tool",
    ];

    let form: AIForm = {
        providerMode: "pi",
        piModelProvider: "anthropic",
        piModelName: "claude-sonnet-4-20250514",
        defaultCustomProviderId: "",
        customProviders: [],
        modelRouting: {
            textModelKey: "",
            visionModelKey: "",
            sttModelKey: "",
            ttsModelKey: "",
        },
        systemPrompt: "You are Molibot, a concise and helpful assistant.",
    };

    function newCustomProvider(): CustomProviderForm {
        const id = `custom-${Math.random().toString(36).slice(2, 8)}`;
        return {
            id,
            name: "New Provider",
            baseUrl: "",
            apiKey: "",
            models: [],
            defaultModel: "",
            path: "/v1/chat/completions",
        };
    }

    function modelIds(provider: CustomProviderForm): string[] {
        return provider.models.map((m) => m.id.trim()).filter(Boolean);
    }

    function ensureModelDefaults(model: ProviderModelForm): void {
        model.id = model.id.trim();
        model.tags = Array.isArray(model.tags)
            ? model.tags.filter((t) => capabilityTags.includes(t))
            : ["text"];
        if (model.tags.length === 0) model.tags = ["text"];
        if (
            !Array.isArray(model.supportedRoles) ||
            model.supportedRoles.length === 0
        ) {
            model.supportedRoles = ["system", "user", "assistant", "tool"];
        }
        model.verification =
            model.verification && typeof model.verification === "object"
                ? Object.fromEntries(
                      Object.entries(model.verification).filter(
                          ([tag, status]) =>
                              capabilityTags.includes(
                                  tag as ModelCapabilityTag,
                              ) &&
                              ["untested", "passed", "failed"].includes(
                                  String(status),
                              ),
                      ),
                  )
                : {};
    }

    function ensureProviderDefaults(provider: CustomProviderForm): void {
        provider.models = provider.models.map((m) => {
            const normalized: ProviderModelForm =
                typeof (m as any) === "string"
                    ? {
                          id: String(m),
                          tags: ["text"] as ModelCapabilityTag[],
                          supportedRoles: [
                              "system",
                              "user",
                              "assistant",
                              "tool",
                          ],
                      }
                    : {
                          id: String(m.id ?? ""),
                          tags: Array.isArray(m.tags) ? m.tags : ["text"],
                          supportedRoles: Array.isArray(m.supportedRoles)
                              ? m.supportedRoles
                              : ["system", "user", "assistant", "tool"],
                          verification:
                              m.verification &&
                              typeof m.verification === "object"
                                  ? m.verification
                                  : {},
                      };
            ensureModelDefaults(normalized);
            return normalized;
        });

        const ids = modelIds(provider);
        if (ids.length === 0) {
            provider.defaultModel = "";
        } else if (!ids.includes(provider.defaultModel)) {
            provider.defaultModel = ids[0];
        }
    }

    function ensureDefaultCustomProvider(): void {
        for (const provider of form.customProviders)
            ensureProviderDefaults(provider);

        if (form.customProviders.length === 0) {
            form.defaultCustomProviderId = "";
            selectedProviderId = "";
            return;
        }

        if (
            !form.customProviders.some(
                (p) => p.id === form.defaultCustomProviderId,
            )
        ) {
            form.defaultCustomProviderId = form.customProviders[0].id;
        }

        if (
            !selectedProviderId ||
            !form.customProviders.some((p) => p.id === selectedProviderId)
        ) {
            selectedProviderId =
                form.defaultCustomProviderId || form.customProviders[0].id;
        }
    }

    function addCustomProvider(): void {
        const provider = newCustomProvider();
        form.customProviders = [...form.customProviders, provider];
        selectedProviderId = provider.id;
        ensureDefaultCustomProvider();
    }

    function removeCustomProvider(id: string): void {
        form.customProviders = form.customProviders.filter((p) => p.id !== id);
        if (form.defaultCustomProviderId === id) {
            form.defaultCustomProviderId = form.customProviders[0]?.id ?? "";
        }
        if (selectedProviderId === id) {
            selectedProviderId = form.customProviders[0]?.id ?? "";
        }
        ensureDefaultCustomProvider();
    }

    function updateProviderById(
        providerId: string,
        updater: (provider: CustomProviderForm) => CustomProviderForm,
    ): void {
        form.customProviders = form.customProviders.map((row) => {
            if (row.id !== providerId) return row;
            const next = updater({
                ...row,
                models: Array.isArray(row.models) ? [...row.models] : [],
            });
            ensureProviderDefaults(next);
            return next;
        });
        ensureDefaultCustomProvider();
    }

    function addModel(providerId: string): void {
        updateProviderById(providerId, (provider) => ({
            ...provider,
            models: [
                ...provider.models,
                {
                    id: "",
                    tags: ["text"] as ModelCapabilityTag[],
                    supportedRoles: ["system", "user", "assistant", "tool"],
                },
            ],
        }));
    }

    function removeModel(providerId: string, index: number): void {
        updateProviderById(providerId, (provider) => ({
            ...provider,
            models: provider.models.filter((_, i) => i !== index),
        }));
    }

    function setAsDefaultProvider(id: string): void {
        form.defaultCustomProviderId = id;
    }

    function toggleTag(
        providerId: string,
        modelIndex: number,
        tag: ModelCapabilityTag,
    ): void {
        updateProviderById(providerId, (provider) => {
            const models = provider.models.map((m, i) => {
                if (i !== modelIndex) return m;
                const set = new Set(m.tags);
                if (set.has(tag)) set.delete(tag);
                else set.add(tag);
                const tags = Array.from(set) as ModelCapabilityTag[];
                return {
                    ...m,
                    tags:
                        tags.length > 0
                            ? tags
                            : (["text"] as ModelCapabilityTag[]),
                };
            });
            return { ...provider, models };
        });
    }

    function filteredCustomProviders(): CustomProviderForm[] {
        const keyword = providerSearch.trim().toLowerCase();
        if (!keyword) return form.customProviders;
        return form.customProviders.filter((p) => {
            return (
                p.name.toLowerCase().includes(keyword) ||
                p.id.toLowerCase().includes(keyword) ||
                p.models.some((m) => m.id.toLowerCase().includes(keyword))
            );
        });
    }

    function getSelectedProvider(): CustomProviderForm | undefined {
        return form.customProviders.find((p) => p.id === selectedProviderId);
    }

    async function testProviderModel(
        providerId: string,
        modelId: string,
    ): Promise<void> {
        const provider = form.customProviders.find((p) => p.id === providerId);
        if (!provider) return;
        const targetModel = modelId.trim();
        if (!targetModel) return;
        testingModelKey = `${providerId}|${targetModel}`;
        error = "";
        message = "";
        try {
            ensureProviderDefaults(provider);

            const res = await fetch("/api/settings/provider-test", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    baseUrl: provider.baseUrl,
                    apiKey: provider.apiKey,
                    path: provider.path,
                    model: targetModel,
                    tags:
                        provider.models.find((m) => m.id.trim() === targetModel)
                            ?.tags ?? [],
                }),
            });

            const data = (await res.json()) as ProviderTestResult & {
                error?: string;
            };
            if (!res.ok) throw new Error(data.error || "Provider test failed");

            updateProviderById(providerId, (current) => ({
                ...current,
                models: current.models.map((m) =>
                    m.id.trim() === targetModel
                        ? {
                              ...m,
                              supportedRoles: data.supportedRoles,
                              verification: {
                                  ...(m.verification ?? {}),
                                  ...(data.verification ?? {}),
                              },
                          }
                        : m,
                ),
            }));
            message = `[${provider.name} / ${targetModel}] ${data.message}`;
        } catch (e) {
            error = e instanceof Error ? e.message : String(e);
        } finally {
            testingModelKey = "";
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

            capabilityTags = metaData.capabilityTags ?? capabilityTags;

            const s = settingsData.settings;
            const loadedProviders = (s.customProviders ?? []) as Array<
                CustomProviderForm & { supportedRoles?: ModelRole[] }
            >;

            form = {
                providerMode: s.providerMode,
                piModelProvider: s.piModelProvider,
                piModelName: s.piModelName,
                defaultCustomProviderId: s.defaultCustomProviderId ?? "",
                customProviders: loadedProviders.map((cp) => ({
                    ...cp,
                    models: Array.isArray(cp.models)
                        ? cp.models.map((m: any) => {
                              if (typeof m === "string") {
                                  return {
                                      id: m,
                                      tags: [
                                          "text",
                                      ] as ModelCapabilityTag[] as ModelCapabilityTag[],
                                      supportedRoles:
                                          Array.isArray(cp.supportedRoles) &&
                                          cp.supportedRoles.length > 0
                                              ? cp.supportedRoles
                                              : [
                                                    "system",
                                                    "user",
                                                    "assistant",
                                                    "tool",
                                                ],
                                  };
                              }
                              const tags = Array.isArray(m.tags)
                                  ? m.tags.filter((t: any) =>
                                        capabilityTags.includes(t),
                                    )
                                  : ["text"];
                              const roles = Array.isArray(m.supportedRoles)
                                  ? m.supportedRoles
                                  : [];
                              return {
                                  id: String(m.id ?? ""),
                                  tags:
                                      tags.length > 0
                                          ? tags
                                          : (["text"] as ModelCapabilityTag[]),
                                  supportedRoles:
                                      roles.length > 0
                                          ? roles
                                          : Array.isArray(cp.supportedRoles) &&
                                              cp.supportedRoles.length > 0
                                            ? cp.supportedRoles
                                            : [
                                                  "system",
                                                  "user",
                                                  "assistant",
                                                  "tool",
                                              ],
                                  verification:
                                      m.verification &&
                                      typeof m.verification === "object"
                                          ? m.verification
                                          : {},
                              };
                          })
                        : [],
                    defaultModel: cp.defaultModel ?? "",
                })),
                modelRouting: {
                    textModelKey: s.modelRouting?.textModelKey ?? "",
                    visionModelKey: s.modelRouting?.visionModelKey ?? "",
                    sttModelKey: s.modelRouting?.sttModelKey ?? "",
                    ttsModelKey: s.modelRouting?.ttsModelKey ?? "",
                },
                systemPrompt: s.systemPrompt,
            };

            ensureDefaultCustomProvider();
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
            ensureDefaultCustomProvider();
            const payload: AIForm = {
                ...form,
                customProviders: form.customProviders.map((provider) => ({
                    ...provider,
                    models: provider.models.map((model) => ({
                        id: model.id.trim(),
                        tags: [...model.tags],
                        supportedRoles: [...model.supportedRoles],
                        verification:
                            model.verification &&
                            Object.keys(model.verification).length > 0
                                ? { ...model.verification }
                                : {},
                    })),
                })),
            };
            const res = await fetch("/api/settings", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (!data.ok)
                throw new Error(data.error || "Failed to save AI settings");
            message = "Custom Providers settings saved.";
            await loadAll();
        } catch (e) {
            error = e instanceof Error ? e.message : String(e);
        } finally {
            saving = false;
        }
    }

    onMount(loadAll);

    function verificationBadgeClass(
        status: ModelCapabilityVerification | undefined,
    ): string {
        if (status === "passed") {
            return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
        }
        if (status === "failed") {
            return "border-rose-500/30 bg-rose-500/10 text-rose-300";
        }
        return "border-white/10 bg-white/5 text-slate-400";
    }

    function verificationLabel(
        model: ProviderModelForm,
        tag: ModelCapabilityTag,
    ): string {
        return model.verification?.[tag] ?? "untested";
    }

    const autoTestedCapabilities: ModelCapabilityTag[] = ["text", "vision"];
</script>

<div class="mx-auto max-w-6xl space-y-6 px-6 py-8 sm:px-10 sm:py-12">
    <div class="flex items-center justify-between gap-3">
        <header>
            <h1 class="text-3xl font-bold tracking-tight text-white">
                Custom Providers
            </h1>
            <p class="mt-2 text-sm text-slate-400">
                Configure custom API-compliant AI endpoints, credentials, and
                supported internal tags.
            </p>
        </header>
    </div>

    {#if loading}
        <div
            class="rounded-2xl border border-white/10 bg-white/[0.02] px-6 py-5 text-sm text-slate-300"
        >
            Loading providers...
        </div>
    {:else}
        <form
            class="flex flex-col gap-6 xl:flex-row"
            on:submit|preventDefault={save}
        >
            <!-- Providers List Pane -->
            <aside class="w-full shrink-0 lg:w-[320px]">
                <div
                    class="sticky top-6 flex flex-col space-y-4 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 shadow-sm"
                >
                    <div class="flex items-center justify-between">
                        <h2
                            class="text-sm font-semibold uppercase tracking-wider text-slate-500"
                        >
                            Providers List
                        </h2>
                        <button
                            type="button"
                            class="flex cursor-pointer items-center justify-center rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-400 transition-colors hover:bg-emerald-500/20"
                            on:click={addCustomProvider}
                        >
                            + Create
                        </button>
                    </div>

                    <div class="relative">
                        <input
                            class="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-2.5 text-sm text-white outline-none focus:border-emerald-500/50"
                            bind:value={providerSearch}
                            placeholder="Search provider..."
                        />
                    </div>

                    <div class="flex flex-col space-y-2">
                        {#if filteredCustomProviders().length === 0}
                            <div
                                class="py-2 text-center text-xs text-slate-500"
                            >
                                No items matched
                            </div>
                        {/if}

                        {#each filteredCustomProviders() as provider (provider.id)}
                            <button
                                type="button"
                                class={`flex cursor-pointer flex-col gap-1 rounded-xl border px-4 py-3 text-left transition-all ${
                                    selectedProviderId === provider.id
                                        ? "border-emerald-500/30 bg-emerald-500/10 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)]"
                                        : "border-white/5 bg-white/[0.01] hover:border-white/15 hover:bg-white/[0.03]"
                                }`}
                                on:click={() =>
                                    (selectedProviderId = provider.id)}
                            >
                                <div
                                    class={`font-medium ${selectedProviderId === provider.id ? "text-emerald-400" : "text-slate-200"}`}
                                >
                                    {provider.name}
                                </div>
                                <div class="text-xs text-slate-500">
                                    ID: {provider.id}
                                </div>
                                <div class="mt-1 flex items-center gap-2">
                                    <span
                                        class="rounded bg-black/40 px-2 py-0.5 text-[10px] text-slate-300"
                                    >
                                        {provider.models.length} model{provider
                                            .models.length === 1
                                            ? ""
                                            : "s"}
                                    </span>
                                    {#if form.defaultCustomProviderId === provider.id}
                                        <span
                                            class="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] uppercase font-bold text-emerald-300"
                                        >
                                            Default
                                        </span>
                                    {/if}
                                </div>
                            </button>
                        {/each}
                    </div>
                </div>
            </aside>

            <!-- Provider Edit Pane -->
            <section class="flex-1 min-w-0">
                <div
                    class="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6 shadow-sm"
                >
                    {#if getSelectedProvider()}
                        {@const cp = getSelectedProvider()!}

                        <div
                            class="flex flex-wrap items-center justify-between gap-4 border-b border-white/5 pb-5"
                        >
                            <h2
                                class="text-xl font-bold tracking-tight text-white"
                            >
                                {cp.name || "Unnamed Provider"}
                            </h2>

                            <div class="flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    class="cursor-pointer rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-slate-300 transition-all hover:bg-white/10 disabled:opacity-50"
                                    on:click={() => setAsDefaultProvider(cp.id)}
                                    disabled={form.defaultCustomProviderId ===
                                        cp.id}
                                >
                                    {form.defaultCustomProviderId === cp.id
                                        ? "Targeted as Default"
                                        : "Set as Default"}
                                </button>
                                <button
                                    type="button"
                                    class="cursor-pointer rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-rose-300 transition-all hover:bg-rose-500/20"
                                    on:click={() => removeCustomProvider(cp.id)}
                                >
                                    Delete
                                </button>
                            </div>
                        </div>

                        <div class="mt-6 grid gap-5 md:grid-cols-2">
                            <label class="grid gap-2 text-sm">
                                <span class="font-medium text-slate-300"
                                    >Provider ID</span
                                >
                                <input
                                    class="rounded-xl border border-white/10 bg-black/20 px-4 py-2.5 outline-none transition-colors focus:border-emerald-500/50"
                                    bind:value={cp.id}
                                />
                            </label>

                            <label class="grid gap-2 text-sm">
                                <span class="font-medium text-slate-300"
                                    >Display Name</span
                                >
                                <input
                                    class="rounded-xl border border-white/10 bg-black/20 px-4 py-2.5 outline-none transition-colors focus:border-emerald-500/50"
                                    bind:value={cp.name}
                                />
                            </label>

                            <label
                                class="grid gap-2 text-sm md:col-span-2 xl:col-span-1"
                            >
                                <span class="font-medium text-slate-300"
                                    >API Base URL</span
                                >
                                <input
                                    class="rounded-xl border border-white/10 bg-black/20 px-4 py-2.5 outline-none transition-colors focus:border-emerald-500/50 focus:bg-white/5"
                                    bind:value={cp.baseUrl}
                                    placeholder="https://api.openai.com"
                                />
                            </label>

                            <label
                                class="grid gap-2 text-sm md:col-span-2 xl:col-span-1"
                            >
                                <span class="font-medium text-slate-300"
                                    >Path Endpoint</span
                                >
                                <input
                                    class="rounded-xl border border-white/10 bg-black/20 px-4 py-2.5 outline-none transition-colors focus:border-emerald-500/50 focus:bg-white/5"
                                    bind:value={cp.path}
                                    placeholder="/v1/chat/completions"
                                />
                            </label>

                            <label class="grid gap-2 text-sm md:col-span-2">
                                <span class="font-medium text-slate-300"
                                    >API Signature / Key</span
                                >
                                <input
                                    class="rounded-xl border border-white/10 bg-black/20 px-4 py-2.5 font-mono text-sm tracking-widest outline-none transition-colors focus:border-emerald-500/50 focus:bg-white/5"
                                    bind:value={cp.apiKey}
                                    type="password"
                                    placeholder="sk-..."
                                />
                            </label>
                        </div>

                        <!-- Models Header -->
                        <div
                            class="mt-8 flex items-center justify-between border-b border-white/5 pb-3"
                        >
                            <h3
                                class="text-sm font-bold uppercase tracking-wider text-slate-300"
                            >
                                Attached Models
                            </h3>
                            <button
                                type="button"
                                class="cursor-pointer rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white transition-all hover:bg-white/10 hover:shadow"
                                on:click={() => addModel(cp.id)}
                            >
                                + Add Model
                            </button>
                        </div>

                        {#if cp.models.length === 0}
                            <div
                                class="mt-4 rounded-xl border border-white/5 bg-black/20 p-8 text-center text-sm text-slate-500"
                            >
                                This provider currently has no defined models.
                                Add a model identifier down below.
                            </div>
                        {/if}

                        <div class="mt-4 space-y-4">
                            {#each cp.models as model, index}
                                <div
                                    class="relative overflow-hidden rounded-xl border border-white/10 bg-white/[0.01]"
                                >
                                    <div
                                        class="grid gap-y-3 p-4 sm:grid-cols-[1fr_auto_auto] sm:gap-x-3"
                                    >
                                        <label class="col-span-1 block">
                                            <span class="hidden sr-only"
                                                >Model ID</span
                                            >
                                            <input
                                                class="w-full rounded-lg border border-white/10 bg-black/30 px-4 py-2 text-sm outline-none transition-colors focus:border-emerald-500/50"
                                                bind:value={model.id}
                                                placeholder="e.g. gpt-4o"
                                            />
                                        </label>

                                        <button
                                            type="button"
                                            class="col-span-1 cursor-pointer rounded-lg border border-sky-500/30 bg-sky-500/10 px-4 py-2 text-xs font-semibold text-sky-400 transition-colors hover:bg-sky-500/20 disabled:opacity-50 sm:col-span-1"
                                            on:click={() =>
                                                testProviderModel(
                                                    cp.id,
                                                    model.id,
                                                )}
                                            disabled={!model.id.trim() ||
                                                testingModelKey ===
                                                    `${cp.id}|${model.id.trim()}`}
                                        >
                                            {testingModelKey ===
                                            `${cp.id}|${model.id.trim()}`
                                                ? "Pinging..."
                                                : "Test Connection"}
                                        </button>

                                        <button
                                            type="button"
                                            class="col-span-1 cursor-pointer rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-xs font-semibold text-rose-300 transition-colors hover:bg-rose-500/20 sm:col-span-1"
                                            on:click={() =>
                                                removeModel(cp.id, index)}
                                        >
                                            Remove
                                        </button>
                                    </div>

                                    <div class="bg-black/20 px-4 py-3">
                                        <div
                                            class="mb-2 text-xs font-medium uppercase tracking-wider text-slate-500"
                                        >
                                            Declared Capabilities
                                        </div>
                                        <div class="flex flex-wrap gap-2">
                                            {#each capabilityTags as tag}
                                                <label
                                                    class={`inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors ${
                                                        model.tags.includes(tag)
                                                            ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-inset ring-emerald-500/40"
                                                            : "bg-white/5 text-slate-400 ring-1 ring-inset ring-white/10 hover:bg-white/10"
                                                    }`}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        class="hidden"
                                                        checked={model.tags.includes(
                                                            tag,
                                                        )}
                                                        on:change={() =>
                                                            toggleTag(
                                                                cp.id,
                                                                index,
                                                                tag,
                                                            )}
                                                    />
                                                    <span class="font-medium"
                                                        >{tag}</span
                                                    >
                                                </label>
                                            {/each}
                                        </div>

                                        {#if model.tags.length > 0}
                                            <div class="mt-4">
                                                <div
                                                    class="mb-2 text-xs font-medium uppercase tracking-wider text-slate-500"
                                                >
                                                    Verification Status
                                                </div>
                                                <div
                                                    class="flex flex-wrap gap-2"
                                                >
                                                    {#each model.tags as tag}
                                                        <span
                                                            class={`inline-flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs ${verificationBadgeClass(
                                                                verificationLabel(
                                                                    model,
                                                                    tag,
                                                                ),
                                                            )}`}
                                                        >
                                                            <span
                                                                class="font-medium"
                                                                >{tag}</span
                                                            >
                                                            <span
                                                                class="uppercase"
                                                                >{verificationLabel(
                                                                    model,
                                                                    tag,
                                                                )}</span
                                                            >
                                                        </span>
                                                    {/each}
                                                </div>
                                                <p
                                                    class="mt-3 text-[11px] leading-5 text-slate-500"
                                                >
                                                    Automatic verification
                                                    currently covers
                                                    {autoTestedCapabilities.join(
                                                        " / ",
                                                    )}. Declared capabilities
                                                    outside that set stay
                                                    `untested` until we add
                                                    deeper probes.
                                                    `audio_input` is config-only
                                                    for now; runtime audio
                                                    handling still falls back to
                                                    STT because native audio
                                                    prompt transport is not
                                                    wired yet.
                                                </p>
                                            </div>
                                        {/if}
                                    </div>
                                </div>
                            {/each}
                        </div>

                        <!-- Save Action bar at the bottom -->
                        <div
                            class="mt-8 flex flex-col gap-3 rounded-2xl bg-black/20 p-4 sm:flex-row sm:items-center sm:justify-between"
                        >
                            <label class="flex items-center gap-3 text-sm">
                                <span class="font-medium text-slate-300"
                                    >Set internal default model:</span
                                >
                                <select
                                    class="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 outline-none transition-colors focus:border-emerald-500/50"
                                    bind:value={cp.defaultModel}
                                >
                                    <option value="">(None)</option>
                                    {#each modelIds(cp) as modelId}
                                        <option value={modelId}
                                            >{modelId}</option
                                        >
                                    {/each}
                                </select>
                            </label>

                            <div class="flex items-center gap-3">
                                {#if message}
                                    <span
                                        class="text-xs font-medium text-emerald-400"
                                        >{message}</span
                                    >
                                {/if}
                                {#if error}
                                    <span
                                        class="max-w-[200px] truncate text-xs font-medium text-rose-400"
                                        title={error}>{error}</span
                                    >
                                {/if}

                                <button
                                    type="submit"
                                    class="shrink-0 cursor-pointer rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-bold text-emerald-950 transition-transform active:scale-95 disabled:pointer-events-none disabled:opacity-50"
                                    disabled={saving}
                                >
                                    {saving
                                        ? "Deploying..."
                                        : "Save Custom Provider"}
                                </button>
                            </div>
                        </div>
                    {:else}
                        <div
                            class="flex flex-col items-center justify-center py-20 text-center"
                        >
                            <div
                                class="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-white/5"
                            >
                                <svg
                                    width="24"
                                    height="24"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="2"
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    class="text-slate-400"
                                >
                                    <path
                                        d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"
                                    ></path>
                                    <polyline points="3.29 7 12 12 20.71 7"
                                    ></polyline>
                                    <line x1="12" y1="22" x2="12" y2="12"
                                    ></line>
                                </svg>
                            </div>
                            <h3 class="text-lg font-medium text-white">
                                No Provider Selected
                            </h3>
                            <p
                                class="mt-2 max-w-[250px] text-sm text-slate-400"
                            >
                                Choose a provider from the sidebar or define a
                                new one to begin configuration.
                            </p>
                        </div>
                    {/if}
                </div>
            </section>
        </form>
    {/if}
</div>
