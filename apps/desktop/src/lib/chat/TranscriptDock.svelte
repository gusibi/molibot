<script lang="ts">
  /**
   * Floating affordances over the transcript's bottom edge.
   *
   * Two problems, one surface, because they are the same problem: something the
   * reader needs is below the fold and nothing on screen says so.
   *
   * - **Jump to latest** appears whenever `stickToBottom` has handed scroll
   *   ownership back to the reader. Without it the only way back to the live
   *   tail of a long run was to drag the scrollbar.
   * - **Attention** is the blocking case. A card that the turn is *waiting on*
   *   (today the Host Bash approval; a Plan proposal next) renders inline at the
   *   end of the transcript, and `stickToBottom` deliberately stops following
   *   once the reader scrolls up. Multiplied together, the turn hangs with the
   *   decision off screen and no indication anywhere — which is the failure the
   *   pitfalls file records as "approval waiting masquerading as a crash".
   *
   * The host injects the element to watch rather than a selector or a flag, so
   * this component knows nothing about approvals and the next such card reuses
   * it as-is (pitfall #7).
   */
  import { onDestroy } from "svelte";
  import { SCROLL_PINNED_EVENT } from "./stickToBottom";

  let {
    scrollElement = null,
    label,
    /** The element whose off-screen-ness should raise the attention pill. */
    attentionElement = null,
    attentionLabel = "",
    attentionAction = ""
  }: {
    scrollElement?: HTMLElement | null;
    label: string;
    attentionElement?: HTMLElement | null;
    attentionLabel?: string;
    attentionAction?: string;
  } = $props();

  let pinned = $state(true);
  let attentionVisible = $state(true);

  // `pinned` is the action's own state, delivered by event. Deriving it here
  // from a second scroll listener would disagree with it during the action's
  // programmatic jumps and make the button flicker on every streamed frame.
  $effect(() => {
    const node = scrollElement;
    if (!node) return;
    const onPinned = (event: Event): void => {
      pinned = (event as CustomEvent<{ pinned: boolean }>).detail?.pinned !== false;
    };
    node.addEventListener(SCROLL_PINNED_EVENT, onPinned);
    return () => node.removeEventListener(SCROLL_PINNED_EVENT, onPinned);
  });

  // An IntersectionObserver, not a scroll calculation: the card's height is not
  // known here, it changes as its command text wraps, and the transcript is the
  // scroll root rather than the viewport.
  $effect(() => {
    const target = attentionElement;
    const root = scrollElement;
    if (!target) {
      attentionVisible = true;
      return;
    }
    attentionVisible = false;
    const observer = new IntersectionObserver(
      (entries) => { attentionVisible = entries.some((entry) => entry.isIntersecting); },
      { root: root ?? null, threshold: 0.35 }
    );
    observer.observe(target);
    return () => observer.disconnect();
  });

  const showAttention = $derived(Boolean(attentionElement) && !attentionVisible);
  const showJump = $derived(!pinned && !showAttention);

  function scrollToLatest(): void {
    if (!scrollElement) return;
    scrollElement.scrollTo({
      top: scrollElement.scrollHeight,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
    });
  }

  function scrollToAttention(): void {
    attentionElement?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "center"
    });
  }

  onDestroy(() => { attentionVisible = true; });
</script>

{#if showAttention}
  <!-- `assertive`: the run is blocked on this, so it must interrupt rather than
       wait for the reader to finish whatever they were being told. -->
  <div class="transcript-dock transcript-dock-attention" role="alert" aria-live="assertive">
    <i class="ph ph-hand-palm" aria-hidden="true"></i>
    <span class="transcript-dock-text">{attentionLabel}</span>
    <button type="button" class="transcript-dock-action" onclick={scrollToAttention}>{attentionAction}</button>
  </div>
{:else if showJump}
  <button type="button" class="transcript-dock transcript-dock-jump" aria-label={label} title={label} onclick={scrollToLatest}>
    <i class="ph ph-arrow-down" aria-hidden="true"></i>
    <span class="transcript-dock-text">{label}</span>
  </button>
{/if}
