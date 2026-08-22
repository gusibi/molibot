import type { ActionReturn } from "svelte/action";

const SUSPEND_FOLLOW_EVENT = "molibot:suspend-scroll-follow";
const RESUME_FOLLOW_EVENT = "molibot:resume-scroll-follow";
/**
 * Fired on the scroll container whenever following turns on or off, with
 * `detail.pinned`.
 *
 * The action owns this state and nothing else can derive it correctly - a
 * consumer computing "am I at the bottom" from its own scroll listener would
 * disagree with the action across the programmatic jumps, which is exactly the
 * window in which a jump-to-latest affordance must not flicker.
 */
export const SCROLL_PINNED_EVENT = "molibot:scroll-pinned";

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
 * - While the reader is at (or near) the bottom, new content - streaming tokens,
 *   an appended message, a freshly loaded transcript - keeps the latest line in
 *   view, gliding there on a small physics spring instead of teleporting.
 * - If the reader scrolls up to read history, following is suspended so they are
 *   never yanked back down. An upward wheel gesture interrupts a glide in
 *   flight; ownership returns the moment the reader settles near the bottom.
 * - Scrolling back to the bottom re-arms following.
 * - Switching to another conversation (the `key` changes) always jumps to the
 *   newest message and re-arms, so opening a long history shows its tail rather
 *   than its head.
 *
 * Why a rAF spring and not `scroll-behavior: smooth` (which the chat motion
 * audit rejected): a CSS smooth scroll cannot be retargeted - every streamed
 * frame would cancel and restart it, and it fights the reader's trackpad. This
 * loop only writes `scrollTop` once per frame off the render path, retargets
 * continuously as content grows (the distance is recomputed live), and cancels
 * on the first sign of reader intent. It is the one place transcript motion is
 * allowed to spend logic; everything else stays CSS.
 *
 * Pass the active conversation id as the `key` so a session switch is
 * distinguished from same-session content updates.
 */
/** Options: see `stickToBottom`. */
export interface StickToBottomOptions {
  /**
   * Session/conversation identity. A change re-arms following and lands on the
   * tail instantly - switching sessions is a context jump, not content growth.
   */
  key: unknown;
  /**
   * True while a live turn is streaming into THIS transcript. Content growth
   * then follows on the spring; every other load (session switch, initial
   * transcript load, idle reload) jumps instantly - a transcript the reader
   * just opened must already be at its tail, never seen scrolling there.
   */
  live?: boolean;
}

