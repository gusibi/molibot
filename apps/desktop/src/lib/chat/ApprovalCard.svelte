<script lang="ts">
  import DecisionCard from "./DecisionCard.svelte";
  import { html as renderDiffHtml } from "diff2html";

  export let title: string;
  export let cardId = "";
  export let subtitle = "";
  export let reasonLabel: string;
  export let command: string;
  export let reason = "";
  export let payload: { path?: string; diff?: string; parameters?: Record<string, unknown> } | undefined;
  export let options: Array<{ id: string; label: string }> = [];
  export let disabled = false;
  export let dangerOptionId = "reject";
  export let defaultOptionId = "";
  export let waitingLabel = "";
  export let secondsLabel = "{count}s";
  export let minutesLabel = "{count} min";
  export let moreLinesLabel = "{count} more lines";
  export let onResolve: (id: string) => void;

  $: diffLines = payload?.diff?.split(/\r?\n/) ?? [];
  $: previewDiff = diffLines.slice(0, 80).join("\n");
  $: diffHtml = previewDiff ? renderDiffHtml(previewDiff, {
    drawFileList: false,
    outputFormat: "line-by-line",
    matching: "lines",
    renderNothingWhenEmpty: false
  }) : "";
</script>

<DecisionCard
  id={`approval-${cardId || command}`}
  {title}
  {subtitle}
  {options}
  {disabled}
  {dangerOptionId}
  {defaultOptionId}
  {waitingLabel}
  {secondsLabel}
  {minutesLabel}
  {onResolve}
>
  <code class="approval-command">{command}</code>
  {#if payload?.path}<div class="approval-path"><i class="ph ph-file-code" aria-hidden="true"></i><code>{payload.path}</code></div>{/if}
  {#if diffHtml}<div class="project-diff-preview approval-diff">{@html diffHtml}</div>{/if}
  {#if diffLines.length > 80}<p class="approval-truncated">{moreLinesLabel.replace("{count}", String(diffLines.length - 80))}</p>{/if}
  {#if reason}<p class="approval-reason"><span class="approval-reason-label">{reasonLabel}</span>{reason}</p>{/if}
</DecisionCard>
