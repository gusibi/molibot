<script lang="ts">
  import { untrack } from "svelte";
  import type { Translation } from "../i18n";
  import { countMatchingLines, highlightLines, markMatches } from "./codeHighlight";

  let {
    content,
    filePath,
    copy,
    revealLine = 0,
    onRevealed
  }: {
    content: string;
    filePath: string;
    copy: Translation;
    revealLine?: number;
    onRevealed?: () => void;
  } = $props();

  /** Rendering every line of a 256 KB file at once stalls the WebView; reveal in chunks. */
  const CHUNK_LINES = 2_000;

  let wrap = $state(false);
  let findOpen = $state(false);
  let findQuery = $state("");
  let findCaseSensitive = $state(false);
  let findIndex = $state(0);
  let visibleLines = $state(CHUNK_LINES);
  let copiedLine = $state(0);
  let viewport = $state<HTMLDivElement | null>(null);
  let findInput = $state<HTMLInputElement | null>(null);

  const rawLines = $derived(content.split("\n"));
  const highlighted = $derived(highlightLines(content, filePath));
  const matches = $derived(countMatchingLines(rawLines, findQuery.trim(), findCaseSensitive));
  const matchSet = $derived(new Set(matches));
  const shown = $derived(Math.min(visibleLines, highlighted.length));
  const remaining = $derived(Math.max(0, highlighted.length - shown));
  const currentMatchLine = $derived(matches.length ? matches[Math.min(findIndex, matches.length - 1)] : -1);

  // Reset per-file view state whenever the viewer is pointed at another file.
  $effect(() => {
    filePath;
    visibleLines = CHUNK_LINES;
    findIndex = 0;
  });

  // Only `revealLine` should retrigger this; reading `visibleLines` untracked
  // keeps a chunk expansion from scrolling the viewer a second time.
  $effect(() => {
    const target = revealLine;
    if (!target) return;
    untrack(() => {
      if (target > visibleLines) visibleLines = Math.ceil(target / CHUNK_LINES) * CHUNK_LINES;
    });
    queueMicrotask(() => {
      scrollToLine(target - 1);
      onRevealed?.();
    });
  });

  function scrollToLine(index: number): void {
    const row = viewport?.querySelector<HTMLElement>(`[data-line="${index}"]`);
    row?.scrollIntoView({ block: "center", behavior: "auto" });
  }

  function stepMatch(delta: number): void {
    if (!matches.length) return;
    findIndex = (findIndex + delta + matches.length) % matches.length;
    const line = matches[findIndex];
    if (line + 1 > visibleLines) visibleLines = Math.ceil((line + 1) / CHUNK_LINES) * CHUNK_LINES;
    queueMicrotask(() => scrollToLine(line));
  }

  function openFind(): void {
    findOpen = true;
    queueMicrotask(() => findInput?.select());
  }

  function closeFind(): void {
    findOpen = false;
    findQuery = "";
    findIndex = 0;
  }

  function onKeydown(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
      event.preventDefault();
      event.stopPropagation();
      openFind();
      return;
    }
    if (event.key === "Escape" && findOpen) {
      event.preventDefault();
      event.stopPropagation();
      closeFind();
    }
  }

  function onFindKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter") {
      event.preventDefault();
      stepMatch(event.shiftKey ? -1 : 1);
    }
  }

  async function copyLineReference(index: number): Promise<void> {
    try {
      await navigator.clipboard.writeText(`${filePath}:${index + 1}`);
      copiedLine = index + 1;
      setTimeout(() => { if (copiedLine === index + 1) copiedLine = 0; }, 1200);
    } catch { /* clipboard unavailable */ }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="code-viewer" onkeydowncapture={onKeydown} role="group" aria-label={filePath}>
  <div class="code-viewer-toolbar">
    <span class="code-viewer-meta">{copy.codeViewerLines.replace("{count}", String(rawLines.length))}</span>
    <button
      type="button"
      class="code-viewer-toggle"
      class:active={wrap}
      aria-pressed={wrap}
      title={copy.codeViewerWrap}
      aria-label={copy.codeViewerWrap}
      onclick={() => (wrap = !wrap)}
    ><i class="ph ph-text-align-left" aria-hidden="true"></i></button>
    <button
      type="button"
      class="code-viewer-toggle"
      class:active={findOpen}
      aria-pressed={findOpen}
      title={copy.codeViewerFind}
      aria-label={copy.codeViewerFind}
      onclick={() => (findOpen ? closeFind() : openFind())}
    ><i class="ph ph-magnifying-glass" aria-hidden="true"></i></button>
  </div>

  {#if findOpen}
    <div class="code-viewer-find">
      <i class="ph ph-magnifying-glass" aria-hidden="true"></i>
      <input
        type="search"
        bind:this={findInput}
        bind:value={findQuery}
        placeholder={copy.codeViewerFindPlaceholder}
        aria-label={copy.codeViewerFind}
        onkeydown={onFindKeydown}
      />
      <button
        type="button"
        class="code-viewer-toggle"
        class:active={findCaseSensitive}
        aria-pressed={findCaseSensitive}
        title={copy.codeViewerCaseSensitive}
        aria-label={copy.codeViewerCaseSensitive}
        onclick={() => (findCaseSensitive = !findCaseSensitive)}
      >Aa</button>
      <span class="code-viewer-find-count">
        {matches.length ? `${Math.min(findIndex, matches.length - 1) + 1}/${matches.length}` : copy.codeViewerNoMatches}
      </span>
      <button type="button" aria-label={copy.prevMatch} title={copy.prevMatch} onclick={() => stepMatch(-1)} disabled={!matches.length}>
        <i class="ph ph-caret-up" aria-hidden="true"></i>
      </button>
      <button type="button" aria-label={copy.nextMatch} title={copy.nextMatch} onclick={() => stepMatch(1)} disabled={!matches.length}>
        <i class="ph ph-caret-down" aria-hidden="true"></i>
      </button>
      <button type="button" aria-label={copy.closePanel} title={copy.closePanel} onclick={closeFind}>
        <i class="ph ph-x" aria-hidden="true"></i>
      </button>
    </div>
  {/if}

  <div class="code-viewer-scroll" class:wrap bind:this={viewport}>
    <ol class="code-lines" style={`--code-gutter:${String(highlighted.length).length}ch`}>
      {#each highlighted.slice(0, shown) as line, index (index)}
        <li
          class="code-line"
          class:is-match={matchSet.has(index)}
          class:is-current={index === currentMatchLine}
          class:is-revealed={index === revealLine - 1}
          data-line={index}
        >
          <button
            type="button"
            class="code-line-number"
            title={copy.projectCopyPathLine}
            aria-label={copy.projectCopyPathLine}
            onclick={() => void copyLineReference(index)}
          >{copiedLine === index + 1 ? "✓" : index + 1}</button>
          <code class="code-line-text">{@html findQuery.trim() ? markMatches(line, findQuery.trim(), findCaseSensitive) : line}</code>
        </li>
      {/each}
    </ol>
    {#if remaining}
      <button type="button" class="code-viewer-more" onclick={() => (visibleLines += CHUNK_LINES)}>
        {copy.codeViewerShowMore.replace("{count}", String(remaining))}
      </button>
    {/if}
  </div>
</div>
