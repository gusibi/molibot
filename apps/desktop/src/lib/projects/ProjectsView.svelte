<script lang="ts">
  import type { Translation } from "../i18n";
  import { loadProjects, projectsStore } from "../stores/projects.svelte";
  import ProjectList from "./ProjectList.svelte";
  import ProjectDetail from "./ProjectDetail.svelte";
  export let copy: Translation;
  export let endpoint: string | null;
  export let openChat: () => void;
  // A single reactive trigger handles both the initial load and endpoint
  // changes. Calling loadProjects from onMount as well doubles the first fetch
  // (projectsStore.endpoint is still "" on mount) and races two loads, which
  // leaves the auto-selected session's messages empty until the view is remounted.
  $: if (endpoint && endpoint !== projectsStore.endpoint) void loadProjects(endpoint);
</script>

<main class="chat-layout projects-layout">
  <ProjectList {copy} {openChat} />
  <ProjectDetail {copy} />
  {#if projectsStore.error}<p class="projects-error" role="alert">{projectsStore.error}</p>{/if}
</main>
