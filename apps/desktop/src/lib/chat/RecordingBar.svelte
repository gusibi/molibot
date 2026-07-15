<script lang="ts">
  export let label: string;
  export let cancelLabel: string;
  export let finishLabel: string;
  export let seconds = 0;
  export let onCancel: () => void;
  export let onFinish: () => void;

  $: formatted = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
</script>

<div class="recording-bar" role="status" aria-live="polite">
  <span class="recording-indicator" aria-hidden="true"></span>
  <span class="recording-label">{label}</span>
  <time>{formatted}</time>
  <button type="button" class="recording-action" onclick={onCancel}>{cancelLabel}</button>
  <button type="button" class="recording-action primary" onclick={onFinish}>{finishLabel}</button>
</div>
