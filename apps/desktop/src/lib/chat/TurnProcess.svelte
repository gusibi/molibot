<script lang="ts">
  import { onMount } from "svelte";
  import ChatMarkdown from "./ChatMarkdown.svelte";
  import { processPresentation } from "./processPresentation";
  import AngleDown from "reicon-svelte/icons/AngleDown";
  import CheckCircle from "reicon-svelte/icons/CheckCircle";
  import TriangleWarning from "reicon-svelte/icons/TriangleWarning";
  import type { Translation } from "../i18n";
  import type { TranscriptProcessBlock } from "./transcript";
  import { finalizeTranscriptActivities, transcriptProcessSummary } from "./transcript";
  import { formatDuration } from "../presentation";
  import ProcessTimeline from "./ProcessTimeline.svelte";
  import ThinkingCard from "./ThinkingCard.svelte";

  export let blocks: TranscriptProcessBlock[];
  export let copy: Translation;
  export let stateKey: string;
  export let live = false;
  export let responding = false;
  export let failed = false;
  export let onOpenPath: ((path: string, mutates: boolean) => void) | null = null;
  export let endpoint = "";
  export let resolveImage: ((href: string) => string | undefined) | undefined = undefined;

  let opened = false;
  let now = Date.now();
  onMount(() => {
    if (!live) return;
    const timer = setInterval(() => { now = Date.now(); }, 1000);
    return () => clearInterval(timer);
  });
  $: presentation = processPresentation(blocks, copy);
  $: liveDuration = presentation.startedAt === undefined ? 0 : Math.max(0, now - presentation.startedAt);
  $: summary = transcriptProcessSummary(blocks);
  $: isFailed = failed || (summary.interrupted && !live);
  $: thinkingText = blocks.flatMap(block => block.kind === "thinking" ? [block.content] : []).join("\n\n");
  $: executionBlocks = blocks.filter(block => block.kind !== "thinking");
  $: displayBlocks = live
    ? executionBlocks
    : executionBlocks.map((block) => block.kind === "activities"
      ? { ...block, activities: finalizeTranscriptActivities(block.activities) ?? [] }
      : block);

  const durationLabel = formatDuration;
</script>

{#if thinkingText.trim()}
  <ThinkingCard text={thinkingText} label={copy.thinking} thinking={live && !responding} />
{/if}

{#if live && !responding}
  <div class="turn-process-overview">
    {#each presentation.commentary as block (block.id)}
      <ChatMarkdown {resolveImage} source={block.content} {copy} {endpoint} className="turn-progress-commentary markdown-body" contentKey={`${stateKey}-progress-${block.id}`} />
    {/each}
    <div class="turn-progress-current" role="status">
      <span>{presentation.status}</span>
      {#if presentation.detail}<span class="turn-progress-detail">{presentation.detail}</span>{/if}
      {#if liveDuration}<small>{durationLabel(liveDuration)}</small>{/if}
    </div>
  </div>
{/if}

{#if displayBlocks.length}
<details class="turn-process" bind:open={opened} data-state={live ? "live" : isFailed ? "error" : "complete"}>
  <summary class="turn-process-summary">
    {#if live}
      <span class="timeline-wave-node turn-process-wave-node" aria-hidden="true">
        <span class="timeline-wave-bar"></span>
        <span class="timeline-wave-bar"></span>
        <span class="timeline-wave-bar"></span>
      </span>
    {:else}
      {#if isFailed}<TriangleWarning size={14} aria-hidden="true" />{:else}<CheckCircle size={14} aria-hidden="true" />{/if}
    {/if}
    <span>{live ? copy.executionDetails : isFailed ? copy.runFailed : copy.runCompleted}</span>
    {#if summary.toolCount}<small>{copy.turnSummaryTools.replace("{count}", String(summary.toolCount))}</small>{/if}
    {#if summary.fileCount}<small>{copy.turnSummaryFiles.replace("{count}", String(summary.fileCount))}</small>{/if}
    {#if summary.durationMs}<small class="turn-process-duration">{durationLabel(summary.durationMs)}</small>{/if}
    <AngleDown class="turn-process-caret" size={14} aria-hidden="true" />
  </summary>
  {#if opened}
    <div class="turn-process-body">
      <ProcessTimeline {resolveImage} blocks={displayBlocks} {copy} {stateKey} {live} {onOpenPath} {endpoint} />
    </div>
  {/if}
</details>
{/if}
