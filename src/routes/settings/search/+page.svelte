<script lang="ts">
  import { onMount } from "svelte";
  import { Alert, AlertDescription } from "$lib/components/ui/alert";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { NativeSelect, NativeSelectOption } from "$lib/components/ui/native-select";
  import { WEB_SEARCH_DEFAULT_BASE_URLS, type WebSearchBaseUrlEngine } from "$lib/shared/webSearchDefaults";
  import { IosSwitch } from "$lib/components/ui/ios-switch";
  import { locale } from "$lib/ui/i18n";

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

  const COPY = {
    "zh-CN": {
      eyebrow: "内置工具",
      title: "网页搜索",
      desc: "配置内置的 Agent 搜索工具。搜索在共享的 Agent 层运行，可在 Web、Telegram、Feishu、QQ 和 Weixin 渠道中使用。",
      loadingText: "正在加载搜索设置...",
      defaultBehavior: "默认行为",
      defaultBehaviorDesc: "设置兜底的搜索逻辑。模型在运行时仍支持覆盖此逻辑。",
      enableLabel: "启用内置网页搜索工具",
      enableDesc: "禁用时，该工具将返回设置错误，而不是进行搜索。",
      defaultRoute: "默认路由",
      defaultEngine: "默认搜索引擎",
      autoStrategy: "自动引擎策略",
      autoStrategyDesc: "仅在默认引擎为“自动”时使用。将自动跳过缺少 API Key 的引擎。",
      maxResults: "最大搜索结果数",
      timeoutMs: "超时 / 重试超时时间 (毫秒)",
      placeholderTimeout: "超时时间",
      placeholderRetryTimeout: "重试超时时间",
      routes: {
        auto: "自动",
        china: "中国本地源",
        global: "全球网页",
        official_docs: "官方文档",
        research: "研究学术",
      },
      engines: {
        auto: "自动路由顺序",
        duckduckgo: "DuckDuckGo",
        brave: "Brave Search",
        tavily: "Tavily",
        exa: "Exa",
        serper: "Serper",
        baidu: "百度千帆",
        baidu_fast: "百度快速",
        baidu_web: "百度网页",
        ark: "火山方舟",
        grok: "Grok",
        bocha: "博查",
      },
      strategies: {
        priority: "优先级顺序",
        random: "在配置好的引擎中随机",
        round_robin: "在配置好的引擎中轮询",
      },
      engineHints: {
        duckduckgo: "不需要 API key。适合简单查询的轻量级备用方案。",
        brave: "全球网页和最新资讯的最佳首选。",
        tavily: "适合学术研究类查询和生成网页片段摘要。",
        exa: "适合技术文档、博客和开发者资料。",
        serper: "兼容 Google SERP 的备用方案。",
        baidu: "中文 AI 搜索路由。",
        baidu_fast: "中文快速网页摘要搜索。",
        baidu_web: "注重来源结果的中文网页搜索。",
        ark: "国内方舟大模型辅助搜索兜底。",
        grok: "全球大模型辅助搜索兜底。",
        bocha: "中文网页搜索备用方案。",
      },
      enginesSectionTitle: "搜索引擎",
      enginesSectionDesc: "DuckDuckGo 无需凭证即可工作。其他引擎在设置 API 密钥之前会被跳过。",
      apiKeyLabel: "API 密钥",
      customBaseUrl: "自定义 Base URL",
      customBaseUrlDesc: "默认值：",
      testSectionTitle: "测试查询",
      testSectionDesc: "使用未保存的设置直接测试引擎配置。",
      testQueryPlaceholder: "搜索查询词",
      btnTest: "测试",
      btnTesting: "测试中...",
      savingText: "正在保存修改...",
      savedMsg: "搜索设置保存成功。",
      btnReset: "重置",
      btnSave: "保存搜索设置",
    },
    "en-US": {
      eyebrow: "Built-in Tool",
      title: "Web Search",
      desc: "Configure the built-in agent search tool. Search runs in the shared agent layer and is available across Web, Telegram, Feishu, QQ, and Weixin channels.",
      loadingText: "Loading search settings...",
      defaultBehavior: "Default Behavior",
      defaultBehaviorDesc: "Set the fallback search logic. Model overrides at runtime are still supported.",
      enableLabel: "Enable built-in webSearch tool",
      enableDesc: "When disabled, the tool returns a settings error instead of searching.",
      defaultRoute: "Default route",
      defaultEngine: "Default engine",
      autoStrategy: "Auto engine strategy",
      autoStrategyDesc: "Used only when Default engine is Auto. Engines without required API keys are skipped.",
      maxResults: "Max results",
      timeoutMs: "Timeout / Retry Timeout (ms)",
      placeholderTimeout: "Timeout",
      placeholderRetryTimeout: "Retry Timeout",
      routes: {
        auto: "Auto",
        china: "China-local sources",
        global: "Global web",
        official_docs: "Official docs",
        research: "Research",
      },
      engines: {
        auto: "Auto route order",
        duckduckgo: "DuckDuckGo",
        brave: "Brave Search",
        tavily: "Tavily",
        exa: "Exa",
        serper: "Serper",
        baidu: "Baidu Qianfan",
        baidu_fast: "Baidu Fast",
        baidu_web: "Baidu Web",
        ark: "Ark Bot",
        grok: "Grok",
        bocha: "Bocha",
      },
      strategies: {
        priority: "Priority order",
        random: "Random among configured",
        round_robin: "Round-robin among configured",
      },
      engineHints: {
        duckduckgo: "No API key. Lightweight fallback for simple lookups.",
        brave: "Best first choice for global web and current sources.",
        tavily: "Good for research-style queries and summarized web snippets.",
        exa: "Useful for technical documents, blogs, and developer material.",
        serper: "Google SERP compatible fallback.",
        baidu: "Chinese AI search route.",
        baidu_fast: "Chinese fast web-summary search.",
        baidu_web: "Chinese web search with source-oriented results.",
        ark: "China-local assistant-backed search fallback.",
        grok: "Global web-search assistant fallback.",
        bocha: "Chinese web search fallback.",
      },
      enginesSectionTitle: "Search Engines",
      enginesSectionDesc: "DuckDuckGo works without credentials. Other engines are skipped until API keys are set.",
      apiKeyLabel: "API Key",
      customBaseUrl: "Custom base URL",
      customBaseUrlDesc: "Default: ",
      testSectionTitle: "Test Query",
      testSectionDesc: "Test the engine config directly using unsaved settings.",
      testQueryPlaceholder: "Search query",
      btnTest: "Test",
      btnTesting: "Testing...",
      savingText: "Saving changes...",
      savedMsg: "Search settings saved.",
      btnReset: "Reset",
      btnSave: "Save Search Settings",
    }
  };

  const enginesList: Array<{ id: EngineId; name: string; keyLabel: string }> = [
    { id: "duckduckgo", name: "DuckDuckGo", keyLabel: "No key required" },
    { id: "brave", name: "Brave Search", keyLabel: "BRAVE_API_KEY" },
    { id: "tavily", name: "Tavily", keyLabel: "TAVILY_API_KEY" },
    { id: "exa", name: "Exa", keyLabel: "EXA_API_KEY" },
    { id: "serper", name: "Serper", keyLabel: "SERPER_API_KEY" },
    { id: "baidu", name: "Baidu Qianfan", keyLabel: "BAIDU_SEARCH_API_KEY" },
    { id: "baidu_fast", name: "Baidu Fast", keyLabel: "BAIDU_SEARCH_API_KEY" },
    { id: "baidu_web", name: "Baidu Web", keyLabel: "BAIDU_SEARCH_API_KEY" },
    { id: "ark", name: "Ark Bot", keyLabel: "ARK_API_KEY" },
    { id: "grok", name: "Grok", keyLabel: "GROK_API_KEY" },
    { id: "bocha", name: "Bocha", keyLabel: "BOCHA_API_KEY" }
  ];
  const visibleEngines = enginesList.filter((engine) => engine.id !== "ark");

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

  $: copy = COPY[$locale] ?? COPY["en-US"];

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
      const res = await fetch("/api/settings/web-search");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load settings");
      webSearch = normalizeForUi({ ...webSearch, ...(data.value ?? {}) });
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
      const res = await fetch("/api/settings/web-search", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: webSearch })
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to save search settings");
      webSearch = normalizeForUi(data.value);
      message = copy.savedMsg;
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
    <span class="search-badge">{copy.eyebrow}</span>
    <h1 class="search-hero-title">{copy.title}</h1>
    <p class="search-hero-desc">
      {copy.desc}
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
    <div class="errors-empty-state"><span class="animate-pulse">{copy.loadingText}</span></div>
  {:else}
    <form id="search-form" class="flex flex-col gap-6" onsubmit={(event) => { event.preventDefault(); save(); }}>
      <section class="search-card">
        <div class="search-card-header">
          <div>
            <h2 class="search-card-title">{copy.defaultBehavior}</h2>
            <p class="search-card-desc">{copy.defaultBehaviorDesc}</p>
          </div>
        </div>

        <div class="search-switch-row">
          <div>
            <Label for="search-enabled" class="font-bold">{copy.enableLabel}</Label>
            <p class="search-form-hint">{copy.enableDesc}</p>
          </div>
          <IosSwitch id="search-enabled" bind:checked={webSearch.enabled} />
        </div>

        <div class="search-form-grid">
          <div class="search-form-group">
            <Label for="default-route">{copy.defaultRoute}</Label>
            <NativeSelect id="default-route" bind:value={webSearch.defaultRoute} class="h-10">
              <NativeSelectOption value="auto">{copy.routes.auto}</NativeSelectOption>
              <NativeSelectOption value="china">{copy.routes.china}</NativeSelectOption>
              <NativeSelectOption value="global">{copy.routes.global}</NativeSelectOption>
              <NativeSelectOption value="official_docs">{copy.routes.official_docs}</NativeSelectOption>
              <NativeSelectOption value="research">{copy.routes.research}</NativeSelectOption>
            </NativeSelect>
          </div>

          <div class="search-form-group">
            <Label for="default-engine">{copy.defaultEngine}</Label>
            <NativeSelect id="default-engine" bind:value={webSearch.defaultEngine} class="h-10">
              <NativeSelectOption value="auto">{copy.engines.auto}</NativeSelectOption>
              {#each visibleEngines as engine}
                <NativeSelectOption value={engine.id}>{copy.engines[engine.id] || engine.name}</NativeSelectOption>
              {/each}
            </NativeSelect>
          </div>

          <div class="search-form-group">
            <Label for="engine-selection-strategy">{copy.autoStrategy}</Label>
            <NativeSelect id="engine-selection-strategy" bind:value={webSearch.engineSelectionStrategy} class="h-10">
              <NativeSelectOption value="priority">{copy.strategies.priority}</NativeSelectOption>
              <NativeSelectOption value="random">{copy.strategies.random}</NativeSelectOption>
              <NativeSelectOption value="round_robin">{copy.strategies.round_robin}</NativeSelectOption>
            </NativeSelect>
            <p class="search-form-hint">{copy.autoStrategyDesc}</p>
          </div>

          <div class="search-form-group">
            <Label for="max-results">{copy.maxResults}</Label>
            <Input id="max-results" type="number" min="1" max="20" bind:value={webSearch.maxResults} class="h-10 tabular-nums" />
          </div>

          <div class="search-form-group search-form-group--full">
            <Label for="timeout-ms">{copy.timeoutMs}</Label>
            <div class="grid grid-cols-2 gap-3">
              <Input id="timeout-ms" type="number" min="1000" max="120000" bind:value={webSearch.timeoutMs} class="h-10 tabular-nums" placeholder={copy.placeholderTimeout} />
              <Input type="number" min="1000" max="180000" bind:value={webSearch.retryTimeoutMs} class="h-10 tabular-nums" placeholder={copy.placeholderRetryTimeout} />
            </div>
          </div>
        </div>
      </section>

      <section class="search-card">
        <div class="search-card-header">
          <div>
            <h2 class="search-card-title">{copy.enginesSectionTitle}</h2>
            <p class="search-card-desc">{copy.enginesSectionDesc}</p>
          </div>
        </div>

        <div class="search-engine-list">
          {#each visibleEngines as engine}
            <div class="search-engine-card">
              <div class="search-engine-header">
                <div class="flex-1">
                  <div class="search-engine-title-group">
                    <h3 class="search-engine-title">{copy.engines[engine.id] || engine.name}</h3>
                    <span class="search-pill">{engine.id}</span>
                  </div>
                  <p class="search-engine-hint">{copy.engineHints[engine.id] || ""}</p>
                </div>
                <IosSwitch bind:checked={webSearch.engines[engine.id].enabled} />
              </div>

              {#if engine.id !== "duckduckgo"}
                <div class="search-engine-inputs">
                  <div class="search-form-group">
                    <Label>{engine.keyLabel === "No key required" ? copy.apiKeyLabel : engine.keyLabel}</Label>
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
                    <Label>{copy.customBaseUrl}</Label>
                    <Input placeholder={defaultBaseUrl(engine.id)} value={webSearch.engines[engine.id].baseUrl ?? ""} oninput={(event) => setEngineValue(engine.id, "baseUrl", (event.target as HTMLInputElement).value)} class="h-9 text-xs" />
                    <p class="search-form-hint truncate">
                      {copy.customBaseUrlDesc} <code>{defaultBaseUrl(engine.id)}</code>
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
            <h2 class="search-card-title">{copy.testSectionTitle}</h2>
            <p class="search-card-desc">{copy.testSectionDesc}</p>
          </div>
        </div>

        <div class="flex flex-col gap-4">
          <div class="search-test-grid">
            <Input bind:value={testQuery} placeholder={copy.testQueryPlaceholder} class="h-10" />
            <NativeSelect bind:value={testEngine} class="h-10">
              <NativeSelectOption value="auto">{copy.engines.auto}</NativeSelectOption>
              {#each visibleEngines as engine}
                <NativeSelectOption value={engine.id}>{copy.engines[engine.id] || engine.name}</NativeSelectOption>
              {/each}
              {#each enginesList.filter(e => e.id === "ark") as ark}
                <NativeSelectOption value={ark.id}>{copy.engines[ark.id] || ark.name}</NativeSelectOption>
              {/each}
            </NativeSelect>
            <Button type="button" variant="outline" onclick={runTest} disabled={testing} class="h-10 px-6 font-bold">
              {testing ? copy.btnTesting : copy.btnTest}
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
        {copy.savingText}
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
      {copy.btnReset}
    </Button>
    <button type="submit" form="search-form" class="settings-footbar-btn" disabled={loading || saving}>
      {saving ? copy.savingText : copy.btnSave}
    </button>
  </div>
</footer>
