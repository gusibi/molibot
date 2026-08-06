<script lang="ts">
  import type { Translation } from "../i18n";
  import CodeViewer from "../projects/CodeViewer.svelte";

  /**
   * SVG viewer (PRD §3.38 Slice 2): renders the graphic with the source one
   * toggle away, in both Project and Session scope.
   *
   * The render goes through `<img src=…>` rather than inlining the markup: an
   * `<img>` document cannot run scripts or fetch external resources, and the
   * file is agent-generated content. `src` is the same streaming URL the media
   * viewer uses, so nothing new is fetched and large files are not decoded twice.
   */
  let {
    src,
    source = "",
    name,
    showSource = false,
    copy
  }: {
    /** Streaming URL for the rendered view. */
    src: string;
    /** Decoded markup for the source view; empty while the text is still loading. */
    source?: string;
    name: string;
    /** Owned by the panel's shared source toggle. */
    showSource?: boolean;
    copy: Translation;
  } = $props();

  let failed = $state(false);

  // A new file must clear a previous file's failure, or the tab stays broken.
  $effect(() => {
    void src;
    failed = false;
  });
</script>

{#if showSource}
  <CodeViewer content={source} filePath={name} {copy} />
{:else if failed || !src}
  <p class="project-viewer-note">{copy.mediaLoadFailed}</p>
{:else}
  <div class="svg-viewer-stage">
    <img class="svg-viewer-image" {src} alt={name} onerror={() => (failed = true)} />
  </div>
{/if}

<style>
  .svg-viewer-stage {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: auto;
    padding: 16px;
    /* A checkerboard reads transparency, which is most of what an SVG asset has. */
    background-image:
      linear-gradient(45deg, var(--fill) 25%, transparent 25%),
      linear-gradient(-45deg, var(--fill) 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, var(--fill) 75%),
      linear-gradient(-45deg, transparent 75%, var(--fill) 75%);
    background-size: 16px 16px;
    background-position: 0 0, 0 8px, 8px -8px, -8px 0;
  }
  .svg-viewer-image {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }
</style>
