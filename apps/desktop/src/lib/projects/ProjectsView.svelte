<script lang="ts">
  import type { Translation } from "../i18n";
  import { loadProjects, projectsStore } from "../stores/projects.svelte";
  import ProjectList from "./ProjectList.svelte";
  import ProjectDetail from "./ProjectDetail.svelte";
  export let copy: Translation;
  export let endpoint: string | null;
  export let openChat: () => void;
  export let openSettings: () => void;
  let loadedEndpoint = "";
  // This marker belongs to the component instance, so every Project-page mount
  // reloads its selected transcript while endpoint changes still trigger once.
  $: if (endpoint && endpoint !== loadedEndpoint) {
    loadedEndpoint = endpoint;
    void loadProjects(endpoint);
  }
</script>

<main class="chat-layout projects-layout">
  <ProjectList {copy} {openChat} {openSettings} />
  <ProjectDetail {copy} />
  {#if projectsStore.error}<p class="projects-error" role="alert">{projectsStore.error}</p>{/if}
</main>
