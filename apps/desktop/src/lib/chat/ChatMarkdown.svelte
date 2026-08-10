<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import type { Translation } from "../i18n";
  import { renderMarkdown } from "../markdown";
  import { markdownBody } from "../markdownInteractions";
  import { splitMermaidBlocks } from "../artifacts/mermaidBlocks";

  export let source: string;
  export let copy: Translation;
  export let className = "message-bubble markdown-body";
  export let onContextMenu: ((event: MouseEvent) => void) | undefined = undefined;
  export let contentKey = "answer";

  let dark = false;
  let diagrams = new Map<string, { status: "ok"; svg: string } | { status: "failed" }>();
  let renderToken = 0;
  let observer: MutationObserver | undefined;
  let root: HTMLElement;
  $: segments = splitMermaidBlocks(source);
  $: diagramKey = `${dark}:${segments.filter((segment) => segment.kind === "mermaid").map((segment) => `${segment.id}:${segment.content}`).join("|")}`;
  $: headings = source.split(/\r?\n/).flatMap((line) => {
    const match = /^(#{1,3})\s+(.+?)\s*#*$/.exec(line.trim());
    return match ? [{ level: match[1].length, label: match[2].replace(/[*_`]/g, "") }] : [];
  });

  function detectDark(): void {
    const explicit = document.documentElement.getAttribute("data-theme");
    dark = explicit === "dark" || (!explicit && matchMedia("(prefers-color-scheme: dark)").matches);
  }

  onMount(() => {
    detectDark();
    observer = new MutationObserver(detectDark);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  });
  onDestroy(() => observer?.disconnect());

  $: if (diagramKey) {
    const token = ++renderToken;
    const current = segments;
    void (async () => {
      const next = new Map<string, { status: "ok"; svg: string } | { status: "failed" }>();
      const mermaidSegments = current.filter((segment) => segment.kind === "mermaid");
      if (!mermaidSegments.length) {
        diagrams = next;
        return;
      }
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: dark ? "dark" : "default" });
        for (const segment of mermaidSegments) {
          try {
            const { svg } = await mermaid.render(`chat-${segment.id}-${token}`, segment.content);
            next.set(segment.id, { status: "ok", svg });
          } catch { next.set(segment.id, { status: "failed" }); }
        }
      } catch {
        for (const segment of mermaidSegments) next.set(segment.id, { status: "failed" });
      }
      if (token === renderToken) diagrams = next;
    })();
  }

  function html(content: string, segmentIndex: number): string {
    return renderMarkdown(content, copy.copyCode, { labels: {
      wrapLines: copy.wrapLines,
      previewArtifact: copy.markdownPreviewArtifact,
      openTable: copy.markdownOpenTable
    }, headingPrefix: `${contentKey}-${segmentIndex}` });
  }

  function jumpToHeading(index: number): void {
    root?.querySelectorAll<HTMLElement>("[data-answer-heading]")[index]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class={className} use:markdownBody={copy} oncontextmenu={onContextMenu} bind:this={root}>
  {#if headings.length >= 3}
    <nav class="answer-outline" aria-label={copy.answerOutline}>
      <strong>{copy.answerOutline}</strong>
      {#each headings as heading, index (index)}<button type="button" class:subheading={heading.level > 1} onclick={() => jumpToHeading(index)}>{heading.label}</button>{/each}
    </nav>
  {/if}
  {#each segments as segment, index (`${segment.kind}-${index}`)}
    {#if segment.kind === "markdown"}
      <div class="chat-markdown-segment">{@html html(segment.content, index)}</div>
    {:else}
      {@const rendered = diagrams.get(segment.id)}
      {#if rendered?.status === "ok"}
        <div class="chat-mermaid">{@html rendered.svg}</div>
      {:else if rendered?.status === "failed"}
        <div class="chat-mermaid-failed"><p>{copy.artifactMermaidFailed}</p><pre>{segment.content}</pre></div>
      {:else}
        <div class="chat-mermaid-pending" role="status"><i class="ph ph-spinner-gap" aria-hidden="true"></i>{copy.loading}</div>
      {/if}
    {/if}
  {/each}
</div>
