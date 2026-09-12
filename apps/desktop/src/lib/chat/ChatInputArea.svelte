<script lang="ts">
  import Paperclip from "../icons/duotone/components/Paperclip.svelte";
  import Microphone from "../icons/duotone/components/Microphone.svelte";
  import TriangleWarning from "../icons/duotone/components/TriangleWarning.svelte";
  import X from "reicon-svelte/icons/X";
  import { onMount, tick } from "svelte";
  import {
    DESKTOP_THINKING_LEVELS,
    type DesktopModelOption,
    type DesktopSessionUsageSummary,
    type DesktopThinkingLevel
  } from "@molibot/desktop-contract";
  import type { Translation } from "../i18n";
  import type { Locale } from "../i18n";
  import { searchDesktopProjectFiles, type DesktopProjectSearchNameHit } from "../api";
  import { formatProjectFileReference } from "@molibot/shared/projectFileReference";
  import type { ComposerMenuItem } from "./composerSuggestionCatalog";
  import { composerSuggestionsStore, ensureComposerSuggestions } from "./composerSuggestions.svelte";
  import type { ComposerContextUsage } from "../presentation";
  import ChatComposerShell from "./ChatComposerShell.svelte";
  import ComposerContextMenu from "./ComposerContextMenu.svelte";
  import ComposerModelMenu from "./ComposerModelMenu.svelte";
  import ComposerPermissionMenu from "./ComposerPermissionMenu.svelte";
  import PendingFilesBar from "./PendingFilesBar.svelte";
  import QueuedMessagesBar from "./QueuedMessagesBar.svelte";
  import RecordingBar from "./RecordingBar.svelte";
  import SlashSuggestionMenu from "./SlashSuggestionMenu.svelte";

  export let copy: Translation;
  export let locale: Locale = "en";
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
  export let thinkingLevelOptions: readonly DesktopThinkingLevel[] = DESKTOP_THINKING_LEVELS;
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
  export let onPasteFiles: (files: File[]) => void;
  export let onPickFiles: () => void;
  export let onToggleRecording: () => void;
  export let onFinishRecording: (send: boolean) => void;
  export let onRemoveQueued: (index: number) => void;
  /** Optional: inject a queued message into the running turn (steer). */
  export let onSteerQueued: ((index: number) => void) | null = null;
  export let onRemoveFile: (index: number) => void;
  export let onDismissError: () => void;
  export let onDismissRecordingError: () => void;
  export let onOpenSettings: () => void;
  export let onChangeModel: (value: string) => void;
  export let onChangeThinking: (value: DesktopThinkingLevel) => void;
  /**
   * Derived context-usage panel data from the host transcript; null renders
   * the panel's empty state ("usage appears after the first reply").
   */
  export let contextUsage: ComposerContextUsage | null = null;
  /** Server-summed cumulative usage of the active session (panel's primary section). */
  export let sessionUsage: DesktopSessionUsageSummary | null = null;
  /** Passed through to the composer menu; absent host = no permission page. */
  export let permissionMode: "plan" | "manual" | "accept_edits" | "auto" = "accept_edits";
  export let permissionModeOptions: readonly ("plan" | "manual" | "accept_edits" | "auto")[] = [];
  /** Where the effective mode comes from — rendered as "inherited from …" in the menu. */
  export let permissionModeSource: "session" | "project" | "instance" | "agent" | "global" = "global";
  export let onChangePermissionMode: ((value: "plan" | "manual" | "accept_edits" | "auto") => void) | undefined = undefined;
  /**
   * True when the host renders this composer as a floating pane over the
   * transcript (`.composer-wrap.is-floating`) rather than in the flow. The
   * difference belongs to the host, so it is injected here — this component
   * stays free of any host or channel conditional.
   *
   * A floating composer owes the layout one thing an in-flow one does not: its
   * height. Everything that has to stay clear of it — the transcript's bottom
   * padding, the dock, the prompt navigator — reads `--composer-h`, and the
   * stack above the card (queued follow-ups, attachments, banners) is part of
   * that height, so the whole footer is measured, not just the card.
   */
  export let floating = false;
  let composerWrap: HTMLElement;
  let activeSuggestionIndex = 0;
  let suggestionsDismissed = false;
  let shell: ChatComposerShell;
  let caret = 0;
  let fileHits: DesktopProjectSearchNameHit[] = [];
  let fileSearchGeneration = 0;
  let fileSearchTimer: ReturnType<typeof setTimeout> | null = null;

  /** Focuses the existing composer after a quick-start prompt fills its draft. */
  export function focusInput(): void {
    shell?.setSelection(value.length);
  }

  $: if (endpoint) void ensureComposerSuggestions(endpoint, projectId);
  // Two trigger characters, one menu, and both fire on the token the caret sits
  // in — at any offset, not only as the first character. `/` offers commands and
  // Skills, `@` offers installed Mini Apps plus (inside a Project) file
  // references. A bare `@` lists every app so the owner can pick one without
  // remembering its id — that is the whole point of the trigger. A token counts
  // only when it starts the message or follows whitespace, so "3/4" or an email
  // address never opens the menu.
  $: caretClamped = Math.min(caret, value.length);
  $: textBeforeCaret = value.slice(0, caretClamped);
  $: slashToken = textBeforeCaret.match(/(?:^|\s)(\/[^\s]*)$/)?.[1] ?? null;
  $: mentionToken = textBeforeCaret.match(/(?:^|\s)(@[^\s@]*)$/)?.[1] ?? null;
  $: suggestionQuery = slashToken?.slice(1).toLowerCase() ?? null;
  $: mentionQuery = slashToken === null ? (mentionToken?.slice(1).toLowerCase() ?? null) : null;
  $: activeToken = slashToken ?? (mentionQuery !== null ? mentionToken : null);
  $: activeTokenStart = activeToken ? caretClamped - activeToken.length : 0;
  $: suggestionKinds = suggestionQuery !== null ? ["command", "skill"] : mentionQuery !== null ? ["miniapp", "file"] : [];
  $: activeQuery = suggestionQuery ?? mentionQuery ?? "";
  $: scheduleFileSearch(mentionQuery, endpoint, projectId);
  $: fileSuggestions = mentionQuery !== null ? fileHits.map((hit): ComposerMenuItem => ({
    id: `file:${hit.path}`,
    kind: "file",
    label: `@${hit.name}`,
    insertText: `${formatProjectFileReference(hit.path)} `,
    description: hit.path,
    aliases: [],
    submitOnSelect: false
  })) : [];
  $: filteredSuggestions = (suggestionKinds.length === 0 || suggestionsDismissed ? [] : [
    ...composerSuggestionsStore.items
      .filter((item) => suggestionKinds.includes(item.kind))
      .filter((item) => !activeQuery || item.label.slice(1).toLowerCase().includes(activeQuery) || item.aliases.some((alias) => alias.toLowerCase().includes(activeQuery))),
    ...fileSuggestions
  ]).slice(0, 12) as ComposerMenuItem[];
  $: if (activeSuggestionIndex >= filteredSuggestions.length) activeSuggestionIndex = 0;

  /**
   * Fetches Project file-name matches for an `@` token. Debounced, and each
   * request carries a generation so a stale response never overwrites the hits
   * for what the user has typed since (pitfall 3). Outside a Project there is
   * no file source, so `@` keeps offering Mini Apps only.
   */
  function scheduleFileSearch(query: string | null, searchEndpoint: string, searchProjectId: string): void {
    if (fileSearchTimer) clearTimeout(fileSearchTimer);
    const generation = ++fileSearchGeneration;
    if (!query || !searchEndpoint || !searchProjectId) {
      fileHits = [];
      return;
    }
    fileSearchTimer = setTimeout(() => {
      void (async () => {
        try {
          const result = await searchDesktopProjectFiles(searchEndpoint, searchProjectId, { query, mode: "name", limit: 8 });
          if (generation === fileSearchGeneration && result.mode === "name") fileHits = result.hits;
        } catch {
          if (generation === fileSearchGeneration) fileHits = [];
        }
      })();
    }, 140);
  }

  function handleComposerKeydown(event: KeyboardEvent): void {
    // keyCode 229 catches WebKit's IME-confirm Enter, which fires after
    // compositionend with isComposing already reset to false.
    if (filteredSuggestions.length > 0 && !event.isComposing && event.keyCode !== 229) {
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
        // Tab only completes the token into the input; Enter may auto-send a
        // whole-message invocation. The user asked for Tab to fill and leave
        // the cursor so they can review before pressing Enter themselves.
        selectSuggestion(filteredSuggestions[activeSuggestionIndex], event.key === "Enter");
        return;
      }
    }
    if (event.key.length === 1 || event.key === "Backspace" || event.key === "Delete") suggestionsDismissed = false;
    onKeydown(event);
  }

  function selectSuggestion(suggestion: ComposerMenuItem | undefined, allowSubmit = true): void {
    if (!suggestion) return;
    // Replace only the trigger token; text on either side of it stays put.
    const before = value.slice(0, activeTokenStart);
    const after = value.slice(caretClamped);
    const insert = suggestion.insertText.endsWith(" ") && after.startsWith(" ")
      ? suggestion.insertText.trimEnd()
      : suggestion.insertText;
    const wholeMessage = !before.trim() && !after.trim();
    value = before + insert + after;
    suggestionsDismissed = true;
    activeSuggestionIndex = 0;
    caret = (before + insert).length;
    void tick().then(() => {
      shell?.setSelection(caret);
      // Submit immediately only when the invocation is the entire message AND
      // the caller allows it (Tab never submits; a click/Enter may).
      if (allowSubmit && suggestion.submitOnSelect && wholeMessage) onSend();
    });
  }

  // Publishing a measurement the layout needs, so it goes straight onto the host
  // element rather than through component state: a reactive round-trip would
  // re-render the whole composer once per resize frame. The property is removed
  // on teardown so a host that later renders a composer in the flow (or none at
  // all) falls back to the `0px` default instead of a stale height.
  onMount(() => {
    if (!floating || !composerWrap) return;
    const host = composerWrap.parentElement;
    const publish = (): void => host?.style.setProperty("--composer-h", `${composerWrap.offsetHeight}px`);
    const observer = new ResizeObserver(publish);
    observer.observe(composerWrap);
    publish();
    return () => {
      observer.disconnect();
      host?.style.removeProperty("--composer-h");
    };
  });
