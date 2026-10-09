<script lang="ts">
  import Plus from "reicon-svelte/icons/Plus";
  import CaretRight from "reicon-svelte/icons/CaretRight";
  import type { DesktopAgentItem, DesktopConversationItem } from "@molibot/desktop-contract";
  import type { Translation } from "../i18n";
  import { listDesktopConversations } from "../api";
  import AgentAvatar from "../components/ui/AgentAvatar.svelte";
  import Button from "../components/ui/Button.svelte";
  import ConversationRow from "./ConversationRow.svelte";
  import type { SessionStatusDot } from "./sessionStatusDot";
  let { endpoint, agents, defaultAgentId, deletedAgentIds = [], expanded, activeAgentId, activeSessionId, refresh = 0, locale, copy, statusDots, formatTime, onAgent, onToggle, onSelect, onHistory, onManage, onRename, onDelete }:
    { endpoint: string; defaultAgentId: string; agents: DesktopAgentItem[]; deletedAgentIds?: string[]; expanded: string[]; activeAgentId: string; activeSessionId: string; refresh?: number; locale: "zh-CN" | "en"; copy: Translation; statusDots: Map<string, SessionStatusDot>; formatTime: (iso: string) => string; onAgent: (id: string) => void; onToggle: (id: string) => void; onSelect: (item: DesktopConversationItem) => void; onHistory: (id?: string) => void; onManage: () => void; onRename: (item: DesktopConversationItem, title: string) => void; onDelete: (item: DesktopConversationItem) => void } = $props();
  let items = $state<Record<string, DesktopConversationItem[]>>({});
  let error = $state("");
  const groups = $derived([...agents.filter(agent => agent.id === defaultAgentId || agent.visible !== false).sort((a, b) => Number(b.id === defaultAgentId) - Number(a.id === defaultAgentId)), ...deletedAgentIds.map(id => ({ id, name: `${id} (${locale === "zh-CN" ? "已删除" : "Deleted"})`, description: "", avatar: "", enabled: false })), { id: "__unassigned__", name: locale === "zh-CN" ? "未归属历史" : "Unassigned history", description: "", avatar: "", enabled: false }]);
  $effect(() => {
    const server = endpoint; const ids = [...expanded]; const revision = refresh;
    let current = true;
    if (server) void Promise.all(ids.map(async id => {
      const result = await listDesktopConversations(server, { channel: "web", agentId: id, limit: 10 });
      return [id, result.items] as const;
    })).then(results => { if (current) { items = { ...items, ...Object.fromEntries(results) }; error = ""; } }).catch(cause => { if (current) error = String(cause); });
    return () => { current = false; };
  });
</script>
<div class="agent-navigation">
  {#each groups as agent (agent.id)}
    <div class="agent-navigation-group">
      <div class="agent-navigation-heading">
        <button type="button" class="agent-navigation-primary" class:current={activeAgentId === agent.id} class:active={activeAgentId === agent.id && !activeSessionId} onclick={() => agent.id === "__unassigned__" ? onHistory(agent.id) : onAgent(agent.id)}>
          <AgentAvatar name={agent.name || agent.id} src={agent.avatar ?? ""} />
          <span class="agent-navigation-identity"><strong>{agent.name || agent.id}{#if agent.id === defaultAgentId}<span class="agent-default-label">{locale === "zh-CN" ? "默认" : "Default"}</span>{/if}</strong><small>{agent.description || (agent.enabled ? "" : locale === "zh-CN" ? "仅查看历史" : "History only")}</small></span>
        </button>
        {#if agent.enabled}<Button class="agent-navigation-new" ariaLabel={`${locale === "zh-CN" ? "新对话" : "New chat"}: ${agent.name}`} title={locale === "zh-CN" ? "新对话" : "New chat"} onclick={() => onAgent(agent.id)}><Plus size={14} /></Button>{/if}
        <button type="button" class="agent-navigation-caret" aria-label={`${locale === "zh-CN" ? "展开历史" : "Expand history"}: ${agent.name}`} aria-expanded={expanded.includes(agent.id)} onclick={() => onToggle(agent.id)}><CaretRight size={14} class={expanded.includes(agent.id) ? "open" : ""} /></button>
      </div>
      {#if expanded.includes(agent.id)}
        <div class="agent-navigation-history">
          {#each items[agent.id] ?? [] as item (item.sessionId)}
            <ConversationRow {item} active={item.sessionId === activeSessionId} statusDot={statusDots.get(`${item.botId}:${item.sessionId}`) ?? null} {formatTime} labels={{ running: copy.running, waitingApproval: copy.waitingApproval, completed: copy.completed, failed: copy.failed, rename: copy.renameConversation, delete: copy.deleteConversation, cancel: copy.cancel }} onSelect={() => onSelect(item)} onRename={title => onRename(item, title)} onDelete={() => onDelete(item)} />
          {/each}
          <Button class="agent-history-button" onclick={() => onHistory(agent.id)}>{locale === "zh-CN" ? "全部历史" : "Full history"}</Button>
        </div>
      {/if}
    </div>
  {/each}
  {#if error}<p class="settings-error">{error}</p>{/if}
  <div class="agent-navigation-actions"><Button onclick={() => onHistory()}>{copy.searchConversations}</Button><Button onclick={onManage}>{locale === "zh-CN" ? "管理 Agent" : "Manage Agents"}</Button></div>
</div>
