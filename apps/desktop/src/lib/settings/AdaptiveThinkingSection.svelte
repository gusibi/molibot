<script lang="ts">
  import Eye from "reicon-svelte/icons/Eye";
  import EyeSlash from "reicon-svelte/icons/EyeSlash";
  import { onDestroy } from "svelte";
  import EmptyState from "../components/ui/EmptyState.svelte";
  import IosSwitch from "../components/ui/IosSwitch.svelte";
  import SelectControl from "../components/ui/SelectControl.svelte";
  import SettingGroup from "../components/ui/SettingGroup.svelte";
  import SettingRow from "../components/ui/SettingRow.svelte";
  import { session, notifySettingsChanged } from "../stores/session.svelte";
  import { trackUnsaved } from "../unsavedGuard";
  import {
    loadDesktopAdaptiveThinkingSettings,
    saveDesktopAdaptiveThinkingSettings,
    testDesktopAdaptiveThinkingConnection,
    type DesktopAdaptiveThinkingSettings
  } from "../api";

  type ThinkingLevel = "low" | "medium" | "high";
  type Strategy = "fixed" | "auto";

  let edit = $state<DesktopAdaptiveThinkingSettings | null>(null);
  let saved = $state<DesktopAdaptiveThinkingSettings | null>(null);
  let apiKey = $state("");
  let clearApiKey = $state(false);
  let showApiKey = $state(false);
  let loading = $state(false);
  let saving = $state(false);
  let testing = $state(false);
  let loadedEndpoint = $state("");
  let message = $state("");
  let failure = $state("");

  const dirty = $derived(Boolean(edit && saved && (
    JSON.stringify(edit) !== JSON.stringify(saved) || apiKey.trim() !== "" || clearApiKey
  )));

  function copyConfig(value: DesktopAdaptiveThinkingSettings): DesktopAdaptiveThinkingSettings {
    return { ...value };
  }

  function levelOptions(): { value: ThinkingLevel; label: string }[] {
    return [
      { value: "low", label: session.text.thinkingLow },
      { value: "medium", label: session.text.thinkingMedium },
      { value: "high", label: session.text.thinkingHigh }
    ];
  }

  $effect(() => {
    if (!session.serviceReady || !session.endpoint || session.endpoint === loadedEndpoint) return;
    loadedEndpoint = session.endpoint;
    loading = true;
    failure = "";
    loadDesktopAdaptiveThinkingSettings(session.endpoint)
      .then((value) => {
        edit = copyConfig(value);
        saved = copyConfig(value);
        apiKey = "";
        clearApiKey = false;
        message = "";
      })
      .catch((cause) => {
        failure = cause instanceof Error ? cause.message : String(cause);
      })
      .finally(() => (loading = false));
  });

  function reset(): void {
    if (!saved) return;
    edit = copyConfig(saved);
    apiKey = "";
    clearApiKey = false;
    message = "";
    failure = "";
  }

  function updateEdit(patch: Partial<DesktopAdaptiveThinkingSettings>): void {
    if (edit) edit = { ...edit, ...patch };
  }

  async function testConnection(): Promise<void> {
    if (!edit || !session.endpoint || !apiKey.trim() || testing) return;
    testing = true;
    message = "";
    failure = "";
    try {
      const result = await testDesktopAdaptiveThinkingConnection(
        session.endpoint,
        edit.baseUrl,
        apiKey,
        edit.timeoutMs
      );
      message = `${session.text.adaptiveThinkingTestSuccess}${result.model ? ` · ${result.model}` : ""}`;
    } catch (cause) {
      failure = cause instanceof Error ? cause.message : String(cause);
    } finally {
      testing = false;
    }
  }

  async function save(): Promise<void> {
    if (!edit || !session.endpoint || saving) return;
    saving = true;
    message = "";
    failure = "";
    try {
      const result = await saveDesktopAdaptiveThinkingSettings(
        session.endpoint,
        edit,
        apiKey,
        clearApiKey
      );
      edit = copyConfig(result);
      saved = copyConfig(result);
      apiKey = "";
      clearApiKey = false;
      message = session.text.adaptiveThinkingSaved;
      notifySettingsChanged();
    } catch (cause) {
      failure = cause instanceof Error ? cause.message : String(cause);
    } finally {
      saving = false;
    }
  }

  onDestroy(trackUnsaved(() => dirty));
</script>

