<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import type { Translation } from "../i18n";
  import Dialog from "../components/ui/Dialog.svelte";
  import CsvTable from "../artifacts/CsvTable.svelte";

  export let copy: Translation;
  let open = false;
  let kind: "html" | "table" = "html";
  let source = "";

  function show(event: Event): void {
    const detail = (event as CustomEvent<{ kind: "html" | "table"; source: string }>).detail;
    if (!detail?.source || !["html", "table"].includes(detail.kind)) return;
    kind = detail.kind;
    source = detail.source;
    open = true;
  }

  onMount(() => window.addEventListener("molibot:markdown-artifact", show));
  onDestroy(() => window.removeEventListener("molibot:markdown-artifact", show));
</script>

<Dialog
  {open}
  onOpenChange={(next) => (open = next)}
  overlayClass="markdown-artifact-overlay"
  contentClass="markdown-artifact-dialog"
  labelledBy="markdown-artifact-tag"
>
  <div class="markdown-artifact-stage">
    {#if kind === "table"}
      <CsvTable name="chat-table.csv" content={source} {copy} large />
    {:else}
      <iframe title={copy.markdownPreviewArtifact} sandbox="allow-scripts" srcdoc={source}></iframe>
    {/if}
  </div>
  <span id="markdown-artifact-tag" class="markdown-artifact-tag">{kind === "table" ? "CSV" : "HTML"}</span>
  <button type="button" class="markdown-artifact-close" aria-label={copy.closePreview} onclick={() => (open = false)}>
    <i class="ph ph-x" aria-hidden="true"></i>
  </button>
</Dialog>
