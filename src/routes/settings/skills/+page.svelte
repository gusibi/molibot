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
    local: { enabled: boolean };
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
    return items.filter((item) => item.scope === scope).sort((a, b) => a.name.localeCompare(b.name));
  }

  function normalizeSkillSearchSettings(input: unknown): SkillSearchSettings {
    const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
    const local = source.local && typeof source.local === "object" ? source.local as Record<string, unknown> : {};
    const api = source.api && typeof source.api === "object" ? source.api as Record<string, unknown> : {};
    return {
      local: { enabled: Boolean(local.enabled) },
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
    const provider = findProvider(skillSearch.api.provider)
      ?? searchProviders.find((item) => item.id === skillSearch.api.provider)
      ?? searchProviders[0] ?? null;
    if (!provider) {
      if (!skillSearch.api.provider && !skillSearch.api.model) return;
      skillSearch = { ...skillSearch, api: { ...skillSearch.api, provider: "", model: "" } };
      return;
    }
    const model = provider.models.includes(skillSearch.api.model)
      ? skillSearch.api.model
      : (provider.defaultModel || provider.models[0] || "");
    if (provider.id === skillSearch.api.provider && model === skillSearch.api.model) return;
    skillSearch = { ...skillSearch, api: { ...skillSearch.api, provider: provider.id, model } };
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
  $: if (!loading) { syncSkillSearchProviderSelection(); }

  onMount(loadSkills);
</script>

<div class="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-8 sm:px-10 sm:py-10">
  <header class="flex flex-col gap-3">
    <Badge variant="secondary" class="w-fit">Capability Index</Badge>
    <div class="flex max-w-3xl flex-col gap-2">
      <h1 class="text-3xl font-semibold tracking-tight text-foreground">Skills</h1>
      <p class="text-sm leading-6 text-muted-foreground">Inspect installed skills and configure runtime skill search.</p>
    </div>
  </header>

  <div class="flex items-center gap-2">
    <Button variant="outline" onclick={loadSkills}>Refresh</Button>
  </div>

  {#if message}
    <Alert variant="default"><AlertDescription>{message}</AlertDescription></Alert>
  {/if}
  {#if error}
    <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
  {/if}

  {#if loading}
    <p class="py-8 text-sm text-muted-foreground">Loading skills...</p>
  {:else}
    <Card>
      <CardHeader>
        <div class="flex items-center justify-between gap-3">
          <div>
            <CardTitle>Skill Search</CardTitle>
            <CardDescription>
              Choose whether runtime should search local skills, call an external routing model, or both.
            </CardDescription>
          </div>
          <Button size="sm" onclick={saveSkillSearchConfig} disabled={savingConfig}>
            {savingConfig ? "Saving..." : "Save Settings"}
          </Button>
        </div>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="grid gap-4 md:grid-cols-2">
          <div class="flex items-center gap-3 rounded-xl border bg-muted/40 px-4 py-3">
            <Checkbox id="sk-local" bind:checked={skillSearch.local.enabled} />
            <Label for="sk-local">Enable local search</Label>
          </div>
          <div class="flex items-center gap-3 rounded-xl border bg-muted/40 px-4 py-3">
            <Checkbox id="sk-api" bind:checked={skillSearch.api.enabled} />
            <Label for="sk-api">Enable API search</Label>
          </div>
        </div>

        <div class="grid gap-3 md:grid-cols-2">
          <div class="grid gap-1.5">
            <Label for="sk-provider">AI Provider</Label>
            <NativeSelect id="sk-provider" bind:value={skillSearch.api.provider}>
              {#if searchProviders.length === 0}
                <NativeSelectOption value="">No available provider</NativeSelectOption>
              {:else}
                {#each searchProviders as provider}
                  <NativeSelectOption value={provider.id}>{provider.name}</NativeSelectOption>
                {/each}
              {/if}
            </NativeSelect>
          </div>
          <div class="grid gap-1.5">
            <Label for="sk-model">Model</Label>
            <NativeSelect id="sk-model" bind:value={skillSearch.api.model} disabled={selectedSearchProviderModels.length === 0}>
              {#if selectedSearchProviderModels.length === 0}
                <NativeSelectOption value="">No available model</NativeSelectOption>
              {:else}
                {#each selectedSearchProviderModels as model}
                  <NativeSelectOption value={model}>{model}</NativeSelectOption>
                {/each}
              {/if}
            </NativeSelect>
          </div>
          <div class="grid gap-1.5">
            <Label for="sk-max-tokens">Max Tokens</Label>
            <Input id="sk-max-tokens" type="number" min="128" max="4096" bind:value={skillSearch.api.maxTokens} />
          </div>
          <div class="grid gap-1.5">
            <Label for="sk-temp">Temperature</Label>
            <Input id="sk-temp" type="number" min="0" max="1" step="0.1" bind:value={skillSearch.api.temperature} />
          </div>
          <div class="grid gap-1.5">
            <Label for="sk-timeout">Timeout (ms)</Label>
            <Input id="sk-timeout" type="number" min="1000" max="60000" step="500" bind:value={skillSearch.api.timeoutMs} />
          </div>
          <div class="grid gap-1.5">
            <Label for="sk-confidence">Min Confidence</Label>
            <Input id="sk-confidence" type="number" min="0" max="1" step="0.05" bind:value={skillSearch.api.minConfidence} />
          </div>
        </div>

        <div class="rounded-xl border bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
          Skill Search API now reuses the AI Provider you already configured under Settings / AI / Providers.
          {#if selectedSearchProvider}
            <div class="mt-2">Current provider: <span class="text-foreground">{selectedSearchProvider.name}</span></div>
          {/if}
          {#if searchProviders.length === 0}
            <div class="mt-2 text-amber-600 dark:text-amber-400">No reusable AI Provider found yet. Add and enable one in Settings / AI / Providers first.</div>
          {/if}
        </div>
      </CardContent>
    </Card>

    <div class="flex flex-wrap gap-3 text-sm">
      <Badge variant="outline">Data root: {dataRoot || "(unknown)"}</Badge>
      <Badge variant="outline">Global skills dir: {globalSkillsDir || "(unknown)"}</Badge>
      <Badge variant="outline">Global: {count.global}</Badge>
      <Badge variant="outline">Chat: {count.chat}</Badge>
      <Badge variant="outline">Bot: {count.bot}</Badge>
      <Badge variant="outline">Total: {items.length}</Badge>
    </div>

    {#each ["global", "chat", "bot"] as scope}
      <section class="space-y-3">
        <h2 class="text-lg font-semibold text-foreground">
          {scope === "global" ? "Global Skills" : scope === "chat" ? "Chat Skills" : "Bot Skills"}
        </h2>
        {#if byScope(scope as SkillScope).length === 0}
          <div class="rounded-xl border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
            No {scope}-level skills found.
          </div>
        {:else}
          {#each byScope(scope as SkillScope) as item}
            <article class="rounded-xl border bg-card/60 p-4">
              <div class="flex items-start justify-between gap-3">
                <p class="text-sm font-semibold text-foreground">{item.name}</p>
                <label class="inline-flex items-center gap-2 text-xs">
                  <Checkbox
                    checked={item.enabled}
                    disabled={saving.has(item.filePath)}
                    onchange={(e) => setSkillEnabled(item.filePath, (e.currentTarget as HTMLInputElement).checked)}
                  />
                  <span class="text-foreground">{item.enabled ? "Enabled" : "Disabled"}</span>
                </label>
              </div>
              <p class="mt-1 text-sm text-muted-foreground">{item.description}</p>
              <p class="mt-2 text-xs text-muted-foreground">Path: {item.filePath}</p>
              {#if item.mcpServers?.length > 0}
                <p class="mt-1 text-xs text-emerald-600 dark:text-emerald-400">MCP: {item.mcpServers.join(", ")}</p>
              {/if}
              {#if scope !== "global"}
                <p class="mt-1 text-xs text-muted-foreground">
                  {scope === "chat" ? `Bot: ${item.botId || "-"} | Chat: ${item.chatId || "-"}` : `Bot: ${item.botId || "-"}`}
                </p>
              {/if}
            </article>
          {/each}
        {/if}
      </section>
    {/each}

    {#if diagnostics.length > 0}
      <div class="space-y-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
        <h2 class="text-sm font-semibold text-amber-700 dark:text-amber-400">Diagnostics</h2>
        {#each diagnostics as row}
          <p class="text-xs text-amber-600 dark:text-amber-300">{row}</p>
        {/each}
      </div>
    {/if}
  {/if}
</div>
