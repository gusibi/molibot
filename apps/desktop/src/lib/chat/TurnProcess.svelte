<script lang="ts">
  import type { Translation } from "../i18n";
  import type { TranscriptProcessBlock } from "./transcript";
  import { finalizeTranscriptActivities, transcriptProcessSummary } from "./transcript";
  import ChatMarkdown from "./ChatMarkdown.svelte";
  import RunActivity from "./RunActivity.svelte";
  import ThinkingCard from "./ThinkingCard.svelte";

  export let blocks: TranscriptProcessBlock[];
  export let copy: Translation;
  export let stateKey: string;
  export let forceOpen = false;
  export let onOpenPath: ((path: string, mutates: boolean) => void) | null = null;

  let opened = forceOpen;
  $: if (forceOpen) opened = true;
  $: summary = transcriptProcessSummary(blocks);

  function durationLabel(durationMs: number): string {
    if (durationMs < 1000) return `${durationMs}ms`;
    return `${(durationMs / 1000).toFixed(1)}s`;
  }
</script>

<details class="turn-process" bind:open={opened} data-state={summary.hasError ? "error" : "complete"}>
  <summary class="turn-process-summary">
    <i class={`ph ${summary.hasError ? "ph-warning-circle" : "ph-check-circle"}`} aria-hidden="true"></i>
    <span>{copy.thinking}</span>
    <small>{copy.turnProcessSteps.replace("{count}", String(summary.stepCount))}</small>
    {#if summary.durationMs}<small class="turn-process-duration">{durationLabel(summary.durationMs)}</small>{/if}
    <i class="ph ph-caret-down turn-process-caret" aria-hidden="true"></i>
  </summary>
  {#if opened}
    <div class="turn-process-body">
      {#each blocks as block (block.id)}
        {#if block.kind === "thinking"}
          <ThinkingCard text={block.content} label={copy.thinking} />
        {:else if block.kind === "activities"}
          <RunActivity activities={finalizeTranscriptActivities(block.activities) ?? []} {copy} {onOpenPath} stateKey={`${stateKey}:${block.id}`} />
        {:else if block.content}
          <ChatMarkdown source={block.content} {copy} className="turn-process-text markdown-body" contentKey={`${stateKey}-${block.id}`} />
        {/if}
      {/each}
    </div>
  {/if}
</details>
