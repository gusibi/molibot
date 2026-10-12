<script lang="ts">
  import { fetchDesktopFileBlob } from "../api";
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
    const target = endpoint, item = row;
    let active = true, objectUrl = "";
    url = "";
    fetchDesktopFileBlob(target, item.conversation.botId ?? item.conversation.contextId, item.conversation.sessionId, item.file.id, false, item.conversation.projectId).then(blob => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob); url = objectUrl;
    }).catch(() => { if (active) url = ""; });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  });
</script>
<span class="agent-file-thumbnail" bind:this={container}>
  {#if url}<img src={url} alt={row.file.original} onerror={() => url = ""} />{:else}<span class="agent-file-type">{label}</span>{/if}
</span>
