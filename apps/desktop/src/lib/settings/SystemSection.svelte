<script lang="ts">
  import { onDestroy } from "svelte";
  import type { DesktopSystemConfig } from "@molibot/desktop-contract";
  import SettingGroup from "../components/ui/SettingGroup.svelte";
  import SettingRow from "../components/ui/SettingRow.svelte";
  import EmptyState from "../components/ui/EmptyState.svelte";
  import SelectControl from "../components/ui/SelectControl.svelte";
  import IosSwitch from "../components/ui/IosSwitch.svelte";
  import { loadDesktopSystem, saveDesktopSystem } from "../api";
  import { session, setError, notifySettingsChanged } from "../stores/session.svelte";
  import { trackUnsaved } from "../unsavedGuard";
  import { buildDesktopSystemPatch } from "./systemConfig";
  import { timezoneOptions } from "./timezones";

  let saved = $state<DesktopSystemConfig | null>(null);
  let draft = $state<DesktopSystemConfig | null>(null);
  let loading = $state(false);
  let saving = $state(false);
  let failed = $state(false);
  let loadRevision = $state(0);
  let savedMessage = $state(false);
  const dirty = $derived(draft !== null && saved !== null && Object.keys(buildDesktopSystemPatch(draft, saved)).length > 0);
  const timezones = $derived(draft ? [...new Set([draft.timezone, ...timezoneOptions()])].map(value => ({ value, label: value })) : []);
  const budgetFields = $derived([
    { key: "maxToolCalls" as const, label: session.text.systemMaxToolCalls, max: 500 },
    { key: "maxToolFailures" as const, label: session.text.systemMaxToolFailures, max: 100 },
    { key: "maxModelAttempts" as const, label: session.text.systemMaxModelRetries, max: 100 }
  ]);
  const childFields = $derived([
    { key: "maxToolCalls" as const, label: session.text.systemMaxToolCalls, min: 1, max: 500 },
    { key: "maxToolFailures" as const, label: session.text.systemMaxToolFailures, min: 1, max: 100 },
    { key: "maxModelTurns" as const, label: session.text.systemMaxModelTurns, min: 1, max: 100 },
    { key: "deadlineMs" as const, label: session.text.systemDeadline, min: 1000, max: 86400000 },
    { key: "maxTasks" as const, label: session.text.systemMaxTasks, min: 1, max: 16 },
    { key: "maxConcurrency" as const, label: session.text.systemMaxConcurrency, min: 1, max: 4 }
  ]);
  const progressOptions = $derived([
    { value: "off", label: session.text.systemProgressOff }, { value: "new", label: session.text.systemProgressNew },
    { value: "all", label: session.text.systemProgressAll }, { value: "verbose", label: session.text.systemProgressVerbose }
  ]);
  const reasoningOptions = $derived([
    { value: "off", label: session.text.systemReasoningOff }, { value: "on", label: session.text.systemReasoningOn },
    { value: "stream", label: session.text.systemReasoningStream }, { value: "new", label: session.text.systemReasoningNew }
  ]);

  $effect(() => {
    const endpoint = session.endpoint;
    const ready = session.serviceReady;
    loadRevision;
    if (!ready || !endpoint) return;
    let cancelled = false;
    loading = true; failed = false; savedMessage = false;
    loadDesktopSystem(endpoint).then(config => {
      if (cancelled) return;
      saved = structuredClone(config); draft = structuredClone(config);
    }).catch(cause => {
      if (cancelled) return;
      failed = true; setError(cause);
    }).finally(() => { if (!cancelled) loading = false; });
    return () => { cancelled = true; };
  });

  function discard(): void {
    if (saved) draft = structuredClone($state.snapshot(saved));
    savedMessage = false;
  }

  async function save(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!draft || !saved || !session.endpoint || saving || !dirty) return;
    const endpoint = session.endpoint;
    const patch = buildDesktopSystemPatch(draft, saved);
    saving = true; savedMessage = false;
    try {
      const config = await saveDesktopSystem(endpoint, patch);
      if (endpoint !== session.endpoint) return;
      saved = structuredClone(config); draft = structuredClone(config);
      savedMessage = true; notifySettingsChanged();
    } catch (cause) { setError(cause); }
    finally { saving = false; }
  }

  onDestroy(trackUnsaved(() => dirty));
</script>

