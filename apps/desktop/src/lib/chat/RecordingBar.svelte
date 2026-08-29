<script lang="ts">
  export let label: string;
  export let cancelLabel: string;
  export let finishLabel: string;
  export let seconds = 0;
  export let onCancel: () => void;
  export let onFinish: () => void;

  $: formatted = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
</script>

<div class="recording-bar">
  <span class="recording-indicator" aria-hidden="true"></span>
  <span class="recording-label" role="status" aria-live="polite">{label}</span>
  <time aria-hidden="true">{formatted}</time>
  <button type="button" class="recording-action" onclick={onCancel}>{cancelLabel}</button>
  <button type="button" class="recording-action primary" onclick={onFinish}>{finishLabel}</button>
</div>
