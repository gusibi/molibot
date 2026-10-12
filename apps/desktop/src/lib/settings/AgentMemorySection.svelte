<script lang="ts">
  import type { DesktopMemoryItem, DesktopMemorySummary } from "@molibot/desktop-contract";
  import Button from "../components/ui/Button.svelte";
  import { session } from "../stores/session.svelte";
  import { loadDesktopMemory, runDesktopMemoryAction } from "../api";
  let { agentId, isNew }: { agentId: string; isNew: boolean } = $props();
  let sharedVisible = $state(false);
  let query = $state("");
  let search = $state("");
  let refresh = $state(0);
  let items = $state<DesktopMemoryItem[]>([]);
  let summary = $state<DesktopMemorySummary | null>(null);
  let loading = $state(false);
  let error = $state("");
  const ownItems = $derived(items.filter(item => item.domain === "agent_self"));
  const sharedItems = $derived(items.filter(item => item.domain !== "agent_self"));
  const visibleItems = $derived(sharedVisible ? sharedItems : ownItems);
  const zh = $derived(session.locale === "zh-CN");
  $effect(() => {
    const endpoint = session.endpoint;
    const ready = session.serviceReady;
    const id = agentId;
    const term = search;
    refresh;
    items = []; summary = null; error = "";
    if (isNew || !endpoint || !ready) { loading = false; return; }
    let active = true;
    loading = true;
    Promise.all([
      loadDesktopMemory(endpoint),
      runDesktopMemoryAction(endpoint, { action: term ? "search" : "list", agentId: id, query: term, limit: 200 })
    ]).then(([state, records]) => {
      if (active) { summary = state; items = records.items ?? []; }
    }).catch(cause => { if (active) error = String(cause); }).finally(() => { if (active) loading = false; });
    return () => { active = false; };
  });
</script>

<p class="agent-settings-hint">{zh ? "记忆来自对话中的明确保存，以及对话提取后的候选确认。运行时会召回相关记录；Agent 也可用 memory 工具主动检索。资料包含来源和状态，由记忆服务维护。" : "Memories come from explicit saves in conversations and confirmed extraction candidates. Relevant records are recalled at runtime; the Agent can also search with the memory tool. Records retain sources and state in the memory service."}</p>
<p class="agent-settings-hint">{zh ? "这里显示当前 Agent 的记忆及已授权的共享个人记忆。共享开关保存后生效；对话和项目记忆按具体会话范围召回。记忆后端、候选审核和全局维护在通用记忆中心管理。" : "This view shows Agent memories and authorized shared owner memories. The sharing switch takes effect after saving. Conversation and project memories are recalled within their conversation scope. Manage the backend, candidate review and maintenance in the shared memory center."}</p>
{#if isNew}
  <p>{zh ? "创建并保存 Agent 后可查看其记忆。" : "Create and save the Agent to view its memories."}</p>
{:else if !session.serviceReady}
  <p>{session.text.memoryUnavailable}</p>
{:else}
  <label class="settings-field"><span>{zh ? "搜索记忆" : "Search memories"}</span><input type="search" bind:value={query} onkeydown={event => { if (event.key === "Enter") { event.preventDefault(); search = query.trim(); refresh++; } }} /></label>
  <Button disabled={loading} onclick={() => { search = query.trim(); refresh++; }}>{zh ? "搜索 / 刷新" : "Search / refresh"}</Button>
  {#if error}<p class="agent-settings-error" role="alert">{error}</p>
  {:else if loading}<p>{session.text.loading}</p>
  {:else if summary && !summary.enabled}<p>{session.text.memoryDisabledStatus}</p>
  {:else}
    <p class="agent-settings-hint">{zh ? "最多显示 200 条匹配记录。" : "Shows up to 200 matching records."}</p>
    <div class="settings-row-actions">
      <Button aria-pressed={!sharedVisible} onclick={() => sharedVisible = false}>{zh ? "Agent 专属记忆" : "Agent memories"} ({ownItems.length})</Button>
      <Button aria-pressed={sharedVisible} onclick={() => sharedVisible = true}>{zh ? "已授权共享记忆" : "Authorized shared memories"} ({sharedItems.length})</Button>
    </div>
    {#each visibleItems as item (item.id)}
      <article class="settings-card agent-memory-record">
        <strong>{item.subject || (item.domain === "agent_self" ? (zh ? "Agent 记忆" : "Agent memory") : (zh ? "共享个人记忆" : "Shared owner memory"))}</strong>
        <p>{item.content}</p>
        <p class="agent-settings-hint">{item.domain === "agent_self" ? (zh ? "Agent 专属" : "Agent only") : (zh ? "个人共享" : "Shared owner")} · {item.state === "disputed" ? (zh ? "有争议" : "Disputed") : item.state === "dormant" ? (zh ? "休眠" : "Dormant") : item.state === "archived" ? (zh ? "已归档" : "Archived") : (zh ? "有效" : "Active")} · {zh ? "来源" : "Sources"}: {item.sources?.length ?? 0}</p>
      </article>
    {:else}<p>{zh ? "暂无匹配记忆。可以在对话中明确要求 Agent 记住信息，或在记忆中心确认候选记录。" : "No matching memories. Ask the Agent to remember information in a conversation, or confirm candidates in the memory center."}</p>{/each}
  {/if}
{/if}
