<script module lang="ts">
  let nextViewerId = 0;
</script>

<script lang="ts">
  import { onDestroy } from "svelte";
  import type { Translation } from "../i18n";
  import { tablist } from "../a11y/tablist";
  import { renderDesktopD2, type DesktopD2Theme } from "../api";
  import Dialog from "../components/ui/Dialog.svelte";
  import MediaViewer from "../projects/MediaViewer.svelte";

  type RenderedDiagram = { status: "ok"; svg: string } | { status: "failed" };

  let {
    source,
    endpoint = "",
    theme = "light",
    copy
  }: {
    source: string;
    endpoint?: string;
    theme?: DesktopD2Theme;
    copy: Translation;
  } = $props();

  const titleId = `d2-viewer-title-${++nextViewerId}`;
  let mode = $state<"preview" | "source">("preview");
  let expanded = $state(false);
  let copied = $state(false);
  let loading = $state(true);
  let rendered = $state<RenderedDiagram | undefined>();
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;

  const svgDataUrl = $derived(
    rendered?.status === "ok"
      ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(rendered.svg)}`
      : ""
  );

  $effect(() => {
    const currentSource = source;
    const currentEndpoint = endpoint;
    const currentTheme = theme;
    mode = "preview";
    expanded = false;
    copied = false;
    loading = true;
    rendered = undefined;
    controller?.abort();

    if (!currentEndpoint || !currentSource.trim()) {
      loading = false;
      rendered = { status: "failed" };
      return;
    }

    const nextController = new AbortController();
    controller = nextController;
    void renderDesktopD2(currentEndpoint, currentSource, currentTheme, nextController.signal)
      .then((svg) => {
        if (!nextController.signal.aborted) rendered = { status: "ok", svg };
      })
      .catch(() => {
        if (!nextController.signal.aborted) rendered = { status: "failed" };
      })
      .finally(() => {
        if (!nextController.signal.aborted) loading = false;
      });
  });

  onDestroy(() => {
    controller?.abort();
    if (copiedTimer) clearTimeout(copiedTimer);
  });

  async function copySource(): Promise<void> {
    await navigator.clipboard.writeText(source);
    copied = true;
    if (copiedTimer) clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => (copied = false), 1600);
  }
</script>

<section class="mermaid-viewer d2-viewer">
  <div class="mermaid-viewer-toolbar">
    <div class="mermaid-viewer-tabs" role="tablist" aria-label={copy.d2ViewMode} use:tablist>
      <button
        type="button"
        role="tab"
        id={`${titleId}-tab-preview`}
        aria-selected={mode === "preview"}
        aria-controls={`${titleId}-panel`}
        class:active={mode === "preview"}
        onclick={() => (mode = "preview")}
      >{copy.preview}</button>
      <button
        type="button"
        role="tab"
        id={`${titleId}-tab-source`}
        aria-selected={mode === "source"}
        aria-controls={`${titleId}-panel`}
        class:active={mode === "source"}
        onclick={() => (mode = "source")}
      >{copy.d2Source}</button>
    </div>

    {#if mode === "source"}
      <button type="button" class="mermaid-viewer-action" onclick={() => void copySource()}>
        <i class={`ph ${copied ? "ph-check" : "ph-copy"}`} aria-hidden="true"></i>
        <span>{copied ? copy.copied : copy.copyCode}</span>
      </button>
    {:else if rendered?.status === "ok"}
      <button type="button" class="mermaid-viewer-action" onclick={() => (expanded = true)}>
        <i class="ph ph-arrows-out" aria-hidden="true"></i>
        <span>{copy.d2Expand}</span>
      </button>
    {/if}
  </div>

  {#if mode === "source"}
    <div id={`${titleId}-panel`} class="mermaid-viewer-source" role="tabpanel" aria-labelledby={`${titleId}-tab-source`}><pre><code>{source}</code></pre></div>
  {:else if loading}
    <div id={`${titleId}-panel`} class="mermaid-viewer-pending" role="tabpanel" aria-labelledby={`${titleId}-tab-preview`}>
      <i class="ph ph-spinner-gap" aria-hidden="true"></i><span>{copy.loading}</span>
    </div>
  {:else if rendered?.status === "ok"}
    <div id={`${titleId}-panel`} class="mermaid-viewer-preview d2-viewer-preview" role="tabpanel" aria-labelledby={`${titleId}-tab-preview`}>
      <img class="d2-viewer-image" src={svgDataUrl} alt={copy.d2Diagram} />
    </div>
  {:else}
    <div id={`${titleId}-panel`} class="mermaid-viewer-failed" role="tabpanel" aria-labelledby={`${titleId}-tab-preview`}>
      <p>{copy.artifactD2Failed}</p>
      <pre><code>{source}</code></pre>
    </div>
  {/if}
</section>

{#if expanded && svgDataUrl}
  <Dialog
    open={expanded}
    contentClass="mermaid-zoom-dialog"
    labelledBy={titleId}
    onOpenChange={(next) => (expanded = next)}
  >
    <header class="mermaid-zoom-head">
      <strong id={titleId}>{copy.d2Diagram}</strong>
      <button type="button" aria-label={copy.closePreview} title={copy.closePreview} onclick={() => (expanded = false)}>
        <i class="ph ph-x" aria-hidden="true"></i>
      </button>
    </header>
    <div class="mermaid-zoom-body">
      <MediaViewer kind="image" src={svgDataUrl} name={copy.d2Diagram} {copy} />
    </div>
  </Dialog>
{/if}
