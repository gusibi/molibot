<script lang="ts">
  import { onMount } from "svelte";

  type ProviderMode = "pi" | "custom";
  type ModelRole = "system" | "user" | "assistant" | "tool" | "developer";
  type ModelCapabilityTag = "text" | "vision" | "stt" | "tts" | "tool";

  interface ProviderModelForm {
    id: string;
    tags: ModelCapabilityTag[];
    supportedRoles: ModelRole[];
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
  }

  let loading = true;
  let saving = false;
  let testingModelKey = "";
  let selectedProviderId = "";
  let providerSearch = "";
  let error = "";
  let message = "";

  let providers: Array<{ id: string; name: string }> = [];
  let providerModels: Record<string, string[]> = {};
  let capabilityTags: ModelCapabilityTag[] = ["text", "vision", "stt", "tts", "tool"];

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
      ttsModelKey: ""
    },
    systemPrompt: "You are Molibot, a concise and helpful assistant."
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
      path: "/v1/chat/completions"
    };
  }

  function modelIds(provider: CustomProviderForm): string[] {
    return provider.models.map((m) => m.id.trim()).filter(Boolean);
  }

  function ensureModelDefaults(model: ProviderModelForm): void {
    model.id = model.id.trim();
    model.tags = Array.isArray(model.tags) ? model.tags.filter((t) => capabilityTags.includes(t)) : ["text"];
    if (model.tags.length === 0) model.tags = ["text"];
    if (!Array.isArray(model.supportedRoles) || model.supportedRoles.length === 0) {
      model.supportedRoles = ["system", "user", "assistant", "tool"];
    }
  }

  function ensureProviderDefaults(provider: CustomProviderForm): void {
    provider.models = provider.models.map((m) => {
      const normalized: ProviderModelForm = typeof (m as unknown) === "string"
        ? { id: String(m), tags: ["text"], supportedRoles: ["system", "user", "assistant", "tool"] }
        : {
            id: String((m as ProviderModelForm).id ?? ""),
            tags: Array.isArray((m as ProviderModelForm).tags) ? (m as ProviderModelForm).tags : ["text"],
            supportedRoles: Array.isArray((m as ProviderModelForm).supportedRoles)
              ? (m as ProviderModelForm).supportedRoles
              : ["system", "user", "assistant", "tool"]
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
    for (const provider of form.customProviders) ensureProviderDefaults(provider);

    if (form.customProviders.length === 0) {
      form.defaultCustomProviderId = "";
      selectedProviderId = "";
      return;
    }

    if (!form.customProviders.some((p) => p.id === form.defaultCustomProviderId)) {
      form.defaultCustomProviderId = form.customProviders[0].id;
    }

    if (!selectedProviderId || !form.customProviders.some((p) => p.id === selectedProviderId)) {
      selectedProviderId = form.defaultCustomProviderId || form.customProviders[0].id;
    }
  }

  function onPiProviderChanged(): void {
    const models = providerModels[form.piModelProvider] ?? [];
    if (models.length > 0 && !models.includes(form.piModelName)) {
      form.piModelName = models[0];
    }
  }

  function addCustomProvider(): void {
    const provider = newCustomProvider();
    form.customProviders = [...form.customProviders, provider];
    selectedProviderId = provider.id;
    ensureDefaultCustomProvider();
    ensureRoutingDefaults();
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
    updater: (provider: CustomProviderForm) => CustomProviderForm
  ): void {
    form.customProviders = form.customProviders.map((row) => {
      if (row.id !== providerId) return row;
      const next = updater({
        ...row,
        models: Array.isArray(row.models) ? [...row.models] : []
      });
      ensureProviderDefaults(next);
      return next;
    });
    ensureDefaultCustomProvider();
    ensureRoutingDefaults();
  }

  function addModel(providerId: string): void {
    updateProviderById(providerId, (provider) => ({
      ...provider,
      models: [
        ...provider.models,
        { id: "", tags: ["text"], supportedRoles: ["system", "user", "assistant", "tool"] }
      ]
    }));
  }

  function removeModel(providerId: string, index: number): void {
    updateProviderById(providerId, (provider) => ({
      ...provider,
      models: provider.models.filter((_, i) => i !== index)
    }));
  }

  function setAsDefaultProvider(id: string): void {
    form.defaultCustomProviderId = id;
  }

  function toggleTag(providerId: string, modelIndex: number, tag: ModelCapabilityTag): void {
    updateProviderById(providerId, (provider) => {
      const models = provider.models.map((m, i) => {
        if (i !== modelIndex) return m;
        const set = new Set(m.tags);
        if (set.has(tag)) set.delete(tag);
        else set.add(tag);
        const tags = Array.from(set) as ModelCapabilityTag[];
        return { ...m, tags: tags.length > 0 ? tags : ["text"] };
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

  function allModelOptions(): Array<{ key: string; label: string; tags: ModelCapabilityTag[] }> {
    const out: Array<{ key: string; label: string; tags: ModelCapabilityTag[] }> = [
      {
        key: `pi|${form.piModelProvider}|${form.piModelName}`,
        label: `[PI] ${form.piModelProvider} / ${form.piModelName}`,
        tags: ["text", "vision"]
      }
    ];

    for (const cp of form.customProviders) {
      for (const m of cp.models) {
        out.push({
          key: `custom|${cp.id}|${m.id}`,
          label: `[Custom] ${cp.name} / ${m.id}`,
          tags: m.tags
        });
      }
    }

    return out;
  }

  function routingOptions(requiredTag: ModelCapabilityTag): Array<{ key: string; label: string }> {
    return allModelOptions()
      .filter((m) => m.tags.includes(requiredTag) || requiredTag === "text")
      .map((m) => ({ key: m.key, label: m.label }));
  }

  function ensureRoutingDefaults(): void {
    const all = allModelOptions();
    const allKeys = new Set(all.map((m) => m.key));

    const textFallback = all[0]?.key ?? "";
    if (!allKeys.has(form.modelRouting.textModelKey)) form.modelRouting.textModelKey = textFallback;

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

  async function testProviderModel(providerId: string, modelId: string): Promise<void> {
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
          model: targetModel
        })
      });

      const data = (await res.json()) as ProviderTestResult & { error?: string };
      if (!res.ok) throw new Error(data.error || "Provider test failed");

      updateProviderById(providerId, (current) => ({
        ...current,
        models: current.models.map((m) =>
          m.id.trim() === targetModel ? { ...m, supportedRoles: data.supportedRoles } : m
        )
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
        fetch("/api/settings/ai-meta")
      ]);

      const settingsData = await settingsRes.json();
      const metaData = (await metaRes.json()) as MetaResponse & { ok: boolean; error?: string };
      if (!settingsData.ok) throw new Error(settingsData.error || "Failed to load settings");
      if (!metaData.ok) throw new Error(metaData.error || "Failed to load AI metadata");

      providers = metaData.providers ?? [];
      providerModels = metaData.providerModels ?? {};
      capabilityTags = metaData.capabilityTags ?? capabilityTags;

      const s = settingsData.settings;
      const loadedProviders = (s.customProviders ?? []) as Array<CustomProviderForm & { supportedRoles?: ModelRole[] }>;

      form = {
        providerMode: s.providerMode,
        piModelProvider: s.piModelProvider,
        piModelName: s.piModelName,
        defaultCustomProviderId: s.defaultCustomProviderId ?? "",
        customProviders: loadedProviders.map((cp) => ({
          ...cp,
          models: Array.isArray(cp.models)
            ? cp.models.map((m: unknown) => {
                if (typeof m === "string") {
                  return {
                    id: m,
                    tags: ["text"] as ModelCapabilityTag[],
                    supportedRoles: Array.isArray(cp.supportedRoles) && cp.supportedRoles.length > 0
                      ? cp.supportedRoles
                      : ["system", "user", "assistant", "tool"]
                  };
                }
                const obj = (m ?? {}) as { id?: unknown; tags?: unknown };
                const tags = Array.isArray(obj.tags)
                  ? obj.tags.map((t) => String(t) as ModelCapabilityTag).filter((t) => capabilityTags.includes(t))
                  : ["text"];
                const roles = Array.isArray((obj as { supportedRoles?: unknown }).supportedRoles)
                  ? ((obj as { supportedRoles: unknown[] }).supportedRoles
                    .map((r) => String(r) as ModelRole)
                    .filter((r) => ["system", "user", "assistant", "tool", "developer"].includes(r)))
                  : [];
                return {
                  id: String(obj.id ?? ""),
                  tags: tags.length > 0 ? tags : ["text"],
                  supportedRoles: roles.length > 0
                    ? roles
                    : (Array.isArray(cp.supportedRoles) && cp.supportedRoles.length > 0
                      ? cp.supportedRoles
                      : ["system", "user", "assistant", "tool"])
                };
              })
            : [],
          defaultModel: cp.defaultModel ?? ""
        })),
        modelRouting: {
          textModelKey: s.modelRouting?.textModelKey ?? "",
          visionModelKey: s.modelRouting?.visionModelKey ?? "",
          sttModelKey: s.modelRouting?.sttModelKey ?? "",
          ttsModelKey: s.modelRouting?.ttsModelKey ?? ""
        },
        systemPrompt: s.systemPrompt
      };

      ensureDefaultCustomProvider();
      onPiProviderChanged();
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
      ensureDefaultCustomProvider();
      ensureRoutingDefaults();
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to save AI settings");
      message = "AI settings saved.";
      await loadAll();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      saving = false;
    }
  }

  onMount(loadAll);
</script>

<main class="h-screen bg-[#212121] text-slate-100">
  <div class="grid h-full grid-cols-1 lg:grid-cols-[260px_1fr]">
    <aside class="hidden border-r border-white/10 bg-[#171717] p-3 lg:block">
      <nav class="space-y-1 text-sm">
        <a class="block rounded-lg px-3 py-2 text-slate-300 transition-colors duration-200 hover:bg-white/10" href="/">Chat</a>
        <a class="block rounded-lg px-3 py-2 text-slate-300 transition-colors duration-200 hover:bg-white/10" href="/settings">Settings</a>
        <a class="block rounded-lg bg-white/15 px-3 py-2 font-medium text-white" href="/settings/ai">AI</a>
        <a class="block rounded-lg px-3 py-2 text-slate-300 transition-colors duration-200 hover:bg-white/10" href="/settings/telegram">Telegram</a>
        <a class="block rounded-lg px-3 py-2 text-slate-300 transition-colors duration-200 hover:bg-white/10" href="/settings/tasks">Tasks</a>
        <a class="block rounded-lg px-3 py-2 text-slate-300 transition-colors duration-200 hover:bg-white/10" href="/settings/skills">Skills</a>
        <a class="block rounded-lg px-3 py-2 text-slate-300 transition-colors duration-200 hover:bg-white/10" href="/settings/plugins">Plugins</a>
        <a class="block rounded-lg px-3 py-2 text-slate-300 transition-colors duration-200 hover:bg-white/10" href="/settings/memory">Memory</a>
      </nav>
    </aside>

    <section class="min-h-0 overflow-y-auto px-4 py-6 sm:px-8">
      <div class="mx-auto max-w-6xl space-y-4">
        <h1 class="text-2xl font-semibold">AI Providers</h1>
        <p class="text-sm text-slate-400">Configure providers, model tags, and routing by capability.</p>

        {#if loading}
          <div class="rounded-xl border border-white/15 bg-[#2b2b2b] px-4 py-3 text-sm text-slate-300">Loading AI settings...</div>
        {:else}
          <form class="space-y-4" on:submit|preventDefault={save}>
            <section class="rounded-xl border border-white/15 bg-[#2b2b2b] p-4">
              <div class="grid gap-3 md:grid-cols-2">
                <label class="grid gap-1.5 text-sm">
                  <span class="text-slate-300">Provider mode</span>
                  <select class="rounded-lg border border-white/15 bg-[#1f1f1f] px-3 py-2 outline-none focus:border-emerald-400" bind:value={form.providerMode}>
                    <option value="pi">pi</option>
                    <option value="custom">custom</option>
                  </select>
                </label>

                <label class="grid gap-1.5 text-sm">
                  <span class="text-slate-300">PI provider</span>
                  <select class="rounded-lg border border-white/15 bg-[#1f1f1f] px-3 py-2 outline-none focus:border-emerald-400" bind:value={form.piModelProvider} on:change={onPiProviderChanged}>
                    {#each providers as provider}
                      <option value={provider.id}>{provider.name}</option>
                    {/each}
                  </select>
                </label>

                <label class="grid gap-1.5 text-sm">
                  <span class="text-slate-300">PI model</span>
                  <select class="rounded-lg border border-white/15 bg-[#1f1f1f] px-3 py-2 outline-none focus:border-emerald-400" bind:value={form.piModelName}>
                    {#each providerModels[form.piModelProvider] ?? [] as model}
                      <option value={model}>{model}</option>
                    {/each}
                  </select>
                </label>

                <label class="grid gap-1.5 text-sm">
                  <span class="text-slate-300">Text model</span>
                  <select class="rounded-lg border border-white/15 bg-[#1f1f1f] px-3 py-2 outline-none focus:border-emerald-400" bind:value={form.modelRouting.textModelKey}>
                    {#each routingOptions("text") as row}
                      <option value={row.key}>{row.label}</option>
                    {/each}
                  </select>
                </label>

                <label class="grid gap-1.5 text-sm">
                  <span class="text-slate-300">Vision model</span>
                  <select class="rounded-lg border border-white/15 bg-[#1f1f1f] px-3 py-2 outline-none focus:border-emerald-400" bind:value={form.modelRouting.visionModelKey}>
                    {#each routingOptions("vision") as row}
                      <option value={row.key}>{row.label}</option>
                    {/each}
                  </select>
                </label>

                <label class="grid gap-1.5 text-sm">
                  <span class="text-slate-300">Speech-to-text model</span>
                  <select class="rounded-lg border border-white/15 bg-[#1f1f1f] px-3 py-2 outline-none focus:border-emerald-400" bind:value={form.modelRouting.sttModelKey}>
                    {#each routingOptions("stt") as row}
                      <option value={row.key}>{row.label}</option>
                    {/each}
                  </select>
                </label>

                <label class="grid gap-1.5 text-sm">
                  <span class="text-slate-300">Text-to-speech model</span>
                  <select class="rounded-lg border border-white/15 bg-[#1f1f1f] px-3 py-2 outline-none focus:border-emerald-400" bind:value={form.modelRouting.ttsModelKey}>
                    {#each routingOptions("tts") as row}
                      <option value={row.key}>{row.label}</option>
                    {/each}
                  </select>
                </label>

                <label class="grid gap-1.5 text-sm md:col-span-2">
                  <span class="text-slate-300">System prompt</span>
                  <textarea class="min-h-24 rounded-lg border border-white/15 bg-[#1f1f1f] px-3 py-2 outline-none focus:border-emerald-400" rows="3" bind:value={form.systemPrompt}></textarea>
                </label>
              </div>
            </section>

            <section class="grid min-h-[560px] gap-0 overflow-hidden rounded-xl border border-white/15 bg-[#2b2b2b] lg:grid-cols-[300px_1fr]">
              <aside class="border-b border-white/10 p-4 lg:border-b-0 lg:border-r">
                <div class="flex items-center justify-between gap-2">
                  <h2 class="text-sm font-semibold">Providers</h2>
                  <button
                    type="button"
                    class="cursor-pointer rounded-md border border-white/15 bg-[#1f1f1f] px-3 py-1.5 text-xs transition-colors duration-200 hover:bg-[#303030]"
                    on:click={addCustomProvider}>+ Add</button
                  >
                </div>

                <input
                  class="mt-3 w-full rounded-lg border border-white/15 bg-[#1f1f1f] px-3 py-2 text-sm outline-none focus:border-emerald-400"
                  bind:value={providerSearch}
                  placeholder="Search provider or model..."
                />

                <div class="mt-3 space-y-2">
                  {#if filteredCustomProviders().length === 0}
                    <p class="text-xs text-slate-500">No provider matched.</p>
                  {/if}

                  {#each filteredCustomProviders() as provider (provider.id)}
                    <button
                      type="button"
                      class={`w-full cursor-pointer rounded-lg border px-3 py-2 text-left text-sm transition-colors duration-200 ${selectedProviderId === provider.id
                        ? "border-white/30 bg-white/10 text-white"
                        : "border-white/10 bg-[#252525] text-slate-300 hover:bg-[#303030]"}`}
                      on:click={() => (selectedProviderId = provider.id)}
                    >
                      <div class="font-medium">{provider.name}</div>
                      <div class="mt-0.5 text-xs text-slate-500">{provider.id}</div>
                      <div class="mt-1 text-xs text-slate-400">
                        {provider.models.length} model{provider.models.length === 1 ? "" : "s"}
                        {#if form.defaultCustomProviderId === provider.id}
                          • default
                        {/if}
                      </div>
                    </button>
                  {/each}
                </div>
              </aside>

              <div class="p-4">
                {#if getSelectedProvider()}
                  {@const cp = getSelectedProvider()!}
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <h2 class="text-lg font-semibold">{cp.name}</h2>
                    <div class="flex gap-2">
                      <button
                        type="button"
                        class="cursor-pointer rounded-md border border-white/15 bg-[#1f1f1f] px-3 py-1.5 text-xs transition-colors duration-200 hover:bg-[#303030] disabled:cursor-not-allowed disabled:opacity-60"
                        on:click={() => setAsDefaultProvider(cp.id)}
                        disabled={form.defaultCustomProviderId === cp.id}
                      >
                        {form.defaultCustomProviderId === cp.id ? "Default Provider" : "Set Default"}
                      </button>
                      <button
                        type="button"
                        class="cursor-pointer rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-300 transition-colors duration-200 hover:bg-rose-500/20"
                        on:click={() => removeCustomProvider(cp.id)}>Remove</button
                      >
                    </div>
                  </div>

                  <div class="mt-3 grid gap-3 md:grid-cols-2">
                    <label class="grid gap-1.5 text-sm">
                      <span class="text-slate-300">ID</span>
                      <input class="rounded-lg border border-white/15 bg-[#1f1f1f] px-3 py-2 outline-none focus:border-emerald-400" bind:value={cp.id} />
                    </label>
                    <label class="grid gap-1.5 text-sm">
                      <span class="text-slate-300">Name</span>
                      <input class="rounded-lg border border-white/15 bg-[#1f1f1f] px-3 py-2 outline-none focus:border-emerald-400" bind:value={cp.name} />
                    </label>
                    <label class="grid gap-1.5 text-sm">
                      <span class="text-slate-300">API Base URL</span>
                      <input class="rounded-lg border border-white/15 bg-[#1f1f1f] px-3 py-2 outline-none focus:border-emerald-400" bind:value={cp.baseUrl} placeholder="https://api.provider.com" />
                    </label>
                    <label class="grid gap-1.5 text-sm">
                      <span class="text-slate-300">API Path</span>
                      <input class="rounded-lg border border-white/15 bg-[#1f1f1f] px-3 py-2 outline-none focus:border-emerald-400" bind:value={cp.path} placeholder="/v1/chat/completions" />
                    </label>
                    <label class="grid gap-1.5 text-sm md:col-span-2">
                      <span class="text-slate-300">API Key</span>
                      <input class="rounded-lg border border-white/15 bg-[#1f1f1f] px-3 py-2 outline-none focus:border-emerald-400" bind:value={cp.apiKey} type="password" />
                    </label>
                  </div>

                  <section class="mt-5 space-y-3 border-t border-white/10 pt-4">
                    <div class="flex items-center justify-between gap-2">
                      <h3 class="text-sm font-semibold">Models</h3>
                      <button
                        type="button"
                        class="cursor-pointer rounded-md border border-white/15 bg-[#1f1f1f] px-3 py-1.5 text-xs transition-colors duration-200 hover:bg-[#303030]"
                        on:click={() => addModel(cp.id)}>+ Add Model</button
                      >
                    </div>

                    {#if cp.models.length === 0}
                      <p class="text-sm text-slate-500">No model configured yet.</p>
                    {/if}

                    {#each cp.models as model, index}
                      <div class="rounded-lg border border-white/10 bg-[#252525] p-3">
                        <div class="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                          <input
                            class="rounded-lg border border-white/15 bg-[#1f1f1f] px-3 py-2 text-sm outline-none focus:border-emerald-400"
                            bind:value={model.id}
                            placeholder="provider/model-name"
                          />
                          <button
                            type="button"
                            class="cursor-pointer rounded-md border border-white/15 bg-[#1f1f1f] px-3 py-2 text-xs transition-colors duration-200 hover:bg-[#303030] disabled:cursor-not-allowed disabled:opacity-60"
                            on:click={() => testProviderModel(cp.id, model.id)}
                            disabled={!model.id.trim() || testingModelKey === `${cp.id}|${model.id.trim()}`}
                          >
                            {testingModelKey === `${cp.id}|${model.id.trim()}` ? "Testing..." : "Test"}
                          </button>
                          <button
                            type="button"
                            class="cursor-pointer rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300 transition-colors duration-200 hover:bg-rose-500/20"
                            on:click={() => removeModel(cp.id, index)}
                          >
                            Delete
                          </button>
                        </div>

                        <div class="mt-2 flex flex-wrap gap-2">
                          {#each capabilityTags as tag}
                            <label class="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-[#1f1f1f] px-2 py-1 text-xs">
                              <input type="checkbox" checked={model.tags.includes(tag)} on:change={() => toggleTag(cp.id, index, tag)} />
                              <span>{tag}</span>
                            </label>
                          {/each}
                        </div>
                      </div>
                    {/each}

                    <label class="grid gap-1.5 text-sm">
                      <span class="text-slate-300">Default model</span>
                      <select class="rounded-lg border border-white/15 bg-[#1f1f1f] px-3 py-2 outline-none focus:border-emerald-400" bind:value={cp.defaultModel}>
                        {#each modelIds(cp) as modelId}
                          <option value={modelId}>{modelId}</option>
                        {/each}
                      </select>
                    </label>
                  </section>

                  <section class="mt-5 space-y-2 border-t border-white/10 pt-4">
                    <h3 class="text-sm font-semibold">Supported roles (by model)</h3>
                    {#if cp.models.length === 0}
                      <p class="text-sm text-slate-500">No model yet.</p>
                    {:else}
                      {#each cp.models as model}
                        {#if model.id.trim()}
                          <div class="flex flex-col gap-1 rounded-lg border border-white/10 bg-[#252525] px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                            <strong class="text-sm">{model.id}</strong>
                            <div class="flex flex-wrap gap-1.5">
                              {#each model.supportedRoles as role}
                                <span class="rounded-full border border-white/20 px-2 py-0.5 text-xs text-slate-300">{role}</span>
                              {/each}
                            </div>
                          </div>
                        {/if}
                      {/each}
                    {/if}
                    <p class="text-xs text-slate-500">Use each model's Test button to refresh its supported roles.</p>
                  </section>
                {:else}
                  <p class="text-sm text-slate-500">Select a provider from the left list.</p>
                {/if}
              </div>
            </section>

            <footer class="flex justify-end">
              <button
                type="submit"
                class="cursor-pointer rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black transition-colors duration-200 hover:bg-slate-200 disabled:cursor-not-allowed disabled:bg-slate-600 disabled:text-slate-300"
                disabled={saving}
              >
                {saving ? "Saving..." : "Save AI Settings"}
              </button>
            </footer>
          </form>

          {#if message}
            <p class="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">{message}</p>
          {/if}
          {#if error}
            <p class="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</p>
          {/if}
        {/if}
      </div>
    </section>
  </div>
</main>
