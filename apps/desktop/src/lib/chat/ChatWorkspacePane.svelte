<script lang="ts">
  import type { Component } from "svelte";
  import type { Translation } from "../i18n";
  import TasksSection from "../settings/TasksSection.svelte";
  import InstalledSkillsPane from "./InstalledSkillsPane.svelte";
  import type { ChatWorkspacePane } from "./workspace";

  export let pane: Exclude<ChatWorkspacePane, "chat">;
  export let copy: Translation;
  export let serviceEndpoint: string | null;
  export let serviceReady: boolean;
  export let serviceError: string;
  export let onRetryService: () => void;
  export let onOpenAgentSettings: () => void;

  interface AgentStudioProps {
    copy: Translation;
    serviceEndpoint: string | null;
    serviceReady: boolean;
    onOpenAgentSettings: () => void;
  }

  let AgentStudioComponent: Component<AgentStudioProps> | null = null;
  let loadingAgentStudio = false;

  $: if (pane === "agents" && !AgentStudioComponent && !loadingAgentStudio) {
    loadingAgentStudio = true;
    void import("./AgentStudioPane.svelte").then((module) => {
      AgentStudioComponent = module.default as Component<AgentStudioProps>;
    }).finally(() => {
      loadingAgentStudio = false;
    });
  }
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
  {:else if AgentStudioComponent}
    <AgentStudioComponent {copy} {serviceEndpoint} {serviceReady} {onOpenAgentSettings} />
  {:else}
    <div class="workspace-empty"><p>{copy.loading}</p></div>
  {/if}
</div>
