<script lang="ts">
  import { onMount } from "svelte";
  import Alert from "$lib/ui/Alert.svelte";
  import Button from "$lib/ui/Button.svelte";
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
  let summary: ModelErrorSummary = { total: 0, recovered: 0, unrecovered: 0, byKind: [], byProvider: [] };
  let selectedChannel = "all";
  let selectedProvider = "all";
  let selectedState = "all";

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
      message = `Loaded ${items.length} model error record(s).`;
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
      hour12: false
    });
  }

  function stateLabel(item: ModelErrorRecord): string {
    if (item.recovered) return "已恢复";
    return "未恢复";
  }

  function stateClass(item: ModelErrorRecord): string {
    return item.recovered
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
      : "border-rose-500/40 bg-rose-500/10 text-rose-300";
  }

  function kindLabel(kind: ModelErrorKind): string {
    if (kind === "missing_api_key") return "缺少密钥";
    if (kind === "empty_response") return "空响应";
    return "请求失败";
  }

  $: channels = Array.from(new Set(items.map((item) => item.channel))).sort();
  $: providers = Array.from(new Set(items.map((item) => item.provider))).sort();
  $: filteredItems = items.filter((item) => {
    if (selectedChannel !== "all" && item.channel !== selectedChannel) return false;
    if (selectedProvider !== "all" && item.provider !== selectedProvider) return false;
    if (selectedState === "recovered" && !item.recovered) return false;
    if (selectedState === "failed" && item.recovered) return false;
    return true;
  });
</script>

<PageShell widthClass="max-w-6xl" gapClass="space-y-6">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <div>
      <h1 class="text-2xl font-semibold">Model Error Logs</h1>
      <p class="text-sm text-slate-400">
        这里只记录模型调用失败，不记录正常请求。用来排查主模型失败、切备用模型、空响应和缺少密钥这类问题。
      </p>
    </div>
    <Button variant="outline" size="md" on:click={loadModelErrors}>Refresh</Button>
  </div>

  {#if message}
    <Alert>{message}</Alert>
  {/if}
  {#if error}
    <Alert variant="destructive">{error}</Alert>
  {/if}

  {#if loading}
    <div class="rounded-xl border border-white/15 bg-[#2b2b2b] px-4 py-3 text-sm text-slate-300">
      Loading model error logs...
    </div>
  {:else}
    <section class="grid gap-3 rounded-xl border border-white/15 bg-[#2b2b2b] p-4 text-sm text-slate-300 sm:grid-cols-3">
      <div><span class="text-slate-400">总失败数:</span> {summary.total}</div>
      <div><span class="text-slate-400">后来恢复:</span> {summary.recovered}</div>
      <div><span class="text-slate-400">直接失败:</span> {summary.unrecovered}</div>
    </section>

    <section class="grid gap-3 rounded-xl border border-white/15 bg-[#2b2b2b] p-4 text-sm text-slate-300 md:grid-cols-3">
      <label class="space-y-1">
        <span class="text-xs uppercase tracking-wide text-slate-400">Channel</span>
        <select class="w-full rounded-lg border border-white/10 bg-black/10 px-3 py-2" bind:value={selectedChannel}>
          <option value="all">All</option>
          {#each channels as channel}
            <option value={channel}>{channel}</option>
          {/each}
        </select>
      </label>
      <label class="space-y-1">
        <span class="text-xs uppercase tracking-wide text-slate-400">Provider</span>
        <select class="w-full rounded-lg border border-white/10 bg-black/10 px-3 py-2" bind:value={selectedProvider}>
          <option value="all">All</option>
          {#each providers as provider}
            <option value={provider}>{provider}</option>
          {/each}
        </select>
      </label>
      <label class="space-y-1">
        <span class="text-xs uppercase tracking-wide text-slate-400">State</span>
        <select class="w-full rounded-lg border border-white/10 bg-black/10 px-3 py-2" bind:value={selectedState}>
          <option value="all">All</option>
          <option value="recovered">Recovered</option>
          <option value="failed">Failed</option>
        </select>
      </label>
    </section>

    {#if filteredItems.length === 0}
      <div class="rounded-xl border border-white/15 bg-[#2b2b2b] px-4 py-3 text-sm text-slate-300">
        No model error logs found for the current filter.
      </div>
    {:else}
      <section class="space-y-4">
        {#each filteredItems as item}
          <article class="rounded-2xl border border-white/15 bg-[#2b2b2b] p-5 text-sm text-slate-200">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="space-y-1">
                <div class="flex flex-wrap items-center gap-2">
                  <h2 class="text-base font-semibold">{item.provider} / {item.model}</h2>
                  <span class={`rounded-full border px-2 py-0.5 text-xs ${stateClass(item)}`}>
                    {stateLabel(item)}
                  </span>
                  <span class="rounded-full border border-white/10 bg-black/10 px-2 py-0.5 text-xs text-slate-300">
                    {kindLabel(item.kind)}
                  </span>
                </div>
                <p class="text-xs text-slate-400">
                  {formatDate(item.ts)} · {item.channel} / {item.botId} / {item.chatId}
                </p>
              </div>
              <div class="text-right text-xs text-slate-400">
                <div>source: {item.source}</div>
                <div>route: {item.route}</div>
                {#if Number.isFinite(item.candidateIndex)}
                  <div>candidate: {(item.candidateIndex ?? 0) + 1}</div>
                {/if}
              </div>
            </div>

            <div class="mt-4 grid gap-3 sm:grid-cols-2">
              <div class="rounded-xl border border-white/10 bg-black/10 p-3">
                <p class="text-xs uppercase tracking-wide text-slate-400">Error Reason</p>
                <p class="mt-2 whitespace-pre-wrap text-sm text-slate-200">{item.message}</p>
              </div>
              <div class="rounded-xl border border-white/10 bg-black/10 p-3">
                <p class="text-xs uppercase tracking-wide text-slate-400">Context</p>
                <div class="mt-2 space-y-1 text-sm text-slate-300">
                  <p>API: {item.api || "-"}</p>
                  <p>Base URL: {item.baseUrl || "-"}</p>
                  <p>Session: {item.sessionId || "-"}</p>
                  <p>Run ID: {item.runId || "-"}</p>
                </div>
              </div>
            </div>

            <div class="mt-4 rounded-xl border border-white/10 bg-black/10 p-3 text-sm text-slate-300">
              {#if item.recovered}
                <p>
                  这次失败后来被备用模型接住了。
                  {#if item.finalProvider || item.finalModel}
                    最终使用的是 {item.finalProvider || "-"} / {item.finalModel || "-"}。
                  {/if}
                </p>
              {:else}
                <p>这次失败没有被备用模型恢复。</p>
              {/if}
            </div>
          </article>
        {/each}
      </section>
    {/if}
  {/if}
</PageShell>
