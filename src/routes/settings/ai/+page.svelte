<script lang="ts">
  import { onMount } from "svelte";

  type ProviderMode = "pi" | "custom";
  type ModelRole = "system" | "user" | "assistant" | "tool" | "developer";

  interface CustomProviderForm {
    id: string;
    name: string;
    baseUrl: string;
    apiKey: string;
    models: string[];
    defaultModel: string;
    supportedRoles: ModelRole[];
    path: string;
  }

  interface AIForm {
    providerMode: ProviderMode;
    piModelProvider: string;
    piModelName: string;
    defaultCustomProviderId: string;
    customProviders: CustomProviderForm[];
    systemPrompt: string;
  }

  interface MetaResponse {
    providers: Array<{ id: string; name: string }>;
    providerModels: Record<string, string[]>;
  }

  interface ProviderTestResult {
    ok: boolean;
    status: number | null;
    message: string;
    supportedRoles: ModelRole[];
  }

  let loading = true;
  let saving = false;
  let testingProviderId = "";
  let selectedProviderId = "";
  let providerSearch = "";
  let error = "";
  let message = "";

  let providers: Array<{ id: string; name: string }> = [];
  let providerModels: Record<string, string[]> = {};

  let form: AIForm = {
    providerMode: "pi",
    piModelProvider: "anthropic",
    piModelName: "claude-sonnet-4-20250514",
    defaultCustomProviderId: "",
    customProviders: [],
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
      supportedRoles: ["system", "user", "assistant", "tool"],
      path: "/v1/chat/completions"
    };
  }

  function ensureProviderDefaults(provider: CustomProviderForm): void {
    provider.models = provider.models.map((m) => m.trim()).filter(Boolean);
    if (provider.models.length === 0) {
      provider.defaultModel = "";
    } else if (!provider.models.includes(provider.defaultModel)) {
      provider.defaultModel = provider.models[0];
    }
    if (!Array.isArray(provider.supportedRoles) || provider.supportedRoles.length === 0) {
      provider.supportedRoles = ["system", "user", "assistant", "tool"];
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

  function addModel(provider: CustomProviderForm): void {
    provider.models = [...provider.models, ""];
  }

  function removeModel(provider: CustomProviderForm, index: number): void {
    provider.models = provider.models.filter((_, i) => i !== index);
    ensureProviderDefaults(provider);
  }

  function setAsDefaultProvider(id: string): void {
    form.defaultCustomProviderId = id;
  }

  function filteredCustomProviders(): CustomProviderForm[] {
    const keyword = providerSearch.trim().toLowerCase();
    if (!keyword) return form.customProviders;
    return form.customProviders.filter((p) => {
      return (
        p.name.toLowerCase().includes(keyword) ||
        p.id.toLowerCase().includes(keyword) ||
        p.models.some((m) => m.toLowerCase().includes(keyword))
      );
    });
  }

  function getSelectedProvider(): CustomProviderForm | undefined {
    return form.customProviders.find((p) => p.id === selectedProviderId);
  }

  async function testProvider(provider: CustomProviderForm): Promise<void> {
    testingProviderId = provider.id;
    error = "";
    message = "";
    try {
      ensureProviderDefaults(provider);
      const targetModel = provider.defaultModel || provider.models[0] || "";
      if (!targetModel) {
        throw new Error("Please add at least one model, then set a default model.");
      }

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

      provider.supportedRoles = data.supportedRoles;
      message = `[${provider.name}] ${data.message}`;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      testingProviderId = "";
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

      const s = settingsData.settings;
      const loadedProviders = (s.customProviders ?? []) as CustomProviderForm[];

      form = {
        providerMode: s.providerMode,
        piModelProvider: s.piModelProvider,
        piModelName: s.piModelName,
        defaultCustomProviderId: s.defaultCustomProviderId ?? "",
        customProviders: loadedProviders.map((cp) => ({
          ...cp,
          models: Array.isArray(cp.models)
            ? cp.models
            : (cp as unknown as { model?: string }).model
              ? [String((cp as unknown as { model?: string }).model)]
              : [],
          defaultModel: cp.defaultModel ?? "",
          supportedRoles: Array.isArray(cp.supportedRoles)
            ? cp.supportedRoles
            : ["system", "user", "assistant", "tool"]
        })),
        systemPrompt: s.systemPrompt
      };

      ensureDefaultCustomProvider();
      onPiProviderChanged();
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
      <p class="subtitle">Manage provider configs, model lists, and role capabilities.</p>
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

          <input
            class="search"
            bind:value={providerSearch}
            placeholder="Search provider or model..."
          />

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
                <button type="button" on:click={() => addModel(cp)}>+ Add Model</button>
              </div>

              {#if cp.models.length === 0}
                <p class="hint">No model configured yet.</p>
              {/if}

              {#each cp.models as _, index}
                <div class="model-row">
                  <input bind:value={cp.models[index]} placeholder="provider/model-name" />
                  <button type="button" class="danger" on:click={() => removeModel(cp, index)}>Delete</button>
                </div>
              {/each}

              <label>
                Default model
                <select bind:value={cp.defaultModel}>
                  {#each cp.models as model}
                    <option value={model}>{model}</option>
                  {/each}
                </select>
              </label>
            </section>

            <section class="roles-panel">
              <div class="roles-head">
                <h3>Role Support</h3>
                <button type="button" on:click={() => testProvider(cp)} disabled={testingProviderId === cp.id}>
                  {testingProviderId === cp.id ? 'Testing...' : 'Test Provider'}
                </button>
              </div>

              <div class="roles">
                {#each cp.supportedRoles as role}
                  <span class="chip">{role}</span>
                {/each}
              </div>

              <p class="hint">Test checks connectivity and whether this model accepts <code>developer</code> role.</p>
            </section>
          {:else}
            <p class="hint">Select or add a provider from the left panel.</p>
          {/if}
        </div>
      </section>

      <div class="footer-actions">
        <button type="submit" disabled={saving}>{saving ? "Saving..." : "Save AI Settings"}</button>
        {#if message}
          <p class="ok">{message}</p>
        {/if}
        {#if error}
          <p class="err">{error}</p>
        {/if}
      </div>
    </form>
  {/if}
</div>

<style>
  :global(html, body, #svelte) {
    margin: 0;
    background: radial-gradient(1200px 800px at 0% 0%, #1c2738 0%, #0b0f15 50%, #080b11 100%);
    color: #e5ecf5;
    font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
  }

  .page {
    max-width: 1320px;
    margin: 0 auto;
    padding: 24px;
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 18px;
  }

  h1 {
    margin: 0;
    font-size: 28px;
    letter-spacing: 0.2px;
  }

  .subtitle {
    margin: 4px 0 0;
    color: #9eb1c7;
    font-size: 13px;
  }

  .links {
    display: flex;
    gap: 12px;
  }

  a {
    color: #a8c5ff;
    text-decoration: none;
  }

  .shell {
    display: grid;
    gap: 14px;
  }

  .global-panel,
  .workspace-panel,
  .models-panel,
  .roles-panel {
    border: 1px solid #2d3b51;
    background: linear-gradient(180deg, #141c29 0%, #101722 100%);
    border-radius: 14px;
  }

  .global-panel {
    padding: 14px;
  }

  .global-grid {
    display: grid;
    gap: 10px;
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  .workspace-panel {
    display: grid;
    grid-template-columns: 320px 1fr;
    min-height: 620px;
    overflow: hidden;
  }

  .sidebar {
    border-right: 1px solid #2d3b51;
    padding: 14px;
    display: grid;
    grid-template-rows: auto auto 1fr;
    gap: 10px;
  }

  .sidebar-head,
  .detail-head,
  .models-head,
  .roles-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
  }

  .search {
    width: 100%;
  }

  .provider-list {
    display: grid;
    gap: 8px;
    align-content: start;
    max-height: 500px;
    overflow: auto;
    padding-right: 4px;
  }

  .provider-item {
    width: 100%;
    text-align: left;
    border-radius: 10px;
    border: 1px solid #2d3b51;
    padding: 10px;
    background: #0e151f;
    display: grid;
    gap: 6px;
    cursor: pointer;
  }

  .provider-item.active {
    border-color: #4f7ccf;
    background: #122034;
    box-shadow: inset 0 0 0 1px rgba(115, 164, 255, 0.2);
  }

  .item-main {
    display: grid;
    gap: 2px;
  }

  .item-id {
    color: #88a0bc;
    font-size: 12px;
  }

  .item-meta {
    display: flex;
    justify-content: space-between;
    align-items: center;
    color: #9eb1c7;
    font-size: 12px;
  }

  .badge {
    font-size: 11px;
    color: #7de7a2;
    border: 1px solid #2e7a4a;
    padding: 2px 6px;
    border-radius: 999px;
  }

  .detail {
    padding: 16px;
    display: grid;
    gap: 12px;
    align-content: start;
  }

  .detail-grid {
    display: grid;
    gap: 10px;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .full {
    grid-column: 1 / -1;
  }

  .models-panel,
  .roles-panel {
    padding: 12px;
  }

  .model-row {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 8px;
    margin-bottom: 8px;
  }

  .roles {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .chip {
    border-radius: 999px;
    border: 1px solid #35517a;
    background: #16263c;
    color: #c6daf8;
    padding: 4px 10px;
    font-size: 12px;
  }

  .footer-actions {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }

  label {
    display: grid;
    gap: 6px;
    font-size: 13px;
    color: #c8d7eb;
  }

  input,
  select,
  textarea,
  button {
    background: #0b111a;
    color: #e5ecf5;
    border: 1px solid #2f3f56;
    border-radius: 10px;
    padding: 9px 11px;
    font: inherit;
  }

  textarea {
    resize: vertical;
  }

  button {
    cursor: pointer;
    width: fit-content;
  }

  button:hover {
    border-color: #47689b;
  }

  .danger {
    border-color: #6f3940;
    color: #f0b4bc;
  }

  .hint {
    margin: 0;
    color: #8ea3bf;
    font-size: 13px;
  }

  .ok {
    color: #7de7a2;
    margin: 0;
  }

  .err {
    color: #ff9ea9;
    margin: 0;
  }

  .row {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  @media (max-width: 980px) {
    .global-grid {
      grid-template-columns: 1fr;
    }

    .workspace-panel {
      grid-template-columns: 1fr;
    }

    .sidebar {
      border-right: none;
      border-bottom: 1px solid #2d3b51;
    }

    .detail-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
