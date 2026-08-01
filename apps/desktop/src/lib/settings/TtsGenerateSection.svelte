<script lang="ts">
  import IosSwitch from "../components/ui/IosSwitch.svelte";
  import SelectControl from "../components/ui/SelectControl.svelte";
  import { session } from "../stores/session.svelte";
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
</script>

{#if !session.serviceReady}
  <div class="settings-card"><div class="settings-row"><p>{session.text.ttsGenerateUnavailable}</p></div></div>
{:else if toolsStore.ttsGenerateLoading || !toolsStore.ttsGenerateEdit}
  <div class="settings-card"><div class="settings-row"><p>{session.text.loading}</p></div></div>
{:else}
  <div class="settings-card"><div class="settings-row"><strong>{session.text.webSearchEnabled}</strong><IosSwitch checked={toolsStore.ttsGenerateEdit.enabled} ariaLabel={session.text.ttsGenerate} onCheckedChange={(checked) => { if (toolsStore.ttsGenerateEdit) toolsStore.ttsGenerateEdit = { ...toolsStore.ttsGenerateEdit, enabled: checked }; markToolSettingsDirty("ttsGenerate"); }} /></div><div class="settings-row"><strong>{session.text.ttsDefaultProvider}</strong><SelectControl value={toolsStore.ttsGenerateEdit.defaultProvider} ariaLabel={session.text.ttsDefaultProvider} options={toolsStore.ttsGenerateEdit.providers.map((provider) => ({ value: provider.id, label: ttsProviderLabel(provider.id, session.text) }))} onChange={(value) => { toolsStore.ttsGenerateEdit!.defaultProvider = value; markToolSettingsDirty("ttsGenerate"); }} /></div></div>
  <p class="settings-group-title">{session.text.ttsProviders}</p><div class="settings-card tool-engine-list">{#each toolsStore.ttsGenerateEdit.providers as provider (provider.id)}<details class="tool-engine-card" open={provider.id === toolsStore.ttsGenerateEdit.defaultProvider}><summary><span>{ttsProviderLabel(provider.id, session.text)}</span><span class="status-badge" data-state={provider.enabled ? "ready" : "disconnected"}>{provider.enabled ? session.text.providerEnabled : session.text.providerDisabled}</span></summary><div class="tool-engine-body"><div class="settings-row"><strong>{session.text.providerEnabledLabel}</strong><IosSwitch checked={provider.enabled} ariaLabel={ttsProviderLabel(provider.id, session.text)} onCheckedChange={(checked) => { if (toolsStore.ttsGenerateEdit) toolsStore.ttsGenerateEdit = { ...toolsStore.ttsGenerateEdit, providers: toolsStore.ttsGenerateEdit.providers.map((item) => item.id === provider.id ? { ...item, enabled: checked } : item) }; markToolSettingsDirty("ttsGenerate"); }} /></div><div class="settings-form">{#if provider.id === "macos"}<label class="settings-field"><span>{session.text.ttsVoice}</span><SelectControl value={provider.voice} ariaLabel={session.text.ttsVoice} options={[{ value: "", label: session.text.ttsSystemVoices }, ...toolsStore.ttsVoices.map((voice) => ({ value: voice.id, label: `${voice.label ?? voice.id}${voice.locale ? ` · ${voice.locale}` : ""}` }))]} onChange={(value) => { provider.voice = value; markToolSettingsDirty("ttsGenerate"); }} /></label>{:else}<label class="settings-field"><span>{session.text.toolBaseUrl}</span><input bind:value={provider.baseUrl} oninput={() => markToolSettingsDirty("ttsGenerate")} /></label><label class="settings-field"><span>{session.text.toolModel}</span><input bind:value={provider.model} oninput={() => markToolSettingsDirty("ttsGenerate")} /></label><label class="settings-field"><span>{session.text.ttsVoice}</span><SelectControl value={provider.voice} ariaLabel={session.text.ttsVoice} options={XIAOMI_VOICES.map((voice) => ({ value: voice.id, label: `${voice.label}${voice.gender ? ` · ${voice.gender}` : ""}${voice.locale ? ` · ${voice.locale}` : ""}` }))} onChange={(value) => { provider.voice = value; markToolSettingsDirty("ttsGenerate"); }} /></label><label class="settings-field"><span>{session.text.webSearchApiKey}</span><div class="secret-input"><input type={secretRevealed(`tts:${provider.id}`) ? "text" : "password"} bind:value={provider.apiKey} placeholder={provider.hasApiKey ? session.text.channelSecretConfigured : ""} autocomplete="new-password" oninput={() => markToolSettingsDirty("ttsGenerate")} /><button class="secret-reveal" type="button" aria-label={session.text.toggleReveal} onclick={(event) => { event.preventDefault(); toggleRevealSecret(`tts:${provider.id}`); }}><i class={`ph ${secretRevealed(`tts:${provider.id}`) ? "ph-eye-slash" : "ph-eye"}`}></i></button></div>{#if provider.hasApiKey}<label class="inline-check"><input type="checkbox" bind:checked={provider.clearApiKey} onchange={() => markToolSettingsDirty("ttsGenerate")} /> {session.text.channelClearSecret}</label>{/if}</label>{/if}<label class="settings-field"><span>{session.text.ttsFormat}</span><SelectControl value={provider.format} ariaLabel={session.text.ttsFormat} options={["wav", "mp3", "aiff", "m4a", "caf"].map((format) => ({ value: format, label: format.toUpperCase() }))} onChange={(value) => { provider.format = value; markToolSettingsDirty("ttsGenerate"); }} /></label></div></div></details>{/each}</div>
  <p class="settings-group-title">{session.text.toolTest}</p><div class="settings-card tool-test-card"><div class="settings-form"><label class="settings-field"><span>{session.text.ttsTestProvider}</span><SelectControl value={toolsStore.ttsTestProvider} ariaLabel={session.text.ttsTestProvider} options={toolsStore.ttsGenerateEdit.providers.map((provider) => ({ value: provider.id, label: ttsProviderLabel(provider.id, session.text) }))} onChange={(value) => toolsStore.ttsTestProvider = value} /></label><label class="settings-field"><span>{session.text.toolTestText}</span><input bind:value={toolsStore.ttsTestText} /></label></div><div class="settings-row-actions tool-test-actions"><button class="secondary-button" type="button" disabled={toolsStore.testBusy} onclick={() => void testToolSettings("ttsGenerate")}>{toolsStore.testBusy ? session.text.loading : session.text.toolTest}</button></div>{#if toolsStore.ttsTestAudioUrl}<audio class="tool-test-audio" controls src={toolsStore.ttsTestAudioUrl}>{session.text.ttsAudioUnsupported}</audio>{/if}{#if toolsStore.testResult}<pre class:run-history-failed={!toolsStore.testResult.ok} class="tool-test-result">{JSON.stringify(toolsStore.testResult.result ?? toolsStore.testResult.error, null, 2)}</pre>{/if}</div>
{/if}

{#if toolsStore.message}<p class="settings-action-message">{toolsStore.message}</p>{/if}
{#if toolsStore.dirty.has("ttsGenerate")}
  <footer class="settings-footbar">
    <span class="settings-footbar-label">{session.text.settingsUnsaved}</span>
    <div class="settings-footbar-actions">
      <button class="primary-button" type="button" disabled={toolsStore.saving} onclick={() => void saveToolSettings("ttsGenerate")}>{toolsStore.saving ? session.text.onboardingProviderSaving : session.text.save}</button>
    </div>
  </footer>
{/if}
