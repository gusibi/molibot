<script lang="ts">
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
</script>

<div class="composer">
  <slot />
  <textarea bind:value rows="1" {placeholder} {disabled} onkeydown={onKeydown}></textarea>
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
