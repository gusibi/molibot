<script lang="ts">
  import Check from "reicon-svelte/icons/Check";
  import Hand from "reicon-svelte/icons/Hand";
  import Lightning from "reicon-svelte/icons/Lightning";
  import ListCheck from "reicon-svelte/icons/ListCheck";
  import PenLine from "reicon-svelte/icons/PenLine";
  import type { ReiconComponent } from "../components/ui/iconTypes";
  import SettingGroup from "../components/ui/SettingGroup.svelte";
  import SettingRow from "../components/ui/SettingRow.svelte";
  import EmptyState from "../components/ui/EmptyState.svelte";
  import { session } from "../stores/session.svelte";
  import { tablist } from "../a11y/tablist";

  type Mode = "plan" | "manual" | "accept_edits" | "auto";

  let defaultMode: Mode = $state("accept_edits");
  let savedMode: Mode = $state("accept_edits");
  let loading = $state(false);
  let saving = $state(false);
  let actionMessage = $state("");

  const MODE_ICONS: Record<Mode, ReiconComponent> = {
    plan: ListCheck,
    manual: Hand,
    accept_edits: PenLine,
    auto: Lightning
  };

  const modes: readonly Mode[] = ["plan", "manual", "accept_edits", "auto"];

  function modeLabel(mode: Mode): string {
    return {
      plan: session.text.permissionModePlan,
      manual: session.text.permissionModeManual,
      accept_edits: session.text.permissionModeAcceptEdits,
      auto: session.text.permissionModeAuto
    }[mode];
  }

  function modeHint(mode: Mode): string {
    return {
      plan: session.text.permissionModePlanHint,
      manual: session.text.permissionModeManualHint,
      accept_edits: session.text.permissionModeAcceptEditsHint,
      auto: session.text.permissionModeAutoHint
    }[mode];
  }

  function selectMode(mode: Mode): void {
    defaultMode = mode;
    actionMessage = "";
  }

  $effect(() => {
    if (!session.serviceReady || !session.endpoint) return;
    loading = true;
    fetch(`${session.endpoint}/api/desktop/execution-default`)
      .then((res) => res.json())
      .then((payload: { ok: boolean; mode?: Mode }) => {
        if (payload.ok && payload.mode) {
          defaultMode = payload.mode;
          savedMode = payload.mode;
        }
      })
      .catch(() => undefined)
      .finally(() => (loading = false));
  });

  async function save(): Promise<void> {
    if (saving) return;
    saving = true;
    actionMessage = "";
    try {
      const res = await fetch(`${session.endpoint}/api/desktop/execution-default`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: defaultMode })
      });
      const payload = (await res.json()) as { ok: boolean; mode?: Mode; error?: string };
      if (payload.ok && payload.mode) {
        savedMode = payload.mode;
        actionMessage = session.text.executionDefaultSaved;
      } else {
        actionMessage = payload.error ?? session.text.executionDefaultSaveFailed;
      }
    } catch {
      actionMessage = session.text.executionDefaultSaveFailed;
    } finally {
      saving = false;
    }
  }

  const dirty = $derived(defaultMode !== savedMode);
</script>

{#if !session.serviceReady}
  <SettingGroup><EmptyState title={session.text.sandboxUnavailable} icon="shield-slash" /></SettingGroup>
{:else}
  <div class="settings-card provider-editor">
    <div class="provider-editor-toolbar">
      <div>
        <strong>{session.text.executionDefaultTitle}</strong>
        <p>{session.text.executionDefaultHint}</p>
      </div>
    </div>
    <div class="execution-mode-grid" role="radiogroup" aria-label={session.text.executionDefaultTitle} use:tablist={'[role="radio"]'}>
      {#each modes as mode (mode)}
        {@const ModeIcon = MODE_ICONS[mode]}
        <button
          type="button"
          role="radio"
          aria-checked={defaultMode === mode}
          tabindex={defaultMode === mode ? 0 : -1}
          class="execution-mode-card"
          class:active={defaultMode === mode}
          data-mode={mode}
          onclick={() => selectMode(mode)}
        >
          <div class="execution-mode-card-header">
            <ModeIcon size={15} aria-hidden="true" />
            <span class="execution-mode-title">{modeLabel(mode)}</span>
            {#if defaultMode === mode}<Check size={12} aria-hidden="true" />{/if}
          </div>
          <p class="execution-mode-desc">{modeHint(mode)}</p>
        </button>
      {/each}
    </div>
    <SettingRow title={session.text.executionAutoScope}>
      <span class="diag-value">{session.text.executionAutoScopeValue}</span>
    </SettingRow>
  </div>
  {#if actionMessage}<p class="settings-action-message" aria-live="polite">{actionMessage}</p>{/if}
{/if}

{#if dirty}
  <footer class="settings-footbar">
    <span class="settings-footbar-label">{session.text.settingsUnsaved}</span>
    <div class="settings-footbar-actions">
      <button class="secondary-button" type="button" disabled={saving} onclick={() => (defaultMode = savedMode)}>{session.text.discardChanges}</button>
      <button class="primary-button" type="button" disabled={saving || loading} onclick={() => void save()}>{saving ? session.text.onboardingProviderSaving : session.text.sandboxSave}</button>
    </div>
  </footer>
{/if}
