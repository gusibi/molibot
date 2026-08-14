<script lang="ts">
  import type { DesktopConversationActivity } from "@molibot/desktop-contract";
  import { html as renderDiffHtml } from "diff2html";
  import type { Translation } from "../i18n";
  import CodeViewer from "../projects/CodeViewer.svelte";
  import { activityPreview, classifyActivityBody, formatActivityMetadata } from "./activityView";

  export let activity: DesktopConversationActivity;
  export let copy: Translation;
  export let onOpenPath: ((path: string, mutates: boolean) => void) | null = null;

  let expanded = false;
  $: body = classifyActivityBody(activity);
  $: metadata = formatActivityMetadata(activity);
  $: rawBodyContent = body?.kind === "diff" ? (body.diff ?? "") : (body?.content ?? "");
  $: preview = activityPreview(rawBodyContent);
  $: bodyContent = expanded ? rawBodyContent : preview.content;

  function icon(state: DesktopConversationActivity["state"]): string {
    if (state === "running") return "circle-notch";
    if (state === "success") return "check-circle";
    if (state === "error") return "x-circle";
    return "info";
  }

  function diffHtml(diff: string): string {
    return renderDiffHtml(diff, {
      drawFileList: false,
      outputFormat: "line-by-line",
      matching: "lines",
      renderNothingWhenEmpty: false
    });
  }
</script>

<div class="process-timeline-entry process-timeline-tool" data-state={activity.state}>
  <i class={`ph${activity.state === "running" ? "" : "-fill"} ph-${icon(activity.state)}`} class:spin={activity.state === "running"} aria-hidden="true"></i>
  {#if body}
    <details class="process-tool-detail" open={activity.state === "error"}>
      <summary>
        <span>{activity.label}</span>
        {#if metadata.length}<small>{metadata.join(" · ")}</small>{/if}
        <i class="ph ph-caret-right" aria-hidden="true"></i>
      </summary>
      <div class="run-activity-body">
        {#if body.kind === "diff" && body.diff}
          <div class="project-diff-preview run-activity-diff">{@html diffHtml(bodyContent)}</div>
        {:else if body.kind === "code" || body.kind === "json"}
          <div class="run-activity-viewer">
            <CodeViewer content={bodyContent} filePath={body.kind === "json" ? `${activity.key}.json` : (body.filePath ?? "")} {copy} />
          </div>
        {:else if body.kind === "terminal"}
          <pre class="run-activity-terminal">{bodyContent}</pre>
        {:else}
          <pre>{bodyContent}</pre>
        {/if}
        {#if preview.truncated}
          <div class="run-activity-more">
            {#if activity.paths?.[0] && onOpenPath}
              <button type="button" onclick={() => onOpenPath?.(activity.paths![0], activity.mutates === true)}>{copy.runActivityOpenFile}</button>
            {/if}
            <button type="button" aria-expanded={expanded} onclick={() => expanded = !expanded}>{expanded ? copy.collapseMessage : copy.expandMessage}</button>
          </div>
        {/if}
      </div>
    </details>
  {:else}
    <span class="process-timeline-label">{activity.label}</span>
  {/if}
</div>
