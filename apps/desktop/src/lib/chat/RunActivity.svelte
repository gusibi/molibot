<script lang="ts">
  import type { DesktopConversationActivity } from "@molibot/desktop-contract";
  import type { Translation } from "../i18n";

  export let activities: DesktopConversationActivity[];
  export let copy: Translation;
  export let live = false;

  $: hasRunning = activities.some((activity) => activity.state === "running");
  $: hasError = activities.some((activity) => activity.state === "error");

  function icon(state: DesktopConversationActivity["state"]): string {
    if (state === "running") return "circle-notch";
    if (state === "success") return "check-circle";
    if (state === "error") return "x-circle";
    return "info";
  }
</script>

<details class="run-activity" open={live || hasRunning || hasError}>
  <summary class="run-activity-head">
    <i class={`ph${hasRunning ? "" : "-fill"} ph-${hasRunning ? "circle-notch" : hasError ? "warning-circle" : "check-circle"}`} class:spin={hasRunning} aria-hidden="true"></i>
    <span>{hasRunning ? copy.runProgress : hasError ? copy.runFailed : copy.runCompleted}</span>
    <span class="run-activity-count">{activities.length}</span>
    <i class="ph ph-caret-down run-activity-caret" aria-hidden="true"></i>
  </summary>
  <div class="run-activity-list">
    {#each activities as activity (activity.key)}
      {#if activity.summary}
        <details class="run-activity-item" data-state={activity.state} open={activity.state === "error"}>
          <summary><i class={`ph${activity.state === "running" ? "" : "-fill"} ph-${icon(activity.state)}`} class:spin={activity.state === "running"} aria-hidden="true"></i><span>{activity.label}</span><i class="ph ph-caret-right run-activity-item-caret" aria-hidden="true"></i></summary>
          <pre>{activity.summary}</pre>
        </details>
      {:else}
        <div class="run-activity-item run-activity-line" data-state={activity.state}><i class={`ph${activity.state === "running" ? "" : "-fill"} ph-${icon(activity.state)}`} class:spin={activity.state === "running"} aria-hidden="true"></i><span>{activity.label}</span></div>
      {/if}
    {/each}
  </div>
</details>
