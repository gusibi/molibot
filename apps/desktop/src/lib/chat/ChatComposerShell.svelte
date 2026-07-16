<script lang="ts">
  import { tick } from "svelte";
  import type { Translation } from "../i18n";
  import { classifyComposerInvocation } from "./composerSuggestions.svelte";
  export let copy: Translation;
  export let value = "";
  export let sending = false;
  export let disabled = false;
  export let canSend = false;
  export let placeholder = "";
  export let onSend: () => void;
  export let onStop: (() => void) | undefined = undefined;
  export let onKeydown: (event: KeyboardEvent) => void;

  let textarea: HTMLTextAreaElement;
  let highlight: HTMLDivElement | null = null;

  // A recognized command/skill at the start of the input gets a colored pill
  // rendered *behind* the (fully visible) textarea text. Keeping the textarea
  // opaque and on top preserves native caret behaviour and CJK IME composition;
  // the overlay only paints the token's background, mirroring the textarea's
  // font/padding/wrapping so the pill stays aligned.
  $: invocation = classifyComposerInvocation(value);
  $: tokenText = invocation ? value.slice(0, invocation.token.length) : "";
  $: restText = invocation ? value.slice(invocation.token.length) : "";

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

  $: value, tick().then(resizeTextarea);
</script>

<div class="composer">
  <slot name="context" />
  <slot />
  <div class="composer-input">
    {#if invocation}
      <div class="composer-highlight" bind:this={highlight} aria-hidden="true"><span class="composer-token" data-kind={invocation.kind}>{tokenText}</span>{restText}</div>
    {/if}
    <textarea bind:this={textarea} bind:value rows="2" {placeholder} {disabled} onkeydown={onKeydown} oninput={resizeTextarea} onscroll={syncScroll}></textarea>
  </div>
  <div class="composer-bar">
    <slot name="tools"><div class="composer-tools"></div></slot>
    <slot name="selectors"><div class="composer-selectors"></div></slot>
    <slot name="action" />
    {#if sending && onStop}
      <button class="send-button" type="button" aria-label={copy.stop} title={copy.stop} onclick={onStop}><i class="ph-fill ph-stop" aria-hidden="true"></i></button>
    {:else}
      <button class="send-button" type="button" aria-label={copy.send} title={copy.send} disabled={!canSend || disabled} onclick={onSend}><i class="ph-fill ph-paper-plane-tilt" aria-hidden="true"></i></button>
    {/if}
  </div>
</div>
