<script lang="ts">
  import Check from "reicon-svelte/icons/Check";
  import EyeSlash from "reicon-svelte/icons/EyeSlash";
  import Loader from "reicon-svelte/icons/Loader";
  import PenLine from "reicon-svelte/icons/PenLine";
  import ThumbsUp from "reicon-svelte/icons/ThumbsUp";
  import TriangleWarning from "reicon-svelte/icons/TriangleWarning";
  import X from "reicon-svelte/icons/X";
  import { onDestroy, onMount, tick } from "svelte";
  import type { DesktopMemoryFeedbackValue, DesktopMemoryTraceResponse } from "@molibot/desktop-contract";
  import type { Translation } from "../i18n";
  import { DirectManipulation } from "../native/directManipulation";

  export let trace: DesktopMemoryTraceResponse["trace"] | null = null;
  export let loading = false;
  export let error = "";
  export let copy: Translation;
  export let recordedMemoryIds = new Set<string>();
  export let onClose: () => void;
  export let onRetry: () => void;
  export let onFeedback: (memoryId: string, value: DesktopMemoryFeedbackValue) => void;
  export let onManageMemory: (memoryId: string) => void;
  export let onHapticCommit: (gestureId: string) => void = () => {};

  /** Locale-aware percent label for memory confidence (0..1 -> "87%"). */
  function formatConfidence(confidence: number): string {
    return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(confidence * 100)}%`;
  }

  let panel: HTMLElement;
  let drawerHandle: HTMLButtonElement | null = null;
  let drawerOffset = 0;
  let drawerGesturePhase = "idle";
  let drawerFrame: number | null = null;
  let drawerFrameTime = 0;
  let drawerGestureId = "";
  const drawerManipulation = new DirectManipulation({
    min: 0,
    max: 400,
    reducedMotion: () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    onUpdate(snapshot) {
      drawerOffset = snapshot.position;
      drawerGesturePhase = snapshot.phase;
    },
    onSettled(target) {
      drawerOffset = 0;
      drawerGesturePhase = "idle";
      if (target > 0) requestClose();
    },
    onCommitted() {
      if (drawerGestureId) onHapticCommit(drawerGestureId);
    }
  });
  let feedbackMemoryId = "";
  let closing = false;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;

  function requestClose(): void {
    if (closing) return;
    closing = true;
    closeTimer = setTimeout(onClose, 200);
  }

  function stepDrawerGesture(timestamp: number): void {
    const elapsed = drawerFrameTime ? timestamp - drawerFrameTime : 16;
    drawerFrameTime = timestamp;
    if (drawerManipulation.step(elapsed)) drawerFrame = requestAnimationFrame(stepDrawerGesture);
    else drawerFrame = null;
  }

  function settleDrawerGesture(): void {
    if (drawerFrame === null && drawerManipulation.current().phase === "settling") {
      drawerFrameTime = 0;
      drawerFrame = requestAnimationFrame(stepDrawerGesture);
    }
  }

  function beginDrawerDrag(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    drawerGestureId = `memory-trace:${event.pointerId}:${event.timeStamp}`;
    drawerHandle?.setPointerCapture(event.pointerId);
    if (drawerManipulation.current().phase === "settling") {
      drawerManipulation.interrupt(event.pointerId, event.clientX, event.timeStamp);
    } else {
      drawerManipulation.begin(event.pointerId, event.clientX, event.timeStamp, drawerOffset);
    }
  }

  function moveDrawerDrag(event: PointerEvent): void {
    drawerManipulation.move(event.pointerId, event.clientX, event.timeStamp);
  }

  function endDrawerDrag(event: PointerEvent): void {
    if (drawerHandle?.hasPointerCapture(event.pointerId)) drawerHandle.releasePointerCapture(event.pointerId);
    drawerManipulation.end(event.pointerId, event.timeStamp);
    settleDrawerGesture();
  }

  function cancelDrawerDrag(event?: PointerEvent): void {
    if (event && drawerHandle?.hasPointerCapture(event.pointerId)) drawerHandle.releasePointerCapture(event.pointerId);
    if (drawerManipulation.current().phase === "idle") return;
    drawerManipulation.cancel();
    settleDrawerGesture();
  }

  function cancelDrawerDragOnBlur(): void {
    cancelDrawerDrag();
  }

  onDestroy(() => {
    if (closeTimer) clearTimeout(closeTimer);
    if (drawerFrame !== null) cancelAnimationFrame(drawerFrame);
  });

  onMount(async () => {
    await tick();
    panel?.focus();
  });

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      requestClose();
      return;
    }
    if (event.key !== "Tab" || !panel) return;
    const focusable = [...panel.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      .filter((element) => element.offsetParent !== null);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function submit(memoryId: string, value: DesktopMemoryFeedbackValue): void {
    feedbackMemoryId = "";
    onFeedback(memoryId, value);
  }

  $: referencedItems = trace?.referencedItems ?? [];
  $: referencedIds = new Set(referencedItems.map((item) => item.memoryId));
  // Injected-but-unused memories: shown as secondary transparency info only.
  $: providedItems = (trace?.injectedItems ?? []).filter((item) => !referencedIds.has(item.memoryId));
</script>

<svelte:window onblur={cancelDrawerDragOnBlur} />

<div class="memory-trace-backdrop" class:closing role="presentation" onclick={(event) => event.target === event.currentTarget && requestClose()}>
  <div
    bind:this={panel}
    class="memory-trace-drawer"
    class:dragging={drawerGesturePhase === "dragging"}
    class:settling={drawerGesturePhase === "settling"}
    style={`--memory-trace-offset:${drawerOffset}px`}
    role="dialog"
    aria-modal="true"
    aria-labelledby="memory-trace-title"
    tabindex="-1"
    onkeydown={onKeydown}
  >
    <button
      class="memory-trace-drag-handle"
      type="button"
      aria-label={copy.memoryTraceClose}
      bind:this={drawerHandle}
      onpointerdown={beginDrawerDrag}
      onpointermove={moveDrawerDrag}
      onpointerup={endDrawerDrag}
      onpointercancel={cancelDrawerDrag}
      onlostpointercapture={cancelDrawerDrag}
    ></button>
    <header class="memory-trace-header">
      <div>
        <h2 id="memory-trace-title">{copy.memoryTraceTitle}</h2>
        <p>{copy.memoryTraceHint}</p>
      </div>
      <button class="icon-button" type="button" aria-label={copy.memoryTraceClose} onclick={requestClose}>
        <X size={16} aria-hidden="true" />
      </button>
    </header>

    <div class="memory-trace-body">
      {#if loading}
        <div class="memory-trace-state" role="status"><Loader size={14} aria-hidden="true" />{copy.loading}</div>
      {:else if error}
        <div class="memory-trace-state" role="alert">
          <p>{copy.memoryTraceLoadError}</p>
          <button class="secondary-button" type="button" onclick={onRetry}>{copy.memoryTraceRetry}</button>
        </div>
      {:else if trace}
        {#if referencedItems.length > 0}
          <section class="memory-trace-section">
            <div class="memory-trace-section-title">
              <h3>{copy.memoryTraceReferencedTitle}</h3>
              <span>{referencedItems.length}</span>
            </div>
            <div class="memory-trace-list">
              {#each referencedItems as item (item.memoryId)}
                <article class="memory-trace-card">
                  <p>{item.snapshot.displayText}</p>
                  <div class="memory-trace-tags">
                    <span class="memory-trace-source">{item.source === "cited" ? copy.memoryTraceSourceCited : copy.memoryTraceSourceToolRetrieved}</span>
                    <span>{item.snapshot.type || item.snapshot.layer}</span>
                    {#if typeof item.snapshot.confidence === "number"}<span>{formatConfidence(item.snapshot.confidence)}</span>{/if}
                  </div>
                  <div class="memory-trace-actions">
                    {#if recordedMemoryIds.has(item.memoryId)}
                      <span class="memory-feedback-recorded"><Check size={11} aria-hidden="true" />{copy.memoryTraceRecorded}</span>
                    {:else}
                      <button type="button" onclick={() => submit(item.memoryId, "helpful")}><ThumbsUp size={11} aria-hidden="true" />{copy.memoryTraceHelpful}</button>
                      <button type="button" aria-expanded={feedbackMemoryId === item.memoryId} onclick={() => feedbackMemoryId = feedbackMemoryId === item.memoryId ? "" : item.memoryId}><TriangleWarning size={11} aria-hidden="true" />{copy.memoryTraceNotForThisTurn}</button>
                    {/if}
                    <button type="button" onclick={() => onManageMemory(item.memoryId)}><PenLine size={11} aria-hidden="true" />{copy.memoryTraceEdit}</button>
                  </div>
                  {#if feedbackMemoryId === item.memoryId}
                    <div class="memory-feedback-reasons">
                      <button type="button" onclick={() => submit(item.memoryId, "irrelevant")}>{copy.memoryFeedbackIrrelevant}</button>
                      <button type="button" onclick={() => submit(item.memoryId, "incorrect")}>{copy.memoryFeedbackIncorrect}</button>
                      <button type="button" onclick={() => submit(item.memoryId, "expired")}>{copy.memoryFeedbackExpired}</button>
                      <button type="button" onclick={() => submit(item.memoryId, "too_private")}>{copy.memoryFeedbackPrivate}</button>
                    </div>
                  {/if}
                </article>
              {/each}
            </div>
          </section>
        {/if}

        {#if providedItems.length > 0}
          <details class="memory-trace-section memory-trace-provided" open={referencedItems.length === 0}>
            <summary class="memory-trace-section-title">
              <h3>{copy.memoryTraceInjectedTitle}</h3>
              <span>{providedItems.length}</span>
            </summary>
            <p class="memory-trace-provided-hint">{copy.memoryTraceInjectedHint}</p>
            <div class="memory-trace-list">
              {#each providedItems as item (item.memoryId)}
                <article class="memory-trace-card">
                  <p>{item.snapshot.displayText}</p>
                  <div class="memory-trace-tags">
                    <span>{item.snapshot.type || item.snapshot.layer}</span>
                    {#if typeof item.snapshot.confidence === "number"}<span>{formatConfidence(item.snapshot.confidence)}</span>{/if}
                  </div>
                  <div class="memory-trace-actions">
                    {#if recordedMemoryIds.has(item.memoryId)}
                      <span class="memory-feedback-recorded"><Check size={11} aria-hidden="true" />{copy.memoryTraceRecorded}</span>
                    {:else}
                      <!-- A memory that was only provided (not used) cannot be
                           "helpful"; the actionable signal is to stop auto-including it. -->
                      <button type="button" onclick={() => submit(item.memoryId, "do_not_inject")}><EyeSlash size={11} aria-hidden="true" />{copy.memoryTraceDoNotInject}</button>
                      <button type="button" aria-expanded={feedbackMemoryId === item.memoryId} onclick={() => feedbackMemoryId = feedbackMemoryId === item.memoryId ? "" : item.memoryId}><TriangleWarning size={11} aria-hidden="true" />{copy.memoryTraceNotForThisTurn}</button>
                    {/if}
                    <button type="button" onclick={() => onManageMemory(item.memoryId)}><PenLine size={11} aria-hidden="true" />{copy.memoryTraceEdit}</button>
                  </div>
                  {#if feedbackMemoryId === item.memoryId}
                    <div class="memory-feedback-reasons">
                      <button type="button" onclick={() => submit(item.memoryId, "irrelevant")}>{copy.memoryFeedbackIrrelevant}</button>
                      <button type="button" onclick={() => submit(item.memoryId, "incorrect")}>{copy.memoryFeedbackIncorrect}</button>
                      <button type="button" onclick={() => submit(item.memoryId, "expired")}>{copy.memoryFeedbackExpired}</button>
                      <button type="button" onclick={() => submit(item.memoryId, "too_private")}>{copy.memoryFeedbackPrivate}</button>
                    </div>
                  {/if}
                </article>
              {/each}
            </div>
          </details>
        {/if}

        {#if trace.writeReceipts.length > 0}
          <section class="memory-trace-section">
            <div class="memory-trace-section-title">
              <h3>{copy.memoryTraceStoredTitle}</h3>
              <span>{trace.writeReceipts.length}</span>
            </div>
            <div class="memory-trace-list">
              {#each trace.writeReceipts as receipt (receipt.memoryId)}
                <article class="memory-trace-card memory-write-card">
                  <span class="memory-write-kind">{receipt.operation === "added" ? copy.memoryTraceAdded : copy.memoryTraceUpdated}</span>
                  <p>{receipt.snapshot.displayText}</p>
                  <div class="memory-trace-tags"><span>{receipt.snapshot.type || receipt.snapshot.layer}</span></div>
                </article>
              {/each}
            </div>
          </section>
        {/if}
      {/if}
    </div>
  </div>
</div>
