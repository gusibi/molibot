import assert from "node:assert/strict";
import test from "node:test";
import {
  SCROLL_PINNED_EVENT,
  resumeStickToBottom,
  stickToBottom,
  suspendStickToBottom
} from "./stickToBottom";

class MockNode extends EventTarget {
  scrollHeight = 1000;
  clientHeight = 600;
  scrollTop = 400; // maxTop = 1000 - 600 = 400 (at bottom)

  scrollTo(options: { top: number; behavior?: string }): void {
    if (typeof options.top === "number") {
      this.scrollTop = options.top;
    }
  }
}

// Ensure minimal browser globals exist for the action in node test environment
if (typeof globalThis.requestAnimationFrame !== "function") {
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback): number => setTimeout(cb, 16) as unknown as number;
  globalThis.cancelAnimationFrame = (id: number): void => clearTimeout(id);
}
if (typeof globalThis.MutationObserver === "undefined") {
  class MockMutationObserver {
    observe(): void {}
    disconnect(): void {}
  }
  globalThis.MutationObserver = MockMutationObserver as unknown as typeof MutationObserver;
}
if (typeof globalThis.document === "undefined") {
  globalThis.document = {
    documentElement: { dataset: {} }
  } as unknown as Document;
}

test("suspendStickToBottom and resumeStickToBottom dispatch follow events", () => {
  const node = new MockNode();
  let suspended = false;
  let resumed = false;

  node.addEventListener("molibot:suspend-scroll-follow", () => {
    suspended = true;
  });
  node.addEventListener("molibot:resume-scroll-follow", () => {
    resumed = true;
  });

  suspendStickToBottom(node as unknown as HTMLElement);
  assert.equal(suspended, true);

  resumeStickToBottom(node as unknown as HTMLElement);
  assert.equal(resumed, true);
});

test("stickToBottom maintains pinned state during elastic bounce and subpixel settle at bottom", () => {
  const node = new MockNode();
  node.scrollHeight = 1000;
  node.clientHeight = 600;
  node.scrollTop = 400; // distanceFromBottom = 0

  const pinnedEvents: boolean[] = [];
  node.addEventListener(SCROLL_PINNED_EVENT, (event) => {
    pinnedEvents.push((event as CustomEvent<{ pinned: boolean }>).detail.pinned);
  });

  const action = stickToBottom(node as unknown as HTMLElement, { key: "session-1" });

  // 1. Upward bounce at the bottom edge (dist = 1px <= SETTLE_DISTANCE)
  // scrollTop moves from 400 to 399 (moved = -1 < 0)
  node.scrollTop = 399; // dist = 1000 - 399 - 600 = 1px
  node.dispatchEvent(new Event("scroll"));

  // Pinned state should NOT be cancelled by bottom bounce
  assert.deepEqual(pinnedEvents, []);

  // 2. User genuinely scrolls up to read history (dist = 100px > SETTLE_DISTANCE)
  node.scrollTop = 300; // dist = 100px
  node.dispatchEvent(new Event("scroll"));

  // Pinned state should now unpin
  assert.deepEqual(pinnedEvents, [false]);

  // 3. User scrolls back down towards bottom (dist = 30px <= THRESHOLD, moved > 0)
  node.scrollTop = 370; // moved = +70 > 0, dist = 30px <= 48px
  node.dispatchEvent(new Event("scroll"));

  // Pinned state should re-arm
  assert.deepEqual(pinnedEvents, [false, true]);

  // 4. User scrolls up away from bottom again
  node.scrollTop = 200;
  node.dispatchEvent(new Event("scroll"));
  assert.deepEqual(pinnedEvents, [false, true, false]);

  // 5. User clicks "Jump to latest" (resumeStickToBottom)
  resumeStickToBottom(node as unknown as HTMLElement);
  assert.deepEqual(pinnedEvents, [false, true, false, true]);

  action.destroy?.();
});

test("stickToBottom re-arms on session key change", () => {
  const node = new MockNode();
  node.scrollHeight = 1000;
  node.clientHeight = 600;
  node.scrollTop = 100; // Far from bottom

  const pinnedEvents: boolean[] = [];
  node.addEventListener(SCROLL_PINNED_EVENT, (event) => {
    pinnedEvents.push((event as CustomEvent<{ pinned: boolean }>).detail.pinned);
  });

  const action = stickToBottom(node as unknown as HTMLElement, { key: "session-1" });

  // Scroll up to unpin
  node.scrollTop = 50;
  node.dispatchEvent(new Event("scroll"));
  assert.deepEqual(pinnedEvents, [false]);

  // Switch session
  action.update?.({ key: "session-2" });
  assert.deepEqual(pinnedEvents, [false, true]);

  action.destroy?.();
});
