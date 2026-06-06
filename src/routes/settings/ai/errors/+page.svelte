<script lang="ts">
  import { onMount } from "svelte";
  import { Alert, AlertDescription } from "$lib/components/ui/alert";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Card, CardContent, CardHeader, CardTitle } from "$lib/components/ui/card";
  import { NativeSelect, NativeSelectOption } from "$lib/components/ui/native-select";
  import SettingsSection from "$lib/components/ui/settings/SettingsSection.svelte";

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

<div class="wb-page">
  <SettingsSection
    title="模型报错记录"
    description="这里只记录失败模型调用，用来定位缺少密钥、空响应、上游请求失败，以及 fallback 是否兜住了这次运行。"
    badge="Failure Radar"
  >
  <div class="flex justify-end">
    <Button variant="outline" onclick={loadModelErrors} disabled={loading} class="h-10 px-6 font-bold">
      {#if loading}
        <span class="mr-2 h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent"></span>
        刷新中
      {:else}
        刷新
      {/if}
    </Button>
  </div>

  {#if error}
    <Alert variant="destructive" class="wb-panel-danger"><AlertDescription>{error}</AlertDescription></Alert>
  {/if}

  {#if loading && items.length === 0}
    <div class="wb-empty-state">
      <span class="animate-pulse">正在加载模型报错记录...</span>
    </div>
  {:else}
    <div class="wb-kpi-grid">
      <div class="wb-kpi-card" data-span="3" data-tone="danger">
        <span class="wb-eyebrow">总失败数</span>
        <strong class="tabular-nums">{summary.total}</strong>
        <p class="settings-item-desc mt-auto">最近 200 条失败日志内的记录数</p>
      </div>
      <div class="wb-kpi-card" data-span="3">
        <span class="wb-eyebrow">后来恢复</span>
        <strong class="tabular-nums text-[#8B9A6D]">{summary.recovered}</strong>
        <p class="settings-item-desc mt-auto">{pct(summary.recovered, summary.total)}% 被备用模型或重试兜住</p>
      </div>
      <div class="wb-kpi-card" data-span="3">
        <span class="wb-eyebrow">直接失败</span>
        <strong class="tabular-nums text-[#A36A5E]">{summary.unrecovered}</strong>
        <p class="settings-item-desc mt-auto">{pct(summary.unrecovered, summary.total)}% 最终没有恢复</p>
      </div>
      <div class="wb-kpi-card" data-span="3">
        <span class="wb-eyebrow">最高频 Provider</span>
        <strong class="text-xl sm:text-2xl">{topProvider?.provider ?? "--"}</strong>
        <p class="settings-item-desc mt-auto">{topProvider ? `${topProvider.count} 条失败` : "暂无失败来源"}</p>
      </div>
    </div>

    <div class="wb-filter-bar">
      <div class="wb-field">
        <span>Channel</span>
        <NativeSelect bind:value={selectedChannel} class="h-9">
          <NativeSelectOption value="all">全部渠道</NativeSelectOption>
          {#each channels as ch}
            <NativeSelectOption value={ch}>{ch}</NativeSelectOption>
          {/each}
        </NativeSelect>
      </div>
      <div class="wb-field">
        <span>Provider</span>
        <NativeSelect bind:value={selectedProvider} class="h-9">
          <NativeSelectOption value="all">全部 Provider</NativeSelectOption>
          {#each providers as p}
            <NativeSelectOption value={p}>{p}</NativeSelectOption>
          {/each}
        </NativeSelect>
      </div>
      <div class="wb-field">
        <span>State</span>
        <NativeSelect bind:value={selectedState} class="h-9">
          <NativeSelectOption value="all">全部状态</NativeSelectOption>
          <NativeSelectOption value="recovered">已恢复</NativeSelectOption>
          <NativeSelectOption value="failed">未恢复</NativeSelectOption>
        </NativeSelect>
      </div>
      <div class="wb-field">
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

    <div class="wb-split-layout">
      <aside class="wb-sticky-side space-y-4">
        <div class="wb-panel-soft">
          <div class="wb-panel-heading">
            <h3 class="font-serif">错误类型</h3>
          </div>
          <div class="wb-rank-list">
            {#each ["request_error", "empty_response", "missing_api_key"] as kind}
              {@const count = countByKind(kind as ModelErrorKind)}
              <button
                type="button"
                class="wb-config-item {selectedKind === kind ? 'active' : ''}"
                onclick={() => (selectedKind = selectedKind === kind ? "all" : kind)}
              >
                <span class="wb-config-item-title">{kindLabel(kind as ModelErrorKind)}</span>
                <span class="wb-pill tabular-nums" data-tone={count > 0 ? "warning" : "default"}>{count}</span>
              </button>
            {/each}
          </div>
        </div>

        <div class="wb-panel-soft">
          <div class="wb-panel-heading">
            <h3 class="font-serif">Provider 排名</h3>
          </div>
          <div class="wb-rank-list">
            {#if summary.byProvider.length === 0}
              <p class="wb-muted text-xs p-3">暂无 provider 失败记录。</p>
            {:else}
              {#each summary.byProvider.slice(0, 10) as row}
                <button
                  type="button"
                  class="wb-config-item {selectedProvider === row.provider ? 'active' : ''}"
                  onclick={() => (selectedProvider = selectedProvider === row.provider ? "all" : row.provider)}
                >
                  <span class="wb-config-item-title">{row.provider}</span>
                  <span class="wb-pill tabular-nums" data-tone="danger">{row.count}</span>
                </button>
              {/each}
            {/if}
          </div>
        </div>
      </aside>

      <section class="space-y-4">
        <div class="flex items-center justify-between px-2">
          <h2 class="font-serif text-lg">失败事件 <span class="wb-muted font-normal text-sm tabular-nums">({filteredItems.length} 条匹配记录)</span></h2>
        </div>

        {#if filteredItems.length === 0}
          <div class="wb-empty-state">当前筛选条件下没有模型报错记录。</div>
        {:else}
          <div class="space-y-4">
            {#each filteredItems as item}
              <div class="wb-panel {item.recovered ? '' : 'border-destructive/30'}" style={item.recovered ? '' : 'border-left: 4px solid var(--destructive)'}>
                <div class="wb-panel-heading">
                  <div class="flex flex-col gap-1">
                    <div class="flex items-center gap-3">
                      <h3 class="font-semibold">{item.provider} / {item.model}</h3>
                      <span class="wb-pill tabular-nums" data-tone={item.recovered ? 'success' : 'danger'}>
                        {item.recovered ? "已恢复" : "未恢复"}
                      </span>
                      <span class="wb-pill" data-tone="default">{kindLabel(item.kind)}</span>
                    </div>
                    <p class="wb-muted text-xs tabular-nums">{formatDate(item.ts)} · {item.channel} / {item.botId} / {item.chatId}</p>
                  </div>
                  <div class="flex gap-2">
                    <span class="wb-pill" data-tone="default">{item.source}</span>
                    <span class="wb-pill" data-tone="default">{item.route}</span>
                  </div>
                </div>

                <div class="wb-grid-2 mt-4">
                  <div class="wb-note">
                    <span class="wb-eyebrow text-[10px]">Error Reason</span>
                    <p class="mt-1 text-sm text-foreground">{item.message}</p>
                  </div>
                  <div class="wb-note">
                    <span class="wb-eyebrow text-[10px]">Context</span>
                    <div class="mt-1 space-y-1 text-xs tabular-nums">
                      <p>API: <span class="wb-text-strong">{item.api || "-"}</span></p>
                      <p>Base URL: <span class="wb-text-strong">{item.baseUrl || "-"}</span></p>
                      <p>Endpoint: <span class="wb-text-strong">{item.endpointUrl || "-"}</span></p>
                      <p>Session: <span class="wb-text-strong font-mono">{item.sessionId || "-"}</span></p>
                    </div>
                  </div>
                </div>

                <div class="mt-4 wb-status-line rounded-lg" data-tone={item.recovered ? 'success' : 'default'}>
                  {#if item.recovered}
                    <span class="flex items-center gap-2">
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                      备用路径已接管：<strong class="font-bold">{item.finalProvider || "-"} / {item.finalModel || "-"}</strong>
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
  </SettingsSection>
</div>

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

<style>
  :global(.tabular-nums) {
    font-variant-numeric: tabular-nums;
  }
</style>

