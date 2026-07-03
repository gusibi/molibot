<script lang="ts">
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

<p class="settings-section-hint">{session.text.ttsGenerateHint}</p>
{#if !session.serviceReady}
  <div class="settings-card"><div class="settings-row"><p>{session.text.ttsGenerateUnavailable}</p></div></div>
{:else if toolsStore.ttsGenerateLoading || !toolsStore.ttsGenerateEdit}
  <div class="settings-card"><div class="settings-row"><p>{session.text.loading}</p></div></div>
{:else}
  <div class="settings-card"><div class="settings-row"><strong>{session.text.webSearchEnabled}</strong><button class:active={toolsStore.ttsGenerateEdit.enabled} class="switch" type="button" role="switch" aria-checked={toolsStore.ttsGenerateEdit.enabled} aria-label={session.text.ttsGenerate} onclick={() => { if (toolsStore.ttsGenerateEdit) toolsStore.ttsGenerateEdit = { ...toolsStore.ttsGenerateEdit, enabled: !toolsStore.ttsGenerateEdit.enabled }; markToolSettingsDirty("ttsGenerate"); }}><span></span></button></div><div class="settings-row"><strong>{session.text.ttsDefaultProvider}</strong><select bind:value={toolsStore.ttsGenerateEdit.defaultProvider} onchange={() => markToolSettingsDirty("ttsGenerate")}>{#each toolsStore.ttsGenerateEdit.providers as provider (provider.id)}<option value={provider.id}>{ttsProviderLabel(provider.id, session.text)}</option>{/each}</select></div></div>
  <p class="settings-group-title">{session.text.ttsProviders}</p><div class="settings-card tool-engine-list">{#each toolsStore.ttsGenerateEdit.providers as provider (provider.id)}<details class="tool-engine-card" open={provider.id === toolsStore.ttsGenerateEdit.defaultProvider}><summary><span>{ttsProviderLabel(provider.id, session.text)}</span><span class="status-badge" data-state={provider.enabled ? "ready" : "disconnected"}>{provider.enabled ? session.text.providerEnabled : session.text.providerDisabled}</span></summary><div class="tool-engine-body"><div class="settings-row"><strong>{session.text.providerEnabledLabel}</strong><button class:active={provider.enabled} class="switch" type="button" role="switch" aria-checked={provider.enabled} aria-label={ttsProviderLabel(provider.id, session.text)} onclick={() => { if (toolsStore.ttsGenerateEdit) toolsStore.ttsGenerateEdit = { ...toolsStore.ttsGenerateEdit, providers: toolsStore.ttsGenerateEdit.providers.map((item) => item.id === provider.id ? { ...item, enabled: !item.enabled } : item) }; markToolSettingsDirty("ttsGenerate"); }}><span></span></button></div><div class="settings-form">{#if provider.id === "macos"}<label class="settings-field"><span>{session.text.ttsVoice}</span><select bind:value={provider.voice} onchange={() => markToolSettingsDirty("ttsGenerate")}><option value="">{session.text.ttsSystemVoices}</option>{#each toolsStore.ttsVoices as voice (voice.id)}<option value={voice.id}>{voice.label ?? voice.id}{voice.locale ? ` · ${voice.locale}` : ""}</option>{/each}</select></label>{:else}<label class="settings-field"><span>{session.text.toolBaseUrl}</span><input bind:value={provider.baseUrl} oninput={() => markToolSettingsDirty("ttsGenerate")} /></label><label class="settings-field"><span>{session.text.toolModel}</span><input bind:value={provider.model} oninput={() => markToolSettingsDirty("ttsGenerate")} /></label><label class="settings-field"><span>{session.text.ttsVoice}</span><select bind:value={provider.voice} onchange={() => markToolSettingsDirty("ttsGenerate")}>{#each XIAOMI_VOICES as voice (voice.id)}<option value={voice.id}>{voice.label}{voice.gender ? ` · ${voice.gender}` : ""}{voice.locale ? ` · ${voice.locale}` : ""}</option>{/each}</select></label><label class="settings-field"><span>{session.text.webSearchApiKey}</span><div class="secret-input"><input type={secretRevealed(`tts:${provider.id}`) ? "text" : "password"} bind:value={provider.apiKey} placeholder={provider.hasApiKey ? session.text.channelSecretConfigured : ""} autocomplete="new-password" oninput={() => markToolSettingsDirty("ttsGenerate")} /><button class="secret-reveal" type="button" aria-label={session.text.toggleReveal} onclick={(event) => { event.preventDefault(); toggleRevealSecret(`tts:${provider.id}`); }}><i class={`ph ${secretRevealed(`tts:${provider.id}`) ? "ph-eye-slash" : "ph-eye"}`}></i></button></div>{#if provider.hasApiKey}<label class="inline-check"><input type="checkbox" bind:checked={provider.clearApiKey} onchange={() => markToolSettingsDirty("ttsGenerate")} /> {session.text.channelClearSecret}</label>{/if}</label>{/if}<label class="settings-field"><span>{session.text.ttsFormat}</span><select bind:value={provider.format} onchange={() => markToolSettingsDirty("ttsGenerate")}><option value="wav">WAV</option><option value="mp3">MP3</option><option value="aiff">AIFF</option><option value="m4a">M4A</option><option value="caf">CAF</option></select></label></div></div></details>{/each}</div>
  <p class="settings-group-title">{session.text.toolTest}</p><div class="settings-card tool-test-card"><div class="settings-form"><label class="settings-field"><span>{session.text.ttsTestProvider}</span><select bind:value={toolsStore.ttsTestProvider}>{#each toolsStore.ttsGenerateEdit.providers as provider (provider.id)}<option value={provider.id}>{ttsProviderLabel(provider.id, session.text)}</option>{/each}</select></label><label class="settings-field"><span>{session.text.toolTestText}</span><input bind:value={toolsStore.ttsTestText} /></label></div><div class="settings-row-actions tool-test-actions"><button class="secondary-button" type="button" disabled={toolsStore.testBusy} onclick={() => void testToolSettings("ttsGenerate")}>{toolsStore.testBusy ? session.text.loading : session.text.toolTest}</button></div>{#if toolsStore.ttsTestAudioUrl}<audio class="tool-test-audio" controls src={toolsStore.ttsTestAudioUrl}>{session.text.ttsAudioUnsupported}</audio>{/if}{#if toolsStore.testResult}<pre class:run-history-failed={!toolsStore.testResult.ok} class="tool-test-result">{JSON.stringify(toolsStore.testResult.result ?? toolsStore.testResult.error, null, 2)}</pre>{/if}</div>
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