{#if !session.serviceReady}
  <SettingGroup><EmptyState title={session.text.adaptiveThinkingUnavailable} icon="cpu" /></SettingGroup>
{:else if loading || !edit}
  <SettingGroup><div class="settings-row"><p>{session.text.loading}</p></div></SettingGroup>
{:else}
  <SettingGroup ariaLabel={session.text.adaptiveThinking}>
    <SettingRow title={session.text.adaptiveThinkingEnabled} description={session.text.adaptiveThinkingEnabledHint}>
      <IosSwitch checked={edit.enabled} ariaLabel={session.text.adaptiveThinkingEnabled} onCheckedChange={(checked) => updateEdit({ enabled: checked })} />
    </SettingRow>
    <div class="settings-form adaptive-thinking-form">
      <label class="settings-field settings-field-wide">
        <span>{session.text.adaptiveThinkingHost}</span>
        <input bind:value={edit.baseUrl} autocomplete="off" spellcheck="false" />
        <small>{session.text.adaptiveThinkingHostHint}</small>
      </label>
      <label class="settings-field settings-field-wide">
        <span>{session.text.adaptiveThinkingApiKey}</span>
        <div class="secret-input">
          <input type={showApiKey ? "text" : "password"} bind:value={apiKey} placeholder={edit.hasApiKey ? session.text.channelSecretConfigured : ""} autocomplete="new-password" spellcheck="false" />
          <button class="secret-reveal" type="button" aria-label={session.text.toggleReveal} onclick={() => (showApiKey = !showApiKey)}>
            {#if showApiKey}<EyeSlash size={16} aria-hidden="true" />{:else}<Eye size={16} aria-hidden="true" />{/if}
          </button>
        </div>
        <small>{session.text.adaptiveThinkingApiKeyHint}</small>
        {#if edit.hasApiKey}
          <label class="inline-check"><input type="checkbox" bind:checked={clearApiKey} />{session.text.channelClearSecret}</label>
        {/if}
      </label>
    </div>
    <div class="settings-row-actions">
      <button class="secondary-button" type="button" disabled={testing || saving || !apiKey.trim()} onclick={() => void testConnection()}>
        {testing ? session.text.loading : session.text.adaptiveThinkingTestConnection}
      </button>
    </div>
  </SettingGroup>

  <SettingGroup title={session.text.adaptiveThinkingPolicy} description={session.text.adaptiveThinkingPolicyHint}>
    <SettingRow title={session.text.adaptiveThinkingDefaultStrategy} description={session.text.adaptiveThinkingDefaultStrategyHint}>
      <SelectControl value={edit.defaultStrategy} ariaLabel={session.text.adaptiveThinkingDefaultStrategy} options={[{ value: "fixed", label: session.text.adaptiveThinkingFixed }, { value: "auto", label: session.text.adaptiveThinkingAuto }]} onChange={(value) => updateEdit({ defaultStrategy: value as Strategy })} />
    </SettingRow>
    <div class="settings-form adaptive-thinking-form">
      <label class="settings-field"><span>{session.text.adaptiveThinkingCeiling}</span><SelectControl value={edit.maxThinkingLevel} ariaLabel={session.text.adaptiveThinkingCeiling} options={levelOptions()} onChange={(value) => updateEdit({ maxThinkingLevel: value as ThinkingLevel })} /></label>
      <label class="settings-field"><span>{session.text.adaptiveThinkingFallback}</span><SelectControl value={edit.fallbackThinkingLevel} ariaLabel={session.text.adaptiveThinkingFallback} options={levelOptions()} onChange={(value) => updateEdit({ fallbackThinkingLevel: value as ThinkingLevel })} /></label>
      <label class="settings-field"><span>{session.text.adaptiveThinkingThreshold}</span><input type="number" min="0" max="1" step="0.01" bind:value={edit.confidenceThreshold} /></label>
      <label class="settings-field"><span>{session.text.adaptiveThinkingTimeout}</span><input type="number" min="100" max="5000" step="100" bind:value={edit.timeoutMs} /></label>
    </div>
  </SettingGroup>
{/if}

{#if failure}<p class="settings-action-message error-message" role="alert">{failure}</p>{/if}
{#if message}<p class="settings-action-message" aria-live="polite">{message}</p>{/if}
{#if dirty}
  <footer class="settings-footbar">
    <span class="settings-footbar-label">{session.text.settingsUnsaved}</span>
    <div class="settings-footbar-actions">
      <button class="secondary-button" type="button" disabled={saving} onclick={reset}>{session.text.cancel}</button>
      <button class="primary-button" type="button" disabled={saving} onclick={() => void save()}>{saving ? session.text.onboardingProviderSaving : session.text.save}</button>
    </div>
  </footer>
{/if}