{#if !session.serviceReady}
  <SettingGroup><EmptyState title={session.text.unavailable} icon="shield-warning" /></SettingGroup>
{:else if loading}
  <SettingGroup><SettingRow title={session.text.loading} /></SettingGroup>
{:else if failed}
  <SettingGroup><SettingRow title={session.text.systemLoadFailed}>
    <button class="secondary-button" type="button" onclick={() => loadRevision++}>{session.text.systemRetryLoad}</button>
  </SettingRow></SettingGroup>
{:else if draft}
  <form id="desktop-system-form" onsubmit={save}>
    <fieldset class="settings-form-fieldset" disabled={saving}>
      <SettingGroup title={session.text.systemTimezone}>
        <SettingRow title={session.text.systemTimezone} description={session.text.systemTimezoneHint}>
          <SelectControl value={draft.timezone} options={timezones} ariaLabel={session.text.systemTimezone} onChange={value => draft!.timezone = value} />
        </SettingRow>
      </SettingGroup>
      <SettingGroup title={session.text.systemBudget} description={session.text.systemBudgetHint}>
        {#each budgetFields as field (field.key)}
          <SettingRow title={field.label}>
            <input class="row-input model-number-input" type="number" min="1" max={field.max} step="1" required aria-label={field.label} bind:value={draft.budget[field.key]} />
          </SettingRow>
        {/each}
      </SettingGroup>
      <SettingGroup title={session.text.systemSubagent} description={session.text.systemSubagentHint}>
        {#each childFields as field (field.key)}
          <SettingRow title={field.label}>
            <input class="row-input model-number-input" type="number" min={field.min} max={field.key === "maxConcurrency" ? Math.min(field.max, draft.subagentRuntime.maxTasks) : field.max} step="1" required aria-label={field.label} bind:value={draft.subagentRuntime[field.key]} />
          </SettingRow>
        {/each}
        <SettingRow title={session.text.systemCompaction}>
          <IosSwitch checked={draft.subagentRuntime.compactionEnabled} ariaLabel={session.text.systemCompaction} onCheckedChange={value => draft!.subagentRuntime.compactionEnabled = value} />
        </SettingRow>
        <SettingRow title={session.text.systemPersistSessions}>
          <IosSwitch checked={draft.subagentRuntime.persistSessions} ariaLabel={session.text.systemPersistSessions} onCheckedChange={value => draft!.subagentRuntime.persistSessions = value} />
        </SettingRow>
      </SettingGroup>
      <SettingGroup title={session.text.systemBrowser} description={session.text.systemBrowserHint}>
        <SettingRow title={session.text.systemBrowserTimeout}>
          <input class="row-input model-number-input" type="number" min="5000" max="300000" step="1" required aria-label={session.text.systemBrowserTimeout} bind:value={draft.browserAutomation.defaultTimeoutMs} />
        </SettingRow>
      </SettingGroup>
      <SettingGroup title={session.text.systemDisplay} description={session.text.systemDisplayHint}>
        <SettingRow title={session.text.systemToolProgress}>
          <SelectControl value={draft.display.toolProgress} options={progressOptions} ariaLabel={session.text.systemToolProgress} onChange={value => draft!.display.toolProgress = value as DesktopSystemConfig["display"]["toolProgress"]} />
        </SettingRow>
        <SettingRow title={session.text.systemReasoning}>
          <SelectControl value={draft.display.showReasoning} options={reasoningOptions} ariaLabel={session.text.systemReasoning} onChange={value => draft!.display.showReasoning = value as DesktopSystemConfig["display"]["showReasoning"]} />
        </SettingRow>
        <SettingRow title={session.text.systemNotifyInterval} description={session.text.systemNotifyIntervalHint}>
          <input class="row-input model-number-input" type="number" min="0" step="1" required aria-label={session.text.systemNotifyInterval} bind:value={draft.display.gatewayNotifyInterval} />
        </SettingRow>
        <SettingRow title={session.text.systemRunLogNotice}>
          <IosSwitch checked={draft.display.runLogNotice} ariaLabel={session.text.systemRunLogNotice} onCheckedChange={value => draft!.display.runLogNotice = value} />
        </SettingRow>
      </SettingGroup>
    </fieldset>
  </form>
  <footer class="settings-footbar">
    <span class="settings-footbar-label">{dirty ? session.text.settingsUnsaved : savedMessage ? session.text.systemSaved : ""}</span>
    <div class="settings-footbar-actions">
      <button class="secondary-button" type="button" disabled={!dirty || saving} onclick={discard}>{session.text.cancel}</button>
      <button class="primary-button" type="submit" form="desktop-system-form" disabled={!dirty || saving}>{saving ? session.text.systemSaving : session.text.save}</button>
    </div>
  </footer>
{/if}
