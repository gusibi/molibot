<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import type { Translation } from "../i18n";
  import Dialog from "../components/ui/Dialog.svelte";
  import SpreadsheetTable from "../artifacts/SpreadsheetTable.svelte";

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

<Dialog {open} onOpenChange={(next) => (open = next)} contentClass="markdown-artifact-dialog">
  <div class="markdown-artifact-head">
    <strong>{kind === "table" ? copy.markdownOpenTable : copy.markdownPreviewArtifact}</strong>
    <button type="button" aria-label={copy.cancel} onclick={() => (open = false)}><i class="ph ph-x" aria-hidden="true"></i></button>
  </div>
  <div class="markdown-artifact-content">
    {#if kind === "table"}
      <SpreadsheetTable name="chat-table.csv" {copy} sourceKey={source} loadBytes={async () => new Blob([source], { type: "text/csv" })} />
    {:else}
      <iframe title={copy.markdownPreviewArtifact} sandbox="" srcdoc={source}></iframe>
    {/if}
  </div>
</Dialog>
