<script lang="ts">
  import type { Translation } from "../i18n";
  import TasksSection from "../settings/TasksSection.svelte";
  import InstalledSkillsPane from "./InstalledSkillsPane.svelte";
  import AgentStudioPane from "./AgentStudioPane.svelte";
  import type { ChatWorkspacePane } from "./workspace";

  export let pane: Exclude<ChatWorkspacePane, "chat">;
  export let copy: Translation;
  export let serviceEndpoint: string | null;
  export let serviceReady: boolean;
  export let serviceError: string;
  export let onRetryService: () => void;
  export let onOpenAgentSettings: () => void;
</script>

<header class="chat-header workspace-header" data-tauri-drag-region>
  <h1 class="workspace-page-title" data-tauri-drag-region>{pane === "automations" ? copy.autoTasks : pane === "skills" ? copy.skillsSquare : copy.agentsNav}</h1>
</header>

<div class="workspace-scroll" data-workspace-pane={pane}>
  {#if !serviceReady}
    <div class="workspace-empty" role={serviceError ? "alert" : undefined}>
      <p>{serviceError ? copy.workspaceLoadFailed : copy.loading}</p>
      {#if serviceError}<small>{serviceError}</small><button class="secondary-button" type="button" onclick={onRetryService}>{copy.retryLoading}</button>{/if}
    </div>
  {:else if pane === "automations"}
    <TasksSection presentation="workspace" />
  {:else if pane === "skills"}
    <InstalledSkillsPane {copy} {serviceEndpoint} {serviceReady} />
  {:else}
    <AgentStudioPane {copy} {serviceEndpoint} {serviceReady} {onOpenAgentSettings} />
  {/if}
</div>
