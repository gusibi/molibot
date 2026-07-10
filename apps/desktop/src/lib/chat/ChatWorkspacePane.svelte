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
  <h1 class="workspace-page-title" data-tauri-drag-region>{pane === "automations" ? copy.autoTasks : copy.skillsSquare}</h1>
</header>

<div class="workspace-scroll" data-workspace-pane={pane}>
  {#if pane === "automations"}
    <TasksSection presentation="workspace" />
  {:else}
    <InstalledSkillsPane {copy} {serviceEndpoint} {serviceReady} />
  {/if}
</div>
