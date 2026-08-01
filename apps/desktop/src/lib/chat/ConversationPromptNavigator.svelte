<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import type { Translation } from "../i18n";
  import type { TranscriptMessage } from "./transcript";
  import {
    activePromptIndex,
    dockMarkerWidth,
    extractPromptNavigationItems,
    layoutPromptMarkers,
    promptMarkerWindow,
    PROMPT_NAVIGATOR_MIN_TURNS,
    PROMPT_OVERFLOW_SLOT,
    type PromptMarkerWindow,
    type PromptNavigationItem
  } from "./conversationNavigation";
  import { suspendStickToBottom } from "./stickToBottom";

  type PositionedPrompt = PromptNavigationItem & { navigationTop: number };

  export let messages: TranscriptMessage[];
  export let copy: Translation;
  export let formatTime: (value: string) => string;
  export let scrollElement: HTMLDivElement | undefined;

  let navigatorElement: HTMLElement;
  let measuredItems: { item: PromptNavigationItem; offset: number }[] = [];
  let positionedItems: PositionedPrompt[] = [];
  let promptOffsets: number[] = [];
  let markerWindow: PromptMarkerWindow = { start: 0, end: 0, hiddenAbove: 0, hiddenBelow: 0 };
  let activeIndex = -1;
  let activeMessageId = "";
  let hoveredMessageId = "";
  let focusedMessageId = "";
  let pointerY: number | null = null;
  let connectedElement: HTMLDivElement | undefined;
  let resizeObserver: ResizeObserver | null = null;
  let observedRows = new Set<HTMLElement>();
  let mutationObserver: MutationObserver | null = null;
  let measureTimer: ReturnType<typeof setTimeout> | null = null;
  let scrollFrame = 0;
  let pointerFrame = 0;
  let pendingPointerY: number | null = null;
  let mounted = false;

  $: navigationItems = extractPromptNavigationItems(messages, {
    image: copy.promptNavigationImage,
    audio: copy.promptNavigationAudio,
    file: (name) => copy.promptNavigationFile.replace("{name}", name),
    empty: copy.promptNavigationEmpty
  });
  $: visible = navigationItems.length >= PROMPT_NAVIGATOR_MIN_TURNS;
  $: if (mounted && scrollElement !== connectedElement) connectScrollElement(scrollElement);
  $: if (mounted && visible && scrollElement && navigationItems) {
    void tick().then(() => scheduleMeasure(true));
  }

  function updateActivePrompt(): void {
    if (!scrollElement || promptOffsets.length === 0) {
      activeIndex = -1;
      activeMessageId = "";
      return;
    }
    const index = activePromptIndex(promptOffsets, scrollElement.scrollTop + 80);
    if (index === activeIndex) return;
    activeIndex = index;
    layoutWindow();
  }

  function layoutWindow(): void {
    if (!navigatorElement || measuredItems.length === 0) {
      positionedItems = [];
      markerWindow = { start: 0, end: 0, hiddenAbove: 0, hiddenBelow: 0 };
      activeMessageId = "";
      return;
    }
    markerWindow = promptMarkerWindow(measuredItems.length, activeIndex, navigatorElement.clientHeight);
    const slice = measuredItems.slice(markerWindow.start, markerWindow.end);
    const positions = layoutPromptMarkers(slice.length, navigatorElement.clientHeight);
    positionedItems = slice.map(({ item }, index) => ({ ...item, navigationTop: positions[index] }));
    activeMessageId = measuredItems[activeIndex]?.item.messageId ?? "";
  }

  function measure(): void {
    measureTimer = null;
    if (!scrollElement || !navigatorElement || !visible) {
      measuredItems = [];
      positionedItems = [];
      promptOffsets = [];
      activeIndex = -1;
      activeMessageId = "";
      return;
    }
    const scrollRect = scrollElement.getBoundingClientRect();
    measuredItems = navigationItems.flatMap((item) => {
      const target = scrollElement?.querySelector<HTMLElement>(`[data-navigation-id="${CSS.escape(item.messageId)}"]`);
      if (!target) return [];
      return [{ item, offset: target.getBoundingClientRect().top - scrollRect.top + scrollElement.scrollTop }];
    });
    promptOffsets = measuredItems.map(({ offset }) => offset);
    observeRows();
    activeIndex = activePromptIndex(promptOffsets, scrollElement.scrollTop + 80);
    layoutWindow();
  }

  function scheduleMeasure(immediate = false): void {
    if (measureTimer) clearTimeout(measureTimer);
    measureTimer = setTimeout(() => requestAnimationFrame(measure), immediate ? 0 : 140);
  }

  function observeRows(): void {
    if (!resizeObserver || !scrollElement) return;
    const nextRows = new Set(scrollElement.querySelectorAll<HTMLElement>(".message-row"));
    observedRows.forEach((row) => {
      if (!nextRows.has(row)) resizeObserver?.unobserve(row);
    });
    nextRows.forEach((row) => {
      if (!observedRows.has(row)) resizeObserver?.observe(row);
    });
    observedRows = nextRows;
  }

  function handleScroll(): void {
    cancelAnimationFrame(scrollFrame);
    scrollFrame = requestAnimationFrame(updateActivePrompt);
  }

  function connectScrollElement(next: HTMLDivElement | undefined): void {
    connectedElement?.removeEventListener("scroll", handleScroll);
    resizeObserver?.disconnect();
    observedRows.clear();
    mutationObserver?.disconnect();
    connectedElement = next;
    if (!next) return;
    next.addEventListener("scroll", handleScroll, { passive: true });
    resizeObserver = new ResizeObserver(() => scheduleMeasure());
    resizeObserver.observe(next);
    mutationObserver = new MutationObserver(() => scheduleMeasure());
    mutationObserver.observe(next, { childList: true, subtree: true });
    observeRows();
    scheduleMeasure(true);
  }

  function handlePointerMove(event: PointerEvent): void {
    const rect = navigatorElement.getBoundingClientRect();
    pendingPointerY = event.clientY - rect.top;
    if (pointerFrame) return;
    pointerFrame = requestAnimationFrame(() => {
      pointerFrame = 0;
      pointerY = pendingPointerY;
      updateHoveredPrompt();
    });
  }

  function updateHoveredPrompt(): void {
    if (pointerY === null) {
      hoveredMessageId = "";
      return;
    }
    const currentPointerY = pointerY;
    let nearest: PositionedPrompt | undefined;
    let nearestDistance = Number.POSITIVE_INFINITY;
    positionedItems.forEach((item) => {
      const distance = Math.abs(item.navigationTop - currentPointerY);
      if (distance < nearestDistance) {
        nearest = item;
        nearestDistance = distance;
      }
    });
    hoveredMessageId = nearest && nearestDistance <= 8 ? nearest.messageId : "";
  }

  function markerWidth(item: PositionedPrompt, focusedId: string, activeId: string, currentPointerY: number | null): number {
    if (focusedId === item.messageId) return 46;
    return Math.max(item.messageId === activeId ? 18 : 6, dockMarkerWidth(item.navigationTop, currentPointerY));
  }

  function jumpToPrompt(item: PromptNavigationItem): void {
    if (!scrollElement) return;
    const target = scrollElement.querySelector<HTMLElement>(`[data-navigation-id="${CSS.escape(item.messageId)}"]`);
    if (!target) return;
    suspendStickToBottom(scrollElement);
    const index = measuredItems.findIndex((entry) => entry.item.messageId === item.messageId);
    if (index >= 0 && index !== activeIndex) {
      activeIndex = index;
      layoutWindow();
    }
    activeMessageId = item.messageId;
    target.classList.remove("navigation-target");
    requestAnimationFrame(() => target.classList.add("navigation-target"));
    window.setTimeout(() => target.classList.remove("navigation-target"), 1000);
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    target.scrollIntoView({ behavior, block: "start" });
  }

  function turnLabel(item: PositionedPrompt, currentCopy: Translation): string {
    return currentCopy.promptNavigationTurn.replace("{count}", String(item.turnIndex + 1));
  }

  function ariaLabel(item: PositionedPrompt, currentCopy: Translation): string {
    return currentCopy.jumpToPrompt.replace("{count}", String(item.turnIndex + 1)).replace("{preview}", [item.userPreviewText, item.assistantPreviewText].filter(Boolean).join(" — "));
  }

  function previewTop(item: PositionedPrompt): number {
    return Math.min(Math.max(item.navigationTop, 28), Math.max(28, navigatorElement.clientHeight - 28));
  }

  function pageJump(direction: -1 | 1): void {
    if (measuredItems.length === 0) return;
    const pageSize = Math.max(1, markerWindow.end - markerWindow.start);
    const target = Math.min(Math.max(activeIndex + direction * pageSize, 0), measuredItems.length - 1);
    const entry = measuredItems[target];
    if (entry) jumpToPrompt(entry.item);
  }

  function overflowTop(edgeItem: PositionedPrompt | undefined, direction: -1 | 1): number {
    if (!edgeItem) return direction === -1 ? PROMPT_OVERFLOW_SLOT : 0;
    return edgeItem.navigationTop + direction * PROMPT_OVERFLOW_SLOT;
  }

  function overflowLabel(template: string, count: number): string {
    return template.replace("{count}", String(count));
  }

  onMount(() => {
    mounted = true;
    connectScrollElement(scrollElement);
  });

  onDestroy(() => {
    connectedElement?.removeEventListener("scroll", handleScroll);
    resizeObserver?.disconnect();
    mutationObserver?.disconnect();
    if (measureTimer) clearTimeout(measureTimer);
    cancelAnimationFrame(scrollFrame);
    cancelAnimationFrame(pointerFrame);
  });
