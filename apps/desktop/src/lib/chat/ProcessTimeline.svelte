<script lang="ts">
  import type { Translation } from "../i18n";
  import type { TranscriptProcessBlock } from "./transcript";
  import ChatMarkdown from "./ChatMarkdown.svelte";
  import ProcessActivityItem from "./ProcessActivityItem.svelte";
  import { activityTimelineItems, type ActivityGroupAction, type ActivityTimelineItem } from "./activityView";
  import { formatDuration } from "../presentation";

  export let blocks: TranscriptProcessBlock[];
  export let copy: Translation;
  export let stateKey: string;
  export let live = false;
  export let onOpenPath: ((path: string, mutates: boolean) => void) | null = null;
  export let endpoint = "";

  function groupLabel(item: Extract<ActivityTimelineItem, { kind: "group" }>): string {
    const count = item.activities.length;
    if (item.action === "read") {
      return (item.fileCount ? copy.activityGroupReadFiles : copy.activityGroupReadCalls)
        .replace("{count}", String(item.fileCount || count));
    }
    if (item.action === "change") {
      return (item.fileCount ? copy.activityGroupChangedFiles : copy.activityGroupChanges)
        .replace("{count}", String(item.fileCount || count));
    }
    return (item.action === "search" ? copy.activityGroupSearches : copy.activityGroupCommands)
      .replace("{count}", String(count));
  }

  function groupIcon(action: ActivityGroupAction): string {
    if (action === "read") return "files";
    if (action === "change") return "pencil-simple-line";
    if (action === "search") return "magnifying-glass";
    return "terminal-window";
  }

  const durationLabel = formatDuration;
</script>

<div class="process-timeline" data-live={live}>
  {#each blocks as block (block.id)}
    {#if block.kind === "thinking"}
      <div class="process-timeline-entry process-timeline-thinking">
        <i class="ph ph-brain" aria-hidden="true"></i>
        <div>
          <span class="process-timeline-label">{copy.thinking}</span>
          <pre>{block.content}</pre>
        </div>
      </div>
    {:else if block.kind === "activities"}
      {@const items = activityTimelineItems(block.activities)}
      {#each items as item (item.key)}
        {#if item.kind === "group"}
          <div class="process-timeline-entry process-timeline-group">
            <i class={`ph ph-${groupIcon(item.action)}`} aria-hidden="true"></i>
            <details class="process-activity-group">
              <summary>
                <span>{groupLabel(item)}</span>
                {#if item.durationMs}<small>{durationLabel(item.durationMs)}</small>{/if}
                <i class="ph ph-caret-right" aria-hidden="true"></i>
              </summary>
              <div class="process-activity-group-list">
                {#each item.activities as activity (activity.key)}
                  <ProcessActivityItem {activity} {copy} {onOpenPath} />
                {/each}
              </div>
            </details>
          </div>
        {:else}
          <ProcessActivityItem activity={item.activity} {copy} {onOpenPath} />
        {/if}
      {/each}
    {:else if block.content}
      <div class="process-timeline-entry process-timeline-text">
        <i class="ph ph-chat-circle-text" aria-hidden="true"></i>
        <ChatMarkdown source={block.content} {copy} {endpoint} className="turn-process-text markdown-body" contentKey={`${stateKey}-${block.id}`} />
      </div>
    {/if}
  {/each}
</div>