export function stickToBottom(node: HTMLElement, options: StickToBottomOptions): ActionReturn<StickToBottomOptions> {
  // A few px of slack so sub-pixel rounding and momentum scrolling still count
  // as "at the bottom".
  const THRESHOLD = 48;
  // Spring tuning (semi-implicit integration, values normalized to 60fps
  // frames). Soft and slightly overdamped: fast enough to keep the newest
  // token in view during streaming, gentle enough not to read as motion.
  const DAMPING = 0.7;
  const STIFFNESS = 0.05;
  const MASS = 1.25;
  const FRAME_MS = 1000 / 60;
  // Sub-pixel tolerance for determining if the scroll container has settled at the bottom.
  // On high-DPI (Retina) displays, fractional pixel rounding often leaves a 0.5 - 2px gap.
  const SETTLE_DISTANCE = 2;
  const SETTLE_VELOCITY = 0.1;

  let pinned = true;
  let currentKey = options.key;
  let live = options.live === true;
  let switchingSession = false;
  let firstLayoutFrame = 0;
  let secondLayoutFrame = 0;
  let springFrame = 0;
  let velocity = 0;
  let lastFrameTime = 0;
  let lastScrollTop = node.scrollTop;
  // Queried per follow() call, which during streaming is once per frame - so
  // resolve the list once and let `.matches` track live changes.
  const reducedMotion = typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;

  const distanceFromBottom = (): number => Math.max(0, node.scrollHeight - node.scrollTop - node.clientHeight);
  const announce = (next: boolean): boolean => {
    if (next === pinned) return false;
    pinned = next;
    node.dispatchEvent(new CustomEvent(SCROLL_PINNED_EVENT, { detail: { pinned } }));
    return true;
  };
  const instantToBottom = (): void => {
    velocity = 0;
    node.scrollTop = node.scrollHeight;
  };
  const stopSpring = (): void => {
    if (springFrame) cancelAnimationFrame(springFrame);
    springFrame = 0;
    velocity = 0;
    lastFrameTime = 0;
  };
  /** Motion is a courtesy: reduced-motion readers and low-performance modes
   *  keep the previous instant follow. */
  const prefersInstant = (): boolean =>
    reducedMotion?.matches === true || (typeof document !== "undefined" && document.documentElement.dataset.performance === "low");

  const springStep = (): void => {
    if (!pinned) {
      stopSpring();
      return;
    }
    const maxTop = node.scrollHeight - node.clientHeight;
    if (maxTop <= 0) {
      stopSpring();
      return;
    }
    const distance = maxTop - node.scrollTop;
    if (Math.abs(distance) < SETTLE_DISTANCE && Math.abs(velocity) < SETTLE_VELOCITY) {
      node.scrollTop = maxTop;
      stopSpring();
      return;
    }
    const now = performance.now();
    // dt in 60fps frames, so a 120Hz display does not double the spring rate;
    // clamped because rAF pauses in background tabs and a multi-second dt
    // would otherwise fling the viewport on the first frame back.
    const dt = Math.min(lastFrameTime ? (now - lastFrameTime) / FRAME_MS : 1, 4);
    lastFrameTime = now;
    velocity = (DAMPING * velocity + STIFFNESS * distance) / MASS;
    node.scrollTop += velocity * dt;
    springFrame = requestAnimationFrame(springStep);
  };

  const follow = (): void => {
    if (!pinned) return;
    if (prefersInstant()) {
      stopSpring();
      instantToBottom();
      return;
    }
    if (!springFrame) springFrame = requestAnimationFrame(springStep);
  };

  const cancelScheduledBottom = (): void => {
    cancelAnimationFrame(firstLayoutFrame);
    cancelAnimationFrame(secondLayoutFrame);
    firstLayoutFrame = 0;
    secondLayoutFrame = 0;
  };
  const scheduleToBottom = (animated: boolean): void => {
    // Parent action updates can precede nested transcript DOM updates. Wait two
    // frames so scrollHeight reflects the complete newly-rendered user turn.
    cancelScheduledBottom();
    firstLayoutFrame = requestAnimationFrame(() => {
      secondLayoutFrame = requestAnimationFrame(() => {
        firstLayoutFrame = 0;
        secondLayoutFrame = 0;
        if (switchingSession) {
          instantToBottom();
          announce(true);
          lastScrollTop = node.scrollTop;
          switchingSession = false;
          return;
        }
        if (!pinned) return;
        if (animated) follow();
        else instantToBottom();
      });
    });
  };

  // The reader's own scrolling is the single source of truth for whether we
  // follow. Upward motion releases ownership when away from the bottom boundary
  // (preventing bounce rebounds or sub-pixel jitter at the tail from breaking the lock).
  // Following re-arms on a DOWNWARD move that reaches the slack, or on settling at the bottom.
  const onScroll = (): void => {
    if (switchingSession) {
      instantToBottom();
      announce(true);
      return;
    }
    const moved = node.scrollTop - lastScrollTop;
    lastScrollTop = node.scrollTop;
    if (moved < 0) {
      // An upward move indicates reader intent to page up only when away from
      // the bottom boundary. If they are already resting within the settle
      // threshold, upward movements are momentum/elastic bounce rebounds, not
      // intentional history navigation.
      if (distanceFromBottom() > SETTLE_DISTANCE) {
        if (springFrame) stopSpring();
        announce(false);
        return;
      }
    }
    if (springFrame) {
      // Our own glide writing downward carries no reader intent, and it may
      // legitimately lag a fast stream beyond the bottom slack (the spring's
      // steady-state lag grows with the content growth rate). Evaluating the
      // lock here would unlock following - killing auto-scroll - with nobody
      // having scrolled at all.
      return;
    }
    const dist = distanceFromBottom();
    const reArmed = announce(dist <= SETTLE_DISTANCE || (moved > 0 && dist <= THRESHOLD));
    // A reader who deliberately scrolled back down deserves the last few px
    // glided home; never do this on a re-arm that was not their doing.
    if (reArmed && moved > 0 && dist > SETTLE_DISTANCE) follow();
  };
  const onWheel = (event: WheelEvent): void => {
    if (switchingSession) {
      switchingSession = false;
    }
    // A trackpad two-finger scroll upwards must release ownership on the input
    // itself when away from the bottom boundary. When resting at the bottom,
    // micro-rebound / finger lifts with deltaY < 0 do not break the pinned state.
    if (event.deltaY < 0) {
      const dist = distanceFromBottom();
      if (dist > SETTLE_DISTANCE) {
        stopSpring();
        cancelScheduledBottom();
        announce(false);
      }
    }
  };
  const onTouchMove = (): void => {
    // Touch owns the gesture while it lasts; the resulting scroll events
    // decide whether following re-arms.
    if (springFrame) stopSpring();
  };
  const suspendFollowing = (): void => {
    announce(false);
    stopSpring();
    cancelScheduledBottom();
  };
  const resumeFollowing = (): void => {
    announce(true);
    scheduleToBottom(true);
  };
  node.addEventListener("scroll", onScroll, { passive: true });
  node.addEventListener("wheel", onWheel, { passive: true });
  node.addEventListener("touchmove", onTouchMove, { passive: true });
  node.addEventListener(SUSPEND_FOLLOW_EVENT, suspendFollowing);
  node.addEventListener(RESUME_FOLLOW_EVENT, resumeFollowing);

  // Content changes (streamed text swaps `{@html}`, messages append/replace) do
  // not fire scroll events, so observe the subtree and follow while pinned. A
  // live turn's growth glides on the spring; everything else (a transcript
  // landing after a session switch, an idle reload) must land instantly - the
  // reader should open a session already at its tail.
  const observer = new MutationObserver(() => {
    if (switchingSession) {
      instantToBottom();
      announce(true);
      return;
    }
    if (!pinned) return;
    if (live) follow();
    else instantToBottom();
  });
  observer.observe(node, { childList: true, subtree: true, characterData: true });

  // Layout and viewport changes (e.g. narrowing the window, expanding a panel,
  // text wrapping into more vertical lines) change scrollHeight without DOM
  // mutations or scroll events. Re-anchor to the bottom while pinned so the
  // latest line stays strictly in view and never gets pushed off-screen.
  let resizeObserver: ResizeObserver | null = null;
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => {
      if (switchingSession) {
        instantToBottom();
        announce(true);
        return;
      }
      if (!pinned) return;
      if (live) follow();
      else instantToBottom();
    });
    resizeObserver.observe(node);
  }

  scheduleToBottom(false);

  return {
    update(next: StickToBottomOptions) {
      live = next.live === true;
      if (next.key === currentKey) return;
      currentKey = next.key;
      switchingSession = true;
      announce(true);
      stopSpring();
      instantToBottom();
      // A session switch is a context jump, not content growth: land on the
      // tail immediately instead of gliding across the whole history.
      scheduleToBottom(false);
    },
    destroy() {
      node.removeEventListener("scroll", onScroll);
      node.removeEventListener("wheel", onWheel);
      node.removeEventListener("touchmove", onTouchMove);
      node.removeEventListener(SUSPEND_FOLLOW_EVENT, suspendFollowing);
      node.removeEventListener(RESUME_FOLLOW_EVENT, resumeFollowing);
      observer.disconnect();
      resizeObserver?.disconnect();
      stopSpring();
      cancelScheduledBottom();
    }
  };
}
