<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import type { Translation } from "../i18n";
  import type { TranscriptMessage } from "./transcript";
  import {
    activePromptIndex,
    dockMarkerWidth,
    extractPromptNavigationItems,
    layoutPromptMarkers,
    PROMPT_NAVIGATOR_MIN_TURNS,
    type PromptNavigationItem
  } from "./conversationNavigation";
  import { suspendStickToBottom } from "./stickToBottom";

  type PositionedPrompt = PromptNavigationItem & { navigationTop: number };

  export let messages: TranscriptMessage[];
  export let copy: Translation;
  export let formatTime: (value: string) => string;
  export let scrollElement: HTMLDivElement | undefined;

  let navigatorElement: HTMLElement;
  let positionedItems: PositionedPrompt[] = [];
  let promptOffsets: number[] = [];
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
      activeMessageId = "";
      return;
    }
    const index = activePromptIndex(promptOffsets, scrollElement.scrollTop + 80);
    activeMessageId = positionedItems[index]?.messageId ?? "";
  }

  function measure(): void {
    measureTimer = null;
    if (!scrollElement || !navigatorElement || !visible) {
      positionedItems = [];
      promptOffsets = [];
      activeMessageId = "";
      return;
    }
    const scrollRect = scrollElement.getBoundingClientRect();
    const measured = navigationItems.flatMap((item) => {
      const target = scrollElement?.querySelector<HTMLElement>(`[data-navigation-id="${CSS.escape(item.messageId)}"]`);
      if (!target) return [];
      return [{ item, offset: target.getBoundingClientRect().top - scrollRect.top + scrollElement.scrollTop }];
    });
    promptOffsets = measured.map(({ offset }) => offset);
    const positions = layoutPromptMarkers(measured.length, navigatorElement.clientHeight);
    positionedItems = measured.map(({ item }, index) => ({ ...item, navigationTop: positions[index] }));
    observeRows();
    updateActivePrompt();
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

  function jumpToPrompt(item: PositionedPrompt): void {
    if (!scrollElement) return;
    const target = scrollElement.querySelector<HTMLElement>(`[data-navigation-id="${CSS.escape(item.messageId)}"]`);
    if (!target) return;
    suspendStickToBottom(scrollElement);
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
  </nav>
{/if}
