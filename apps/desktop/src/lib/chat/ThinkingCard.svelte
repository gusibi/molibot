<script lang="ts">
  /**
   * Collapsed reasoning block for a completed turn.
   *
   * Reasoning text is the heaviest single field on a transcript (a measured
   * project session carried 464 KB of it across 38 messages) and the card is
   * closed by default, so mounting every `<pre>` up-front paid a large DOM and
   * layout cost for content nobody could see. Mount the body on first open.
   */
  export let text: string;
  export let label: string;

  let opened = false;
</script>

<details class="thinking-card" bind:open={opened}>
  <summary>{label}</summary>
  {#if opened}<pre>{text}</pre>{/if}
</details>
