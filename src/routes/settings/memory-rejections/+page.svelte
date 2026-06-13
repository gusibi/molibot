<script lang="ts">
  import { onMount } from "svelte";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { locale } from "$lib/ui/i18n";

  interface RejectionItem {
    createdAt: string;
    action: "add" | "update";
    channel: string;
    externalUserId: string;
    reason: string;
    content: string;
    layer?: string;
    tags: string[];
  }

  interface Counts {
    total: number;
    add: number;
    update: number;
  }

  const COPY = {
    "zh-CN": {
      eyebrow: "记忆治理",
      title: "记忆拒绝记录",
      desc: "审查哪些记忆写入被阻止及其原因。",
      placeholderSearch: "搜索原因或内容...",
      btnRefresh: "刷新",
      loading: "正在加载记忆拒绝记录...",
      recordsTitle: "拒绝记录",
      recordsDesc: "拦截的写入：总数：{total} | 新增：{add} | 更新：{update}",
      noRecords: "未找到被拦截的记忆写入。",
      reasonLabel: "原因：",
      emptyContent: "(空)",
      tagsLabel: "标签：",
      failedLoad: "加载记忆拒绝记录失败",
      loadedMsg: "已加载 {count} 条被拒绝的记忆写入。"
    },
    "en-US": {
      eyebrow: "Memory Governance",
      title: "Memory Rejections",
      desc: "Review which memory writes were blocked and why.",
      placeholderSearch: "Search reason or content...",
      btnRefresh: "Refresh",
      loading: "Loading memory rejections...",
      recordsTitle: "Rejection Records",
      recordsDesc: "Blocked writes: Total: {total} | Add: {add} | Update: {update}",
      noRecords: "No blocked memory writes found.",
      reasonLabel: "Reason: ",
      emptyContent: "(empty)",
      tagsLabel: "Tags: ",
      failedLoad: "Failed to load memory rejections",
      loadedMsg: "Loaded {count} rejected memory write(s)."
    }
  } as const;

  let loading = true;
  let error = "";
  let message = "";
  let diagnostics: string[] = [];
  let items: RejectionItem[] = [];
  let counts: Counts = { total: 0, add: 0, update: 0 };
  let searchText = "";

  $: copy = COPY[$locale] ?? COPY["en-US"];

  function formatDate(value: string): string {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString($locale === "zh-CN" ? "zh-CN" : "en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    });
  }

  function filteredItems(): RejectionItem[] {
    const query = searchText.trim().toLowerCase();
    if (!query) return items;
    return items.filter((item) =>
      [item.reason, item.content, item.channel, item.externalUserId, item.layer ?? "", item.tags.join(",")]
        .join("\n")
        .toLowerCase()
        .includes(query)
    );
  }

  async function loadRejections(): Promise<void> {
    loading = true;
    error = "";
    message = "";
    try {
      const res = await fetch("/api/settings/memory-rejections");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || copy.failedLoad);
      items = Array.isArray(data.items) ? data.items : [];
      diagnostics = Array.isArray(data.diagnostics) ? data.diagnostics : [];
      counts = {
        total: Number(data.counts?.total ?? 0),
        add: Number(data.counts?.add ?? 0),
        update: Number(data.counts?.update ?? 0)
      };
      message = copy.loadedMsg.replace("{count}", String(items.length));
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  onMount(loadRejections);
</script>

<div class="channel-page">
  <header class="channel-hero">
    <span class="channel-badge">{copy.eyebrow}</span>
    <h1 class="channel-hero-title">{copy.title}</h1>
    <p class="channel-hero-desc">{copy.desc}</p>
  </header>

  <div class="channel-card">
    <div class="channel-card-body">
      <div class="channel-field-row" style="grid-template-columns: 2fr 1fr; gap: 0.75rem; align-items: center;">
        <div class="channel-field">
          <Input bind:value={searchText} placeholder={copy.placeholderSearch} />
        </div>
        <Button variant="outline" onclick={loadRejections}>{copy.btnRefresh}</Button>
      </div>
    </div>
  </div>

  {#if message || error}
    <div class="channel-card" style="padding: 1rem;">
      <div class="channel-card-body" style="gap: 0.5rem;">
        {#if message}
          <div class="settings-footbar-ok">{message}</div>
        {/if}
        {#if error}
          <div class="settings-footbar-error">{error}</div>
        {/if}
      </div>
    </div>
  {/if}

  {#if loading}
    <div class="channel-loading">{copy.loading}</div>
  {:else}
    <div class="channel-card">
      <div class="channel-card-header">
        <div>
          <h2 class="channel-card-title">{copy.recordsTitle}</h2>
          <p class="channel-card-desc">
            {copy.recordsDesc.replace("{total}", String(counts.total)).replace("{add}", String(counts.add)).replace("{update}", String(counts.update))}
          </p>
        </div>
      </div>
      <div class="channel-card-body" style="gap: 1.5rem;">
        {#if diagnostics.length > 0}
          <div class="channel-hint" style="background: var(--muted); padding: 0.75rem; border-radius: 6px; white-space: pre-wrap;">
            {diagnostics.join("\n")}
          </div>
        {/if}
        
        {#if filteredItems().length === 0}
          <div class="channel-hint">
            {copy.noRecords}
          </div>
        {:else}
          {#each filteredItems() as item}
            <div class="channel-card" style="padding: 1rem; background: var(--muted-soft, color-mix(in oklab, var(--muted) 4%, transparent)); border-color: var(--border);">
              <div class="channel-card-body">
                <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem;">
                  <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                    <Badge variant="destructive">{item.action}</Badge>
                    <span class="channel-sidebar-btn-name">{item.channel}:{item.externalUserId}</span>
                    {#if item.layer}
                      <Badge variant="outline">{item.layer}</Badge>
                    {/if}
                  </div>
                  <span class="channel-sidebar-btn-id">{formatDate(item.createdAt)}</span>
                </div>

                <div style="color: var(--destructive); font-size: 0.875rem; font-weight: 500;">
                  {copy.reasonLabel}{item.reason}
                </div>

                <div class="channel-hint font-mono" style="background: var(--muted); padding: 0.75rem; border-radius: 6px; white-space: pre-wrap; color: var(--foreground);">
                  {item.content || copy.emptyContent}
                </div>

                {#if item.tags.length > 0}
                  <div class="channel-sidebar-btn-id">
                    {copy.tagsLabel}{item.tags.join(", ")}
                  </div>
                {/if}
              </div>
            </div>
          {/each}
        {/if}
      </div>
    </div>
  {/if}
</div>
