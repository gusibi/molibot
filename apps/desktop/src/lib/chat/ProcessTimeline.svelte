<script lang="ts">
  import AngleRight from "reicon-svelte/icons/AngleRight";
  import Bulb from "reicon-svelte/icons/Bulb";
  import ChatLine from "reicon-svelte/icons/ChatLine";
  import { ACTIVITY_GROUP_ICONS } from "./activityIcons";
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

  const durationLabel = formatDuration;
</script>

<div class="process-timeline" data-live={live}>
  {#each blocks as block (block.id)}
    {#if block.kind === "thinking"}
      <div class="process-timeline-entry process-timeline-thinking">
        <Bulb size={14} aria-hidden="true" />
        <div>
          <span class="process-timeline-label">{copy.thinking}</span>
          <pre>{block.content}</pre>
        </div>
      </div>
    {:else if block.kind === "activities"}
      {@const items = activityTimelineItems(block.activities)}
      {#each items as item (item.key)}
        {#if item.kind === "group"}
          {@const GroupIcon = ACTIVITY_GROUP_ICONS[item.action]}
          <div class="process-timeline-entry process-timeline-group">
            <GroupIcon size={14} aria-hidden="true" />
            <details class="process-activity-group">
              <summary>
                <span>{groupLabel(item)}</span>
                {#if item.durationMs}<small>{durationLabel(item.durationMs)}</small>{/if}
                <AngleRight class="process-activity-caret" size={14} aria-hidden="true" />
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
        <ChatLine size={14} aria-hidden="true" />
        <ChatMarkdown source={block.content} {copy} {endpoint} className="turn-process-text markdown-body" contentKey={`${stateKey}-${block.id}`} />
      </div>
    {/if}
  {/each}
</div>
