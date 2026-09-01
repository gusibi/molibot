<script lang="ts">
  import Eye from "reicon-svelte/icons/Eye";
  import FileText from "reicon-svelte/icons/FileText";
  import InfoCircle from "reicon-svelte/icons/InfoCircle";
  import Loader from "reicon-svelte/icons/Loader";
  import Refresh from "reicon-svelte/icons/Refresh";
  import TriangleWarning from "reicon-svelte/icons/TriangleWarning";
  import type { Translation } from "../i18n";
  import MarkdownPreview from "./MarkdownPreview.svelte";
  import { parseDocx, type DocxDocument } from "./docx";

  let {
    name,
    copy,
    theme,
    sourceKey,
    version,
    loadBytes
  }: {
    name: string;
    copy: Translation;
    theme: "light" | "dark";
    /** Stable identity for the file; changing it reloads the document. */
    sourceKey: string;
    /** Preview object identity, so a rewritten Project file reloads in place. */
    version?: unknown;
    loadBytes: () => Promise<Blob | ArrayBuffer | Uint8Array>;
  } = $props();

  let loadState = $state<"loading" | "ready" | "error">("loading");
  let document = $state<DocxDocument | null>(null);
  let error = $state("");
  let loadToken = 0;

  async function loadDocument(key: string, revision: unknown, loader: () => Promise<Blob | ArrayBuffer | Uint8Array>): Promise<void> {
    const token = ++loadToken;
    // Read the arguments before awaiting so a stale request cannot replace a
    // newer tab when the user clicks through files quickly.
    void key;
    void revision;
    loadState = "loading";
    document = null;
    error = "";
    try {
      const input = await loader();
      const bytes = input instanceof Blob ? await input.arrayBuffer() : input;
      const parsed = await parseDocx(bytes);
      if (token !== loadToken) return;
      document = parsed;
      loadState = "ready";
    } catch (cause) {
      if (token !== loadToken) return;
      error = cause instanceof Error ? cause.message : String(cause);
      loadState = "error";
    }
  }

  function retry(): void {
    void loadDocument(sourceKey, version, loadBytes);
  }

  $effect(() => {
    const key = sourceKey;
    const revision = version;
    const loader = loadBytes;
    void loadDocument(key, revision, loader);
  });
</script>

<div class="docx-preview" aria-label={name}>
  {#if loadState === "loading"}
    <div class="docx-state" role="status"><Loader size={18} aria-hidden="true" /><span>{copy.artifactDocxLoading}</span></div>
  {:else if loadState === "error"}
    <div class="docx-state docx-state-error" role="alert">
      <TriangleWarning size={18} aria-hidden="true" />
      <strong>{copy.artifactDocxFailed}</strong>
      {#if error}<span>{error}</span>{/if}
      <button type="button" onclick={retry}><Refresh size={14} aria-hidden="true" />{copy.artifactRefresh}</button>
    </div>
  {:else if !document || !document.markdown.trim()}
    <div class="docx-state"><FileText size={18} aria-hidden="true" /><span>{copy.artifactDocxEmpty}</span></div>
  {:else}
    <div class="docx-toolbar">
      <span class="docx-read-only"><Eye size={12} aria-hidden="true" />{copy.artifactDocxReadOnly}</span>
      {#if document.warnings.length > 0}
        <span class="docx-warning" title={document.warnings.join("\n")}><InfoCircle size={12} aria-hidden="true" />{copy.artifactDocxWarnings}</span>
      {/if}
    </div>
    <MarkdownPreview content={document.markdown} {copy} {theme} name={name} />
  {/if}
</div>

<style>
  .docx-preview {
    display: flex;
    flex: 1 1 auto;
    min-height: 0;
    flex-direction: column;
    background: var(--card-bg);
  }
  .docx-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex: 0 0 auto;
    padding: 6px 16px;
    border-bottom: 1px solid var(--separator);
    color: var(--label-tertiary);
    font-size: var(--fs-meta);
  }
  .docx-read-only,
  .docx-warning {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .docx-warning {
    color: var(--warning);
  }
  .docx-state {
    display: flex;
    flex: 1 1 auto;
    min-height: 0;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 24px;
    color: var(--label-secondary);
    text-align: center;
  }
  .docx-state-error {
    flex-direction: column;
  }
  .docx-state-error > :global(svg) {
    color: var(--danger);
    font-size: var(--icon-lg);
  }
  .docx-state-error span {
    max-width: 520px;
    color: var(--label-tertiary);
    overflow-wrap: anywhere;
  }
  .docx-state-error button {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    border: 1px solid var(--chrome-border);
    border-radius: var(--radius-small);
    background: transparent;
    color: var(--label-secondary);
    padding: 5px 10px;
    cursor: pointer;
    font: inherit;
  }
</style>
