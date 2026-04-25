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

<style>
  .error-console {
    color: var(--foreground);
  }

  .hero-panel,
  .metric-card,
  .filter-panel,
  .panel,
  .state-card {
    border: 1px solid color-mix(in oklab, var(--border) 78%, transparent);
    background: linear-gradient(180deg, color-mix(in oklab, var(--card) 94%, white 3%), var(--card));
    box-shadow: var(--shadow);
  }

  .hero-panel {
    display: flex;
    justify-content: space-between;
    gap: 24px;
    padding: 28px;
    border-radius: 24px;
  }

  .eyebrow {
    margin: 0 0 10px;
    color: var(--destructive);
    font-size: 0.78rem;
    font-weight: 900;
    letter-spacing: 0.16em;
    text-transform: uppercase;
  }

  h1,
  h2,
  h3 {
    margin: 0;
    letter-spacing: 0;
  }

  h1 {
    font-size: clamp(2rem, 4vw, 4.2rem);
    line-height: 0.96;
    font-weight: 950;
  }

  h2 {
    font-size: 1.05rem;
    font-weight: 850;
  }

  h3 {
    font-size: 1rem;
    font-weight: 850;
  }

  .hero-copy,
  .metric-card p,
  .panel-heading p,
  .empty-copy,
  .record-main p {
    color: var(--muted-foreground);
  }

  .hero-copy {
    max-width: 760px;
    margin: 14px 0 0;
    font-size: 0.95rem;
    line-height: 1.7;
  }

  .hero-actions {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 10px;
  }

  .refresh-button,
  .filter-panel button,
  .kind-list button,
  .provider-rank button {
    cursor: pointer;
    border: 1px solid var(--border);
    color: var(--foreground);
    font-weight: 800;
    transition: background-color 0.16s ease, border-color 0.16s ease, transform 0.16s ease;
  }

  .refresh-button {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    border-radius: 12px;
    background: color-mix(in oklab, var(--muted) 68%, transparent);
    padding: 10px 14px;
  }

  .load-note {
    color: var(--muted-foreground);
    font-size: 0.78rem;
    font-weight: 700;
  }

  .metric-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 16px;
    margin-top: 18px;
  }

  .metric-card {
    min-height: 142px;
    padding: 22px;
    border-radius: 20px;
    border-top: 4px solid var(--border);
  }

  .metric-card.danger {
    border-top-color: var(--destructive);
  }

  .metric-card.success {
    border-top-color: #22c55e;
  }

  .metric-card.warning {
    border-top-color: #f59e0b;
  }

  .metric-card.neutral {
    border-top-color: #64748b;
  }

  .metric-card span {
    color: var(--muted-foreground);
    font-size: 0.78rem;
    font-weight: 900;
    text-transform: uppercase;
  }

  .metric-card strong {
    display: block;
    margin-top: 20px;
    font-size: clamp(2rem, 3vw, 3rem);
    line-height: 0.95;
    font-weight: 950;
  }

  .filter-panel {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr)) auto;
    gap: 14px;
    align-items: end;
    margin-top: 18px;
    padding: 18px;
    border-radius: 18px;
  }

  .filter-panel label {
    display: grid;
    gap: 7px;
  }

  .filter-panel label span {
    color: var(--muted-foreground);
    font-size: 0.76rem;
    font-weight: 850;
    text-transform: uppercase;
  }

  select {
    min-height: 42px;
    border-radius: 12px;
    border: 1px solid var(--input);
    background: var(--card);
    color: var(--foreground);
    padding: 0 12px;
    font-weight: 700;
  }

  .filter-panel button {
    min-height: 42px;
    border-radius: 12px;
    background: color-mix(in oklab, var(--muted) 64%, transparent);
    padding: 0 14px;
  }

  .split-grid {
    display: grid;
    grid-template-columns: 330px minmax(0, 1fr);
    gap: 16px;
    margin-top: 16px;
  }

  .panel {
    border-radius: 22px;
    padding: 22px;
  }

  .panel-heading {
    margin-bottom: 16px;
  }

  .panel-heading p {
    margin: 6px 0 0;
    font-size: 0.84rem;
  }

  .provider-heading {
    margin-top: 26px;
  }

  .kind-list,
  .provider-rank,
  .records {
    display: grid;
    gap: 10px;
  }

  .kind-list button,
  .provider-rank button {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
    border-radius: 14px;
    background: color-mix(in oklab, var(--muted) 38%, transparent);
    padding: 12px 14px;
    text-align: left;
  }

  .kind-list button.active,
  .provider-rank button.active {
    border-color: color-mix(in oklab, var(--destructive) 44%, var(--border));
    background: color-mix(in oklab, var(--destructive) 12%, var(--card));
  }

  .record-card {
    border: 1px solid var(--border);
    border-left-width: 4px;
    border-radius: 18px;
    background: color-mix(in oklab, var(--card) 82%, transparent);
    padding: 18px;
  }

  .record-card.recovered {
    border-left-color: #22c55e;
  }

  .record-card.failed {
    border-left-color: var(--destructive);
  }

  .record-main,
  .record-title,
  .record-meta {
    display: flex;
    align-items: flex-start;
    gap: 10px;
  }

  .record-main {
    justify-content: space-between;
  }

  .record-title {
    align-items: center;
    flex-wrap: wrap;
  }

  .record-main p {
    margin: 8px 0 0;
    font-size: 0.82rem;
  }

  .record-meta {
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .record-meta span,
  .state-pill,
  .kind-pill {
    border-radius: 999px;
    border: 1px solid var(--border);
    padding: 4px 8px;
    color: var(--muted-foreground);
    font-size: 0.72rem;
    font-weight: 850;
  }

  .state-pill.ok {
    color: #22c55e;
    border-color: color-mix(in oklab, #22c55e 36%, var(--border));
  }

  .state-pill.bad {
    color: var(--destructive);
    border-color: color-mix(in oklab, var(--destructive) 36%, var(--border));
  }

  .record-detail-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) minmax(0, 0.8fr);
    gap: 12px;
    margin-top: 16px;
  }

  .detail-box,
  .recovery-line {
    border: 1px solid color-mix(in oklab, var(--border) 72%, transparent);
    border-radius: 14px;
    background: color-mix(in oklab, var(--background) 34%, transparent);
    padding: 13px;
  }

  .detail-box span {
    color: var(--muted-foreground);
    font-size: 0.72rem;
    font-weight: 900;
    text-transform: uppercase;
  }

  .detail-box p {
    margin: 7px 0 0;
    color: var(--foreground);
    font-size: 0.86rem;
    line-height: 1.55;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }

  .recovery-line {
    margin-top: 12px;
    color: var(--muted-foreground);
    font-size: 0.86rem;
    font-weight: 750;
  }

  .state-card,
  .empty-state {
    margin-top: 18px;
    border-radius: 18px;
    padding: 22px;
    color: var(--muted-foreground);
    font-weight: 800;
  }

  .state-card.destructive {
    color: var(--destructive);
    border-color: color-mix(in oklab, var(--destructive) 42%, var(--border));
  }

  .empty-state {
    border: 1px solid var(--border);
    background: color-mix(in oklab, var(--muted) 40%, transparent);
  }

  @media (max-width: 1100px) {
    .hero-panel {
      flex-direction: column;
    }

    .hero-actions {
      align-items: stretch;
    }

    .metric-grid,
    .filter-panel {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .split-grid,
    .record-detail-grid {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 720px) {
    .hero-panel,
    .panel,
    .metric-card {
      padding: 18px;
      border-radius: 18px;
    }

    .metric-grid,
    .filter-panel {
      grid-template-columns: 1fr;
    }

    .record-main {
      flex-direction: column;
    }
  }
</style>
