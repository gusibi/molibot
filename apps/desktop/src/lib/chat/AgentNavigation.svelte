<script lang="ts">
  import RowContextMenu from "../components/ui/RowContextMenu.svelte";
  import GroupHeader from "./GroupHeader.svelte";
  import type { DesktopAgentActivityItem, DesktopAgentItem } from "@molibot/desktop-contract";
  import type { Translation } from "../i18n";
  import AgentAvatar from "../components/ui/AgentAvatar.svelte";
  import { agentActivityLabel } from "./agentActivity";
  import Run from "reicon-svelte/icons/Run";
  import Check from "reicon-svelte/icons/Check";
  import X from "reicon-svelte/icons/X";
  import Minus from "reicon-svelte/icons/Minus";
  import Map from "../icons/duotone/components/Map.svelte";
  let { activities = [], activityReady = false, selectedAgentId = "", overviewActive = false, onOverview, hasUnassignedHistory = false, agents, defaultAgentId, deletedAgentIds = [], locale, copy, onAgent, onHistory, onFiles, onSettings }:
    { activities?: DesktopAgentActivityItem[]; activityReady?: boolean; selectedAgentId?: string; overviewActive?: boolean; onOverview: () => void; hasUnassignedHistory?: boolean; defaultAgentId: string; agents: DesktopAgentItem[]; deletedAgentIds?: string[]; locale: "zh-CN" | "en"; copy: Translation; onAgent: (id: string) => void; onHistory: (id: string) => void; onFiles: (id: string) => void; onSettings: (id: string) => void } = $props();
  // The server already ordered Agents (default first, then latest activity);
  // this view only hides Agents the owner kept out of the chat sidebar.
  const groups = $derived([...agents.filter(agent => agent.id === defaultAgentId || agent.visible !== false), ...deletedAgentIds.map(id => ({ id, name: `${id} (${locale === "zh-CN" ? "已删除" : "Deleted"})`, description: "", avatar: "", enabled: false })), ...(hasUnassignedHistory ? [{ id: "__unassigned__", name: locale === "zh-CN" ? "未归属历史" : "Unassigned history", description: "", avatar: "", enabled: false }] : [])]);
</script>
<div class="agent-navigation">
  <GroupHeader label={copy.agentOverview} active={overviewActive} expandable={false} onToggle={onOverview}>
    {#snippet avatar()}<Map size={16} aria-hidden="true" />{/snippet}
  </GroupHeader>
  {#each groups as agent (agent.id)}
    <RowContextMenu items={[{label: locale === "zh-CN" ? "全部对话" : "All conversations", onSelect: () => onHistory(agent.id)}, ...(agents.some(item => item.id === agent.id) ? [{label: locale === "zh-CN" ? "文件与附件" : "Files and attachments", onSelect: () => onFiles(agent.id)}, {label: locale === "zh-CN" ? "设置" : "Settings", onSelect: () => onSettings(agent.id)}] : [])]}>
    <div class="agent-navigation-group">
      <GroupHeader label={agent.name || agent.id} active={!overviewActive && selectedAgentId === agent.id} open={false} expandable={false} actionLabel={copy.newChat} onAction={agent.enabled ? () => onAgent(agent.id) : null} onToggle={() => agent.enabled ? onAgent(agent.id) : onHistory(agent.id)}>
        {#snippet avatar()}<AgentAvatar name={agent.name || agent.id} src={agent.avatar ?? ""} />{/snippet}
        {#snippet status()}
          {@const activity = activities.find(item => item.agentId === agent.id)}
          {@const label = agents.some(item => item.id === agent.id) ? agentActivityLabel(agent.enabled, activity, activityReady, copy) : ""}
          {#if label}
            {@const status = !agent.enabled ? "disabled" : activity?.status}
            {@const StatusIcon = status === "working" ? Run : status === "completed" ? Check : status === "error" ? X : Minus}
            <span class="agent-navigation-status" data-status={status} title={label} role="img" aria-label={label}><StatusIcon size={14} aria-hidden="true" /></span>
          {/if}
        {/snippet}
      </GroupHeader>

    </div>
    </RowContextMenu>
  {/each}

</div>
