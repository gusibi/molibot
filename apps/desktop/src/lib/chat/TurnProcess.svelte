<script lang="ts">
  import type { Translation } from "../i18n";
  import type { TranscriptProcessBlock } from "./transcript";
  import { finalizeTranscriptActivities, transcriptProcessSummary } from "./transcript";
  import ProcessTimeline from "./ProcessTimeline.svelte";

  export let blocks: TranscriptProcessBlock[];
  export let copy: Translation;
  export let stateKey: string;
  export let forceOpen = false;
  export let live = false;
  export let onOpenPath: ((path: string, mutates: boolean) => void) | null = null;
  export let endpoint = "";

  // `forceOpen` is followed on its TRANSITIONS, in both directions: the live
  // card opens while the model is still reasoning and must fold once the
  // answer starts so the answer leads. After the fold the state belongs to the
  // reader - a manual re-expand is never re-collapsed by a later transition.
  let opened = forceOpen;
  let lastForceOpen = forceOpen;
  $: if (forceOpen !== lastForceOpen) {
    lastForceOpen = forceOpen;
    opened = forceOpen;
  }
  $: summary = transcriptProcessSummary(blocks);
  $: displayBlocks = live
    ? blocks
    : blocks.map((block) => block.kind === "activities"
      ? { ...block, activities: finalizeTranscriptActivities(block.activities) ?? [] }
      : block);

  function durationLabel(durationMs: number): string {
    if (durationMs < 1000) return `${durationMs}ms`;
    return `${(durationMs / 1000).toFixed(1)}s`;
  }
</script>

<details class="turn-process" bind:open={opened} data-state={live ? "live" : summary.hasError ? "error" : "complete"}>
  <summary class="turn-process-summary">
    <i class={`ph ${live ? "ph-circle-notch spin" : summary.hasError ? "ph-warning-circle" : "ph-check-circle"}`} aria-hidden="true"></i>
    <span>{live ? copy.runProgress : summary.hasError ? copy.runFailed : copy.runCompleted}</span>
    {#if summary.toolCount}<small>{copy.turnSummaryTools.replace("{count}", String(summary.toolCount))}</small>{/if}
    {#if summary.fileCount}<small>{copy.turnSummaryFiles.replace("{count}", String(summary.fileCount))}</small>{/if}
    {#if summary.durationMs}<small class="turn-process-duration">{durationLabel(summary.durationMs)}</small>{/if}
    <i class="ph ph-caret-down turn-process-caret" aria-hidden="true"></i>
  </summary>
  {#if opened}
    <div class="turn-process-body">
      <ProcessTimeline blocks={displayBlocks} {copy} {stateKey} {live} {onOpenPath} {endpoint} />
    </div>
  {/if}
</details>
