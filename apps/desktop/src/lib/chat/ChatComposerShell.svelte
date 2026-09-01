<script lang="ts">
  import Airplane from "reicon-svelte/icons/Airplane";
  import Stop from "reicon-svelte/icons/Stop";
  import { tick } from "svelte";
  import type { Translation } from "../i18n";
  import { segmentComposerValue } from "./composerSuggestions.svelte";
  import { clipboardImageFiles } from "./clipboardFiles";
  export let copy: Translation;
  export let value = "";
  export let sending = false;
  export let disabled = false;
  export let canSend = false;
  export let placeholder = "";
  export let onSend: () => void;
  export let onStop: (() => void) | undefined = undefined;
  export let onKeydown: (event: KeyboardEvent) => void;
  export let onPasteFiles: (files: File[]) => void;
  /** Reports the caret position so suggestion triggers work at any offset, not just index 0. */
  export let onCaretMove: ((caret: number) => void) | undefined = undefined;

  let textarea: HTMLTextAreaElement;
  let highlight: HTMLDivElement | null = null;

  /** Places the caret after a programmatic token replacement, keeping focus in the textarea. */
  export function setSelection(position: number): void {
    if (!textarea) return;
    textarea.focus();
    textarea.setSelectionRange(position, position);
    emitCaret();
  }

  function emitCaret(): void {
    if (textarea) onCaretMove?.(textarea.selectionStart ?? 0);
  }

  // Every recognized command/skill/miniapp token — at any offset, not just the
  // start — gets a colored pill rendered *behind* the (fully visible) textarea
  // text. Keeping the textarea opaque and on top preserves native caret
  // behaviour and CJK IME composition; the overlay only paints the tokens'
  // backgrounds, mirroring the textarea's font/padding/wrapping so the pills
  // stay aligned.
  $: segments = segmentComposerValue(value);
  $: hasInvocation = segments.some((segment) => segment.kind !== null);

  function resizeTextarea(): void {
    if (!textarea) return;
    if (!value) {
      textarea.style.height = "";
    } else {
      textarea.style.height = "auto";
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
    syncScroll();
  }

  function syncScroll(): void {
    if (highlight && textarea) highlight.scrollTop = textarea.scrollTop;
  }

  function handlePaste(event: ClipboardEvent): void {
    if (sending || disabled) return;
    const files = clipboardImageFiles(event.clipboardData?.items ?? []);
    if (files.length === 0) return;
    event.preventDefault();
    onPasteFiles(files);
  }

  $: value, tick().then(resizeTextarea);
</script>

<div class="composer">
  <slot name="context" />
  <slot />
  <div class="composer-input">
    {#if hasInvocation}
      <div class="composer-highlight" bind:this={highlight} aria-hidden="true">{#each segments as segment}{#if segment.kind}<span class="composer-token" data-kind={segment.kind}>{segment.text}</span>{:else}{segment.text}{/if}{/each}</div>
    {/if}
    <textarea
      bind:this={textarea}
      bind:value
      rows="2"
      {placeholder}
      {disabled}
      onkeydown={onKeydown}
      onpaste={handlePaste}
      oninput={() => { resizeTextarea(); emitCaret(); }}
      onkeyup={emitCaret}
      onpointerup={emitCaret}
      onfocus={emitCaret}
      onscroll={syncScroll}
    ></textarea>
  </div>
  <div class="composer-bar">
    <slot name="tools"><div class="composer-tools"></div></slot>
    <slot name="selectors"><div class="composer-selectors"></div></slot>
    <slot name="action" />
    {#if sending && onStop}
      <button class="send-button" type="button" aria-label={copy.stop} title={copy.stop} onclick={onStop}><Stop weight="Filled" size={16} aria-hidden="true" /></button>
    {:else}
      <button class="send-button" type="button" aria-label={copy.send} title={copy.send} disabled={!canSend || disabled} onclick={onSend}><Airplane weight="Filled" size={16} aria-hidden="true" /></button>
    {/if}
  </div>
</div>
