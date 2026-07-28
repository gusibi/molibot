import type { ActionReturn } from "svelte/action";

const SUSPEND_FOLLOW_EVENT = "molibot:suspend-scroll-follow";
const RESUME_FOLLOW_EVENT = "molibot:resume-scroll-follow";

/** Immediately hands scroll ownership to the reader before a history jump. */
export function suspendStickToBottom(node: HTMLElement): void {
  node.dispatchEvent(new CustomEvent(SUSPEND_FOLLOW_EVENT));
}

/** Re-arms following after a committed new user turn. */
export function resumeStickToBottom(node: HTMLElement): void {
  node.dispatchEvent(new CustomEvent(RESUME_FOLLOW_EVENT));
}

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
  let firstLayoutFrame = 0;
  let secondLayoutFrame = 0;

  const distanceFromBottom = (): number => node.scrollHeight - node.scrollTop - node.clientHeight;
  const toBottom = (): void => {
    node.scrollTop = node.scrollHeight;
  };
  const cancelScheduledBottom = (): void => {
    cancelAnimationFrame(firstLayoutFrame);
    cancelAnimationFrame(secondLayoutFrame);
    firstLayoutFrame = 0;
    secondLayoutFrame = 0;
  };
  const scheduleToBottom = (): void => {
    // Parent action updates can precede nested transcript DOM updates. Wait two
    // frames so scrollHeight reflects the complete newly-rendered user turn.
    cancelScheduledBottom();
    firstLayoutFrame = requestAnimationFrame(() => {
      secondLayoutFrame = requestAnimationFrame(() => {
        firstLayoutFrame = 0;
        secondLayoutFrame = 0;
        if (pinned) toBottom();
      });
    });
  };

  // The reader's own scrolling is the single source of truth for whether we
  // follow. Our programmatic jumps land within THRESHOLD, so they keep us armed.
  const onScroll = (): void => {
    pinned = distanceFromBottom() <= THRESHOLD;
  };
  const suspendFollowing = (): void => {
    pinned = false;
    cancelScheduledBottom();
  };
  const resumeFollowing = (): void => {
    pinned = true;
    scheduleToBottom();
  };
  node.addEventListener("scroll", onScroll, { passive: true });
  node.addEventListener(SUSPEND_FOLLOW_EVENT, suspendFollowing);
  node.addEventListener(RESUME_FOLLOW_EVENT, resumeFollowing);

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
      node.removeEventListener(SUSPEND_FOLLOW_EVENT, suspendFollowing);
      node.removeEventListener(RESUME_FOLLOW_EVENT, resumeFollowing);
      observer.disconnect();
      cancelScheduledBottom();
    }
  };
}
