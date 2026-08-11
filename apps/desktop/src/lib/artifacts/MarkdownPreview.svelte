<script lang="ts">
  import { renderMarkdown } from "../markdown";
  import { markdownBody } from "../markdownInteractions";
  import { splitMermaidBlocks, hasMermaidBlock, type MarkdownSegment } from "./mermaidBlocks";
  import CodeViewer from "../projects/CodeViewer.svelte";
  import type { Translation } from "../i18n";

  /**
   * Markdown viewer (PRD §3.38 Slice 2) plus mermaid diagrams (Slice 3).
   *
   * The prose goes through the transcript's own `renderMarkdown` - the same
   * marked + highlight.js + DOMPurify pipeline, not a second implementation
   * (pitfall #7) - so an agent-written report reads in the panel exactly as it
   * does in chat.
   *
   * Mermaid is loaded with a dynamic `import()` and only when the document
   * actually contains a diagram, so a ~2 MB library never enters the initial
   * bundle or a plain Markdown file's render path. A render failure degrades to
   * the diagram's source text; it never blanks the tab.
   */
  let {
    content,
    copy,
    theme,
    name,
    showSource = false
  }: {
    content: string;
    copy: Translation;
    theme: "light" | "dark";
    /** File name; drives CodeViewer's highlighter in the source view. */
    name: string;
    /** Owned by the panel's shared source toggle. */
    showSource?: boolean;
  } = $props();

  const segments = $derived(splitMermaidBlocks(content));
  const diagramsPresent = $derived(hasMermaidBlock(content));

  /** Rendered SVG per diagram id, or an error marker to fall back to source. */
  let diagrams = $state(new Map<string, { status: "ok"; svg: string } | { status: "failed" }>());
  let renderToken = 0;

  function markdownHtml(segment: MarkdownSegment): string {
    return segment.kind === "markdown"
      ? renderMarkdown(segment.content, copy.copyCode, { labels: { wrapLines: copy.wrapLines } })
      : "";
  }


  $effect(() => {
    // Re-render on content *and* theme: mermaid bakes its palette into the SVG,
    // so a theme switch needs a fresh render, not a CSS override.
    const currentSegments = segments;
    const currentTheme = theme;
    if (showSource || !diagramsPresent) return;

    const token = ++renderToken;
    void (async () => {
      let mermaid: typeof import("mermaid").default;
      try {
        mermaid = (await import("mermaid")).default;
      } catch {
        if (token === renderToken) {
          diagrams = new Map(
            currentSegments
              .filter((segment) => segment.kind === "mermaid")
              .map((segment) => [(segment as { id: string }).id, { status: "failed" as const }])
          );
        }
        return;
      }
      // `securityLevel: strict` keeps the library from emitting scripts or
      // click handlers from diagram text, which is agent-generated content.
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        suppressErrorRendering: true,
        theme: currentTheme === "dark" ? "dark" : "default"
      });

      const next = new Map<string, { status: "ok"; svg: string } | { status: "failed" }>();
      for (const segment of currentSegments) {
        if (segment.kind !== "mermaid") continue;
        try {
          const { svg } = await mermaid.render(`${segment.id}-${token}`, segment.content);
          next.set(segment.id, { status: "ok", svg });
        } catch {
          next.set(segment.id, { status: "failed" });
        }
      }
      // A late render must never replace a newer document's diagrams
      // (pitfall #3).
      if (token === renderToken) diagrams = next;
    })();
  });
</script>

{#if showSource}
  <CodeViewer content={content} filePath={name} {copy} />
{:else}
  <!-- One delegated listener for every segment: links and code-block copy
       buttons behave the same wherever they land in the document. -->
  <div class="markdown-preview" use:markdownBody={copy}>
    {#each segments as segment, index (index)}
      {#if segment.kind === "markdown"}
        <div class="markdown-body">{@html markdownHtml(segment)}</div>
      {:else}
        {@const rendered = diagrams.get(segment.id)}
        {#if rendered?.status === "ok"}
          <div class="markdown-preview-diagram">{@html rendered.svg}</div>
        {:else if rendered?.status === "failed"}
          <div class="markdown-preview-diagram-failed">
            <p class="project-viewer-note">{copy.artifactMermaidFailed}</p>
            <pre>{segment.content}</pre>
          </div>
        {:else}
          <div class="markdown-preview-diagram-pending" role="status">
            <i class="ph ph-spinner-gap" aria-hidden="true"></i><span>{copy.loading}</span>
          </div>
        {/if}
      {/if}
    {/each}
  </div>
{/if}

<style>
  .markdown-preview {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    padding: 12px 16px;
    color: var(--label-primary);
    font-size: var(--fs-body);
    line-height: var(--lh-body);
  }
  .markdown-preview-diagram {
    display: flex;
    justify-content: center;
    padding: 12px 0;
    overflow-x: auto;
  }
  .markdown-preview-diagram :global(svg) {
    max-width: 100%;
    height: auto;
  }
  .markdown-preview-diagram-pending {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 12px 0;
    color: var(--label-tertiary);
    font-size: var(--fs-meta);
    line-height: var(--lh-meta);
  }
  .markdown-preview-diagram-failed pre {
    margin: 0;
    padding: 8px 10px;
    border: 1px solid var(--separator);
    border-radius: var(--radius-small);
    background: var(--fill);
    font-family: var(--font-mono);
    font-size: var(--fs-meta);
    line-height: var(--lh-meta);
    white-space: pre-wrap;
    word-break: break-word;
  }
</style>
