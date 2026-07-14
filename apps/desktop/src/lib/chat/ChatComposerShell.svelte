<script lang="ts">
  import { tick } from "svelte";
  import type { Translation } from "../i18n";
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

  function resizeTextarea(): void {
    if (!textarea) return;
    if (!value) {
      textarea.style.height = "";
      return;
    }
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }

  $: value, tick().then(resizeTextarea);
</script>

<div class="composer">
  <slot name="context" />
  <slot />
  <textarea bind:this={textarea} bind:value rows="2" {placeholder} {disabled} onkeydown={onKeydown} oninput={resizeTextarea}></textarea>
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
