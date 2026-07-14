<script lang="ts">
  import { tick } from "svelte";
  import type { DesktopComposerSuggestion, DesktopModelOption, DesktopThinkingLevel } from "@molibot/desktop-contract";
  import type { Translation } from "../i18n";
  import { composerSuggestionsStore, ensureComposerSuggestions } from "./composerSuggestions.svelte";
  import ChatComposerShell from "./ChatComposerShell.svelte";
  import PendingFilesBar from "./PendingFilesBar.svelte";
  import QueuedMessagesBar from "./QueuedMessagesBar.svelte";
  import RecordingBar from "./RecordingBar.svelte";
  import SlashSuggestionMenu from "./SlashSuggestionMenu.svelte";

  export let copy: Translation;
  export let value = "";
  export let endpoint = "";
  export let projectId = "";
  export let sending = false;
  export let disabled = false;
  export let canSend = false;
  export let placeholder = "";
  export let modelReady = true;
  export let modelOptions: DesktopModelOption[] = [];
  export let activeModelKey = "";
  export let activeModelLabel = "";
  export let activeModelTitle = "";
  export let changingModel = false;
  export let thinkingLevel: DesktopThinkingLevel = "medium";
  export let thinkingLevelLabel = "";
  export let error = "";
  export let recordingError = "";
  export let queuedMessages: string[] = [];
  export let pendingFiles: File[] = [];
  export let pendingAudioUrls = new Map<File, string>();
  export let recording = false;
  export let recordingSeconds = 0;
  export let showSettingsAction = false;
  export let showFileTool = true;
  export let showRecordingTool = true;
  export let fileToolDisabled = false;
  export let recordingToolDisabled = false;
  export let inferAttachmentKind: (file: File) => "image" | "audio" | "video" | "file";
  export let onSend: () => void;
  export let onStop: () => void;
  export let onKeydown: (event: KeyboardEvent) => void;
  export let onPickFiles: () => void;
  export let onToggleRecording: () => void;
  export let onFinishRecording: (send: boolean) => void;
  export let onRemoveQueued: (index: number) => void;
  export let onRemoveFile: (index: number) => void;
  export let onDismissError: () => void;
  export let onDismissRecordingError: () => void;
  export let onOpenSettings: () => void;
  export let onChangeModel: (event: Event) => void;

  $: modelPillLabel = activeModelLabel || copy.model;
  $: thinkingPillLabel = thinkingLevelLabel || copy.thinkingLevel;
  let activeSuggestionIndex = 0;
  let suggestionsDismissed = false;

  $: if (endpoint) void ensureComposerSuggestions(endpoint, projectId);
  $: suggestionQuery = value.match(/^\/([^\s]*)$/)?.[1]?.toLowerCase() ?? null;
  $: filteredSuggestions = suggestionQuery === null || suggestionsDismissed ? [] : composerSuggestionsStore.items
    .filter((item) => !suggestionQuery || item.label.slice(1).toLowerCase().includes(suggestionQuery) || item.aliases.some((alias) => alias.toLowerCase().includes(suggestionQuery)))
    .slice(0, 10);
  $: if (activeSuggestionIndex >= filteredSuggestions.length) activeSuggestionIndex = 0;

  function handleComposerKeydown(event: KeyboardEvent): void {
    if (filteredSuggestions.length > 0 && !event.isComposing) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        activeSuggestionIndex = (activeSuggestionIndex + delta + filteredSuggestions.length) % filteredSuggestions.length;
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        suggestionsDismissed = true;
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        selectSuggestion(filteredSuggestions[activeSuggestionIndex]);
        return;
      }
    }
    if (event.key.length === 1 || event.key === "Backspace" || event.key === "Delete") suggestionsDismissed = false;
    onKeydown(event);
  }

  function selectSuggestion(suggestion: DesktopComposerSuggestion | undefined): void {
    if (!suggestion) return;
    value = suggestion.insertText;
    suggestionsDismissed = true;
    activeSuggestionIndex = 0;
    if (suggestion.submitOnSelect) void tick().then(onSend);
  }
</script>

