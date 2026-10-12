<script lang="ts">
  import AgentFileThumbnail from "./AgentFileThumbnail.svelte";
  import { groupAgentFiles, type AgentFileType } from "./agentFileGroups";
  import { CHANNEL_LOGOS, CONVERSATION_SOURCE_ICONS } from "./activityIcons";
  import { untrack } from "svelte";
  import Button from "../components/ui/Button.svelte";
  import ArtifactPanel from "../artifacts/ArtifactPanel.svelte";
  import { searchDesktopConversations, listDesktopSessionFiles } from "../api";
  import type { DesktopConversationSearchItem, DesktopSessionFile } from "@molibot/desktop-contract";
  import type { Translation } from "../i18n";
  let { endpoint, agentId, locale, copy, theme, formatTime, onClose, onConversation }: {
    endpoint: string; agentId: string; locale: string; copy: Translation; theme: "light" | "dark";
    formatTime: (value: string) => string; onClose: () => void; onConversation: (item: DesktopConversationSearchItem) => void;
  } = $props();
  type FileRow = { conversation: DesktopConversationSearchItem; file: DesktopSessionFile };
  let rows = $state<FileRow[]>([]);
  let selected = $state<FileRow | null>(null);
  let loading = $state(false);
  let error = $state("");
  let cursor = $state<string | null>(null);
  let hasMore = $state(false);
  let failed = $state<DesktopConversationSearchItem[]>([]);
  const groups = $derived(groupAgentFiles(rows));
  const typeLabels = $derived<Record<AgentFileType, string>>(locale === "zh-CN" ? { image: "图片", video: "视频", audio: "音频", code: "代码", text: "文本", document: "文档", other: "其他文件" } : { image: "Images", video: "Videos", audio: "Audio", code: "Code", text: "Text", document: "Documents", other: "Other files" });
  const originLabels = $derived(locale === "zh-CN" ? { generated: "生成内容", uploaded: "上传附件", unknown: "来源待确认" } : { generated: "Generated content", uploaded: "Uploaded attachments", unknown: "Unconfirmed origin" });
  const channelLabels = $derived<Record<string, string>>({ desktop: "Desktop", web: "Web", feishu: locale === "zh-CN" ? "飞书" : "Feishu", telegram: "Telegram", qq: "QQ", weixin: locale === "zh-CN" ? "微信" : "Weixin", project: locale === "zh-CN" ? "项目" : "Project" });
  let generation = 0;
  const touches = { written: new Set<string>(), all: new Set<string>() };

  async function loadFiles(conversations: DesktopConversationSearchItem[], request: number, target: string): Promise<void> {
    const results: PromiseSettledResult<{ conversation: DesktopConversationSearchItem; files: DesktopSessionFile[] }>[] = [];
    for (let start = 0; start < conversations.length; start += 4) {
      if (request !== generation) return;
      results.push(...await Promise.allSettled(conversations.slice(start, start + 4).map(async conversation => ({ conversation, files: await listDesktopSessionFiles(target, conversation.botId ?? conversation.contextId, conversation.sessionId, conversation.projectId) }))));
    }
    if (request !== generation) return;
    failed = [];
    const next = new Map(rows.map(row => [`${row.conversation.sessionId}:${row.file.id}`, row]));
    results.forEach((result, index) => {
      if (result.status === "rejected") { failed.push(conversations[index]); return; }
      for (const file of result.value.files) next.set(`${result.value.conversation.sessionId}:${file.id}`, { conversation: result.value.conversation, file });
    });
    rows = [...next.values()].sort((a, b) => b.file.createdAt.localeCompare(a.file.createdAt));
  }

  async function load(reset = false): Promise<void> {
    const request = ++generation;
    const target = endpoint;
    const owner = agentId;
    loading = true; error = "";
    if (reset) { rows = []; selected = null; cursor = null; hasMore = false; failed = []; }
    try {
      const response = await searchDesktopConversations(target, { scope: "all", agentId: owner, includeArchived: true, limit: 20, cursor: reset ? null : cursor });
      if (request !== generation) return;
      const group = response.groups[0];
      await loadFiles(group?.items ?? [], request, target);
      if (request !== generation) return;
      cursor = group?.nextCursor ?? null; hasMore = group?.hasMore ?? false;
    } catch (cause) {
      if (request === generation) error = cause instanceof Error ? cause.message : String(cause);
    } finally { if (request === generation) loading = false; }
  }
  async function retry(): Promise<void> {
    const request = ++generation;
    loading = true;
    await loadFiles(failed, request, endpoint);
    if (request === generation) loading = false;
  }
  $effect(() => {
    const target = endpoint;
    const owner = agentId;
    if (target && owner) untrack(() => void load(true));
    return () => { generation += 1; };
  });
