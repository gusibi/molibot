<script lang="ts">
  import { onMount } from "svelte";
  import PageShell from "$lib/ui/PageShell.svelte";
  import Button from "$lib/ui/Button.svelte";
  import Alert from "$lib/ui/Alert.svelte";

  type SkillScope = "global" | "chat" | "bot";

  interface SkillItem {
    name: string;
    description: string;
    filePath: string;
    baseDir: string;
    scope: SkillScope;
    enabled: boolean;
    mcpServers: string[];
    botId?: string;
    chatId?: string;
  }

  interface SkillSearchSettings {
    local: {
      enabled: boolean;
    };
    api: {
      enabled: boolean;
      provider: string;
      model: string;
      maxTokens: number;
      temperature: number;
      timeoutMs: number;
      minConfidence: number;
    };
  }

  interface SearchProviderItem {
    id: string;
    name: string;
    defaultModel: string;
    models: string[];
  }

  let loading = true;
  let savingConfig = false;
  let error = "";
  let message = "";
  let dataRoot = "";
  let globalSkillsDir = "";
  let diagnostics: string[] = [];
  let items: SkillItem[] = [];
  let searchProviders: SearchProviderItem[] = [];
  let selectedSearchProvider: SearchProviderItem | null = null;
  let selectedSearchProviderModels: string[] = [];
  let count = { global: 0, chat: 0, bot: 0 };
  let saving = new Set<string>();
  let skillSearch: SkillSearchSettings = {
    local: { enabled: false },
    api: {
      enabled: false,
      provider: "",
      model: "",
      maxTokens: 400,
      temperature: 0,
      timeoutMs: 8000,
      minConfidence: 0.6
    }
  };

  function byScope(scope: SkillScope): SkillItem[] {
    return items
      .filter((item) => item.scope === scope)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  function normalizeSkillSearchSettings(input: unknown): SkillSearchSettings {
    const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
    const local = source.local && typeof source.local === "object" ? source.local as Record<string, unknown> : {};
    const api = source.api && typeof source.api === "object" ? source.api as Record<string, unknown> : {};
    return {
      local: {
        enabled: Boolean(local.enabled)
      },
      api: {
        enabled: Boolean(api.enabled),
        provider: String(api.provider ?? ""),
        model: String(api.model ?? ""),
        maxTokens: Number(api.maxTokens ?? 400) || 400,
        temperature: Number(api.temperature ?? 0) || 0,
        timeoutMs: Number(api.timeoutMs ?? 8000) || 8000,
        minConfidence: Number(api.minConfidence ?? 0.6) || 0.6
      }
    };
  }

  function findProvider(providerId: string): SearchProviderItem | null {
    return searchProviders.find((provider) => provider.id === providerId) ?? null;
  }

  function syncSkillSearchProviderSelection(): void {
    const provider =
      findProvider(skillSearch.api.provider)
      ?? searchProviders.find((item) => item.id === skillSearch.api.provider)
      ?? searchProviders[0]
      ?? null;

    if (!provider) {
      if (!skillSearch.api.provider && !skillSearch.api.model) return;
      skillSearch = {
        ...skillSearch,
        api: {
          ...skillSearch.api,
          provider: "",
          model: ""
        }
      };
      return;
    }

    const model = provider.models.includes(skillSearch.api.model)
      ? skillSearch.api.model
      : (provider.defaultModel || provider.models[0] || "");

    if (provider.id === skillSearch.api.provider && model === skillSearch.api.model) return;

    skillSearch = {
      ...skillSearch,
      api: {
        ...skillSearch.api,
        provider: provider.id,
        model
      }
    };
  }

  async function loadSkills(): Promise<void> {
    loading = true;
    error = "";
    message = "";
    try {
      const res = await fetch("/api/settings/skills");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load skills");
      dataRoot = String(data.dataRoot ?? "");
      globalSkillsDir = String(data.globalSkillsDir ?? "");
      diagnostics = Array.isArray(data.diagnostics) ? data.diagnostics : [];
      items = Array.isArray(data.items) ? data.items : [];
      searchProviders = Array.isArray(data.searchProviders) ? data.searchProviders : [];
      skillSearch = normalizeSkillSearchSettings(data.skillSearch);
      syncSkillSearchProviderSelection();
      count = {
        global: Number(data.count?.global ?? 0),
        chat: Number(data.count?.chat ?? 0),
        bot: Number(data.count?.bot ?? 0),
      };
      message = `Loaded ${items.length} skill(s).`;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  async function persistSkillsState(nextItems: SkillItem[]): Promise<void> {
    const disabledSkillPaths = nextItems.filter((item) => !item.enabled).map((item) => item.filePath);
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ disabledSkillPaths })
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Failed to save skill status");
  }

  async function setSkillEnabled(filePath: string, enabled: boolean): Promise<void> {
    error = "";
    message = "";
    const prev = items;
    const nextItems = items.map((item) => item.filePath === filePath ? { ...item, enabled } : item);
    items = nextItems;
    saving = new Set([...saving, filePath]);
    try {
      await persistSkillsState(nextItems);
      message = "Skill status updated.";
    } catch (e) {
      items = prev;
      error = e instanceof Error ? e.message : String(e);
    } finally {
      const next = new Set(saving);
      next.delete(filePath);
      saving = next;
    }
  }

  async function saveSkillSearchConfig(): Promise<void> {
    savingConfig = true;
    error = "";
    message = "";
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skillSearch })
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to save skill search settings");
      skillSearch = normalizeSkillSearchSettings(data.settings?.skillSearch ?? skillSearch);
      message = "Skill search settings updated.";
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      savingConfig = false;
    }
  }

  $: selectedSearchProvider = findProvider(skillSearch.api.provider);
  $: selectedSearchProviderModels = selectedSearchProvider?.models ?? [];
  $: if (!loading) {
    syncSkillSearchProviderSelection();
  }

  onMount(loadSkills);
