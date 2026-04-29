<script lang="ts">
  import { onMount } from "svelte";
  import PageShell from "$lib/ui/PageShell.svelte";

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
  let summary: ModelErrorSummary = {
    total: 0,
    recovered: 0,
    unrecovered: 0,
    byKind: [],
    byProvider: [],
  };
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
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
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

<PageShell widthClass="max-w-[1500px]" gapClass="space-y-6">
  <section class="error-console">
    <header class="hero-panel">
      <div>
        <p class="eyebrow">Failure Radar</p>
        <h1>模型报错记录</h1>
        <p class="hero-copy">
          这里只记录失败模型调用，用来定位缺少密钥、空响应、上游请求失败，以及 fallback 是否兜住了这次运行。
        </p>
      </div>
      <div class="hero-actions">
        <button type="button" class="refresh-button" on:click={loadModelErrors} disabled={loading}>
          <span aria-hidden="true">↻</span>
          {loading ? "刷新中" : "刷新"}
        </button>
        {#if message}
          <span class="load-note">{message}</span>
        {/if}
      </div>
    </header>

    {#if error}
      <div class="state-card destructive">Error: {error}</div>
    {/if}

    {#if loading && items.length === 0}
      <div class="state-card">正在加载模型报错记录...</div>
    {:else}
      <div class="metric-grid">
        <article class="metric-card danger">
          <span>总失败数</span>
          <strong>{summary.total}</strong>
          <p>最近 200 条失败日志内的记录数</p>
        </article>
        <article class="metric-card success">
          <span>后来恢复</span>
          <strong>{summary.recovered}</strong>
          <p>{pct(summary.recovered, summary.total)}% 被备用模型或重试兜住</p>
        </article>
        <article class="metric-card warning">
          <span>直接失败</span>
          <strong>{summary.unrecovered}</strong>
          <p>{pct(summary.unrecovered, summary.total)}% 最终没有恢复</p>
        </article>
        <article class="metric-card neutral">
          <span>最高频 Provider</span>
          <strong>{topProvider?.provider ?? "--"}</strong>
          <p>{topProvider ? `${topProvider.count} 条失败` : "暂无失败来源"}</p>
        </article>
      </div>

      <section class="filter-panel">
        <label>
          <span>Channel</span>
          <select bind:value={selectedChannel}>
            <option value="all">全部渠道</option>
            {#each channels as channel}
              <option value={channel}>{channel}</option>
            {/each}
          </select>
        </label>
        <label>
          <span>Provider</span>
          <select bind:value={selectedProvider}>
            <option value="all">全部 Provider</option>
            {#each providers as provider}
              <option value={provider}>{provider}</option>
            {/each}
          </select>
        </label>
        <label>
          <span>State</span>
          <select bind:value={selectedState}>
            <option value="all">全部状态</option>
            <option value="recovered">已恢复</option>
            <option value="failed">未恢复</option>
          </select>
        </label>
        <label>
          <span>Kind</span>
          <select bind:value={selectedKind}>
            <option value="all">全部类型</option>
            <option value="request_error">请求失败</option>
            <option value="empty_response">空响应</option>
            <option value="missing_api_key">缺少密钥</option>
          </select>
        </label>
        <button type="button" on:click={resetFilters}>清空筛选</button>
      </section>

      <div class="split-grid">
        <aside class="panel">
          <div class="panel-heading">
            <h2>错误类型</h2>
            <p>按后端记录的 kind 字段聚合</p>
          </div>
          <div class="kind-list">
            {#each ["request_error", "empty_response", "missing_api_key"] as kind}
              {@const count = countByKind(kind as ModelErrorKind)}
              <button
                type="button"
                class:active={selectedKind === kind}
                on:click={() => (selectedKind = selectedKind === kind ? "all" : kind)}
              >
                <span>{kindLabel(kind as ModelErrorKind)}</span>
                <strong>{count}</strong>
              </button>
            {/each}
          </div>

          <div class="panel-heading provider-heading">
            <h2>Provider 排名</h2>
            <p>定位哪个上游最常失败</p>
          </div>
          <div class="provider-rank">
            {#if summary.byProvider.length === 0}
              <p class="empty-copy">暂无 provider 失败记录。</p>
            {:else}
              {#each summary.byProvider.slice(0, 10) as row}
                <button
                  type="button"
                  class:active={selectedProvider === row.provider}
                  on:click={() => (selectedProvider = selectedProvider === row.provider ? "all" : row.provider)}
                >
                  <span>{row.provider}</span>
                  <strong>{row.count}</strong>
                </button>
              {/each}
            {/if}
          </div>
        </aside>

        <section class="panel record-panel">
          <div class="panel-heading">
            <h2>失败事件</h2>
            <p>{filteredItems.length} 条匹配记录</p>
          </div>

          {#if filteredItems.length === 0}
            <div class="empty-state">当前筛选条件下没有模型报错记录。</div>
          {:else}
            <div class="records">
              {#each filteredItems as item}
                <article class={`record-card ${item.recovered ? "recovered" : "failed"}`}>
                  <div class="record-main">
                    <div>
                      <div class="record-title">
                        <h3>{item.provider} / {item.model}</h3>
                        <span class={`state-pill ${item.recovered ? "ok" : "bad"}`}>
                          {item.recovered ? "已恢复" : "未恢复"}
                        </span>
                        <span class="kind-pill">{kindLabel(item.kind)}</span>
                      </div>
                      <p>{formatDate(item.ts)} · {item.channel} / {item.botId} / {item.chatId}</p>
                    </div>
                    <div class="record-meta">
                      <span>{item.source}</span>
                      <span>{item.route}</span>
                      {#if Number.isFinite(item.candidateIndex)}
                        <span>candidate {(item.candidateIndex ?? 0) + 1}</span>
                      {/if}
                    </div>
                  </div>

                  <div class="record-detail-grid">
                    <div class="detail-box reason">
                      <span>Error Reason</span>
                      <p>{item.message}</p>
                    </div>
                    <div class="detail-box">
                      <span>Context</span>
                      <p>API: {item.api || "-"}</p>
                      <p>Base URL: {item.baseUrl || "-"}</p>
                      <p>Endpoint: {item.endpointUrl || "-"}</p>
                      <p>Session: {item.sessionId || "-"}</p>
                      <p>Run ID: {item.runId || "-"}</p>
                    </div>
                  </div>

                  <div class="recovery-line">
                    {#if item.recovered}
                      备用路径已接管：{item.finalProvider || "-"} / {item.finalModel || "-"}
                    {:else}
                      这次失败没有被备用模型恢复。
                    {/if}
                  </div>
                </article>
              {/each}
            </div>
          {/if}
        </section>
      </div>
    {/if}
  </section>
</PageShell>