</script>

{#if visible}
  <nav
    bind:this={navigatorElement}
    class="conversation-prompt-navigator"
    aria-label={copy.promptNavigationLabel}
    onpointermove={handlePointerMove}
    onpointerleave={() => { pendingPointerY = null; pointerY = null; hoveredMessageId = ""; }}
  >
    {#if markerWindow.hiddenAbove > 0}
      <button
        type="button"
        class="prompt-navigation-overflow"
        style={`top:${overflowTop(positionedItems[0], -1)}px`}
        aria-label={overflowLabel(copy.promptNavigationHiddenAbove, markerWindow.hiddenAbove)}
        onclick={() => pageJump(-1)}
      >+{markerWindow.hiddenAbove}</button>
    {/if}
    {#each positionedItems as item (item.messageId)}
      {@const showTooltip = hoveredMessageId === item.messageId || focusedMessageId === item.messageId}
      <button
        type="button"
        class:active={item.messageId === activeMessageId}
        class="prompt-navigation-marker"
        style={`top:${item.navigationTop}px`}
        aria-label={ariaLabel(item, copy)}
        aria-current={item.messageId === activeMessageId ? "step" : undefined}
        aria-describedby={showTooltip ? `prompt-preview-${item.turnIndex}` : undefined}
        onfocus={() => focusedMessageId = item.messageId}
        onblur={() => focusedMessageId = ""}
        onclick={() => jumpToPrompt(item)}
      >
        <span class="prompt-navigation-line" style={`width:${markerWidth(item, focusedMessageId, activeMessageId, pointerY)}px`} aria-hidden="true"></span>
      </button>
      {#if showTooltip}
        <div id={`prompt-preview-${item.turnIndex}`} class="prompt-navigation-preview" role="tooltip" style={`top:${previewTop(item)}px`}>
          <div class="prompt-navigation-preview-user"><strong>{turnLabel(item, copy)}</strong><span>{item.userPreviewText}</span></div>
          {#if item.assistantPreviewText}<div class="prompt-navigation-preview-assistant">{item.assistantPreviewText}</div>{/if}
          {#if item.createdAt}<time>{formatTime(item.createdAt)}</time>{/if}
        </div>
      {/if}
    {/each}
    {#if markerWindow.hiddenBelow > 0}
      <button
        type="button"
        class="prompt-navigation-overflow"
        style={`top:${overflowTop(positionedItems.at(-1), 1)}px`}
        aria-label={overflowLabel(copy.promptNavigationHiddenBelow, markerWindow.hiddenBelow)}
        onclick={() => pageJump(1)}
      >+{markerWindow.hiddenBelow}</button>
    {/if}
  </nav>
{/if}