<footer class="composer-wrap">
  {#if !modelReady}
    <div class="model-banner" role="status">
      <div>
        <strong>{copy.noModelBannerTitle}</strong>
        <p>{copy.noModelBannerHint}</p>
      </div>
      {#if showSettingsAction}
        <button class="secondary-button" type="button" onclick={onOpenSettings}>{copy.openSettings}</button>
      {/if}
    </div>
  {/if}

  {#if error}
    <div class="composer-error" role="alert">
      <i class="ph ph-warning-circle" aria-hidden="true"></i>
      <span><strong>{copy.chatErrorTitle}</strong>{error}</span>
      <button type="button" aria-label={copy.chatErrorDismiss} onclick={onDismissError}><i class="ph ph-x" aria-hidden="true"></i></button>
    </div>
  {/if}

  {#if recordingError}
    <div class="composer-error" role="alert">
      <i class="ph ph-warning-circle" aria-hidden="true"></i>
      <span><strong>{copy.chatErrorTitle}</strong>{recordingError}</span>
      <button type="button" aria-label={copy.chatErrorDismiss} onclick={onDismissRecordingError}><i class="ph ph-x" aria-hidden="true"></i></button>
    </div>
  {/if}

  <QueuedMessagesBar queued={queuedMessages} label={copy.queued} removeLabel={copy.removeQueued} onRemove={onRemoveQueued} />
  <PendingFilesBar files={pendingFiles} audioUrls={pendingAudioUrls} removeLabel={copy.removeFile} disabled={sending} inferKind={inferAttachmentKind} onRemove={onRemoveFile} />

  <ChatComposerShell
    bind:value
    {copy}
    {sending}
    {disabled}
    {canSend}
    {placeholder}
    {onSend}
    {onStop}
    onKeydown={handleComposerKeydown}
  >
    {#if filteredSuggestions.length > 0}
      <SlashSuggestionMenu suggestions={filteredSuggestions} activeIndex={activeSuggestionIndex} onSelect={selectSuggestion} />
    {/if}
    <svelte:fragment slot="context"><slot /></svelte:fragment>
    {#if recording}
      <RecordingBar
        label={copy.recording}
        cancelLabel={copy.cancel}
        finishLabel={copy.finishRecording}
        seconds={recordingSeconds}
        onCancel={() => onFinishRecording(false)}
        onFinish={() => onFinishRecording(true)}
      />
    {/if}
    <div class="composer-tools" slot="tools">
      {#if showFileTool}
        <button
          class="composer-tool"
          type="button"
          aria-label={copy.addFiles}
          title={copy.addFiles}
          disabled={fileToolDisabled}
          onclick={onPickFiles}
        ><i class="ph ph-paperclip" aria-hidden="true"></i></button>
      {/if}
    </div>
    <div class="composer-selectors" slot="selectors">
      <label class="composer-pill" title={activeModelTitle || modelPillLabel}>
        <i class="ph ph-cpu" aria-hidden="true"></i>
        <span class="composer-pill-label">{modelPillLabel}</span>
        <select value={activeModelKey} disabled={sending || changingModel || modelOptions.length === 0} onchange={onChangeModel} aria-label={copy.model}>
          {#each modelOptions as model (model.key)}
            <option value={model.key}>{model.label}</option>
          {/each}
        </select>
        <i class="ph-bold ph-caret-down" aria-hidden="true"></i>
      </label>
      <label class="composer-pill">
        <i class="ph ph-brain" aria-hidden="true"></i>
        <span class="composer-pill-label">{thinkingPillLabel}</span>
        <select bind:value={thinkingLevel} disabled={sending} aria-label={copy.thinkingLevel}>
          <option value="off">{copy.thinkingOff}</option>
          <option value="low">{copy.thinkingLow}</option>
          <option value="medium">{copy.thinkingMedium}</option>
          <option value="high">{copy.thinkingHigh}</option>
        </select>
        <i class="ph-bold ph-caret-down" aria-hidden="true"></i>
      </label>
    </div>
    <svelte:fragment slot="action">
      {#if showRecordingTool}
        <button
          class="composer-tool"
          class:recording={recording}
          type="button"
          aria-label={recording ? copy.finishRecording : copy.startRecording}
          title={recording ? copy.finishRecording : copy.startRecording}
          aria-pressed={recording}
          disabled={recordingToolDisabled}
          onclick={onToggleRecording}
        ><i class="ph ph-microphone" aria-hidden="true"></i></button>
      {/if}
    </svelte:fragment>
  </ChatComposerShell>
</footer>
