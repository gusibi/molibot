<script lang="ts">
  import Eye from "reicon-svelte/icons/Eye";
  import EyeSlash from "reicon-svelte/icons/EyeSlash";
  import { onDestroy } from "svelte";
  import EmptyState from "../components/ui/EmptyState.svelte";
  import IosSwitch from "../components/ui/IosSwitch.svelte";
  import SelectControl from "../components/ui/SelectControl.svelte";
  import SettingGroup from "../components/ui/SettingGroup.svelte";
  import SettingRow from "../components/ui/SettingRow.svelte";
  import { session } from "../stores/session.svelte";
  import { trackUnsaved } from "../unsavedGuard";
  import {
    toolsStore,
    XIAOMI_VOICES,
    loadTts,
    markToolSettingsDirty,
    saveToolSettings,
    secretRevealed,
    testToolSettings,
    toggleRevealSecret,
    ttsProviderLabel
  } from "../stores/tools.svelte";

  $effect(() => {
    if (session.serviceReady && session.endpoint && session.endpoint !== toolsStore.ttsGenerateEndpoint) {
      void loadTts(session.endpoint);
    }
  });

  onDestroy(trackUnsaved(() => toolsStore.dirty.has("ttsGenerate")));
</script>

{#if !session.serviceReady}
  <SettingGroup><EmptyState title={session.text.ttsGenerateUnavailable} icon="speaker-high" /></SettingGroup>
{:else if toolsStore.ttsGenerateLoading || !toolsStore.ttsGenerateEdit}
  <SettingGroup><div class="settings-row"><p>{session.text.loading}</p></div></SettingGroup>
{:else}
  <SettingGroup ariaLabel={session.text.ttsGenerateEnabled}>
    <SettingRow title={session.text.ttsGenerateEnabled}>
      <IosSwitch checked={toolsStore.ttsGenerateEdit.enabled} ariaLabel={session.text.ttsGenerateEnabled} onCheckedChange={(checked) => { if (toolsStore.ttsGenerateEdit) toolsStore.ttsGenerateEdit = { ...toolsStore.ttsGenerateEdit, enabled: checked }; markToolSettingsDirty("ttsGenerate"); }} />
    </SettingRow>
    <SettingRow title={session.text.ttsDefaultProvider}>
      <SelectControl value={toolsStore.ttsGenerateEdit.defaultProvider} ariaLabel={session.text.ttsDefaultProvider} options={toolsStore.ttsGenerateEdit.providers.map((provider) => ({ value: provider.id, label: ttsProviderLabel(provider.id, session.text) }))} onChange={(value) => { toolsStore.ttsGenerateEdit!.defaultProvider = value; markToolSettingsDirty("ttsGenerate"); }} />
    </SettingRow>
  </SettingGroup>

  <SettingGroup title={session.text.ttsProviders} contentClass="tool-engine-list">
    {#each toolsStore.ttsGenerateEdit.providers as provider (provider.id)}
      <details class="tool-engine-card" open={provider.id === toolsStore.ttsGenerateEdit.defaultProvider}>
        <summary>
          <span>{ttsProviderLabel(provider.id, session.text)}</span>
          <span class="status-badge" data-state={provider.enabled ? "ready" : "disconnected"}>{provider.enabled ? session.text.providerEnabled : session.text.providerDisabled}</span>
        </summary>
        <div class="tool-engine-body">
          <div class="settings-row">
            <strong>{session.text.providerEnabledLabel}</strong>
            <IosSwitch checked={provider.enabled} ariaLabel={ttsProviderLabel(provider.id, session.text)} onCheckedChange={(checked) => { if (toolsStore.ttsGenerateEdit) toolsStore.ttsGenerateEdit = { ...toolsStore.ttsGenerateEdit, providers: toolsStore.ttsGenerateEdit.providers.map((item) => item.id === provider.id ? { ...item, enabled: checked } : item) }; markToolSettingsDirty("ttsGenerate"); }} />
          </div>
          <div class="settings-form tool-provider-form">
            {#if provider.id === "macos"}
              <label class="settings-field">
                <span>{session.text.ttsVoice}</span>
                <SelectControl value={provider.voice} ariaLabel={session.text.ttsVoice} options={[{ value: "", label: session.text.ttsSystemVoices }, ...toolsStore.ttsVoices.map((voice) => ({ value: voice.id, label: `${voice.label ?? voice.id}${voice.locale ? ` · ${voice.locale}` : ""}` }))]} onChange={(value) => { provider.voice = value; markToolSettingsDirty("ttsGenerate"); }} />
              </label>
            {:else}
              <label class="settings-field">
                <span>{session.text.toolBaseUrl}</span>
                <input bind:value={provider.baseUrl} autocomplete="off" spellcheck="false" oninput={() => markToolSettingsDirty("ttsGenerate")} />
              </label>
              <label class="settings-field">
                <span>{session.text.toolModel}</span>
                <input bind:value={provider.model} autocomplete="off" spellcheck="false" oninput={() => markToolSettingsDirty("ttsGenerate")} />
              </label>
              <label class="settings-field">
                <span>{session.text.ttsVoice}</span>
                <SelectControl value={provider.voice} ariaLabel={session.text.ttsVoice} options={XIAOMI_VOICES.map((voice) => ({ value: voice.id, label: `${voice.label}${voice.gender ? ` · ${voice.gender}` : ""}${voice.locale ? ` · ${voice.locale}` : ""}` }))} onChange={(value) => { provider.voice = value; markToolSettingsDirty("ttsGenerate"); }} />
              </label>
              <label class="settings-field">
                <span>{session.text.ttsFormat}</span>
                <SelectControl value={provider.format} ariaLabel={session.text.ttsFormat} options={["wav", "mp3", "aiff", "m4a", "caf"].map((format) => ({ value: format, label: format.toUpperCase() }))} onChange={(value) => { provider.format = value; markToolSettingsDirty("ttsGenerate"); }} />
              </label>
              <label class="settings-field settings-field-wide">
                <span>{session.text.toolApiKey}</span>
                <div class="secret-input">
                  <input type={secretRevealed(`tts:${provider.id}`) ? "text" : "password"} aria-label={session.text.toolApiKey} bind:value={provider.apiKey} placeholder={provider.hasApiKey ? session.text.channelSecretConfigured : ""} autocomplete="new-password" spellcheck="false" oninput={() => markToolSettingsDirty("ttsGenerate")} />
                  <button class="secret-reveal" type="button" aria-label={session.text.toggleReveal} onclick={(event) => { event.preventDefault(); toggleRevealSecret(`tts:${provider.id}`); }}>
                    {#if secretRevealed(`tts:${provider.id}`)}<EyeSlash size={16} aria-hidden="true" />{:else}<Eye size={16} aria-hidden="true" />{/if}
                  </button>
                </div>
                {#if provider.hasApiKey}
                  <label class="inline-check">
                    <input type="checkbox" bind:checked={provider.clearApiKey} onchange={() => markToolSettingsDirty("ttsGenerate")} />
                    {session.text.channelClearSecret}
                  </label>
                {/if}
              </label>
            {/if}
            {#if provider.id === "macos"}
              <label class="settings-field">
                <span>{session.text.ttsFormat}</span>
                <SelectControl value={provider.format} ariaLabel={session.text.ttsFormat} options={["wav", "mp3", "aiff", "m4a", "caf"].map((format) => ({ value: format, label: format.toUpperCase() }))} onChange={(value) => { provider.format = value; markToolSettingsDirty("ttsGenerate"); }} />
              </label>
            {/if}
          </div>
        </div>
      </details>
    {/each}
  </SettingGroup>

  <SettingGroup title={session.text.toolTest} contentClass="tool-test-card">
    <div class="settings-form">
      <label class="settings-field">
        <span>{session.text.ttsTestProvider}</span>
        <SelectControl value={toolsStore.ttsTestProvider} ariaLabel={session.text.ttsTestProvider} options={toolsStore.ttsGenerateEdit.providers.map((provider) => ({ value: provider.id, label: ttsProviderLabel(provider.id, session.text) }))} onChange={(value) => toolsStore.ttsTestProvider = value} />
      </label>
      <label class="settings-field">
        <span>{session.text.toolTestText}</span>
        <input bind:value={toolsStore.ttsTestText} autocomplete="off" />
      </label>
    </div>
    <div class="settings-row-actions tool-test-actions">
      <button class="secondary-button" type="button" disabled={toolsStore.testBusy} onclick={() => void testToolSettings("ttsGenerate")}>{toolsStore.testBusy ? session.text.loading : session.text.toolTest}</button>
    </div>
    {#if toolsStore.ttsTestAudioUrl}
      <audio class="tool-test-audio" controls src={toolsStore.ttsTestAudioUrl}>{session.text.ttsAudioUnsupported}</audio>
    {/if}
    {#if toolsStore.testResult}
      <pre class:run-history-failed={!toolsStore.testResult.ok} class="tool-test-result">{JSON.stringify(toolsStore.testResult.result ?? toolsStore.testResult.error, null, 2)}</pre>
    {/if}
  </SettingGroup>
{/if}

{#if toolsStore.message}<p class="settings-action-message" aria-live="polite">{toolsStore.message}</p>{/if}
{#if toolsStore.dirty.has("ttsGenerate")}
  <footer class="settings-footbar">
    <span class="settings-footbar-label">{session.text.settingsUnsaved}</span>
    <div class="settings-footbar-actions">
      <button class="primary-button" type="button" disabled={toolsStore.saving} onclick={() => void saveToolSettings("ttsGenerate")}>{toolsStore.saving ? session.text.onboardingProviderSaving : session.text.save}</button>
    </div>
  </footer>
{/if}
