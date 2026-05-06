<script lang="ts">
  import { onMount } from "svelte";
  import { Alert, AlertDescription } from "$lib/components/ui/alert";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Card, CardContent, CardHeader, CardTitle } from "$lib/components/ui/card";
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

<div class="mx-auto flex max-w-[1500px] flex-col gap-6 px-6 py-8 sm:px-10 sm:py-10">
  <header class="flex flex-col gap-3">
    <Badge variant="secondary" class="w-fit">Failure Radar</Badge>
    <div class="flex max-w-3xl flex-col gap-2">
      <h1 class="text-3xl font-semibold tracking-tight text-foreground">模型报错记录</h1>
      <p class="text-sm leading-6 text-muted-foreground">
        这里只记录失败模型调用，用来定位缺少密钥、空响应、上游请求失败，以及 fallback 是否兜住了这次运行。
      </p>
    </div>
    <div class="flex items-center gap-2">
      <Button variant="outline" onclick={loadModelErrors} disabled={loading}>
        {loading ? "刷新中" : "刷新"}
      </Button>
      {#if message}
        <span class="text-xs text-muted-foreground">{message}</span>
      {/if}
    </div>
  </header>

  {#if error}
    <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
  {/if}

  {#if loading && items.length === 0}
    <p class="py-8 text-sm text-muted-foreground">正在加载模型报错记录...</p>
  {:else}
    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardHeader class="pb-2">
          <CardTitle class="text-sm text-muted-foreground">总失败数</CardTitle>
        </CardHeader>
        <CardContent>
          <strong class="text-3xl font-semibold tracking-tight text-destructive">{summary.total}</strong>
          <p class="mt-1 text-xs text-muted-foreground">最近 200 条失败日志内的记录数</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader class="pb-2">
          <CardTitle class="text-sm text-muted-foreground">后来恢复</CardTitle>
        </CardHeader>
        <CardContent>
          <strong class="text-3xl font-semibold tracking-tight text-emerald-600 dark:text-emerald-400">{summary.recovered}</strong>
          <p class="mt-1 text-xs text-muted-foreground">{pct(summary.recovered, summary.total)}% 被备用模型或重试兜住</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader class="pb-2">
          <CardTitle class="text-sm text-muted-foreground">直接失败</CardTitle>
        </CardHeader>
        <CardContent>
          <strong class="text-3xl font-semibold tracking-tight text-amber-600 dark:text-amber-400">{summary.unrecovered}</strong>
          <p class="mt-1 text-xs text-muted-foreground">{pct(summary.unrecovered, summary.total)}% 最终没有恢复</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader class="pb-2">
          <CardTitle class="text-sm text-muted-foreground">最高频 Provider</CardTitle>
        </CardHeader>
        <CardContent>
          <strong class="text-3xl font-semibold tracking-tight">{topProvider?.provider ?? "--"}</strong>
          <p class="mt-1 text-xs text-muted-foreground">{topProvider ? `${topProvider.count} 条失败` : "暂无失败来源"}</p>
        </CardContent>
      </Card>
    </div>

    <div class="flex flex-wrap items-center gap-3">
      <div class="grid gap-1.5">
        <span class="text-xs text-muted-foreground">Channel</span>
        <NativeSelect bind:value={selectedChannel}>
          <NativeSelectOption value="all">全部渠道</NativeSelectOption>
          {#each channels as ch}
            <NativeSelectOption value={ch}>{ch}</NativeSelectOption>
          {/each}
        </NativeSelect>
      </div>
      <div class="grid gap-1.5">
        <span class="text-xs text-muted-foreground">Provider</span>
        <NativeSelect bind:value={selectedProvider}>
          <NativeSelectOption value="all">全部 Provider</NativeSelectOption>
          {#each providers as p}
            <NativeSelectOption value={p}>{p}</NativeSelectOption>
          {/each}
        </NativeSelect>
      </div>
      <div class="grid gap-1.5">
        <span class="text-xs text-muted-foreground">State</span>
        <NativeSelect bind:value={selectedState}>
          <NativeSelectOption value="all">全部状态</NativeSelectOption>
          <NativeSelectOption value="recovered">已恢复</NativeSelectOption>
          <NativeSelectOption value="failed">未恢复</NativeSelectOption>
        </NativeSelect>
      </div>
      <div class="grid gap-1.5">
        <span class="text-xs text-muted-foreground">Kind</span>
        <NativeSelect bind:value={selectedKind}>
          <NativeSelectOption value="all">全部类型</NativeSelectOption>
          <NativeSelectOption value="request_error">请求失败</NativeSelectOption>
          <NativeSelectOption value="empty_response">空响应</NativeSelectOption>
          <NativeSelectOption value="missing_api_key">缺少密钥</NativeSelectOption>
        </NativeSelect>
      </div>
      <Button variant="outline" size="sm" class="mt-auto" onclick={resetFilters}>清空筛选</Button>
    </div>

    <div class="grid gap-6 lg:grid-cols-[260px_1fr]">
      <aside class="space-y-4">
        <Card>
          <CardHeader class="pb-2">
            <CardTitle class="text-sm">错误类型</CardTitle>
          </CardHeader>
          <CardContent class="space-y-1">
            {#each ["request_error", "empty_response", "missing_api_key"] as kind}
              {@const count = countByKind(kind as ModelErrorKind)}
              <button
                type="button"
                class="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition hover:bg-muted/60 {selectedKind === kind ? 'bg-muted' : ''}"
                onclick={() => (selectedKind = selectedKind === kind ? "all" : kind)}
              >
                <span class="text-foreground">{kindLabel(kind as ModelErrorKind)}</span>
                <Badge variant="secondary">{count}</Badge>
              </button>
            {/each}
          </CardContent>
        </Card>

        <Card>
          <CardHeader class="pb-2">
            <CardTitle class="text-sm">Provider 排名</CardTitle>
          </CardHeader>
          <CardContent class="space-y-1">
            {#if summary.byProvider.length === 0}
              <p class="text-xs text-muted-foreground">暂无 provider 失败记录。</p>
            {:else}
              {#each summary.byProvider.slice(0, 10) as row}
                <button
                  type="button"
                  class="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition hover:bg-muted/60 {selectedProvider === row.provider ? 'bg-muted' : ''}"
                  onclick={() => (selectedProvider = selectedProvider === row.provider ? "all" : row.provider)}
                >
                  <span class="text-foreground">{row.provider}</span>
                  <Badge variant="secondary">{row.count}</Badge>
                </button>
              {/each}
            {/if}
          </CardContent>
        </Card>
      </aside>

      <section class="space-y-3">
        <h2 class="text-sm font-semibold text-foreground">失败事件 <span class="font-normal text-muted-foreground">({filteredItems.length} 条匹配记录)</span></h2>

        {#if filteredItems.length === 0}
          <div class="rounded-xl border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">当前筛选条件下没有模型报错记录。</div>
        {:else}
          <div class="space-y-3">
            {#each filteredItems as item}
              <Card class={item.recovered ? "" : "border-destructive/30"}>
                <CardHeader class="pb-2">
                  <div class="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div class="flex flex-wrap items-center gap-2">
                        <CardTitle class="text-sm">{item.provider} / {item.model}</CardTitle>
                        <Badge variant={item.recovered ? "default" : "destructive"}>
                          {item.recovered ? "已恢复" : "未恢复"}
                        </Badge>
                        <Badge variant="outline">{kindLabel(item.kind)}</Badge>
                      </div>
                      <p class="mt-1 text-xs text-muted-foreground">{formatDate(item.ts)} · {item.channel} / {item.botId} / {item.chatId}</p>
                    </div>
                    <div class="flex gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline" class="text-[10px]">{item.source}</Badge>
                      <Badge variant="outline" class="text-[10px]">{item.route}</Badge>
                      {#if Number.isFinite(item.candidateIndex)}
                        <Badge variant="outline" class="text-[10px]">candidate {(item.candidateIndex ?? 0) + 1}</Badge>
                      {/if}
                    </div>
                  </div>
                </CardHeader>
                <CardContent class="space-y-3">
                  <div class="grid gap-3 sm:grid-cols-2">
                    <div class="rounded-lg border bg-muted/40 p-3">
                      <span class="text-xs font-semibold text-muted-foreground">Error Reason</span>
                      <p class="mt-1 text-sm text-foreground">{item.message}</p>
                    </div>
                    <div class="rounded-lg border bg-muted/40 p-3">
                      <span class="text-xs font-semibold text-muted-foreground">Context</span>
                      <p class="mt-1 text-xs text-foreground">API: {item.api || "-"}</p>
                      <p class="text-xs text-foreground">Base URL: {item.baseUrl || "-"}</p>
                      <p class="text-xs text-foreground">Endpoint: {item.endpointUrl || "-"}</p>
                      <p class="text-xs text-foreground">Session: {item.sessionId || "-"}</p>
                      <p class="text-xs text-foreground">Run ID: {item.runId || "-"}</p>
                    </div>
                  </div>
                  <div class="rounded-lg border bg-muted/40 px-3 py-2 text-xs {item.recovered ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}">
                    {#if item.recovered}
                      备用路径已接管：{item.finalProvider || "-"} / {item.finalModel || "-"}
                    {:else}
                      这次失败没有被备用模型恢复。
                    {/if}
                  </div>
                </CardContent>
              </Card>
            {/each}
          </div>
        {/if}
      </section>
    </div>
  {/if}
</div>
