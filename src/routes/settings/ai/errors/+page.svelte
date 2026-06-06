<script lang="ts">
  import { onMount } from "svelte";
  import { Alert, AlertDescription } from "$lib/components/ui/alert";
  import { Button } from "$lib/components/ui/button";
  import { NativeSelect, NativeSelectOption } from "$lib/components/ui/native-select";

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

  let loading = true;
  let error = "";
  let message = "";
  let items: ModelErrorRecord[] = [];
  let summary: ModelErrorSummary = { total: 0, recovered: 0, unrecovered: 0, byKind: [], byProvider: [] };
  let selectedChannel = "all";
  let selectedProvider = "all";
  let selectedState = "all";
  let selectedKind = "all";

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
      message = `已载入 ${items.length} 条模型失败记录`;
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
    return date.toLocaleString("zh-CN", {
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    });
  }

  function kindLabel(kind: ModelErrorKind): string {
    if (kind === "missing_api_key") return "缺少密钥";
    if (kind === "empty_response") return "空响应";
    return "请求失败";
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
    <span class="errors-badge">Failure Radar</span>
    <h1 class="errors-hero-title">模型报错记录</h1>
    <p class="errors-hero-desc">
      这里只记录失败模型调用，用来定位缺少密钥、空响应、上游请求失败，以及 fallback 是否兜住了这次运行。
    </p>
  </header>

  {#if error}
    <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
  {/if}

  {#if loading && items.length === 0}
    <div class="errors-empty-state">
      <span class="animate-pulse">正在加载模型报错记录...</span>
    </div>
  {:else}
    <!-- KPIs -->
    <div class="errors-kpi-grid">
      <div class="errors-kpi-card">
        <span class="errors-kpi-label">总失败数</span>
        <strong class="errors-kpi-value">{summary.total}</strong>
        <p class="errors-kpi-desc">最近 200 条内的记录数</p>
      </div>
      <div class="errors-kpi-card">
        <span class="errors-kpi-label">后来恢复</span>
        <strong class="errors-kpi-value text-[#8B9A6D]">{summary.recovered}</strong>
        <p class="errors-kpi-desc">{pct(summary.recovered, summary.total)}% 被备用模型或重试兜住</p>
      </div>
      <div class="errors-kpi-card">
        <span class="errors-kpi-label">直接失败</span>
        <strong class="errors-kpi-value text-[#A36A5E]">{summary.unrecovered}</strong>
        <p class="errors-kpi-desc">{pct(summary.unrecovered, summary.total)}% 最终没有恢复</p>
      </div>
      <div class="errors-kpi-card">
        <span class="errors-kpi-label">最高频 Provider</span>
        <strong class="errors-kpi-value text-xl font-serif">{topProvider?.provider ?? "--"}</strong>
        <p class="errors-kpi-desc">{topProvider ? `${topProvider.count} 条失败` : "暂无失败来源"}</p>
      </div>
    </div>

    <!-- Filter Bar -->
    <div class="errors-filter-bar">
      <div class="errors-field">
        <span>Channel</span>
        <NativeSelect bind:value={selectedChannel} class="h-9">
          <NativeSelectOption value="all">全部渠道</NativeSelectOption>
          {#each channels as ch}
            <NativeSelectOption value={ch}>{ch}</NativeSelectOption>
          {/each}
        </NativeSelect>
      </div>
      <div class="errors-field">
        <span>Provider</span>
        <NativeSelect bind:value={selectedProvider} class="h-9">
          <NativeSelectOption value="all">全部 Provider</NativeSelectOption>
          {#each providers as p}
            <NativeSelectOption value={p}>{p}</NativeSelectOption>
          {/each}
        </NativeSelect>
      </div>
      <div class="errors-field">
        <span>State</span>
        <NativeSelect bind:value={selectedState} class="h-9">
          <NativeSelectOption value="all">全部状态</NativeSelectOption>
          <NativeSelectOption value="recovered">已恢复</NativeSelectOption>
          <NativeSelectOption value="failed">未恢复</NativeSelectOption>
        </NativeSelect>
      </div>
      <div class="errors-field">
        <span>Kind</span>
        <NativeSelect bind:value={selectedKind} class="h-9">
          <NativeSelectOption value="all">全部类型</NativeSelectOption>
          <NativeSelectOption value="request_error">请求失败</NativeSelectOption>
          <NativeSelectOption value="empty_response">空响应</NativeSelectOption>
          <NativeSelectOption value="missing_api_key">缺少密钥</NativeSelectOption>
        </NativeSelect>
      </div>
      <Button variant="outline" size="sm" class="h-9 px-4 font-semibold" onclick={resetFilters}>清空筛选</Button>
    </div>

    <!-- Split Layout -->
    <div class="errors-split-layout">
      <!-- Sidebar panels -->
      <aside class="errors-sidebar">
        <div class="errors-panel-soft">
          <div class="errors-panel-heading">
            <h3 class="errors-panel-title">错误类型</h3>
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
            <h3 class="errors-panel-title">Provider 排名</h3>
          </div>
          <div class="errors-rank-list">
            {#if summary.byProvider.length === 0}
              <p class="text-xs text-muted-foreground p-2">暂无 provider 失败记录。</p>
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
            失败事件 <span>({filteredItems.length} 条匹配记录)</span>
          </h2>
        </div>

        {#if filteredItems.length === 0}
          <div class="errors-empty-state">当前筛选条件下没有模型报错记录。</div>
        {:else}
          <div class="flex flex-col gap-4">
            {#each filteredItems as item}
              <div class="errors-event-card" style={item.recovered ? '' : 'border-left: 4px solid oklch(50% 0.18 25)'}>
                <div class="errors-event-header">
                  <div class="errors-event-title-row">
                    <div class="errors-event-title-group">
                      <h3 class="errors-event-title">{item.provider} / {item.model}</h3>
                      <span class="errors-pill tabular-nums" data-tone={item.recovered ? 'success' : 'danger'}>
                        {item.recovered ? "已恢复" : "未恢复"}
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
                      备用路径已接管：<strong>{item.finalProvider || "-"} / {item.finalModel || "-"}</strong>
                    </span>
                  {:else}
                    <span class="flex items-center gap-2">
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                      这次失败没有被备用模型恢复。
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
        探测中...
      </span>
    {:else if items.length > 0}
      <span class="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <span class="h-2 w-2 rounded-full bg-[#8B9A6D]"></span>
        记录已更新至 {formatDate(items[0].ts)}
      </span>
    {/if}
  </div>
  <div class="flex items-center gap-3">
    <Button variant="outline" size="sm" onclick={loadModelErrors} disabled={loading} class="h-9 px-4 text-xs font-bold">
      刷新记录
    </Button>
  </div>
</footer>



