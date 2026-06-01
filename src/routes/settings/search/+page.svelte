<script lang="ts">
  import { onMount } from "svelte";
  import { Alert, AlertDescription } from "$lib/components/ui/alert";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "$lib/components/ui/card";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { NativeSelect, NativeSelectOption } from "$lib/components/ui/native-select";
  import { WEB_SEARCH_DEFAULT_BASE_URLS, type WebSearchBaseUrlEngine } from "$lib/shared/webSearchDefaults";
  import { Switch } from "$lib/components/ui/switch";

  type EngineId = "duckduckgo" | "brave" | "tavily" | "exa" | "serper" | "baidu" | "bocha";
  type RouteId = "auto" | "domestic_news" | "international_news" | "chinese_general" | "global_general";

  interface EngineSettings {
    enabled: boolean;
    apiKey: string;
    baseUrl?: string;
  }

  interface WebSearchSettings {
    enabled: boolean;
    defaultRoute: RouteId;
    defaultEngine: EngineId | "auto";
    maxResults: number;
    timeoutMs: number;
    retryTimeoutMs: number;
    engines: Record<EngineId, EngineSettings>;
  }

  const engines: Array<{ id: EngineId; name: string; hint: string; keyLabel: string }> = [
    { id: "duckduckgo", name: "DuckDuckGo", hint: "No API key. Lightweight fallback for simple lookups.", keyLabel: "No key required" },
    { id: "brave", name: "Brave Search", hint: "Best first choice for global web and international news.", keyLabel: "BRAVE_API_KEY" },
    { id: "tavily", name: "Tavily", hint: "Good for research-style queries and summarized web snippets.", keyLabel: "TAVILY_API_KEY" },
    { id: "exa", name: "Exa", hint: "Useful for technical documents, blogs, and developer material.", keyLabel: "EXA_API_KEY" },
    { id: "serper", name: "Serper", hint: "Google SERP compatible fallback.", keyLabel: "SERPER_API_KEY" },
    { id: "baidu", name: "Baidu Qianfan", hint: "Chinese search and domestic news route.", keyLabel: "BAIDU_SEARCH_API_KEY" },
    { id: "bocha", name: "Bocha", hint: "Chinese web search fallback.", keyLabel: "BOCHA_API_KEY" }
  ];

  function defaultBaseUrl(id: EngineId): string {
    return id === "duckduckgo" ? "" : WEB_SEARCH_DEFAULT_BASE_URLS[id as WebSearchBaseUrlEngine];
  }

  let loading = true;
  let saving = false;
  let testing = false;
  let message = "";
  let error = "";
  let testQuery = "latest AI news";
  let testResult: any = null;

  let webSearch: WebSearchSettings = {
    enabled: true,
    defaultRoute: "auto",
    defaultEngine: "auto",
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
      webSearch = { ...webSearch, ...(data.settings?.webSearch ?? {}) };
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
      webSearch = data.settings.webSearch;
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
        body: JSON.stringify({ query: testQuery, webSearch })
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

<div class="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-8 sm:px-10 sm:py-10">
  <header class="flex flex-col gap-3">
    <Badge variant="secondary" class="w-fit">Built-in Tool</Badge>
    <div class="max-w-3xl space-y-2">
      <h1 class="text-3xl font-semibold tracking-tight text-foreground">Web Search</h1>
      <p class="text-sm leading-6 text-muted-foreground">
        Configure the built-in Agent search tool. Search runs in the shared Agent layer and is available across Web, Telegram, Feishu, QQ, and Weixin.
      </p>
    </div>
  </header>

  {#if error}
    <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
  {/if}
  {#if message}
    <Alert><AlertDescription>{message}</AlertDescription></Alert>
  {/if}

  {#if loading}
    <p class="py-8 text-sm text-muted-foreground">Loading search settings...</p>
  {:else}
    <form class="space-y-5" onsubmit={(event) => { event.preventDefault(); save(); }}>
      <Card>
        <CardHeader>
          <CardTitle class="text-sm">Default Behavior</CardTitle>
          <CardDescription>Keep this broad. Per-call engine and route overrides are still supported by the tool schema.</CardDescription>
        </CardHeader>
        <CardContent class="grid gap-5">
          <div class="flex items-center justify-between gap-4 rounded-lg border bg-muted/30 px-4 py-3">
            <div>
              <Label for="search-enabled">Enable built-in webSearch tool</Label>
              <p class="mt-1 text-xs text-muted-foreground">When disabled, the tool returns a settings error instead of searching.</p>
            </div>
            <Switch id="search-enabled" bind:checked={webSearch.enabled} />
          </div>

          <div class="grid gap-4 sm:grid-cols-2">
            <div class="grid gap-1.5">
              <Label for="default-route">Default route</Label>
              <NativeSelect id="default-route" bind:value={webSearch.defaultRoute}>
                <NativeSelectOption value="auto">Auto</NativeSelectOption>
                <NativeSelectOption value="domestic_news">Domestic news</NativeSelectOption>
                <NativeSelectOption value="international_news">International news</NativeSelectOption>
                <NativeSelectOption value="chinese_general">Chinese general</NativeSelectOption>
                <NativeSelectOption value="global_general">Global general</NativeSelectOption>
              </NativeSelect>
            </div>
            <div class="grid gap-1.5">
              <Label for="default-engine">Default engine</Label>
              <NativeSelect id="default-engine" bind:value={webSearch.defaultEngine}>
                <NativeSelectOption value="auto">Auto route order</NativeSelectOption>
                {#each engines as engine}
                  <NativeSelectOption value={engine.id}>{engine.name}</NativeSelectOption>
                {/each}
              </NativeSelect>
            </div>
            <div class="grid gap-1.5">
              <Label for="max-results">Max results</Label>
              <Input id="max-results" type="number" min="1" max="20" bind:value={webSearch.maxResults} />
            </div>
            <div class="grid gap-1.5">
              <Label for="timeout-ms">Timeout / retry timeout (ms)</Label>
              <div class="grid grid-cols-2 gap-2">
                <Input id="timeout-ms" type="number" min="1000" max="120000" bind:value={webSearch.timeoutMs} />
                <Input type="number" min="1000" max="180000" bind:value={webSearch.retryTimeoutMs} />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle class="text-sm">Search Engines</CardTitle>
          <CardDescription>DuckDuckGo works without credentials. Paid or account-backed engines are skipped until their API key is configured.</CardDescription>
        </CardHeader>
        <CardContent class="space-y-3">
          {#each engines as engine}
            <div class="grid gap-3 rounded-lg border bg-muted/30 p-4">
              <div class="flex items-start justify-between gap-4">
                <div>
                  <div class="flex flex-wrap items-center gap-2">
                    <p class="text-sm font-semibold text-foreground">{engine.name}</p>
                    <Badge variant="secondary">{engine.id}</Badge>
                  </div>
                  <p class="mt-1 text-xs leading-5 text-muted-foreground">{engine.hint}</p>
                </div>
                <Switch checked={webSearch.engines[engine.id].enabled} onclick={() => setEngineEnabled(engine.id, !webSearch.engines[engine.id].enabled)} />
              </div>
              {#if engine.id !== "duckduckgo"}
                <div class="grid gap-3 sm:grid-cols-2">
                  <div class="grid gap-1.5">
                    <Label>{engine.keyLabel}</Label>
                    <Input type="password" autocomplete="off" value={webSearch.engines[engine.id].apiKey} oninput={(event) => setEngineValue(engine.id, "apiKey", (event.target as HTMLInputElement).value)} />
                  </div>
                  <div class="grid gap-1.5">
                    <Label>Custom base URL</Label>
                    <Input placeholder={defaultBaseUrl(engine.id)} value={webSearch.engines[engine.id].baseUrl ?? ""} oninput={(event) => setEngineValue(engine.id, "baseUrl", (event.target as HTMLInputElement).value)} />
                    <p class="text-xs leading-5 text-muted-foreground">
                      {#if webSearch.engines[engine.id].baseUrl?.trim()}
                        Effective default when cleared: <code>{defaultBaseUrl(engine.id)}</code>
                      {:else}
                        Default: <code>{defaultBaseUrl(engine.id)}</code>
                      {/if}
                    </p>
                  </div>
                </div>
              {/if}
            </div>
          {/each}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle class="text-sm">Test Query</CardTitle>
          <CardDescription>Runs with the current form values, including unsaved API keys.</CardDescription>
        </CardHeader>
        <CardContent class="space-y-4">
          <div class="flex flex-col gap-2 sm:flex-row">
            <Input bind:value={testQuery} placeholder="Search query" />
            <Button type="button" variant="secondary" onclick={runTest} disabled={testing}>{testing ? "Testing..." : "Test"}</Button>
          </div>
          {#if testResult}
            <div class="rounded-lg border bg-muted/30 p-4 text-sm">
              <div class="flex flex-wrap gap-2">
                <Badge variant="secondary">route: {testResult.route}</Badge>
                <Badge variant="secondary">engine: {testResult.engine ?? "none"}</Badge>
                <Badge variant="secondary">results: {testResult.results?.length ?? 0}</Badge>
              </div>
              <div class="mt-3 space-y-3">
                {#each testResult.results ?? [] as result}
                  <div class="break-words">
                    <a class="font-medium text-foreground underline underline-offset-4" href={result.url} target="_blank" rel="noreferrer">{result.title}</a>
                    <p class="mt-1 text-xs text-muted-foreground">{result.snippet}</p>
                  </div>
                {/each}
              </div>
            </div>
          {/if}
        </CardContent>
      </Card>

      <div class="flex justify-end">
        <Button type="submit" disabled={saving}>{saving ? "Saving..." : "Save search settings"}</Button>
      </div>
    </form>
  {/if}
</div>
