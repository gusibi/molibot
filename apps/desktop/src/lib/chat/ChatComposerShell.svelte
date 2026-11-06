<script lang="ts">
  import Plane2 from "../icons/duotone/components/Plane2.svelte";
  import Stop from "../icons/duotone/components/Stop.svelte";
  import { onDestroy, tick } from "svelte";
  import type { Translation } from "../i18n";
  import { segmentComposerValue } from "./composerSuggestions.svelte";
  import { clipboardImageFiles } from "./clipboardFiles";
  import BeamRing from "./BeamRing.svelte";
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
  let inputVisualScrollFrom: number | null = null;
  let pendingVisualSource: number | null = null;
  let flowFrame = 0;
  const FLOW_MS = 160;

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

  function syncScroll(): void {
    if (highlight && textarea) highlight.scrollTop = textarea.scrollTop;
  }

  function currentTranslateY(): number {
    const transform = getComputedStyle(textarea).transform;
    if (transform === "none") return 0;
    return new DOMMatrix(transform).m42;
  }

  function setFlowStyles(transform: string, transition: string): void {
    for (const node of [textarea, highlight]) {
      if (!node) continue;
      node.style.transform = transform;
      node.style.transition = transition;
    }
  }

  function cancelScrollFlow(): void {
    if (flowFrame) cancelAnimationFrame(flowFrame);
    flowFrame = 0;
    pendingVisualSource = null;
    const offset = currentTranslateY();
    setFlowStyles("", "");
    textarea.style.willChange = "";
    if (offset !== 0) textarea.scrollTop = Math.max(0, textarea.scrollTop - offset);
    syncScroll();
  }

  function handleBeforeInput(): void {
    if (flowFrame) cancelAnimationFrame(flowFrame);
    flowFrame = 0;
    inputVisualScrollFrom = pendingVisualSource ?? textarea.scrollTop - currentTranslateY();
    pendingVisualSource = null;
  }

  function handleInput(): void {
    emitCaret();
    const source = inputVisualScrollFrom;
    inputVisualScrollFrom = null;
    if (
      source === null ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      document.documentElement.dataset.performance === "low"
    ) {
      setFlowStyles("", "");
      textarea.style.willChange = "";
      syncScroll();
      return;
    }

    const lineHeight = Number.parseFloat(getComputedStyle(textarea).lineHeight);
    pendingVisualSource = source;
    setFlowStyles(`translateY(${lineHeight}px)`, "none");
    textarea.style.willChange = "transform";
    flowFrame = requestAnimationFrame(() => {
      flowFrame = 0;
      pendingVisualSource = null;
      const settledTarget = textarea.scrollTop;
      const offset = settledTarget - source;
      if (Math.abs(offset) < 1) {
        setFlowStyles("", "");
        textarea.style.willChange = "";
        return;
      }
      setFlowStyles(`translateY(${offset}px)`, "none");
      void textarea.offsetHeight;
      setFlowStyles("translateY(0px)", `transform ${FLOW_MS}ms var(--ease-standard)`);
      syncScroll();
    });
    syncScroll();
  }

  function handleTransitionEnd(event: TransitionEvent): void {
    if (event.propertyName !== "transform") return;
    setFlowStyles("", "");
    textarea.style.willChange = "";
  }

  function handlePaste(event: ClipboardEvent): void {
    if (sending || disabled) return;
    const files = clipboardImageFiles(event.clipboardData?.items ?? []);
    if (files.length === 0) return;
    event.preventDefault();
    onPasteFiles(files);
  }

  $: value, tick().then(syncScroll);

  onDestroy(cancelScrollFlow);
</script>

<div class="composer">
  <slot name="context" />
  <slot />
  <div class="composer-input">
    {#if hasInvocation}
      <div class="composer-highlight" bind:this={highlight} aria-hidden="true">{#each segments as segment}{#if segment.kind}<span class="composer-token" data-kind={segment.kind}>{segment.text}</span>{:else}{segment.text}{/if}{/each}</div>
    {/if}
    <textarea
      data-testid="chat-composer"
      bind:this={textarea}
      bind:value
      rows="2"
      {placeholder}
      {disabled}
      onkeydown={onKeydown}
      onpaste={handlePaste}
      onbeforeinput={handleBeforeInput}
      oninput={handleInput}
      onkeyup={emitCaret}
      onpointerup={emitCaret}
      onfocus={emitCaret}
      onwheel={cancelScrollFlow}
      ontouchmove={cancelScrollFlow}
      ontransitionend={handleTransitionEnd}
      onscroll={syncScroll}
    ></textarea>
  </div>
  <div class="composer-bar">
    <slot name="tools"><div class="composer-tools"></div></slot>
    <slot name="selectors"><div class="composer-selectors"></div></slot>
    <slot name="action" />
    {#if sending && onStop}
      <button class="send-button beam" type="button" aria-label={copy.stop} title={copy.stop} onclick={onStop}><BeamRing /><Stop weight="Filled" size={16} aria-hidden="true" /></button>
    {:else}
      <button class="send-button" type="button" aria-label={copy.send} title={copy.send} disabled={!canSend || disabled} onclick={onSend}><Plane2 size={16} aria-hidden="true" /></button>
    {/if}
  </div>
</div>
