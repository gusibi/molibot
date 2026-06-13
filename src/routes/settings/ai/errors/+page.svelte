<script lang="ts">
  import { onMount } from "svelte";
  import { Alert, AlertDescription } from "$lib/components/ui/alert";
  import { Button } from "$lib/components/ui/button";
  import { NativeSelect, NativeSelectOption } from "$lib/components/ui/native-select";
  import { locale } from "$lib/ui/i18n";

  type ModelErrorKind = "request_error" | "empty_response" | "missing_api_key";

  interface ModelErrorRecord {
    ts: string;
    source: "runner" | "assistant";
    channel: string;
    botId: string;
    chatId: string;
    sessionId?: string;
    runId?: string;
    provider: string;
    model: string;
    api?: string;
    route: "text" | "vision" | "stt" | "tts";
    kind: ModelErrorKind;
    message: string;
    baseUrl?: string;
    endpointUrl?: string;
    candidateIndex?: number;
    recovered: boolean;
    fallbackUsed: boolean;
    finalProvider?: string;
    finalModel?: string;
  }

  interface ModelErrorSummary {
    total: number;
    recovered: number;
    unrecovered: number;
    byKind: Array<{ kind: ModelErrorKind; count: number }>;
    byProvider: Array<{ provider: string; count: number }>;
  }

  const COPY = {
    "zh-CN": {
      eyebrow: "Failure Radar",
      title: "模型报错记录",
      desc: "这里只记录失败模型调用，用来定位缺少密钥、空响应、上游请求失败，以及 fallback 是否兜住了这次运行。",
      loadingText: "正在加载模型报错记录...",
      kpi: {
        totalFailures: "总失败数",
        totalFailuresDesc: "最近 200 条内的记录数",
        recovered: "后来恢复",
        recoveredDesc: "{pct}% 被备用模型或重试兜住",
        unrecovered: "直接失败",
        unrecoveredDesc: "{pct}% 最终没有恢复",
        topProvider: "最高频 Provider",
        topProviderEmpty: "暂无失败来源",
        topProviderDesc: "{count} 条失败"
      },
      filters: {
        allChannels: "全部渠道",
        allProviders: "全部 Provider",
        allStates: "全部状态",
        recovered: "已恢复",
        failed: "未恢复",
        allKinds: "全部类型",
        request_error: "请求失败",
        empty_response: "空响应",
        missing_api_key: "缺少密钥",
        clear: "清空筛选"
      },
      kindsTitle: "错误类型",
      providerRankTitle: "Provider 排名",
      providerRankEmpty: "暂无 provider 失败记录。",
      eventsTitle: "失败事件",
      eventsMatch: "({count} 条匹配记录)",
      emptyState: "当前筛选条件下没有模型报错记录。",
      card: {
        recovered: "已恢复",
        failed: "未恢复",
        fallbackSuccess: "备用路径已接管：",
        fallbackFailed: "这次失败没有被备用模型恢复。"
      },
      footbar: {
        scanning: "探测中...",
        updated: "记录已更新至 {time}",
        refresh: "刷新记录",
        loadedMsg: "已载入 {count} 条模型失败记录"
      }
    },
    "en-US": {
      eyebrow: "Failure Radar",
      title: "Model Error Logs",
      desc: "Only failed model calls are recorded here, used to locate missing keys, empty responses, upstream request failures, and verify whether fallbacks successfully saved the run.",
      loadingText: "Loading model error logs...",
      kpi: {
        totalFailures: "Total Failures",
        totalFailuresDesc: "Count within the last 200 logs",
        recovered: "Recovered",
        recoveredDesc: "{pct}% rescued by fallbacks or retries",
        unrecovered: "Direct Failures",
        unrecoveredDesc: "{pct}% not recovered",
        topProvider: "Top Failed Provider",
        topProviderEmpty: "No failed sources",
        topProviderDesc: "{count} failures"
      },
      filters: {
        allChannels: "All Channels",
        allProviders: "All Providers",
        allStates: "All States",
        recovered: "Recovered",
        failed: "Failed",
        allKinds: "All Kinds",
        request_error: "Request Failure",
        empty_response: "Empty Response",
        missing_api_key: "Missing API Key",
        clear: "Clear Filters"
      },
      kindsTitle: "Error Types",
      providerRankTitle: "Provider Rankings",
      providerRankEmpty: "No provider failures recorded.",
      eventsTitle: "Failure Events",
      eventsMatch: "({count} matching logs)",
      emptyState: "No model errors match the current filters.",
      card: {
        recovered: "Recovered",
        failed: "Failed",
        fallbackSuccess: "Fallback path took over: ",
        fallbackFailed: "This failure was not recovered by a fallback model."
      },
      footbar: {
        scanning: "Scanning...",
        updated: "Logs updated as of {time}",
        refresh: "Refresh Logs",
        loadedMsg: "Loaded {count} model failure records"
      }
    }
  };

  let loading = true;
  let error = "";
  let message = "";
  let items: ModelErrorRecord[] = [];
  let summary: ModelErrorSummary = { total: 0, recovered: 0, unrecovered: 0, byKind: [], byProvider: [] };
  let selectedChannel = "all";
  let selectedProvider = "all";
  let selectedState = "all";
  let selectedKind = "all";

  $: copy = COPY[$locale] ?? COPY["en-US"];

  async function loadModelErrors(): Promise<void> {
    loading = true;
    error = "";
    message = "";
    try {
      const res = await fetch("/api/settings/model-errors?limit=200");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load model errors");
      items = Array.isArray(data.items) ? data.items : [];
      summary = data.summary ?? summary;
      message = copy.footbar.loadedMsg.replace("{count}", String(items.length));
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  onMount(loadModelErrors);

  function formatDate(value: string): string {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString($locale === "zh-CN" ? "zh-CN" : "en-US", {
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    });
  }

  function kindLabel(kind: ModelErrorKind): string {
    if (kind === "missing_api_key") return copy.filters.missing_api_key;
    if (kind === "empty_response") return copy.filters.empty_response;
    return copy.filters.request_error;
  }

  function resetFilters(): void {
    selectedChannel = "all";
    selectedProvider = "all";
    selectedState = "all";
    selectedKind = "all";
  }

  function pct(value: number, total: number): number {
    if (total <= 0) return 0;
    return Math.round((value / total) * 100);
  }

  function countByKind(kind: ModelErrorKind): number {
    return summary.byKind.find((row) => row.kind === kind)?.count ?? 0;
  }

  $: channels = Array.from(new Set(items.map((item) => item.channel))).sort();
  $: providers = Array.from(new Set(items.map((item) => item.provider))).sort();
  $: filteredItems = items.filter((item) => {
    if (selectedChannel !== "all" && item.channel !== selectedChannel) return false;
    if (selectedProvider !== "all" && item.provider !== selectedProvider) return false;
    if (selectedState === "recovered" && !item.recovered) return false;
    if (selectedState === "failed" && item.recovered) return false;
    if (selectedKind !== "all" && item.kind !== selectedKind) return false;
    return true;
  });
  $: topProvider = summary.byProvider[0];
</script>

<div class="errors-page">
  <!-- Hero Header -->
  <header class="errors-hero">
    <span class="errors-badge">{copy.eyebrow}</span>
    <h1 class="errors-hero-title">{copy.title}</h1>
    <p class="errors-hero-desc">
      {copy.desc}
    </p>
  </header>

  {#if error}
    <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
  {/if}

  {#if loading && items.length === 0}
    <div class="errors-empty-state">
      <span class="animate-pulse">{copy.loadingText}</span>
    </div>
  {:else}
    <!-- KPIs -->
    <div class="errors-kpi-grid">
      <div class="errors-kpi-card">
        <span class="errors-kpi-label">{copy.kpi.totalFailures}</span>
        <strong class="errors-kpi-value">{summary.total}</strong>
        <p class="errors-kpi-desc">{copy.kpi.totalFailuresDesc}</p>
      </div>
      <div class="errors-kpi-card">
        <span class="errors-kpi-label">{copy.kpi.recovered}</span>
        <strong class="errors-kpi-value text-[#8B9A6D]">{summary.recovered}</strong>
        <p class="errors-kpi-desc">{copy.kpi.recoveredDesc.replace("{pct}", String(pct(summary.recovered, summary.total)))}</p>
      </div>
      <div class="errors-kpi-card">
        <span class="errors-kpi-label">{copy.kpi.unrecovered}</span>
        <strong class="errors-kpi-value text-[#A36A5E]">{summary.unrecovered}</strong>
        <p class="errors-kpi-desc">{copy.kpi.unrecoveredDesc.replace("{pct}", String(pct(summary.unrecovered, summary.total)))}</p>
      </div>
      <div class="errors-kpi-card">
        <span class="errors-kpi-label">{copy.kpi.topProvider}</span>
        <strong class="errors-kpi-value text-xl font-serif">{topProvider?.provider ?? "--"}</strong>
        <p class="errors-kpi-desc">{topProvider ? copy.kpi.topProviderDesc.replace("{count}", String(topProvider.count)) : copy.kpi.topProviderEmpty}</p>
      </div>
    </div>

    <!-- Filter Bar -->
    <div class="errors-filter-bar">
      <div class="errors-field">
        <span>Channel</span>
        <NativeSelect bind:value={selectedChannel} class="h-9">
          <NativeSelectOption value="all">{copy.filters.allChannels}</NativeSelectOption>
          {#each channels as ch}
            <NativeSelectOption value={ch}>{ch}</NativeSelectOption>
          {/each}
        </NativeSelect>
      </div>
      <div class="errors-field">
        <span>Provider</span>
        <NativeSelect bind:value={selectedProvider} class="h-9">
          <NativeSelectOption value="all">{copy.filters.allProviders}</NativeSelectOption>
          {#each providers as p}
            <NativeSelectOption value={p}>{p}</NativeSelectOption>
          {/each}
        </NativeSelect>
      </div>
      <div class="errors-field">
        <span>State</span>
        <NativeSelect bind:value={selectedState} class="h-9">
          <NativeSelectOption value="all">{copy.filters.allStates}</NativeSelectOption>
          <NativeSelectOption value="recovered">{copy.filters.recovered}</NativeSelectOption>
          <NativeSelectOption value="failed">{copy.filters.failed}</NativeSelectOption>
        </NativeSelect>
      </div>
      <div class="errors-field">
        <span>Kind</span>
        <NativeSelect bind:value={selectedKind} class="h-9">
          <NativeSelectOption value="all">{copy.filters.allKinds}</NativeSelectOption>
          <NativeSelectOption value="request_error">{copy.filters.request_error}</NativeSelectOption>
          <NativeSelectOption value="empty_response">{copy.filters.empty_response}</NativeSelectOption>
          <NativeSelectOption value="missing_api_key">{copy.filters.missing_api_key}</NativeSelectOption>
        </NativeSelect>
      </div>
      <Button variant="outline" size="sm" class="h-9 px-4 font-semibold" onclick={resetFilters}>{copy.filters.clear}</Button>
    </div>

    <!-- Split Layout -->
    <div class="errors-split-layout">
      <!-- Sidebar panels -->
      <aside class="errors-sidebar">
        <div class="errors-panel-soft">
          <div class="errors-panel-heading">
            <h3 class="errors-panel-title">{copy.kindsTitle}</h3>
          </div>
          <div class="errors-rank-list">
            {#each ["request_error", "empty_response", "missing_api_key"] as kind}
              {@const count = countByKind(kind as ModelErrorKind)}
              <button
                type="button"
                class="errors-config-item {selectedKind === kind ? 'active' : ''}"
                onclick={() => (selectedKind = selectedKind === kind ? "all" : kind)}
              >
                <span class="errors-config-item-title">{kindLabel(kind as ModelErrorKind)}</span>
                <span class="errors-pill tabular-nums" data-tone={count > 0 ? "warning" : "default"}>{count}</span>
              </button>
            {/each}
          </div>
        </div>

        <div class="errors-panel-soft">
          <div class="errors-panel-heading">
            <h3 class="errors-panel-title">{copy.providerRankTitle}</h3>
          </div>
          <div class="errors-rank-list">
            {#if summary.byProvider.length === 0}
              <p class="text-xs text-muted-foreground p-2">{copy.providerRankEmpty}</p>
            {:else}
              {#each summary.byProvider.slice(0, 10) as row}
                <button
                  type="button"
                  class="errors-config-item {selectedProvider === row.provider ? 'active' : ''}"
                  onclick={() => (selectedProvider = selectedProvider === row.provider ? "all" : row.provider)}
                >
                  <span class="errors-config-item-title">{row.provider}</span>
                  <span class="errors-pill tabular-nums" data-tone="danger">{row.count}</span>
                </button>
              {/each}
            {/if}
          </div>
        </div>
      </aside>

      <!-- Main event logs list -->
      <section class="errors-content">
        <div class="errors-content-header">
          <h2 class="errors-content-title">
            {copy.eventsTitle} <span>{copy.eventsMatch.replace("{count}", String(filteredItems.length))}</span>
          </h2>
        </div>

        {#if filteredItems.length === 0}
          <div class="errors-empty-state">{copy.emptyState}</div>
        {:else}
          <div class="flex flex-col gap-4">
            {#each filteredItems as item}
              <div class="errors-event-card" style={item.recovered ? '' : 'border-left: 4px solid oklch(50% 0.18 25)'}>
                <div class="errors-event-header">
                  <div class="errors-event-title-row">
                    <div class="errors-event-title-group">
                      <h3 class="errors-event-title">{item.provider} / {item.model}</h3>
                      <span class="errors-pill tabular-nums" data-tone={item.recovered ? 'success' : 'danger'}>
                        {item.recovered ? copy.card.recovered : copy.card.failed}
                      </span>
                      <span class="errors-pill" data-tone="default">{kindLabel(item.kind)}</span>
                    </div>
                    <p class="errors-event-meta">{formatDate(item.ts)} · {item.channel} / {item.botId} / {item.chatId}</p>
                  </div>
                  <div class="errors-event-tags">
                    <span class="errors-pill" data-tone="default">{item.source}</span>
                    <span class="errors-pill" data-tone="default">{item.route}</span>
                  </div>
                </div>

                <div class="errors-event-grid">
                  <div class="errors-note">
                    <span class="errors-note-title">Error Reason</span>
                    <p class="errors-note-content">{item.message}</p>
                  </div>
                  <div class="errors-note">
                    <span class="errors-note-title">Context</span>
                    <ul class="errors-note-context-list">
                      <li>API: <span>{item.api || "-"}</span></li>
                      <li>Base URL: <span>{item.baseUrl || "-"}</span></li>
                      <li>Endpoint: <span>{item.endpointUrl || "-"}</span></li>
                      <li>Session: <span>{item.sessionId || "-"}</span></li>
                    </ul>
                  </div>
                </div>

                <div class="errors-status-line" data-tone={item.recovered ? 'success' : 'default'}>
                  {#if item.recovered}
                    <span class="flex items-center gap-2">
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                      {copy.card.fallbackSuccess}<strong>{item.finalProvider || "-"} / {item.finalModel || "-"}</strong>
                    </span>
                  {:else}
                    <span class="flex items-center gap-2">
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                      {copy.card.fallbackFailed}
                    </span>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </section>
    </div>
  {/if}
</div>

<!-- Fixed Footer Bar -->
<footer class="settings-footbar">
  <div class="settings-footbar-status">
    {#if loading}
      <span class="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <span class="h-2 w-2 animate-pulse rounded-full bg-[#A36A5E]"></span>
        {copy.footbar.scanning}
      </span>
    {:else if items.length > 0}
      <span class="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <span class="h-2 w-2 rounded-full bg-[#8B9A6D]"></span>
        {copy.footbar.updated.replace("{time}", formatDate(items[0].ts))}
      </span>
    {/if}
  </div>
  <div class="flex items-center gap-3">
    <Button variant="outline" size="sm" onclick={loadModelErrors} disabled={loading} class="h-9 px-4 text-xs font-bold">
      {copy.footbar.refresh}
    </Button>
  </div>
</footer>
