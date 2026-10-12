<script lang="ts">
  import Button from "../components/ui/Button.svelte";
  import SelectControl from "../components/ui/SelectControl.svelte";
  import SettingRow from "../components/ui/SettingRow.svelte";
  import type { DesktopAgentBinding } from "../api";
  import { projectAgentBindings } from "./agentBindings";
  let { items, agentId, agentName, agents, zh, bindings = $bindable() }: {
    items: DesktopAgentBinding[]; agentId: string; agentName: string;
    agents: { id: string; name: string }[]; zh: boolean; bindings: Record<string, boolean>;
  } = $props();
  let adding = $state(false);
  let selection = $state("");
  const projection = $derived(projectAgentBindings(items, agentId, bindings));
  const channelNames = $derived<Record<string, string>>({feishu: zh ? "飞书" : "Feishu", telegram: "Telegram", qq: "QQ", weixin: zh ? "微信" : "Weixin", web: "Web Profile"});
  const options = $derived(projection.available.map(item => ({value: item.key, label: `${item.name} · ${channelNames[item.channel] ?? item.channel} · ${zh ? "当前负责人" : "Current Agent"}: ${agents.find(agent => agent.id === item.agentId)?.name ?? item.agentId}`})));
  const selected = $derived(projection.available.find(item => item.key === selection));
  const previousName = $derived(agents.find(agent => agent.id === selected?.agentId)?.name ?? selected?.agentId ?? "");
  $effect(() => { if (!selected) selection = ""; });
  function bindSelected() {
    if (!selected) return;
    bindings = {...bindings, [selected.key]: true}; selection = "";
  }
  function undo(key: string) {
    const next = {...bindings}; delete next[key]; bindings = next;
  }
</script>

<h2>{zh ? "绑定的机器人" : "Bound bots"} · {projection.bound.length}</h2>
<p class="agent-settings-hint">{zh ? `这些机器人收到的新对话由 ${agentName} 负责回复。此处只配置负责人；机器人是否启用、账号和密钥在全局渠道设置中管理。` : `New conversations received by these bots are handled by ${agentName}. This page assigns responsibility. Manage bot availability, accounts and credentials in global channel settings.`}</p>
<p class="agent-settings-hint">{zh ? "改绑在点击底部“保存”后生效，已有对话仍由原 Agent 负责。" : "Binding changes take effect after Save. Existing conversations keep their original Agent."}</p>
{#each projection.bound as item (item.key)}
  <SettingRow title={item.name} description={`${channelNames[item.channel] ?? item.channel} · ${item.agentId === agentId ? (zh ? "由当前 Agent 回复新对话" : "This Agent handles new conversations") : (zh ? "待保存绑定" : "Binding pending save")}`}>
    {#if agentId !== "default"}<Button onclick={() => bindings = {...bindings, [item.key]: false}}>{zh ? "移交给 Momo" : "Transfer to Momo"}</Button>{/if}
  </SettingRow>
{:else}<p class="agent-settings-hint">{projection.pending.length ? (zh ? "保存后，这个 Agent 将不再绑定机器人。" : "After saving, this Agent will have no bound bots.") : (zh ? "这个 Agent 尚未绑定机器人。" : "This Agent has no bound bots.")}</p>{/each}
{#if agentId === "default" && projection.bound.length}<p class="agent-settings-hint">{zh ? "要把 Momo 的机器人移交给其他 Agent，请进入目标 Agent 的“绑定的机器人”页面添加绑定。" : "To transfer a bot from Momo, open Bound bots in the destination Agent and bind it there."}</p>{/if}
{#if items.length}
  <Button aria-expanded={adding} onclick={() => adding = !adding}>{adding ? (zh ? "收起绑定选择" : "Hide bot picker") : (zh ? "绑定其他机器人" : "Bind another bot")}</Button>
  {#if adding}
    {#if options.length}
      <div class="agent-binding-picker">
        <label class="settings-field"><span>{zh ? "选择机器人" : "Choose a bot"}</span><SelectControl value={selection} options={[{value: "", label: zh ? "请选择机器人" : "Select a bot"}, ...options]} ariaLabel={zh ? "选择机器人" : "Choose a bot"} onChange={value => selection = value} /></label>
        {#if selected}<p class="agent-settings-hint">{selected.agentId === agentId ? (zh ? "重新绑定将撤销这个机器人的移交。" : "Binding this bot again cancels its pending transfer.") : (zh ? `保存后，“${selected.name}”的新对话将从 ${previousName} 改由 ${agentName} 回复。` : `After saving, new conversations for “${selected.name}” will be handled by ${agentName} instead of ${previousName}.`)}</p>{/if}
        <Button disabled={!selected} onclick={bindSelected}>{zh ? `绑定到 ${agentName}` : `Bind to ${agentName}`}</Button>
      </div>
    {:else}<p class="agent-settings-hint">{zh ? "所有已配置机器人都已归属当前 Agent。" : "All configured bots are already assigned to this Agent."}</p>{/if}
  {/if}
{:else}<p class="agent-settings-hint">{zh ? "暂无已配置机器人。请先在全局渠道设置中添加账号。" : "No bots configured. Add an account in global channel settings first."}</p>{/if}
{#if projection.pending.length}
  <section class="agent-binding-pending" aria-live="polite">
    <h3>{zh ? "待保存的变更" : "Changes pending save"} · {projection.pending.length}</h3>
    {#each projection.pending as item (item.key)}
      {@const from = agents.find(agent => agent.id === item.agentId)?.name ?? item.agentId}
      {@const to = item.targetAgentId === agentId ? agentName : agents.find(agent => agent.id === item.targetAgentId)?.name ?? item.targetAgentId}
      <SettingRow title={`${item.name} · ${channelNames[item.channel] ?? item.channel}`} description={`${from} → ${to}`}><Button onclick={() => undo(item.key)}>{zh ? "撤销" : "Undo"}</Button></SettingRow>
    {/each}
  </section>
{/if}