</script>

<footer class="composer-wrap" class:is-floating={floating} bind:this={composerWrap}>
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
      <TriangleWarning size={16} aria-hidden="true" />
      <span><strong>{copy.chatErrorTitle}</strong>{error}</span>
      <button type="button" aria-label={copy.chatErrorDismiss} onclick={onDismissError}><X size={14} aria-hidden="true" /></button>
    </div>
  {/if}

  {#if recordingError}
    <div class="composer-error" role="alert">
      <TriangleWarning size={16} aria-hidden="true" />
      <span><strong>{copy.chatErrorTitle}</strong>{recordingError}</span>
      <button type="button" aria-label={copy.chatErrorDismiss} onclick={onDismissRecordingError}><X size={14} aria-hidden="true" /></button>
    </div>
  {/if}

  <QueuedMessagesBar
    queued={queuedMessages}
    label={copy.queued}
    removeLabel={copy.removeQueued}
    confirmLabel={copy.confirmDelete}
    onRemove={onRemoveQueued}
    canSteer={sending}
    steerLabel={copy.steerQueued}
    onSteer={onSteerQueued}
  />
  <PendingFilesBar files={pendingFiles} audioUrls={pendingAudioUrls} removeLabel={copy.removeFile} disabled={sending} inferKind={inferAttachmentKind} onRemove={onRemoveFile} />

  <ChatComposerShell
    bind:this={shell}
    bind:value
    {copy}
    {sending}
    {disabled}
    {canSend}
    {placeholder}
    {onSend}
    {onStop}
    {onPasteFiles}
    onKeydown={handleComposerKeydown}
    onCaretMove={(position) => (caret = position)}
  >
    {#if filteredSuggestions.length > 0}
      <SlashSuggestionMenu suggestions={filteredSuggestions} activeIndex={activeSuggestionIndex} onSelect={selectSuggestion} {copy} />
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
      <slot name="mention" />
      {#if showFileTool}
        <button
          class="composer-tool"
          type="button"
          aria-label={copy.addFiles}
          title={copy.addFiles}
          disabled={fileToolDisabled}
          onclick={onPickFiles}
        ><Paperclip size={18} aria-hidden="true" /></button>
      {/if}
      {#if onChangePermissionMode && permissionModeOptions.length > 1}
        <ComposerPermissionMenu
          {copy}
          value={permissionMode}
          options={permissionModeOptions}
          source={permissionModeSource}
          disabled={sending}
          onChange={onChangePermissionMode}
        />
      {/if}
    </div>
    <div class="composer-selectors" slot="selectors">
      <ComposerContextMenu {copy} {locale} usage={contextUsage} {sessionUsage} />
      <ComposerModelMenu
        {copy}
        {modelOptions}
        {activeModelKey}
        {activeModelLabel}
        {activeModelTitle}
        {changingModel}
        {thinkingLevel}
        {thinkingLevelOptions}
        {thinkingLevelLabel}
        disabled={sending || modelOptions.length === 0}
        {onChangeModel}
        {onChangeThinking}
      />
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
        ><Microphone size={18} aria-hidden="true" /></button>
      {/if}
    </svelte:fragment>
  </ChatComposerShell>
</footer>
