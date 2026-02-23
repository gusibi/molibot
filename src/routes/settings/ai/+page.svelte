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

<div class="page">
  <header class="header">
    <div>
      <h1>AI Providers</h1>
      <p class="subtitle">Configure providers, model tags, and routing by capability.</p>
    </div>
    <div class="links">
      <a href="/settings">Back</a>
      <a href="/">Chat</a>
    </div>
  </header>

  {#if loading}
    <p>Loading AI settings...</p>
  {:else}
    <form class="shell" on:submit|preventDefault={save}>
      <section class="global-panel">
        <div class="global-grid">
          <label>
            Provider mode
            <select bind:value={form.providerMode}>
              <option value="pi">pi</option>
              <option value="custom">custom</option>
            </select>
          </label>

          <label>
            PI provider
            <select bind:value={form.piModelProvider} on:change={onPiProviderChanged}>
              {#each providers as provider}
                <option value={provider.id}>{provider.name}</option>
              {/each}
            </select>
          </label>

          <label>
            PI model
            <select bind:value={form.piModelName}>
              {#each providerModels[form.piModelProvider] ?? [] as model}
                <option value={model}>{model}</option>
              {/each}
            </select>
          </label>

          <label>
            Text model
            <select bind:value={form.modelRouting.textModelKey}>
              {#each routingOptions("text") as row}
                <option value={row.key}>{row.label}</option>
              {/each}
            </select>
          </label>

          <label>
            Vision model
            <select bind:value={form.modelRouting.visionModelKey}>
              {#each routingOptions("vision") as row}
                <option value={row.key}>{row.label}</option>
              {/each}
            </select>
          </label>

          <label>
            Speech-to-text model
            <select bind:value={form.modelRouting.sttModelKey}>
              {#each routingOptions("stt") as row}
                <option value={row.key}>{row.label}</option>
              {/each}
            </select>
          </label>

          <label>
            Text-to-speech model
            <select bind:value={form.modelRouting.ttsModelKey}>
              {#each routingOptions("tts") as row}
                <option value={row.key}>{row.label}</option>
              {/each}
            </select>
          </label>

          <label>
            System prompt
            <textarea rows="3" bind:value={form.systemPrompt}></textarea>
          </label>
        </div>
      </section>

      <section class="workspace-panel">
        <aside class="sidebar">
          <div class="sidebar-head">
            <h2>Providers</h2>
            <button type="button" on:click={addCustomProvider}>+ Add</button>
          </div>

          <input class="search" bind:value={providerSearch} placeholder="Search provider or model..." />

          <div class="provider-list">
            {#if filteredCustomProviders().length === 0}
              <p class="hint">No provider matched.</p>
            {/if}

            {#each filteredCustomProviders() as provider (provider.id)}
              <button
                type="button"
                class="provider-item {selectedProviderId === provider.id ? 'active' : ''}"
                on:click={() => (selectedProviderId = provider.id)}
              >
                <div class="item-main">
                  <strong>{provider.name}</strong>
                  <span class="item-id">{provider.id}</span>
                </div>
                <div class="item-meta">
                  <span>{provider.models.length} model{provider.models.length === 1 ? '' : 's'}</span>
                  {#if form.defaultCustomProviderId === provider.id}
                    <span class="badge">DEFAULT</span>
                  {/if}
                </div>
              </button>
            {/each}
          </div>
        </aside>

        <div class="detail">
          {#if getSelectedProvider()}
            {@const cp = getSelectedProvider()!}
            <div class="detail-head">
              <h2>{cp.name}</h2>
              <div class="row">
                <button type="button" on:click={() => setAsDefaultProvider(cp.id)} disabled={form.defaultCustomProviderId === cp.id}>
                  {form.defaultCustomProviderId === cp.id ? 'Default Provider' : 'Set Default'}
                </button>
                <button type="button" class="danger" on:click={() => removeCustomProvider(cp.id)}>Remove</button>
              </div>
            </div>

            <div class="detail-grid">
              <label>
                ID
                <input bind:value={cp.id} />
              </label>
              <label>
                Name
                <input bind:value={cp.name} />
              </label>
              <label>
                API Base URL
                <input bind:value={cp.baseUrl} placeholder="https://api.provider.com" />
              </label>
              <label>
                API Path
                <input bind:value={cp.path} placeholder="/v1/chat/completions" />
              </label>
              <label class="full">
                API Key
                <input bind:value={cp.apiKey} type="password" />
              </label>
            </div>

            <section class="models-panel">
              <div class="models-head">
                <h3>Models</h3>
                <button type="button" on:click={() => addModel(cp.id)}>+ Add Model</button>
              </div>

              {#if cp.models.length === 0}
                <p class="hint">No model configured yet.</p>
              {/if}

              {#each cp.models as model, index}
                <div class="model-row" style="display:grid; grid-template-columns: 1fr auto auto; gap:8px; align-items:center;">
                  <input bind:value={model.id} placeholder="provider/model-name" />
                  <button
                    type="button"
                    on:click={() => testProviderModel(cp.id, model.id)}
                    disabled={!model.id.trim() || testingModelKey === `${cp.id}|${model.id.trim()}`}
                  >
                    {testingModelKey === `${cp.id}|${model.id.trim()}` ? "Testing..." : "Test"}
                  </button>
                  <button type="button" class="danger" on:click={() => removeModel(cp.id, index)}>Delete</button>
                </div>
                <div class="tags" style="display:flex; gap:8px; flex-wrap:wrap; margin:6px 0 12px 0;">
                  {#each capabilityTags as tag}
                    <label style="display:flex; align-items:center; gap:4px;">
                      <input type="checkbox" checked={model.tags.includes(tag)} on:change={() => toggleTag(cp.id, index, tag)} />
                      <span>{tag}</span>
                    </label>
                  {/each}
                </div>
              {/each}

              <label>
                Default model
                <select bind:value={cp.defaultModel}>
                  {#each modelIds(cp) as modelId}
                    <option value={modelId}>{modelId}</option>
                  {/each}
                </select>
              </label>
            </section>

            <section class="role-panel">
              <h3>Supported roles (by model)</h3>
              {#if cp.models.length === 0}
                <p class="hint">No model yet.</p>
              {:else}
                {#each cp.models as model}
                  {#if model.id.trim()}
                    <div class="row">
                      <strong>{model.id}</strong>
                      <div class="chips">
                        {#each model.supportedRoles as role}
                          <span class="chip">{role}</span>
                        {/each}
                      </div>
                    </div>
                  {/if}
                {/each}
              {/if}
              <p class="hint">Use each model's Test button to refresh its supported roles.</p>
            </section>
          {:else}
            <p class="hint">Select a provider from the left list.</p>
          {/if}
        </div>
      </section>

      <footer class="actions">
        <button type="submit" disabled={saving}>{saving ? "Saving..." : "Save AI Settings"}</button>
      </footer>
    </form>

    {#if message}
      <p class="ok">{message}</p>
    {/if}
    {#if error}
      <p class="err">{error}</p>
    {/if}
  {/if}
</div>

<style>
  .page { max-width: 1200px; margin: 0 auto; padding: 20px; }
  .header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
  .subtitle { color: #4b5563; margin: 4px 0 0 0; }
  .links { display: flex; gap: 12px; }
  .shell { display: grid; gap: 14px; }
  .global-panel, .workspace-panel, .detail, .sidebar, .actions, .ok, .err { border: 1px solid #e5e7eb; border-radius: 12px; background: #fff; }
  .global-panel, .actions, .ok, .err { padding: 12px; }
  .global-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .workspace-panel { display: grid; grid-template-columns: 320px 1fr; min-height: 560px; overflow: hidden; }
  .sidebar { border: none; border-right: 1px solid #e5e7eb; border-radius: 0; padding: 12px; }
  .detail { border: none; border-radius: 0; padding: 12px; }
  .sidebar-head, .detail-head, .models-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .provider-list { margin-top: 10px; display: grid; gap: 8px; }
  .provider-item { text-align: left; border: 1px solid #e5e7eb; border-radius: 10px; padding: 8px; background: #fff; }
  .provider-item.active { border-color: #2563eb; background: #eff6ff; }
  .item-main { display: flex; flex-direction: column; gap: 2px; }
  .item-id { font-size: 12px; color: #6b7280; }
  .item-meta { display: flex; gap: 8px; font-size: 12px; color: #6b7280; margin-top: 6px; }
  .badge { color: #1d4ed8; font-weight: 700; }
  .detail-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 10px; }
  .full { grid-column: 1 / -1; }
  .models-panel, .role-panel { margin-top: 14px; padding-top: 10px; border-top: 1px solid #e5e7eb; }
  .chips { display: flex; gap: 8px; flex-wrap: wrap; margin: 8px 0; }
  .chip { font-size: 12px; border: 1px solid #d1d5db; border-radius: 999px; padding: 2px 8px; }
  label { display: grid; gap: 6px; font-size: 13px; }
  input, select, textarea, button { font: inherit; }
  input, select, textarea { padding: 8px; border: 1px solid #d1d5db; border-radius: 8px; }
  textarea { min-height: 80px; resize: vertical; }
  button { padding: 8px 10px; border: 1px solid #d1d5db; border-radius: 8px; background: #f9fafb; cursor: pointer; }
  button.danger { color: #b91c1c; border-color: #fecaca; background: #fef2f2; }
  .search { width: 100%; margin-top: 8px; }
  .actions { display: flex; justify-content: flex-end; }
  .ok { color: #166534; }
  .err { color: #b91c1c; }
  .hint { color: #6b7280; }
  .row { display: flex; gap: 8px; }
  @media (max-width: 960px) {
    .global-grid, .detail-grid { grid-template-columns: 1fr; }
    .workspace-panel { grid-template-columns: 1fr; }
    .sidebar { border-right: none; border-bottom: 1px solid #e5e7eb; }
  }
</style>
