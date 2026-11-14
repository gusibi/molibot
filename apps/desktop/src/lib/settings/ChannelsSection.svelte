<script lang="ts">
  import { untrack } from "svelte";
  import DirectoryActions from "../components/ui/DirectoryActions.svelte";
  import DirectoryToolbar from "../components/ui/DirectoryToolbar.svelte";
  import AgentAvatar from "../components/ui/AgentAvatar.svelte";
  import Button from "../components/ui/Button.svelte";
  import SkeletonRows from "../components/ui/SkeletonRows.svelte";
  import { CHANNEL_LOGOS } from "../chat/activityIcons";
  import X from "reicon-svelte/icons/X";
  import AlertDialog from "../components/ui/AlertDialog.svelte";
  import Dialog from "../components/ui/Dialog.svelte";
  import EmptyState from "../components/ui/EmptyState.svelte";
  import IosSwitch from "../components/ui/IosSwitch.svelte";
  import SelectControl from "../components/ui/SelectControl.svelte";
  import SettingGroup from "../components/ui/SettingGroup.svelte";
  import { session } from "../stores/session.svelte";
  import { agentsStore, loadAgents } from "../stores/agents.svelte";
  import { PROFILE_FILE_NAMES } from "./profileFiles";
  import { labeledOptions, progressOptionLabels, reasoningOptionLabels, type ProgressValue, type ReasoningValue } from "./displaySettings";
  import type { DesktopChannelDisplaySettings, DesktopChannelInstance, DesktopExternalChannel } from "@molibot/desktop-contract";
  import {
    channelsStore,
    CHANNEL_FIELD_CONFIG,
    DESKTOP_CHANNELS,
    WEB_CHANNEL,
    beginChannelEdit,
    beginNewChannel,
    clearChannelQr,
    externalChannelLabel,
    generateChannelQr,
    loadChannels,
    removeChannelInstance,
    saveChannelEditor,
    testChannelEditor,
    toggleChannelSecretClear,
    updateChannelEdit
  } from "../stores/channels.svelte";

  let query = $state("");
  let status = $state<"all" | "enabled" | "disabled">("all");
  let platform = $state<"all" | DesktopExternalChannel>("all");
  const allPlatforms = [WEB_CHANNEL, ...DESKTOP_CHANNELS];
  const agentMap = $derived(new Map((agentsStore.agents?.items ?? []).map(agent => [agent.id, agent])));
  const filteredGroups = $derived.by(() => {
    const term = query.trim().toLocaleLowerCase(session.locale);
    return allPlatforms.map(channel => {
      const group = channelsStore.channels?.groups.find(group => group.channel === channel);
      const instances = (group?.instances ?? []).filter(inst => (status === "all" || inst.enabled === (status === "enabled")) && (!term || [inst.name, inst.id, inst.agentId, agentMap.get(inst.agentId)?.name ?? "", externalChannelLabel(channel, session.locale)].join("\n").toLocaleLowerCase(session.locale).includes(term)));
      return { channel, instances, total: group?.total ?? 0, enabled: group?.enabled ?? 0 };
    }).filter(group => (platform === "all" || platform === group.channel) && (group.instances.length > 0 || (!term && status === "all")));
  });
  const shown = $derived(filteredGroups.reduce((total, group) => total + group.instances.length, 0));
  let deletingChannelInstance = $state<{ channel: DesktopExternalChannel; id: string; name: string } | null>(null);

  // Inherit-first option lists; the inherit label shows the current global value
  // so "follow global" is never a blind choice.
  const globalDisplay = $derived(channelsStore.channels?.defaults ?? {});
  const progressLabels = $derived(progressOptionLabels(session.text));
  const reasoningLabels = $derived(reasoningOptionLabels(session.text));
  const followGlobalLabel = $derived((current?: string) => current ? `${session.text.channelFollowGlobal} · ${current}` : session.text.channelFollowGlobal);
  const toolProgressOptions = $derived([
    { value: "inherit", label: followGlobalLabel(globalDisplay.toolProgress ? progressLabels[globalDisplay.toolProgress as ProgressValue] : undefined) },
    ...labeledOptions(progressLabels)
  ]);
  const showReasoningOptions = $derived([
    { value: "inherit", label: followGlobalLabel(globalDisplay.showReasoning ? reasoningLabels[globalDisplay.showReasoning as ReasoningValue] : undefined) },
    ...labeledOptions(reasoningLabels)
  ]);
  const runLogNoticeOptions = $derived([
    { value: "inherit", label: followGlobalLabel(globalDisplay.runLogNotice === undefined ? undefined : globalDisplay.runLogNotice ? session.text.channelRunLogOn : session.text.channelRunLogOff) },
    { value: "on", label: session.text.channelRunLogOn },
    { value: "off", label: session.text.channelRunLogOff }
  ]);
  // Web is operated inside the app: basics and Markdown files only — no chat
  // allowlist, no display overrides, no platform credentials.
  const editingWeb = $derived(channelsStore.channelEdit?.channel === WEB_CHANNEL);

  const COMPACTION_MINUTE_PRESETS = [
    { minutes: 30, labelKey: "channelIdleCompactionPreset30m" },
    { minutes: 60, labelKey: "channelIdleCompactionPreset1h" },
    { minutes: 120, labelKey: "channelIdleCompactionPreset2h" },
    { minutes: 240, labelKey: "channelIdleCompactionPreset4h" }
  ] as const;
  const COMPACTION_TOKEN_PRESETS = [2000, 4000, 8000, 16000] as const;

  function formatIdleMinutes(minutes: number): string {
    if (session.locale === "zh-CN") {
      return minutes % 60 === 0 && minutes >= 60 ? `${minutes / 60} 小时` : `${minutes} 分钟`;
    }
    return minutes % 60 === 0 && minutes >= 60 ? `${minutes / 60}h` : `${minutes}m`;
  }

  function formatTokenCount(tokens: number): string {
    return new Intl.NumberFormat(session.locale === "zh-CN" ? "zh-CN" : "en-US").format(tokens);
  }

  function formatCompactionSummary(minutes: number, minTokens: number): string {
    return session.text.channelIdleCompactionRowSummary
      .replace("{duration}", formatIdleMinutes(minutes))
      .replace("{tokens}", formatTokenCount(minTokens));
  }

  function clampCompactionInt(value: string, min: number, max: number, fallback: number): number {
    const parsed = Math.round(Number(value));
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  }

  $effect(() => {
    const endpoint = session.serviceReady ? session.endpoint : null;
    if (endpoint) untrack(() => void loadChannels(endpoint));
  });
  $effect(() => {
    const endpoint = session.serviceReady ? session.endpoint : null;
    if (endpoint) untrack(() => { if (endpoint !== agentsStore.endpoint) void loadAgents(endpoint); });
  });

  async function handleConfirmDelete(): Promise<void> {
    if (!deletingChannelInstance) return;
    const { channel, id } = deletingChannelInstance;
    deletingChannelInstance = null;
    await removeChannelInstance(channel, id);
  }
