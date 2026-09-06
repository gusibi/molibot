<script lang="ts">
  import Sidebar from "reicon-svelte/icons/Sidebar";
  import type { Component } from "svelte";
  import type { Translation } from "../i18n";
  import PageHeader from "../components/ui/PageHeader.svelte";
  import TasksSection from "../settings/TasksSection.svelte";
  import InstalledSkillsPane from "./InstalledSkillsPane.svelte";
  import MiniAppsLaunchpad from "../miniapps/MiniAppsLaunchpad.svelte";
  import type { ChatWorkspacePane } from "./workspace";

  export let pane: Exclude<ChatWorkspacePane, "chat">;
  export let copy: Translation;
  export let serviceEndpoint: string | null;
  export let serviceReady: boolean;
  export let serviceError: string;
  export let onRetryService: () => void;
  export let onOpenAgentSettings: () => void;
  export let onAutomationUnreadChange: (count: number) => void = () => {};
  export let onOpenMiniApp: (appId: string) => void = () => {};
  /** Opens Settings at the Mini App AI section; the pane only signposts it. */
  export let onOpenMiniAppAiSettings: () => void = () => {};
  export let sidebarCollapsed = false;
  export let onToggleSidebar: () => void = () => {};

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

  $: workspaceTitle = pane === "automations" ? copy.autoTasks : pane === "skills" ? copy.skillsSquare : pane === "miniapps" ? copy.miniAppsNav : copy.agentsNav;
  $: workspaceDescription = pane === "automations" ? copy.autoTasksHint : pane === "skills" ? copy.skillsSquareHint : pane === "miniapps" ? copy.miniAppsHint : copy.agentStudioHint;
</script>

<PageHeader title={workspaceTitle} description={workspaceDescription} workspace>
  <div slot="actions">
    {#if sidebarCollapsed}
      <button
        type="button"
        class="icon-button sidebar-expand-btn workspace-header-expand"
        aria-label={copy.expandSidebar}
        title={copy.expandSidebar}
        onclick={onToggleSidebar}
      >
        <Sidebar size={16} aria-hidden="true" />
      </button>
    {/if}
  </div>
</PageHeader>

<div class="workspace-scroll" data-workspace-pane={pane}>
  {#if !serviceReady}
    <div class="workspace-empty" role={serviceError ? "alert" : undefined}>
      <p>{serviceError ? copy.workspaceLoadFailed : copy.loading}</p>
      {#if serviceError}<small>{serviceError}</small><button class="secondary-button" type="button" onclick={onRetryService}>{copy.retryLoading}</button>{/if}
    </div>
  {:else if pane === "automations"}
    <TasksSection presentation="workspace" onUnreadChange={onAutomationUnreadChange} />
  {:else if pane === "skills"}
    <InstalledSkillsPane {copy} {serviceEndpoint} {serviceReady} />
  {:else if pane === "miniapps"}
    <MiniAppsLaunchpad onOpenApp={onOpenMiniApp} onOpenAiSettings={onOpenMiniAppAiSettings} />
  {:else if AgentStudioComponent}
    <AgentStudioComponent {copy} {serviceEndpoint} {serviceReady} {onOpenAgentSettings} />
  {:else}
    <div class="workspace-empty"><p>{copy.loading}</p></div>
  {/if}
</div>
