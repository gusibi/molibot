<script lang="ts">
  import AgentCityStartup from "../../chat/AgentCityStartup.svelte";
  let { title, description = "" }: { title: string; description?: string } = $props();
</script>

<div class="workspace-empty-art" role="status">
  <AgentCityStartup paused />
  <h2>{title}</h2>
  {#if description}<p>{description}</p>{/if}
</div>