</script>

<PageShell widthClass="max-w-5xl" gapClass="space-y-6">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <div>
      <h1 class="text-2xl font-semibold">Skills</h1>
      <p class="text-sm text-slate-400">
        Inspect installed skills and configure runtime skill search.
      </p>
    </div>
    <Button variant="outline" size="md" on:click={loadSkills}>
      Refresh
    </Button>
  </div>

  {#if message}
    <Alert>{message}</Alert>
  {/if}
  {#if error}
    <Alert variant="destructive">{error}</Alert>
  {/if}

  {#if loading}
    <div class="rounded-xl border border-white/15 bg-[#2b2b2b] px-4 py-3 text-sm text-slate-300">
      Loading skills...
    </div>
  {:else}
    <section class="space-y-4 rounded-xl border border-white/15 bg-[#2b2b2b] p-4">
      <div class="flex items-center justify-between gap-3">
        <div>
          <h2 class="text-lg font-semibold">Skill Search</h2>
          <p class="text-sm text-slate-400">
            Choose whether runtime should search local skills, call an external routing model, or both.
          </p>
        </div>
        <Button size="sm" on:click={saveSkillSearchConfig} disabled={savingConfig}>
          {savingConfig ? "Saving..." : "Save Settings"}
        </Button>
      </div>

      <div class="grid gap-4 md:grid-cols-2">
        <label class="flex items-center justify-between rounded-xl border border-white/10 bg-black/10 px-4 py-3 text-sm">
          <span>Enable local search</span>
          <input type="checkbox" bind:checked={skillSearch.local.enabled} />
        </label>
        <label class="flex items-center justify-between rounded-xl border border-white/10 bg-black/10 px-4 py-3 text-sm">
          <span>Enable API search</span>
          <input type="checkbox" bind:checked={skillSearch.api.enabled} />
        </label>
      </div>

      <div class="grid gap-3 md:grid-cols-2">
        <label class="space-y-1 text-sm">
          <span class="text-slate-300">AI Provider</span>
          <select
            class="w-full rounded-lg border border-white/15 bg-black/20 px-3 py-2 text-sm"
            bind:value={skillSearch.api.provider}
          >
            {#if searchProviders.length === 0}
              <option value="">No available provider</option>
            {:else}
              {#each searchProviders as provider}
                <option value={provider.id}>{provider.name}</option>
              {/each}
            {/if}
          </select>
        </label>
        <label class="space-y-1 text-sm">
          <span class="text-slate-300">Model</span>
          <select
            class="w-full rounded-lg border border-white/15 bg-black/20 px-3 py-2 text-sm"
            bind:value={skillSearch.api.model}
            disabled={selectedSearchProviderModels.length === 0}
          >
            {#if selectedSearchProviderModels.length === 0}
              <option value="">No available model</option>
            {:else}
              {#each selectedSearchProviderModels as model}
                <option value={model}>{model}</option>
              {/each}
            {/if}
          </select>
        </label>
        <label class="space-y-1 text-sm">
          <span class="text-slate-300">Max Tokens</span>
          <input type="number" min="128" max="4096" class="w-full rounded-lg border border-white/15 bg-black/20 px-3 py-2 text-sm" bind:value={skillSearch.api.maxTokens} />
        </label>
        <label class="space-y-1 text-sm">
          <span class="text-slate-300">Temperature</span>
          <input type="number" min="0" max="1" step="0.1" class="w-full rounded-lg border border-white/15 bg-black/20 px-3 py-2 text-sm" bind:value={skillSearch.api.temperature} />
        </label>
        <label class="space-y-1 text-sm">
          <span class="text-slate-300">Timeout (ms)</span>
          <input type="number" min="1000" max="60000" step="500" class="w-full rounded-lg border border-white/15 bg-black/20 px-3 py-2 text-sm" bind:value={skillSearch.api.timeoutMs} />
        </label>
        <label class="space-y-1 text-sm">
          <span class="text-slate-300">Min Confidence</span>
          <input type="number" min="0" max="1" step="0.05" class="w-full rounded-lg border border-white/15 bg-black/20 px-3 py-2 text-sm" bind:value={skillSearch.api.minConfidence} />
        </label>
      </div>

      <div class="rounded-xl border border-white/10 bg-black/10 px-4 py-3 text-xs text-slate-400">
        Skill Search API now reuses the AI Provider you already configured under Settings / AI / Providers.
        {#if selectedSearchProvider}
          <div class="mt-2">
            Current provider: <span class="text-slate-200">{selectedSearchProvider.name}</span>
          </div>
        {/if}
        {#if searchProviders.length === 0}
          <div class="mt-2 text-amber-300">
            No reusable AI Provider found yet. Add and enable one in Settings / AI / Providers first.
          </div>
        {/if}
      </div>
    </section>

    <section class="grid gap-3 rounded-xl border border-white/15 bg-[#2b2b2b] p-4 text-sm text-slate-300 sm:grid-cols-2">
      <div>
        <span class="text-slate-400">Data root:</span>
        {dataRoot || "(unknown)"}
      </div>
      <div>
        <span class="text-slate-400">Global skills dir:</span>
        {globalSkillsDir || "(unknown)"}
      </div>
      <div>
        <span class="text-slate-400">Global skills:</span>
        {count.global}
      </div>
      <div>
        <span class="text-slate-400">Chat skills:</span>
        {count.chat}
      </div>
      <div>
        <span class="text-slate-400">Bot skills:</span>
        {count.bot}
      </div>
      <div><span class="text-slate-400">Total:</span> {items.length}</div>
    </section>

    <section class="space-y-3">
      <h2 class="text-lg font-semibold">Global Skills</h2>
      {#if byScope("global").length === 0}
        <div class="rounded-xl border border-white/15 bg-[#2b2b2b] px-4 py-3 text-sm text-slate-300">
          No global skills found.
        </div>
      {:else}
        {#each byScope("global") as item}
          <article class="rounded-xl border border-white/15 bg-[#2b2b2b] p-4">
            <div class="flex items-start justify-between gap-3">
              <p class="text-sm font-semibold">{item.name}</p>
              <label class="inline-flex items-center gap-2 text-xs text-slate-200">
                <input
                  type="checkbox"
                  checked={item.enabled}
                  disabled={saving.has(item.filePath)}
                  on:change={(event) => setSkillEnabled(item.filePath, (event.target as HTMLInputElement).checked)}
                />
                <span>{item.enabled ? "Enabled" : "Disabled"}</span>
              </label>
            </div>
            <p class="mt-1 text-sm text-slate-400">{item.description}</p>
            <p class="mt-2 text-xs text-slate-400">Path: {item.filePath}</p>
            {#if item.mcpServers?.length > 0}
              <p class="mt-1 text-xs text-emerald-300">MCP: {item.mcpServers.join(", ")}</p>
            {/if}
          </article>
        {/each}
      {/if}
    </section>

    <section class="space-y-3">
      <h2 class="text-lg font-semibold">Chat Skills</h2>
      {#if byScope("chat").length === 0}
        <div class="rounded-xl border border-white/15 bg-[#2b2b2b] px-4 py-3 text-sm text-slate-300">
          No chat-level skills found.
        </div>
      {:else}
        {#each byScope("chat") as item}
          <article class="rounded-xl border border-white/15 bg-[#2b2b2b] p-4">
            <div class="flex items-start justify-between gap-3">
              <p class="text-sm font-semibold">{item.name}</p>
              <label class="inline-flex items-center gap-2 text-xs text-slate-200">
                <input
                  type="checkbox"
                  checked={item.enabled}
                  disabled={saving.has(item.filePath)}
                  on:change={(event) => setSkillEnabled(item.filePath, (event.target as HTMLInputElement).checked)}
                />
                <span>{item.enabled ? "Enabled" : "Disabled"}</span>
              </label>
            </div>
            <p class="mt-1 text-sm text-slate-400">{item.description}</p>
            <p class="mt-2 text-xs text-slate-400">Bot: {item.botId || "-"} | Chat: {item.chatId || "-"}</p>
            <p class="mt-1 text-xs text-slate-400">Path: {item.filePath}</p>
            {#if item.mcpServers?.length > 0}
              <p class="mt-1 text-xs text-emerald-300">MCP: {item.mcpServers.join(", ")}</p>
            {/if}
          </article>
        {/each}
      {/if}
    </section>

    <section class="space-y-3">
      <h2 class="text-lg font-semibold">Bot Skills</h2>
      {#if byScope("bot").length === 0}
        <div class="rounded-xl border border-white/15 bg-[#2b2b2b] px-4 py-3 text-sm text-slate-300">
          No bot-level skills found.
        </div>
      {:else}
        {#each byScope("bot") as item}
          <article class="rounded-xl border border-white/15 bg-[#2b2b2b] p-4">
            <div class="flex items-start justify-between gap-3">
              <p class="text-sm font-semibold">{item.name}</p>
              <label class="inline-flex items-center gap-2 text-xs text-slate-200">
                <input
                  type="checkbox"
                  checked={item.enabled}
                  disabled={saving.has(item.filePath)}
                  on:change={(event) => setSkillEnabled(item.filePath, (event.target as HTMLInputElement).checked)}
                />
                <span>{item.enabled ? "Enabled" : "Disabled"}</span>
              </label>
            </div>
            <p class="mt-1 text-sm text-slate-400">{item.description}</p>
            <p class="mt-2 text-xs text-slate-400">Bot: {item.botId || "-"}</p>
            <p class="mt-1 text-xs text-slate-400">Path: {item.filePath}</p>
            {#if item.mcpServers?.length > 0}
              <p class="mt-1 text-xs text-emerald-300">MCP: {item.mcpServers.join(", ")}</p>
            {/if}
          </article>
        {/each}
      {/if}
    </section>

    {#if diagnostics.length > 0}
      <section class="space-y-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
        <h2 class="text-sm font-semibold text-amber-300">Diagnostics</h2>
        {#each diagnostics as row}
          <p class="text-xs text-amber-200">{row}</p>
        {/each}
      </section>
    {/if}
  {/if}
</PageShell>
