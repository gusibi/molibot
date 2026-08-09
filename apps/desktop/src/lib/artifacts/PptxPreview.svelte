<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import type { Translation } from "../i18n";
  import { PPTX_MAX_BYTES, preparePptxBytes } from "./pptx";

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
    /** Stable identity for the file; changing it reloads the presentation. */
    sourceKey: string;
    /** Preview object identity, so a rewritten Project file reloads in place. */
    version?: unknown;
    loadBytes: () => Promise<Blob | ArrayBuffer | Uint8Array>;
  } = $props();

  type PptxViewerInstance = {
    load: (source: ArrayBuffer) => Promise<void>;
    destroy: () => void;
    slideCount: number;
  };

  let host = $state<HTMLDivElement | null>(null);
  let viewer = $state<PptxViewerInstance | null>(null);
  let loadState = $state<"loading" | "ready" | "empty" | "error">("loading");
  let slideCount = $state(0);
  let error = $state("");
  let warning = $state("");
  let loadToken = 0;

  function disposeViewer(): void {
    viewer?.destroy();
    viewer = null;
    host?.replaceChildren();
  }

  async function loadPresentation(
    key: string,
    revision: unknown,
    loader: () => Promise<Blob | ArrayBuffer | Uint8Array>,
    appearance: "light" | "dark"
  ): Promise<void> {
    const token = ++loadToken;
    // Read the arguments before awaiting so a stale request cannot replace a
    // newer tab when the user clicks through files quickly.
    void key;
    void revision;
    disposeViewer();
    loadState = "loading";
    slideCount = 0;
    error = "";
    warning = "";

    try {
      const input = await loader();
      const bytes = input instanceof Blob ? await input.arrayBuffer() : input;
      const source = preparePptxBytes(bytes);
      await tick();
      if (token !== loadToken || !host) return;

      // Keep the OOXML parser and its WASM renderer out of the initial bundle.
      const { PptxScrollViewer } = await import("@silurus/ooxml/pptx");
      if (token !== loadToken || !host) return;

      let loadFailure: Error | null = null;
      const next = new PptxScrollViewer(host, {
        mode: "main",
        background: appearance === "dark" ? "#161b22" : "#f6f8fa",
        gap: 18,
        paddingTop: 20,
        paddingBottom: 24,
        paddingLeft: 24,
        paddingRight: 24,
        pageShadow: appearance === "dark" ? "0 0 0 1px #30363d, 0 8px 24px rgba(1, 4, 9, 0.45)" : "0 0 0 1px #d0d7de, 0 8px 24px rgba(31, 35, 40, 0.12)",
        enableTextSelection: true,
        enableHyperlinks: false,
        useGoogleFonts: false,
        maxZipEntryBytes: PPTX_MAX_BYTES,
        resourceLimits: {
          maxArchiveEntryBytes: PPTX_MAX_BYTES,
          maxTotalInflatedBytes: PPTX_MAX_BYTES * 2,
          maxArchiveEntries: 2_000
        },
        onError: (cause: Error) => {
          if (token !== loadToken) return;
          if (loadState === "loading") loadFailure = cause;
          else warning = cause.message;
        }
      });
      await next.load(source);
      if (loadFailure) {
        next.destroy();
        throw loadFailure;
      }
      if (token !== loadToken) {
        next.destroy();
        return;
      }

      viewer = next;
      slideCount = next.slideCount;
      loadState = slideCount > 0 ? "ready" : "empty";
    } catch (cause) {
      if (token !== loadToken) return;
      error = cause instanceof Error ? cause.message : String(cause);
      loadState = "error";
    }
  }

  function retry(): void {
    void loadPresentation(sourceKey, version, loadBytes, theme);
  }

  $effect(() => {
    const key = sourceKey;
    const revision = version;
    const loader = loadBytes;
    const appearance = theme;
    void loadPresentation(key, revision, loader, appearance);
  });

  onDestroy(() => {
    loadToken += 1;
    disposeViewer();
  });
</script>

<div class="pptx-preview" aria-label={name} aria-busy={loadState === "loading"}>
  {#if loadState === "ready"}
    <div class="pptx-toolbar">
      <span class="pptx-read-only"><i class="ph ph-eye" aria-hidden="true"></i>{copy.artifactPptxReadOnly}</span>
      <span class="pptx-summary">{slideCount} {copy.artifactPptxSlides}</span>
      {#if warning}
        <span class="pptx-warning" title={warning}><i class="ph ph-info" aria-hidden="true"></i>{copy.artifactPptxWarnings}</span>
      {/if}
    </div>
  {/if}

  <div class="pptx-viewer-host" bind:this={host}></div>

  {#if loadState === "loading"}
    <div class="pptx-state" role="status"><i class="ph ph-spinner-gap" aria-hidden="true"></i><span>{copy.artifactPptxLoading}</span></div>
  {:else if loadState === "error"}
    <div class="pptx-state pptx-state-error" role="alert">
      <i class="ph ph-warning-circle" aria-hidden="true"></i>
      <strong>{copy.artifactPptxFailed}</strong>
      {#if error}<span>{error}</span>{/if}
      <button type="button" onclick={retry}><i class="ph ph-arrow-clockwise" aria-hidden="true"></i>{copy.artifactRefresh}</button>
    </div>
  {:else if loadState === "empty"}
    <div class="pptx-state"><i class="ph ph-presentation" aria-hidden="true"></i><span>{copy.artifactPptxEmpty}</span></div>
  {/if}
</div>

<style>
  .pptx-preview {
    position: relative;
    display: flex;
    flex: 1 1 auto;
    min-height: 0;
    flex-direction: column;
    background: var(--card-bg);
  }
  .pptx-toolbar {
    display: flex;
    align-items: center;
    gap: 12px;
    flex: 0 0 auto;
    min-width: 0;
    padding: 6px 16px;
    border-bottom: 1px solid var(--separator);
    color: var(--label-tertiary);
    font-size: var(--fs-meta);
  }
  .pptx-read-only,
  .pptx-summary,
  .pptx-warning {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    white-space: nowrap;
  }
  .pptx-warning {
    min-width: 0;
    margin-left: auto;
    color: var(--warning);
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .pptx-viewer-host {
    flex: 1 1 auto;
    min-height: 0;
    min-width: 0;
    overflow: hidden;
  }
  .pptx-state {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 24px;
    background: var(--card-bg);
    color: var(--label-secondary);
    text-align: center;
  }
  .pptx-state-error {
    flex-direction: column;
  }
  .pptx-state-error > i {
    color: var(--danger);
    font-size: var(--icon-lg);
  }
  .pptx-state-error span {
    max-width: 520px;
    color: var(--label-tertiary);
    overflow-wrap: anywhere;
  }
  .pptx-state-error button {
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
