<script lang="ts">
  import { onMount } from "svelte";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { IosSwitch } from "$lib/components/ui/ios-switch";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { Textarea } from "$lib/components/ui/textarea";
  import { locale } from "$lib/ui/i18n";

  interface MemoryItem {
    id: string;
    channel: string;
    externalUserId: string;
    content: string;
    tags: string[];
    layer: "long_term" | "daily";
    hasConflict?: boolean;
    expiresAt?: string;
    sourceSessionId?: string;
    updatedAt: string;
  }

  const COPY = {
    "zh-CN": {
      eyebrow: "记忆操作",
      pluginEnabled: "插件已启用",
      pluginDisabled: "插件已禁用",
      activeBackend: "当前后端：",
      title: "记忆管理",
      desc: "搜索、写入、编辑和删除运行时记忆。设置页面默认查询全部作用域，以便在一个地方检查所有内容。冲突的内容会被标记供人工审查。",
      labelChannel: "渠道",
      labelUserId: "用户 ID",
      labelQuery: "搜索内容",
      placeholderSearch: "搜索记忆内容...",
      labelAllScopes: "全部作用域",
      btnSearch: "搜索",
      btnSync: "同步文件",
      btnSyncing: "同步中...",
      btnFlush: "写入",
      btnFlushing: "写入中...",
      btnDedup: "去重",
      btnDeduping: "去重中...",
      pluginLink: "在插件设置中切换记忆后端配置 →",
      loading: "正在加载记忆...",
      recordsTitle: "记忆记录",
      recordsDesc: "个已找到的记录",
      noRecords: "未找到记忆。如果你期望有导入的记忆，请切换作用域过滤器或运行“同步文件”。",
      btnSave: "保存",
      btnDelete: "删除",
      syncSuccess: "外部记忆同步完成。",
      memoryUpdated: "记忆已更新。",
      failedLoadSettings: "加载记忆设置失败",
      failedLoadMemory: "加载记忆失败",
      syncFailed: "同步失败",
      flushFailed: "写入失败",
      dedupFailed: "去重失败",
      deleteFailed: "删除失败",
      updateFailed: "更新失败",
      syncResult: "同步扫描了 {count} 个文件，导入了 {imported} 条",
      flushResult: "写入完成：扫描了 {scanned} 条，新增了 {added} 条。",
      dedupResult: "去重完成：扫描了 {scanned} 条，删除了 {removed} 条，影响作用域数 {affected}。"
    },
    "en-US": {
      eyebrow: "Memory Operations",
      pluginEnabled: "plugin enabled",
      pluginDisabled: "plugin disabled",
      activeBackend: "active backend: ",
      title: "Memory Management",
      desc: "Search, flush, edit and delete runtime memories. Settings page defaults to all scopes so you can inspect everything in one place. Conflicts are marked for review.",
      labelChannel: "Channel",
      labelUserId: "User ID",
      labelQuery: "Query",
      placeholderSearch: "Search memory content...",
      labelAllScopes: "All Scopes",
      btnSearch: "Search",
      btnSync: "Sync Files",
      btnSyncing: "Syncing...",
      btnFlush: "Flush",
      btnFlushing: "Flushing...",
      btnDedup: "Deduplicate",
      btnDeduping: "Deduping...",
      pluginLink: "Switch memory configurations in plugin settings →",
      loading: "Loading memory...",
      recordsTitle: "Memory Records",
      recordsDesc: "records found",
      noRecords: "No memory found. Toggle scope filters or run Sync Files if you expect imported memory.",
      btnSave: "Save",
      btnDelete: "Delete",
      syncSuccess: "External memory sync completed.",
      memoryUpdated: "Memory updated.",
      failedLoadSettings: "Failed to load memory settings",
      failedLoadMemory: "Failed to load memory",
      syncFailed: "Sync failed",
      flushFailed: "Flush failed",
      dedupFailed: "Compact failed",
      deleteFailed: "Delete failed",
      updateFailed: "Update failed",
      syncResult: "sync scanned {count} file(s), imported {imported}",
      flushResult: "Flush done: scanned {scanned}, added {added}.",
      dedupResult: "Dedup completed: scanned {scanned}, removed {removed}, affected scopes {affected}."
    }
  } as const;

  let loading = true;
  let flushing = false;
  let compacting = false;
  let syncing = false;
  let searchText = "";
  let allScopes = true;
  let message = "";
  let error = "";
  let syncInfo = "";
  let items: MemoryItem[] = [];
  let channel = "";
  let userId = "";
  let memoryEnabled = false;
  let activeBackend = "json-file";

  $: copy = COPY[$locale] ?? COPY["en-US"];

  async function loadRuntimeMemorySettings(): Promise<void> {
    const res = await fetch("/api/settings");
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || copy.failedLoadSettings);
    memoryEnabled = Boolean(data.settings?.plugins?.memory?.enabled);
    activeBackend = String(
      (data.settings?.plugins?.memory as any)?.backend ?? (data.settings?.plugins?.memory as any)?.core ?? "json-file",
    );
  }

  async function listMemory(): Promise<void> {
    loading = true;
    error = "";
    try {
      const res = await fetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: searchText.trim() ? "search" : "list",
          channel,
          userId,
          allScopes,
          query: searchText.trim(),
          limit: 200,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || copy.failedLoadMemory);
      items = Array.isArray(data.items) ? data.items : [];
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  async function syncMemory(): Promise<void> {
    syncing = true;
    message = "";
    error = "";
    try {
      const res = await fetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync" }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || copy.syncFailed);
      const count = Number(data.sync?.scannedFiles ?? 0);
      const imported = Number(data.sync?.importedCount ?? 0);
      syncInfo = copy.syncResult.replace("{count}", String(count)).replace("{imported}", String(imported));
      message = copy.syncSuccess;
      await listMemory();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      syncing = false;
    }
  }

  async function flushMemory(): Promise<void> {
    flushing = true;
    message = "";
    error = "";
    try {
      const res = await fetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "flush", channel, userId }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || copy.flushFailed);
      const scanned = data.result?.scannedMessages ?? 0;
      const added = data.result?.addedCount ?? 0;
      message = copy.flushResult.replace("{scanned}", String(scanned)).replace("{added}", String(added));
      await listMemory();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      flushing = false;
    }
  }

  async function compactMemory(): Promise<void> {
    compacting = true;
    message = "";
    error = "";
    try {
      const res = await fetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "compact", channel, userId, allScopes }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || copy.dedupFailed);
      const scanned = data.result?.scannedCount ?? 0;
      const removed = data.result?.removedCount ?? 0;
      const affected = data.result?.scopesAffected ?? 0;
      message = copy.dedupResult.replace("{scanned}", String(scanned)).replace("{removed}", String(removed)).replace("{affected}", String(affected));
      await listMemory();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      compacting = false;
    }
  }

  async function removeItem(item: MemoryItem): Promise<void> {
    error = "";
    try {
      const res = await fetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete",
          channel: item.channel,
          userId: item.externalUserId,
          id: item.id,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || copy.deleteFailed);
      items = items.filter((row) => row.id !== item.id);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  async function saveItem(item: MemoryItem): Promise<void> {
    error = "";
    try {
      const res = await fetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update",
          channel: item.channel,
          userId: item.externalUserId,
          id: item.id,
          content: item.content,
          tags: item.tags,
          expiresAt: item.expiresAt || null,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || copy.updateFailed);
      if (data.item) {
        items = items.map((row) => (row.id === item.id ? data.item : row));
      }
      message = copy.memoryUpdated;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  onMount(async () => {
    try {
      await loadRuntimeMemorySettings();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    await listMemory();
  });
</script>

<div class="channel-page">
  <header class="channel-hero">
    <span class="channel-badge">{copy.eyebrow}</span>
    <span class="channel-badge">{copy.activeBackend}{activeBackend}</span>
    <h1 class="channel-hero-title">{copy.title}</h1>
    <p class="channel-hero-desc">{copy.desc}</p>
  </header>

  <div class="channel-card">
    <div class="channel-card-body">
      <div class="channel-field-row" style="grid-template-columns: 1fr 1.5fr 2fr 1.5fr; gap: 0.75rem; align-items: center;">
        <div class="channel-field">
          <Label for="mem-channel">{copy.labelChannel}</Label>
          <Input id="mem-channel" bind:value={channel} placeholder="channel" />
        </div>
        <div class="channel-field">
          <Label for="mem-userId">{copy.labelUserId}</Label>
          <Input id="mem-userId" bind:value={userId} placeholder="userId" />
        </div>
        <div class="channel-field">
          <Label for="mem-search">{copy.labelQuery}</Label>
          <Input id="mem-search" bind:value={searchText} placeholder={copy.placeholderSearch} />
        </div>
        <div class="channel-field">
          <Label for="mem-all-scopes">{copy.labelAllScopes}</Label>
          <div style="display: flex; align-items: center; height: 2.25rem;">
            <IosSwitch id="mem-all-scopes" bind:checked={allScopes} />
          </div>
        </div>
      </div>

      <div class="channel-field-row" style="grid-template-columns: repeat(4, 1fr); gap: 0.75rem; margin-top: 0.5rem;">
        <Button variant="outline" onclick={listMemory}>{copy.btnSearch}</Button>
        <Button variant="outline" onclick={syncMemory} disabled={syncing}>
          {syncing ? copy.btnSyncing : copy.btnSync}
        </Button>
        <Button variant="secondary" onclick={flushMemory} disabled={flushing}>
          {flushing ? copy.btnFlushing : copy.btnFlush}
        </Button>
        <Button variant="outline" onclick={compactMemory} disabled={compacting}>
          {compacting ? copy.btnDeduping : copy.btnDedup}
        </Button>
      </div>

      <div class="channel-hint" style="margin-top: 0.5rem;">
        <a class="text-primary hover:underline font-medium" href="/settings/plugins">
          {copy.pluginLink}
        </a>
      </div>
    </div>
  </div>

  {#if message || syncInfo || error}
    <div class="channel-card" style="padding: 1rem;">
      <div class="channel-card-body" style="gap: 0.5rem;">
        {#if message}
          <div class="settings-footbar-ok">{message}</div>
        {/if}
        {#if syncInfo}
          <div class="channel-hint">{syncInfo}</div>
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
          <p class="channel-card-desc">{items.length} {copy.recordsDesc}</p>
        </div>
      </div>
      <div class="channel-card-body" style="gap: 1.5rem;">
        {#if items.length === 0}
          <div class="channel-hint">{copy.noRecords}</div>
        {:else}
          {#each items as item (item.id)}
            <div class="channel-card" style="padding: 1rem; background: var(--muted-soft, color-mix(in oklab, var(--muted) 4%, transparent)); border-color: var(--border);">
              <div class="channel-card-body">
                <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem;">
                  <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                    <Badge variant="outline" class="text-[10px]">source {item.channel}:{item.externalUserId}</Badge>
                    <Badge variant="outline" class="text-[10px]">{item.layer}</Badge>
                    {#if item.sourceSessionId}
                      <Badge variant="outline" class="text-[10px]">session {item.sourceSessionId}</Badge>
                    {/if}
                    {#if item.hasConflict}
                      <Badge variant="secondary" class="border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400">conflict</Badge>
                    {/if}
                    {#if item.expiresAt}
                      <Badge variant="default" class="text-[10px]">expires {item.expiresAt.slice(0, 10)}</Badge>
                    {/if}
                  </div>
                  <span class="channel-sidebar-btn-id">updated {item.updatedAt.replace("T", " ").slice(0, 19)}</span>
                </div>

                <Textarea class="channel-textarea" style="min-height: 80px;" bind:value={item.content} />

                <div class="channel-field-row" style="grid-template-columns: 1fr 1.5fr auto auto; gap: 0.5rem; align-items: center;">
                  <Input
                    value={item.tags.join(",")}
                    onchange={(e) => {
                      const value = (e.currentTarget as HTMLInputElement).value;
                      item.tags = value.split(",").map((v) => v.trim()).filter(Boolean);
                    }}
                    placeholder="tag1,tag2"
                  />
                  <Input bind:value={item.expiresAt} placeholder="expiresAt (ISO8601)" />
                  <Button variant="outline" size="sm" onclick={() => saveItem(item)}>{copy.btnSave}</Button>
                  <Button variant="destructive" size="sm" onclick={() => removeItem(item)}>{copy.btnDelete}</Button>
                </div>
              </div>
            </div>
          {/each}
        {/if}
      </div>
    </div>
  {/if}
</div>
