<script lang="ts">
  import { desktopFileContentUrl } from "../api";
  import type { AgentFileRow, AgentFileType } from "./agentFileGroups";
  let { endpoint, row, type, label }: { endpoint: string; row: AgentFileRow; type: AgentFileType; label: string } = $props();
  let container = $state<HTMLSpanElement>();
  let visible = $state(false);
  let url = $state("");
  $effect(() => {
    if (!container || type !== "image") return;
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { visible = true; observer.disconnect(); } });
    observer.observe(container);
    return () => observer.disconnect();
  });
  $effect(() => {
    if (!visible || type !== "image") return;
    url = desktopFileContentUrl(
      endpoint,
      row.conversation.botId ?? row.conversation.contextId,
      row.conversation.sessionId,
      row.file.id,
      false,
      row.conversation.projectId
    );
  });
</script>
<span class="agent-file-thumbnail" bind:this={container}>
  {#if url}<img src={url} alt={row.file.original} decoding="async" onerror={() => url = ""} />{:else}<span class="agent-file-type">{label}</span>{/if}
</span>
