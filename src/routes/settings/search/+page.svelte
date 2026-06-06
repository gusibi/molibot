<script lang="ts">
  import { onMount } from "svelte";
  import { Alert, AlertDescription } from "$lib/components/ui/alert";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { NativeSelect, NativeSelectOption } from "$lib/components/ui/native-select";
  import { WEB_SEARCH_DEFAULT_BASE_URLS, type WebSearchBaseUrlEngine } from "$lib/shared/webSearchDefaults";
  import { Switch } from "$lib/components/ui/switch";

  type EngineId =
    | "duckduckgo"
    | "brave"
    | "tavily"
    | "exa"
    | "serper"
    | "baidu"
    | "baidu_fast"
    | "baidu_web"
    | "ark"
    | "grok"
    | "bocha";
  type RouteId = "auto" | "china" | "global" | "official_docs" | "research";
  type EngineSelectionStrategy = "priority" | "random" | "round_robin";

  interface EngineSettings {
    enabled: boolean;
    apiKey: string;
    baseUrl?: string;
  }

  interface WebSearchSettings {
    enabled: boolean;
    defaultRoute: RouteId;
    defaultEngine: EngineId | "auto";
    engineSelectionStrategy: EngineSelectionStrategy;
    maxResults: number;
    timeoutMs: number;
    retryTimeoutMs: number;
    engines: Record<EngineId, EngineSettings>;
  }

  const engines: Array<{ id: EngineId; name: string; hint: string; keyLabel: string }> = [
    { id: "duckduckgo", name: "DuckDuckGo", hint: "No API key. Lightweight fallback for simple lookups.", keyLabel: "No key required" },
    { id: "brave", name: "Brave Search", hint: "Best first choice for global web and current sources.", keyLabel: "BRAVE_API_KEY" },
    { id: "tavily", name: "Tavily", hint: "Good for research-style queries and summarized web snippets.", keyLabel: "TAVILY_API_KEY" },
    { id: "exa", name: "Exa", hint: "Useful for technical documents, blogs, and developer material.", keyLabel: "EXA_API_KEY" },
    { id: "serper", name: "Serper", hint: "Google SERP compatible fallback.", keyLabel: "SERPER_API_KEY" },
    { id: "baidu", name: "Baidu Qianfan", hint: "Chinese AI search route.", keyLabel: "BAIDU_SEARCH_API_KEY" },
    { id: "baidu_fast", name: "Baidu Fast", hint: "Chinese fast web-summary search.", keyLabel: "BAIDU_SEARCH_API_KEY" },
    { id: "baidu_web", name: "Baidu Web", hint: "Chinese web search with source-oriented results.", keyLabel: "BAIDU_SEARCH_API_KEY" },
    { id: "ark", name: "Ark Bot", hint: "China-local assistant-backed search fallback.", keyLabel: "ARK_API_KEY" },
    { id: "grok", name: "Grok", hint: "Global web-search assistant fallback.", keyLabel: "GROK_API_KEY" },
    { id: "bocha", name: "Bocha", hint: "Chinese web search fallback.", keyLabel: "BOCHA_API_KEY" }
  ];
  const visibleEngines = engines.filter((engine) => engine.id !== "ark");

  function defaultBaseUrl(id: EngineId): string {
    return id === "duckduckgo" ? "" : WEB_SEARCH_DEFAULT_BASE_URLS[id as WebSearchBaseUrlEngine];
  }

  function normalizeForUi(settings: WebSearchSettings): WebSearchSettings {
    return {
      ...settings,
      defaultEngine: settings.defaultEngine === "ark" ? "auto" : settings.defaultEngine,
      engines: {
        ...settings.engines,
        ark: {
          ...settings.engines.ark,
          enabled: false
        }
      }
    };
  }

  let loading = true;
  let saving = false;
  let testing = false;
  let message = "";
  let error = "";
  let testQuery = "latest AI news";
  let testEngine: EngineId | "auto" = "auto";
  let testResult: any = null;

  let showApiKey: Record<string, boolean> = {};

  let webSearch: WebSearchSettings = {
    enabled: true,
    defaultRoute: "auto",
    defaultEngine: "auto",
    engineSelectionStrategy: "priority",
    maxResults: 5,
    timeoutMs: 60000,
    retryTimeoutMs: 120000,
    engines: {
      duckduckgo: { enabled: true, apiKey: "" },
      brave: { enabled: false, apiKey: "" },
      tavily: { enabled: false, apiKey: "" },
      exa: { enabled: false, apiKey: "" },
      serper: { enabled: false, apiKey: "" },
      baidu: { enabled: false, apiKey: "" },
      baidu_fast: { enabled: false, apiKey: "" },
      baidu_web: { enabled: false, apiKey: "" },
      ark: { enabled: false, apiKey: "" },
      grok: { enabled: false, apiKey: "" },
      bocha: { enabled: false, apiKey: "" }
    }
  };

  function setEngineEnabled(id: EngineId, enabled: boolean): void {
    webSearch = {
      ...webSearch,
      engines: {
        ...webSearch.engines,
        [id]: { ...webSearch.engines[id], enabled }
      }
    };
  }

  function setEngineValue(id: EngineId, key: "apiKey" | "baseUrl", value: string): void {
    webSearch = {
      ...webSearch,
      engines: {
        ...webSearch.engines,
        [id]: { ...webSearch.engines[id], [key]: value }
      }
    };
  }

  async function loadSettings(): Promise<void> {
    loading = true;
    message = "";
    error = "";
    try {
      const res = await fetch("/api/settings");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load settings");
      webSearch = normalizeForUi({ ...webSearch, ...(data.settings?.webSearch ?? {}) });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  async function save(): Promise<void> {
    saving = true;
    message = "";
    error = "";
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ webSearch })
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to save search settings");
      webSearch = normalizeForUi(data.settings.webSearch);
      message = "Search settings saved.";
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      saving = false;
    }
  }

  async function runTest(): Promise<void> {
    testing = true;
    message = "";
    error = "";
    testResult = null;
    try {
      const res = await fetch("/api/settings/web-search/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: testQuery, engine: testEngine, webSearch })
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Search test failed");
      testResult = data.result;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      testing = false;
    }
  }

  onMount(loadSettings);
</script>

<div class="search-page">
  <header class="search-hero">
    <span class="search-badge">Built-in Tool</span>
    <h1 class="search-hero-title">Web Search</h1>
    <p class="search-hero-desc">
      Configure the built-in agent search tool. Search runs in the shared agent layer and is available across Web, Telegram, Feishu, QQ, and Weixin channels.
    </p>
  </header>

  {#if error}
    <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
  {/if}
  {#if message}
    <div class="search-test-result mt-2 mb-4" data-tone="success">
      <span class="flex items-center gap-2 text-sm font-medium">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
        {message}
      </span>
    </div>
  {/if}

  {#if loading}
    <div class="errors-empty-state"><span class="animate-pulse">Loading search settings...</span></div>
  {:else}
    <form id="search-form" class="flex flex-col gap-6" onsubmit={(event) => { event.preventDefault(); save(); }}>
      <section class="search-card">
        <div class="search-card-header">
          <div>
            <h2 class="search-card-title">Default Behavior</h2>
            <p class="search-card-desc">Set the fallback search logic. Model overrides at runtime are still supported.</p>
          </div>
        </div>

        <div class="search-switch-row">
          <div>
            <Label for="search-enabled" class="font-bold">Enable built-in webSearch tool</Label>
            <p class="search-form-hint">When disabled, the tool returns a settings error instead of searching.</p>
          </div>
          <Switch id="search-enabled" bind:checked={webSearch.enabled} />
        </div>

        <div class="search-form-grid">
          <div class="search-form-group">
            <Label for="default-route">Default route</Label>
            <NativeSelect id="default-route" bind:value={webSearch.defaultRoute} class="h-10">
              <NativeSelectOption value="auto">Auto</NativeSelectOption>
              <NativeSelectOption value="china">China-local sources</NativeSelectOption>
              <NativeSelectOption value="global">Global web</NativeSelectOption>
              <NativeSelectOption value="official_docs">Official docs</NativeSelectOption>
              <NativeSelectOption value="research">Research</NativeSelectOption>
            </NativeSelect>
          </div>

          <div class="search-form-group">
            <Label for="default-engine">Default engine</Label>
            <NativeSelect id="default-engine" bind:value={webSearch.defaultEngine} class="h-10">
              <NativeSelectOption value="auto">Auto route order</NativeSelectOption>
              {#each visibleEngines as engine}
                <NativeSelectOption value={engine.id}>{engine.name}</NativeSelectOption>
              {/each}
            </NativeSelect>
          </div>

          <div class="search-form-group">
            <Label for="engine-selection-strategy">Auto engine strategy</Label>
            <NativeSelect id="engine-selection-strategy" bind:value={webSearch.engineSelectionStrategy} class="h-10">
              <NativeSelectOption value="priority">Priority order</NativeSelectOption>
              <NativeSelectOption value="random">Random among configured</NativeSelectOption>
              <NativeSelectOption value="round_robin">Round-robin among configured</NativeSelectOption>
            </NativeSelect>
            <p class="search-form-hint">Used only when Default engine is Auto. Engines without required API keys are skipped.</p>
          </div>

          <div class="search-form-group">
            <Label for="max-results">Max results</Label>
            <Input id="max-results" type="number" min="1" max="20" bind:value={webSearch.maxResults} class="h-10 tabular-nums" />
          </div>

          <div class="search-form-group search-form-group--full">
            <Label for="timeout-ms">Timeout / Retry Timeout (ms)</Label>
            <div class="grid grid-cols-2 gap-3">
              <Input id="timeout-ms" type="number" min="1000" max="120000" bind:value={webSearch.timeoutMs} class="h-10 tabular-nums" placeholder="Timeout" />
              <Input type="number" min="1000" max="180000" bind:value={webSearch.retryTimeoutMs} class="h-10 tabular-nums" placeholder="Retry Timeout" />
            </div>
          </div>
        </div>
      </section>

      <section class="search-card">
        <div class="search-card-header">
          <div>
            <h2 class="search-card-title">Search Engines</h2>
            <p class="search-card-desc">DuckDuckGo works without credentials. Other engines are skipped until API keys are set.</p>
          </div>
        </div>

        <div class="search-engine-list">
          {#each visibleEngines as engine}
            <div class="search-engine-card">
              <div class="search-engine-header">
                <div class="flex-1">
                  <div class="search-engine-title-group">
                    <h3 class="search-engine-title">{engine.name}</h3>
                    <span class="search-pill">{engine.id}</span>
                  </div>
                  <p class="search-engine-hint">{engine.hint}</p>
                </div>
                <Switch bind:checked={webSearch.engines[engine.id].enabled} />
              </div>

              {#if engine.id !== "duckduckgo"}
                <div class="search-engine-inputs">
                  <div class="search-form-group">
                    <Label>{engine.keyLabel}</Label>
                    <div class="search-key-input-container">
                      <Input
                        type={showApiKey[engine.id] ? "text" : "password"}
                        autocomplete="off"
                        value={webSearch.engines[engine.id].apiKey}
                        oninput={(event) => setEngineValue(engine.id, "apiKey", (event.target as HTMLInputElement).value)}
                        class="h-9 font-mono text-xs flex-1"
                      />
                      <button
                        type="button"
                        class="search-icon-btn"
                        onclick={() => (showApiKey[engine.id] = !showApiKey[engine.id])}
                        aria-label={showApiKey[engine.id] ? "Hide API key" : "Show API key"}
                      >
                        {#if showApiKey[engine.id]}
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/></svg>
                        {:else}
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>
                        {/if}
                      </button>
                    </div>
                  </div>

                  <div class="search-form-group">
                    <Label>Custom base URL</Label>
                    <Input placeholder={defaultBaseUrl(engine.id)} value={webSearch.engines[engine.id].baseUrl ?? ""} oninput={(event) => setEngineValue(engine.id, "baseUrl", (event.target as HTMLInputElement).value)} class="h-9 text-xs" />
                    <p class="search-form-hint truncate">
                      Default: <code>{defaultBaseUrl(engine.id)}</code>
                    </p>
                  </div>
                </div>
              {/if}
            </div>
          {/each}
        </div>
      </section>

      <section class="search-card">
        <div class="search-card-header">
          <div>
            <h2 class="search-card-title">Test Query</h2>
            <p class="search-card-desc">Test the engine config directly using unsaved settings.</p>
          </div>
        </div>

        <div class="flex flex-col gap-4">
          <div class="search-test-grid">
            <Input bind:value={testQuery} placeholder="Search query" class="h-10" />
            <NativeSelect bind:value={testEngine} class="h-10">
              <NativeSelectOption value="auto">Auto engine</NativeSelectOption>
              {#each visibleEngines as engine}
                <NativeSelectOption value={engine.id}>{engine.name}</NativeSelectOption>
              {/each}
              {#each engines.filter(e => e.id === "ark") as ark}
                <NativeSelectOption value={ark.id}>{ark.name}</NativeSelectOption>
              {/each}
            </NativeSelect>
            <Button type="button" variant="outline" onclick={runTest} disabled={testing} class="h-10 px-6 font-bold">
              {testing ? "Testing..." : "Test"}
            </Button>
          </div>

          {#if testResult}
            <div class="search-test-result">
              <span class="search-note-title">WebSearchResponse</span>
              <pre class="search-test-pre">{JSON.stringify(testResult, null, 2)}</pre>
            </div>
          {/if}
        </div>
      </section>
    </form>
  {/if}
</div>

<footer class="settings-footbar">
  <div class="settings-footbar-status">
    {#if saving}
      <span class="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <span class="h-2 w-2 animate-pulse rounded-full bg-[#A36A5E]"></span>
        Saving changes...
      </span>
    {:else if message}
      <span class="settings-footbar-ok">{message}</span>
    {/if}
    {#if error}
      <span class="settings-footbar-error">{error}</span>
    {/if}
  </div>
  <div class="flex items-center gap-3">
    <Button variant="outline" size="sm" onclick={loadSettings} disabled={loading || saving} class="h-9 px-4 text-xs font-bold">
      Reset
    </Button>
    <button type="submit" form="search-form" class="settings-footbar-btn" disabled={loading || saving}>
      {saving ? "Saving..." : "Save Search Settings"}
    </button>
  </div>
</footer>


