import type { ActionReturn } from "svelte/action";

/**
 * Keeps a scroll container pinned to its newest content, the way a chat
 * transcript should behave:
 *
 * - While the reader is at (or near) the bottom, new content — streaming tokens,
 *   an appended message, a freshly loaded transcript — keeps the latest line in
 *   view.
 * - If the reader scrolls up to read history, following is suspended so they are
 *   never yanked back down.
 * - Scrolling back to the bottom re-arms following.
 * - Switching to another conversation (the `key` changes) always jumps to the
 *   newest message and re-arms, so opening a long history shows its tail rather
 *   than its head.
 *
 * Pass the active conversation id as the `key` so a session switch is
 * distinguished from same-session content updates.
 */
export function stickToBottom(node: HTMLElement, key: unknown): ActionReturn<unknown> {
  // A few px of slack so sub-pixel rounding and momentum scrolling still count
  // as "at the bottom".
  const THRESHOLD = 48;
  let pinned = true;
  let currentKey = key;

  const distanceFromBottom = (): number => node.scrollHeight - node.scrollTop - node.clientHeight;
  const toBottom = (): void => {
    node.scrollTop = node.scrollHeight;
  };
  const scheduleToBottom = (): void => {
    // Wait for layout so scrollHeight reflects the just-applied DOM change.
    requestAnimationFrame(toBottom);
  };

  // The reader's own scrolling is the single source of truth for whether we
  // follow. Our programmatic jumps land within THRESHOLD, so they keep us armed.
  const onScroll = (): void => {
    pinned = distanceFromBottom() <= THRESHOLD;
  };
  node.addEventListener("scroll", onScroll, { passive: true });

  // Content changes (streamed text swaps `{@html}`, messages append/replace) do
  // not fire scroll events, so observe the subtree and follow while pinned.
  const observer = new MutationObserver(() => {
    if (pinned) toBottom();
  });
  observer.observe(node, { childList: true, subtree: true, characterData: true });

  scheduleToBottom();

  return {
    update(nextKey: unknown) {
      if (nextKey === currentKey) return;
      currentKey = nextKey;
      pinned = true;
      scheduleToBottom();
    },
    destroy() {
      node.removeEventListener("scroll", onScroll);
      observer.disconnect();
    }
  };
}
