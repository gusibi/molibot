<script lang="ts">
  import type { Translation } from "../i18n";
  import type { RawPreviewKind } from "@molibot/shared/filePreview";
  import { formatSize } from "./fileIcons";

  let { kind, src, name, sizeBytes = 0, copy }: {
    kind: RawPreviewKind;
    src: string;
    name: string;
    sizeBytes?: number;
    copy: Translation;
  } = $props();

  const MIN_ZOOM = 0.1;
  const MAX_ZOOM = 12;

  let zoom = $state(0);
  /** 0 means "fit to the viewport"; any other value is an explicit zoom factor. */
  let offsetX = $state(0);
  let offsetY = $state(0);
  let naturalWidth = $state(0);
  let naturalHeight = $state(0);
  let failed = $state(false);
  let panning = $state(false);
  let panOrigin = { x: 0, y: 0, offsetX: 0, offsetY: 0 };

  const fitted = $derived(zoom === 0);
  const scale = $derived(zoom || 1);

  // Reset the transform whenever the viewer is pointed at another file.
  $effect(() => {
    src;
    zoom = 0;
    offsetX = 0;
    offsetY = 0;
    naturalWidth = 0;
    naturalHeight = 0;
    failed = false;
  });

  function clampZoom(value: number): number {
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
  }

  function fit(): void {
    zoom = 0;
    offsetX = 0;
    offsetY = 0;
  }

  function actualSize(): void {
    zoom = 1;
    offsetX = 0;
    offsetY = 0;
  }

  function step(factor: number): void {
    zoom = clampZoom((zoom || 1) * factor);
  }

  function onWheel(event: WheelEvent): void {
    if (kind !== "image") return;
    event.preventDefault();
    // A trackpad pinch arrives as a ctrl-modified wheel event; both gestures zoom.
    step(Math.exp(-event.deltaY / 260));
  }

  function onPointerDown(event: PointerEvent): void {
    if (kind !== "image" || event.button !== 0 || fitted) return;
    event.preventDefault();
    panning = true;
    panOrigin = { x: event.clientX, y: event.clientY, offsetX, offsetY };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent): void {
    if (!panning) return;
    offsetX = panOrigin.offsetX + (event.clientX - panOrigin.x);
    offsetY = panOrigin.offsetY + (event.clientY - panOrigin.y);
  }

  function onPointerUp(event: PointerEvent): void {
    if (!panning) return;
    panning = false;
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
  }

  function onDoubleClick(): void {
    if (kind !== "image") return;
    if (fitted) actualSize();
    else fit();
  }
</script>

<div class="media-viewer" class:is-image={kind === "image"}>
  {#if kind === "image"}
    <div class="media-viewer-toolbar">
      <span class="media-viewer-meta">
        {#if naturalWidth}{naturalWidth} × {naturalHeight}{/if}
        {#if sizeBytes}<span>· {formatSize(sizeBytes)}</span>{/if}
        <span>· {fitted ? copy.mediaViewerFit : `${Math.round(scale * 100)}%`}</span>
      </span>
      <button type="button" class="code-viewer-toggle" title={copy.mediaViewerZoomOut} aria-label={copy.mediaViewerZoomOut} onclick={() => step(1 / 1.25)}>
        <i class="ph ph-magnifying-glass-minus" aria-hidden="true"></i>
      </button>
      <button type="button" class="code-viewer-toggle" title={copy.mediaViewerZoomIn} aria-label={copy.mediaViewerZoomIn} onclick={() => step(1.25)}>
        <i class="ph ph-magnifying-glass-plus" aria-hidden="true"></i>
      </button>
      <button type="button" class="code-viewer-toggle" class:active={fitted} title={copy.mediaViewerFit} aria-label={copy.mediaViewerFit} onclick={fit}>
        <i class="ph ph-corners-in" aria-hidden="true"></i>
      </button>
      <button type="button" class="code-viewer-toggle" class:active={zoom === 1} title={copy.mediaViewerActualSize} aria-label={copy.mediaViewerActualSize} onclick={actualSize}>1:1</button>
    </div>
  {/if}

  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="media-viewer-stage"
    class:panning
    class:zoomed={!fitted}
    onwheel={onWheel}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
    ondblclick={onDoubleClick}
  >
    {#if failed}
      <p class="project-viewer-note">{copy.mediaLoadFailed}</p>
    {:else if kind === "image"}
      <img
        class="media-viewer-image"
        class:fitted
        src={src}
        alt={name}
        draggable="false"
        style={fitted ? "" : `transform: translate(${offsetX}px, ${offsetY}px) scale(${scale});`}
        onload={(event) => {
          const image = event.currentTarget as HTMLImageElement;
          naturalWidth = image.naturalWidth;
          naturalHeight = image.naturalHeight;
        }}
        onerror={() => (failed = true)}
      />
    {:else if kind === "video"}
      <!-- svelte-ignore a11y_media_has_caption -->
      <video class="media-viewer-video" src={src} controls preload="metadata" onerror={() => (failed = true)}></video>
    {:else if kind === "audio"}
      <audio class="media-viewer-audio" src={src} controls preload="metadata" onerror={() => (failed = true)}></audio>
    {:else if kind === "pdf"}
      <embed class="media-viewer-pdf" src={src} type="application/pdf" title={name} />
    {/if}
  </div>
</div>
