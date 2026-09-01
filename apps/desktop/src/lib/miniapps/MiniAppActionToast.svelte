<script lang="ts">
  import X from "reicon-svelte/icons/X";
  import type { DesktopMiniAppResultCard } from "@molibot/desktop-contract";
  import MiniAppResultCard from "./MiniAppResultCard.svelte";

  /**
   * Feedback for a Mini App message action, in Chat and Project Chat.
   *
   * One component rather than a copy per host: the two chat surfaces had the
   * same markup inline, which is exactly how one of them quietly loses a fix
   * (pitfall #7).
   *
   * Dismissal has two modes on purpose. A one-line result is transient and
   * self-clears; a result carrying a *card* is something to read, and yanking
   * it away mid-sentence is worse than leaving it up — so a card stays until
   * dismissed. The close button is always present either way, because a toast
   * you cannot get rid of is its own annoyance.
   */
  let {
    text,
    card = null,
    dismissLabel,
    openLabel,
    onOpenLink,
    onDismiss
  }: {
    text: string;
    card?: DesktopMiniAppResultCard | null;
    dismissLabel: string;
    openLabel: string;
    onOpenLink: (link: string) => void;
    onDismiss: () => void;
  } = $props();
</script>

<div class="chat-action-toast" class:has-card={Boolean(card)} role="status">
  <div class="chat-action-toast-head">
    <span class="chat-action-toast-text">{text}</span>
    <button
      type="button"
      class="chat-action-toast-close"
      aria-label={dismissLabel}
      title={dismissLabel}
      onclick={onDismiss}
    ><X size={14} aria-hidden="true" /></button>
  </div>
  {#if card}
    <MiniAppResultCard {card} {openLabel} {onOpenLink} />
  {/if}
</div>
