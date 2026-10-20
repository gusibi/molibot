<script lang="ts">
  /** Collapsed bodies stay unmounted; only phase changes override manual toggles. */
  export let text: string;
  export let label: string;
  export let thinking = false;

  let opened = false;
  let previousThinking: boolean | undefined;
  $: if (thinking !== previousThinking) {
    opened = thinking;
    previousThinking = thinking;
  }
</script>

<details class="thinking-card" bind:open={opened}>
  <summary>{label}</summary>
  {#if opened}<pre>{text}</pre>{/if}
</details>