</script>

{#snippet channelInstances(channel: DesktopExternalChannel, instances: DesktopChannelInstance[])}
  {#each instances as inst (inst.id)}
    <div class="settings-row directory-entity-row directory-channel-row" data-channel-id={inst.id}>
      <AgentAvatar name={agentMap.get(inst.agentId)?.name ?? inst.name} src={agentMap.get(inst.agentId)?.avatar ?? ""} />
      <div class="profile-info">
        <strong>{inst.name}</strong>
        <p class="directory-description">{session.text.channelLinkedAgent}: {agentMap.get(inst.agentId)?.name ?? (inst.agentId || session.text.noLinkedAgent)}{#if inst.display && channel !== WEB_CHANNEL} · {session.text.channelDisplayCustom}{/if}{#if channel !== WEB_CHANNEL && inst.idleCompaction?.enabled} · <span class="directory-compaction-badge">{session.text.channelIdleCompactionBadge.replace("{duration}", formatIdleMinutes(inst.idleCompaction.idleMinutes)).replace("{tokens}", formatTokenCount(inst.idleCompaction.minContextTokens))}</span>{/if}</p>
        <details class="directory-row-details"><summary>{session.text.directoryDetails}</summary><dl><div><dt>ID</dt><dd><code>{inst.id}</code></dd></div><div><dt>Agent ID</dt><dd><code>{inst.agentId || "—"}</code></dd></div>{#if channel !== WEB_CHANNEL}<div><dt>{session.text.channelAllowedChats}</dt><dd>{inst.allowedChatCount}</dd></div><div><dt>{session.text.channelIdleCompactionDetail}</dt><dd>{inst.idleCompaction?.enabled ? formatCompactionSummary(inst.idleCompaction.idleMinutes, inst.idleCompaction.minContextTokens) : session.text.channelIdleCompactionDisabledLabel}</dd></div>{/if}<div><dt>{session.text.channelPermissionMode}</dt><dd>{inst.permissionMode === null ? session.text.agentPermissionModeInherit : { plan: session.text.permissionModePlan, manual: session.text.permissionModeManual, accept_edits: session.text.permissionModeAcceptEdits, auto: session.text.permissionModeAuto }[inst.permissionMode]}</dd></div></dl></details>
      </div>
      <div class="settings-row-actions">
        <span class="directory-enabled-state" data-enabled={inst.enabled}><i aria-hidden="true"></i>{inst.enabled ? session.text.providerEnabled : session.text.providerDisabled}</span>
        <button class="text-button" type="button" disabled={channelsStore.editorLoading} onclick={() => void beginChannelEdit(channel, inst.id)}>{session.text.channelEdit}</button>
        <DirectoryActions label={session.text.directoryMoreActions.replace("{name}", inst.name)} disabled={channelsStore.saving} items={[{ label: session.text.channelDelete, danger: true, onSelect: () => deletingChannelInstance = { channel, id: inst.id, name: inst.name } }]} />
      </div>
    </div>
  {/each}
{/snippet}

{#snippet channelGroup(group: (typeof filteredGroups)[number])}
  <SettingGroup title={externalChannelLabel(group.channel, session.locale)} description={`${group.enabled} ${session.text.providerEnabled} · ${group.total} ${session.text.directoryInstances}`}>
    <svelte:fragment slot="action">
      <button class="secondary-button" type="button" disabled={channelsStore.channelEdit !== null} onclick={() => beginNewChannel(group.channel)}>{session.text.channelAdd}</button>
    </svelte:fragment>
    {#if group.instances.length === 0}<p class="directory-empty-group">{session.text.channelsEmpty}</p>{:else}{@render channelInstances(group.channel, group.instances)}{/if}
  </SettingGroup>
{/snippet}

{#if !session.serviceReady}
  <SettingGroup><EmptyState title={session.text.channelsUnavailable} icon="chat-circle-dots" /></SettingGroup>
{:else if channelsStore.error && !channelsStore.channels}
  <SettingGroup><div class="directory-load-error" role="alert"><strong>{session.text.directoryLoadFailed}</strong><p>{channelsStore.error}</p><Button onclick={() => session.endpoint && loadChannels(session.endpoint)}>{session.text.retryLoading}</Button></div></SettingGroup>
{:else if !channelsStore.channels}
  <SettingGroup><SkeletonRows count={4} label={session.text.loading} /></SettingGroup>
{:else}
  <div class="directory-shell channel-directory" aria-busy={channelsStore.loading}>
  {#if channelsStore.error}<div class="directory-load-error" role="alert"><p>{channelsStore.error}</p><Button onclick={() => session.endpoint && loadChannels(session.endpoint)}>{session.text.retryLoading}</Button></div>{/if}
  {#if agentsStore.error}<div class="directory-load-error" role="alert"><p>{agentsStore.error}</p><Button onclick={() => session.endpoint && loadAgents(session.endpoint)}>{session.text.retryLoading}</Button></div>{/if}
  <DirectoryToolbar {query} {status} total={channelsStore.channels.counts.totalInstances} enabled={channelsStore.channels.counts.enabledInstances} {shown} searchLabel={session.text.directoryChannelSearch} onQuery={value => query = value} onStatus={value => status = value} />
  <nav class="directory-platforms" aria-label={session.text.channels}>
    <button type="button" class:active={platform === "all"} aria-pressed={platform === "all"} onclick={() => platform = "all"}>{session.text.directoryAllChannels}</button>
    {#each allPlatforms as channel}<button type="button" class:active={platform === channel} aria-pressed={platform === channel} onclick={() => platform = channel}><img src={CHANNEL_LOGOS[channel]} alt="" width="16" height="16" />{externalChannelLabel(channel, session.locale)}<span>{channelsStore.channels.groups.find(group => group.channel === channel)?.total ?? 0}</span></button>{/each}
  </nav>
  {#if shown === 0 && (query.trim() || status !== "all")}
    <SettingGroup><EmptyState title={session.text.directoryNoMatches} description={session.text.directoryNoMatchesHint} icon="magnifying-glass"><Button onclick={() => { query = ""; status = "all"; platform = "all"; }}>{session.text.directoryClear}</Button></EmptyState></SettingGroup>
  {:else}{#each filteredGroups as group (group.channel)}{@render channelGroup(group)}{/each}{/if}
  </div>
  {#if channelsStore.channelEdit}
    {@const savedInstance = channelsStore.channels.groups.find((group) => group.channel === channelsStore.channelEdit?.channel)?.instances.find((instance) => instance.id === channelsStore.channelEdit?.previousId)}
    <Dialog open={true} busy={channelsStore.saving} contentClass="entity-editor-dialog" labelledBy="channel-editor-title" onOpenChange={(next) => { if (!next) channelsStore.channelEdit = null; }}>
    <form id="desktop-channel-form" class="entity-editor-form" aria-label={session.text.channels} onsubmit={(event) => { event.preventDefault(); void saveChannelEditor(); }}>
      <header class="entity-editor-head"><strong id="channel-editor-title">{session.text.channels} · {externalChannelLabel(channelsStore.channelEdit.channel, session.locale)}</strong><button class="modal-close" type="button" aria-label={session.text.dialogClose} disabled={channelsStore.saving} onclick={() => (channelsStore.channelEdit = null)}><X size={16} aria-hidden="true" /></button></header>
      <div class="entity-editor-body">
      <div class="provider-editor-toolbar"><strong>{session.text.channelBasicsSection}</strong></div>
      <div class="settings-form">
        <label class="settings-field"><span>{session.text.channelInstanceId}</span><input value={channelsStore.channelEdit.id} disabled={!channelsStore.channelEdit.isNew} autocomplete="off" spellcheck="false" oninput={(event) => updateChannelEdit((draft) => ({ ...draft, id: (event.currentTarget as HTMLInputElement).value }))} /></label>
        <label class="settings-field"><span>{session.text.channelInstanceName}</span><input value={channelsStore.channelEdit.name} autocomplete="off" oninput={(event) => updateChannelEdit((draft) => ({ ...draft, name: (event.currentTarget as HTMLInputElement).value }))} /></label>
        <label class="settings-field"><span>{session.text.channelLinkedAgent}</span><SelectControl value={channelsStore.channelEdit.agentId} ariaLabel={session.text.channelLinkedAgent} options={agentsStore.agents?.items.filter((agent) => agent.enabled).map((agent) => ({ value: agent.id, label: agent.name })) ?? []} onChange={(value) => updateChannelEdit((draft) => ({ ...draft, agentId: value }))} /></label>
        <label class="settings-field"><span>{session.text.channelPermissionMode}</span><SelectControl value={channelsStore.channelEdit.permissionMode ?? "inherit"} ariaLabel={session.text.channelPermissionMode} options={[{ value: "inherit", label: session.text.agentPermissionModeInherit }, { value: "plan", label: session.text.permissionModePlan }, { value: "manual", label: session.text.permissionModeManual }, { value: "accept_edits", label: session.text.permissionModeAcceptEdits }, { value: "auto", label: session.text.permissionModeAuto }]} onChange={(value) => updateChannelEdit((draft) => ({ ...draft, permissionMode: value === "inherit" ? null : value as "plan" | "manual" | "accept_edits" | "auto" }))} /></label>
        {#if !editingWeb}<label class="settings-field settings-field-wide"><span>{session.text.channelAllowedChatIds}</span><textarea rows="3" value={channelsStore.channelEdit.allowedChatIds.join("\n")} placeholder={session.text.channelAllowedChatHint} autocomplete="off" spellcheck="false" oninput={(event) => updateChannelEdit((draft) => ({ ...draft, allowedChatIds: (event.currentTarget as HTMLTextAreaElement).value.split(/[\n,]/).map((value) => value.trim()).filter(Boolean) }))}></textarea></label>{/if}
      </div>
      <div class="provider-inline-options"><div class="inline-switch-row"><span>{session.text.channelEnabled}</span><IosSwitch checked={channelsStore.channelEdit.enabled} ariaLabel={session.text.channelEnabled} onCheckedChange={(checked) => updateChannelEdit((draft) => ({ ...draft, enabled: checked }))} /></div></div>
      {#if !editingWeb}
      <div class="provider-editor-toolbar"><strong>{session.text.channelDisplaySection}</strong></div>
      <div class="settings-form">
        <label class="settings-field"><span>{session.text.systemToolProgress}</span><SelectControl value={channelsStore.channelEdit.display.toolProgress ?? "inherit"} ariaLabel={session.text.systemToolProgress} options={toolProgressOptions} onChange={(value) => updateChannelEdit((draft) => ({ ...draft, display: { ...draft.display, toolProgress: value === "inherit" ? undefined : value as DesktopChannelDisplaySettings["toolProgress"] } }))} /></label>
        <label class="settings-field"><span>{session.text.systemReasoning}</span><SelectControl value={channelsStore.channelEdit.display.showReasoning ?? "inherit"} ariaLabel={session.text.systemReasoning} options={showReasoningOptions} onChange={(value) => updateChannelEdit((draft) => ({ ...draft, display: { ...draft.display, showReasoning: value === "inherit" ? undefined : value as DesktopChannelDisplaySettings["showReasoning"] } }))} /></label>
        <label class="settings-field"><span>{session.text.systemRunLogNotice}</span><SelectControl value={channelsStore.channelEdit.display.runLogNotice === undefined ? "inherit" : channelsStore.channelEdit.display.runLogNotice ? "on" : "off"} ariaLabel={session.text.systemRunLogNotice} options={runLogNoticeOptions} onChange={(value) => updateChannelEdit((draft) => ({ ...draft, display: { ...draft.display, runLogNotice: value === "inherit" ? undefined : value === "on" } }))} /></label>
        <label class="settings-field"><span>{session.text.systemNotifyInterval}</span><input type="number" min="0" step="1" value={channelsStore.channelEdit.display.gatewayNotifyInterval ?? ""} placeholder={String(globalDisplay.gatewayNotifyInterval ?? 0)} aria-label={session.text.systemNotifyInterval} oninput={(event) => { const raw = (event.currentTarget as HTMLInputElement).value.trim(); updateChannelEdit((draft) => ({ ...draft, display: { ...draft.display, gatewayNotifyInterval: raw === "" ? undefined : Number(raw) } })); }} /><small>{session.text.channelNotifyEmptyHint}</small></label>
      </div>
      <section class="channel-compaction-card" data-enabled={channelsStore.channelEdit.idleCompaction.enabled ? "true" : "false"} aria-label={session.text.channelIdleCompactionSection}>
        <header class="channel-compaction-head">
          <div class="channel-compaction-copy">
            <div class="channel-compaction-title-row">
              <strong>{session.text.channelIdleCompactionSection}</strong>
              <span class="channel-compaction-pill" data-enabled={channelsStore.channelEdit.idleCompaction.enabled ? "true" : "false"}>
                <i aria-hidden="true"></i>
                {channelsStore.channelEdit.idleCompaction.enabled
                  ? `${session.text.channelIdleCompactionStatusOn} · ${formatIdleMinutes(channelsStore.channelEdit.idleCompaction.idleMinutes)}`
                  : session.text.channelIdleCompactionDisabledLabel}
              </span>
            </div>
            <p>{session.text.channelIdleCompactionHint}</p>
          </div>
          <IosSwitch
            checked={channelsStore.channelEdit.idleCompaction.enabled}
            ariaLabel={session.text.channelIdleCompactionEnable}
            onCheckedChange={(checked) => updateChannelEdit((draft) => ({ ...draft, idleCompaction: { ...draft.idleCompaction, enabled: checked } }))}
          />
        </header>

        <ol class="compaction-pipeline" aria-hidden="true">
          <li class="compaction-pipeline-step">
            <span class="compaction-step-index">01</span>
            <div>
              <strong>{session.text.channelIdleCompactionStepIdle}</strong>
              <span>{formatIdleMinutes(channelsStore.channelEdit.idleCompaction.idleMinutes)}</span>
            </div>
          </li>
          <li class="compaction-pipeline-arrow">→</li>
          <li class="compaction-pipeline-step">
            <span class="compaction-step-index">02</span>
            <div>
              <strong>{session.text.channelIdleCompactionStepMemory}</strong>
              <span>{session.text.memory}</span>
            </div>
          </li>
          <li class="compaction-pipeline-arrow">→</li>
          <li class="compaction-pipeline-step">
            <span class="compaction-step-index">03</span>
            <div>
              <strong>{session.text.channelIdleCompactionStepCompact}</strong>
              <span>{session.text.channelIdleCompactionStepCompactDetail.replace("{tokens}", formatTokenCount(channelsStore.channelEdit.idleCompaction.minContextTokens))}</span>
            </div>
          </li>
        </ol>

        {#if channelsStore.channelEdit.idleCompaction.enabled}
          <div class="compaction-bento-grid">
            <div class="compaction-param-card">
              <div class="compaction-param-head">
                <label for="channel-compaction-minutes">{session.text.channelIdleCompactionMinutes}</label>
                <span>{session.text.channelIdleCompactionMinutesHint}</span>
              </div>
              <div class="bento-preset-row" role="group" aria-label={session.text.channelIdleCompactionMinutes}>
                {#each COMPACTION_MINUTE_PRESETS as preset (preset.minutes)}
                  <button
                    type="button"
                    class="bento-preset-chip"
                    class:active={channelsStore.channelEdit.idleCompaction.idleMinutes === preset.minutes}
                    aria-pressed={channelsStore.channelEdit.idleCompaction.idleMinutes === preset.minutes}
                    onclick={() => updateChannelEdit((draft) => ({ ...draft, idleCompaction: { ...draft.idleCompaction, idleMinutes: preset.minutes } }))}
                  >{session.text[preset.labelKey]}</button>
                {/each}
              </div>
              <div class="bento-unit-input">
                <input
                  id="channel-compaction-minutes"
                  type="number"
                  min="5"
                  max="10080"
                  step="5"
                  value={channelsStore.channelEdit.idleCompaction.idleMinutes}
                  aria-label={session.text.channelIdleCompactionMinutes}
                  oninput={(event) => {
                    const parsed = Number((event.currentTarget as HTMLInputElement).value);
                    if (!Number.isFinite(parsed) || parsed <= 0) return;
                    updateChannelEdit((draft) => ({ ...draft, idleCompaction: { ...draft.idleCompaction, idleMinutes: Math.min(10080, Math.round(parsed)) } }));
                  }}
                  onblur={(event) => {
                    const next = clampCompactionInt((event.currentTarget as HTMLInputElement).value, 5, 10080, 60);
                    updateChannelEdit((draft) => ({ ...draft, idleCompaction: { ...draft.idleCompaction, idleMinutes: next } }));
                    (event.currentTarget as HTMLInputElement).value = String(next);
                  }}
                />
                <span>{session.text.channelIdleCompactionUnitMinutes}</span>
              </div>
            </div>

            <div class="compaction-param-card">
              <div class="compaction-param-head">
                <label for="channel-compaction-tokens">{session.text.channelIdleCompactionMinTokens}</label>
                <span>{session.text.channelIdleCompactionMinTokensHint}</span>
              </div>
              <div class="bento-preset-row" role="group" aria-label={session.text.channelIdleCompactionMinTokens}>
                {#each COMPACTION_TOKEN_PRESETS as tokenPreset (tokenPreset)}
                  <button
                    type="button"
                    class="bento-preset-chip"
                    class:active={channelsStore.channelEdit.idleCompaction.minContextTokens === tokenPreset}
                    aria-pressed={channelsStore.channelEdit.idleCompaction.minContextTokens === tokenPreset}
                    onclick={() => updateChannelEdit((draft) => ({ ...draft, idleCompaction: { ...draft.idleCompaction, minContextTokens: tokenPreset } }))}
                  >{formatTokenCount(tokenPreset)}</button>
                {/each}
              </div>
              <div class="bento-unit-input">
                <input
                  id="channel-compaction-tokens"
                  type="number"
                  min="500"
                  max="200000"
                  step="500"
                  value={channelsStore.channelEdit.idleCompaction.minContextTokens}
                  aria-label={session.text.channelIdleCompactionMinTokens}
                  oninput={(event) => {
                    const parsed = Number((event.currentTarget as HTMLInputElement).value);
                    if (!Number.isFinite(parsed) || parsed <= 0) return;
                    updateChannelEdit((draft) => ({ ...draft, idleCompaction: { ...draft.idleCompaction, minContextTokens: Math.min(200000, Math.round(parsed)) } }));
                  }}
                  onblur={(event) => {
                    const next = clampCompactionInt((event.currentTarget as HTMLInputElement).value, 500, 200000, 4000);
                    updateChannelEdit((draft) => ({ ...draft, idleCompaction: { ...draft.idleCompaction, minContextTokens: next } }));
                    (event.currentTarget as HTMLInputElement).value = String(next);
                  }}
                />
                <span>{session.text.channelIdleCompactionUnitTokens}</span>
              </div>
            </div>
          </div>
          <p class="compaction-foot-note">{session.text.channelIdleCompactionScopeNote}</p>
        {:else}
          <p class="compaction-foot-note">{session.text.channelIdleCompactionOffHint}</p>
        {/if}
      </section>
      <div class="provider-editor-toolbar"><strong>{session.text.channelCredentials}</strong>{#if channelsStore.channelEdit.channel === "feishu"}<button class="secondary-button" type="button" disabled={channelsStore.testing} onclick={() => void testChannelEditor()}>{channelsStore.testing ? session.text.loading : session.text.channelTest}</button>{/if}</div>
      <div class="settings-form">
        {#each CHANNEL_FIELD_CONFIG[channelsStore.channelEdit.channel].visible as key (key)}
          {#if key === "streamOutput"}
            <label class="settings-field"><span>{session.text.channelStreamOutput}</span><SelectControl value={channelsStore.channelEdit.fields[key] ?? "true"} ariaLabel={session.text.channelStreamOutput} options={[{ value: "true", label: session.text.yes }, { value: "false", label: session.text.no }]} onChange={(value) => updateChannelEdit((draft) => ({ ...draft, fields: { ...draft.fields, [key]: value } }))} /></label>
          {:else}
            <label class="settings-field"><span>{key === "appId" ? session.text.channelAppId : session.text.channelBaseUrl}</span><input value={channelsStore.channelEdit.fields[key] ?? ""} autocomplete="off" spellcheck="false" oninput={(event) => updateChannelEdit((draft) => ({ ...draft, fields: { ...draft.fields, [key]: (event.currentTarget as HTMLInputElement).value } }))} /></label>
          {/if}
        {/each}
        {#each CHANNEL_FIELD_CONFIG[channelsStore.channelEdit.channel].secret as key (key)}
          <label class="settings-field">
            <span>{key === "token" ? session.text.channelToken : key === "appSecret" ? session.text.channelAppSecret : key === "verificationToken" ? session.text.channelVerificationToken : key === "encryptKey" ? session.text.channelEncryptKey : session.text.channelClientSecret}</span>
            <input type="password" value={channelsStore.channelEdit.secretValues?.[key] ?? ""} placeholder={savedInstance?.configuredSecrets.includes(key) ? session.text.channelSecretConfigured : ""} autocomplete="new-password" spellcheck="false" oninput={(event) => updateChannelEdit((draft) => ({ ...draft, secretValues: { ...(draft.secretValues ?? {}), [key]: (event.currentTarget as HTMLInputElement).value } }))} />
            {#if savedInstance?.configuredSecrets.includes(key)}<label class="inline-check"><input type="checkbox" checked={channelsStore.channelEdit.clearSecrets?.includes(key)} onchange={() => toggleChannelSecretClear(key)} /> {session.text.channelClearSecret}</label>{/if}
          </label>
        {/each}
      </div>
      {/if}
      <div class="provider-editor-toolbar"><strong>{session.text.channelBotFiles}</strong></div>
      <div class="profile-files-editor">
        {#each PROFILE_FILE_NAMES as fileName (fileName)}
          <label class="settings-field"><span>{fileName}</span><textarea rows="7" value={channelsStore.channelEdit.files[fileName] ?? ""} autocomplete="off" spellcheck="false" oninput={(event) => updateChannelEdit((draft) => ({ ...draft, files: { ...draft.files, [fileName]: (event.currentTarget as HTMLTextAreaElement).value } }))}></textarea></label>
        {/each}
      </div>
      {#if channelsStore.channelEdit.channel === "weixin"}
        <div class="provider-editor-toolbar"><strong>{session.text.channelQrTitle}</strong></div>
        <p class="settings-section-hint">{session.text.channelQrHint}</p>
        <label class="settings-field settings-field-wide"><span>{session.text.channelQrLink}</span><textarea rows="3" bind:value={channelsStore.qrLink} placeholder={session.text.channelQrLinkPlaceholder} autocomplete="off"></textarea></label>
        <div class="settings-row-actions channel-qr-actions">
          <button class="secondary-button" type="button" disabled={channelsStore.qrLoading} onclick={() => void generateChannelQr()}>{channelsStore.qrLoading ? session.text.loading : session.text.channelQrGenerate}</button>
          <button class="secondary-button" type="button" onclick={clearChannelQr}>{session.text.channelQrClear}</button>
          {#if channelsStore.qrLink}<a class="secondary-button" href={channelsStore.qrLink} target="_blank" rel="noreferrer">{session.text.channelQrOpen}</a>{/if}
        </div>
        {#if channelsStore.qrImage}<div class="channel-qr-result"><img src={channelsStore.qrImage} alt="WeChat login QR code" width="220" height="220" /><p>{session.text.channelQrScan}</p></div>{/if}
        {#if channelsStore.qrError}<p class="settings-action-message error-text">{channelsStore.qrError}</p>{/if}
      {/if}
      </div>
      <footer class="entity-editor-foot"><button class="secondary-button" type="button" disabled={channelsStore.saving} onclick={() => (channelsStore.channelEdit = null)}>{session.text.cancel}</button><button class="primary-button" type="submit" disabled={channelsStore.saving || !channelsStore.channelEdit.id.trim()}>{channelsStore.saving ? session.text.onboardingProviderSaving : session.text.save}</button></footer>
    </form>
    </Dialog>
  {/if}

  {#if deletingChannelInstance}
    <AlertDialog
      open={true}
      contentClass="modal-card"
      labelledBy="channel-delete-title"
      describedBy="channel-delete-description"
      onOpenChange={(next) => { if (!next) deletingChannelInstance = null; }}
    >
      <header class="modal-head"><strong id="channel-delete-title">{session.text.channelDelete}</strong></header>
      <div class="modal-body"><p id="channel-delete-description"><strong>{deletingChannelInstance.name}</strong> · {session.text.channelDeleteConfirm}</p></div>
      <footer class="provider-modal-foot">
        <button class="secondary-button" type="button" onclick={() => (deletingChannelInstance = null)}>{session.text.cancel}</button>
        <button class="primary-button danger-action" type="button" onclick={() => void handleConfirmDelete()}>{session.text.channelDelete}</button>
      </footer>
    </AlertDialog>
  {/if}

  {#if channelsStore.actionMessage}<p class="settings-action-message" aria-live="polite">{channelsStore.actionMessage}</p>{/if}
{/if}
