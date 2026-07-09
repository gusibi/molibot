<script lang="ts">
  import type { Translation } from "../i18n";
  import TasksSection from "../settings/TasksSection.svelte";
  import InstalledSkillsPane from "./InstalledSkillsPane.svelte";
  import type { ChatWorkspacePane } from "./workspace";

  export let pane: Exclude<ChatWorkspacePane, "chat">;
  export let copy: Translation;
  export let serviceEndpoint: string | null;
  export let serviceReady: boolean;
</script>

<header class="chat-header workspace-header" data-tauri-drag-region>
  <div class="chat-title-block" data-tauri-drag-region>
    <div class="workspace-header-icon" data-tauri-drag-region aria-hidden="true">
      <i class={`ph-fill ph-${pane === "automations" ? "clock-countdown" : "magic-wand"}`} data-tauri-drag-region></i>
    </div>
    <div class="chat-title-text" data-tauri-drag-region>
      <div class="chat-title-name" data-tauri-drag-region>{pane === "automations" ? copy.autoTasks : copy.skillsSquare}</div>
      <div class="chat-title-sub" data-tauri-drag-region>{pane === "automations" ? copy.tasksHint : copy.installedSkillsHint}</div>
    </div>
  </div>
</header>

<div class="workspace-scroll" data-workspace-pane={pane}>
  {#if pane === "automations"}
    <TasksSection />
  {:else}
    <InstalledSkillsPane {copy} {serviceEndpoint} {serviceReady} />
  {/if}
</div>