</script>

<section class="agent-files-page" class:previewing={selected !== null}>
  <div class="agent-files-list">
    <div class="agent-history-toolbar">
      <Button onclick={onClose}>{locale === "zh-CN" ? "返回 Agent 首页" : "Back to Agent home"}</Button>
      <Button disabled={loading || !endpoint} onclick={() => void load(true)}>{locale === "zh-CN" ? "刷新" : "Refresh"}</Button>
    </div>
    <p class="agent-files-description">{locale === "zh-CN" ? "按文件来源和类型分组，组内最新内容在前。数量仅包含已加载对话；历史来源无法确认的文件单独显示。" : "Grouped by origin and type, newest first within each group. Counts cover loaded conversations; unconfirmed historical origins appear separately."}</p>
    {#if error}<p role="alert">{error}</p><Button disabled={loading} onclick={() => void load()}>{locale === "zh-CN" ? "重试" : "Retry"}</Button>{/if}
    {#if failed.length}<p role="alert">{locale === "zh-CN" ? `${failed.length} 个对话的文件加载失败。` : `Files from ${failed.length} conversations could not be loaded.`}</p><Button disabled={loading} onclick={() => void retry()}>{locale === "zh-CN" ? "重试失败项" : "Retry failed items"}</Button>{/if}
    {#each groups as section (section.origin)}
      <section class="agent-files-origin" aria-label={originLabels[section.origin]}>
        <h2>{originLabels[section.origin]}</h2>
        {#each section.groups as group (group.type)}
          <h3>{typeLabels[group.type]} <span class="agent-files-count">{group.rows.length}</span></h3>
          <div class="agent-files-grid">
            {#each group.rows as row (`${row.conversation.sessionId}:${row.file.id}`)}
              {@const SourceIcon = CONVERSATION_SOURCE_ICONS[row.conversation.source]}
              <article class="agent-file-card">
                <button class="agent-files-open" type="button" onclick={() => selected = row}>
                  <AgentFileThumbnail {endpoint} {row} type={group.type} label={typeLabels[group.type]} />
                  <strong title={row.file.original}>{row.file.original}</strong>
                </button>
                <div class="agent-file-card-body">
                  <span class="agent-file-channel">{#if CHANNEL_LOGOS[row.conversation.source]}<img src={CHANNEL_LOGOS[row.conversation.source]} alt="" width="16" height="16" />{:else}<SourceIcon size={16} aria-hidden="true" />{/if}{channelLabels[row.conversation.source] ?? row.conversation.source}</span>
                  <small title={row.conversation.title}>{row.conversation.title}</small>
                  <time datetime={row.file.createdAt}>{new Date(row.file.createdAt).toLocaleString(locale)}</time>
                  <Button onclick={() => onConversation(row.conversation)}>{locale === "zh-CN" ? "查看来源对话" : "View conversation"}</Button>
                </div>
              </article>
            {/each}
          </div>
        {/each}
      </section>
    {/each}
    {#if loading}<p aria-live="polite">{copy.loading}</p>{:else if !rows.length && !error && !failed.length}<p>{locale === "zh-CN" ? "已加载的对话中没有文件或附件。" : "No files or attachments in the loaded conversations."}</p>{/if}
    {#if hasMore}<Button disabled={loading || failed.length > 0} onclick={() => void load()}>{locale === "zh-CN" ? "加载更多对话的文件" : "Load files from more conversations"}</Button>{/if}
  </div>
  {#if selected}
    <div class="agent-files-preview">
      <div class="agent-history-toolbar"><Button onclick={() => selected = null}>{locale === "zh-CN" ? "返回文件列表" : "Back to files"}</Button><Button onclick={() => selected && onConversation(selected.conversation)}>{locale === "zh-CN" ? "查看来源对话" : "View conversation"}</Button></div>
      {#key `${selected.conversation.sessionId}:${selected.file.id}`}
        <ArtifactPanel {endpoint} projectId={selected.conversation.projectId ?? ""} sessionId={selected.conversation.sessionId} profileId={selected.conversation.botId ?? selected.conversation.contextId} scope="session" {touches} sessionFile={selected.file} sessionFileNonce={1} {locale} {theme} {copy} onClose={() => selected = null} />
      {/key}
    </div>
  {/if}
</section>
