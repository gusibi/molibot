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
  private _scrollTop = 400; // maxTop = 1000 - 600 = 400 (at bottom)

  get scrollTop(): number {
    return this._scrollTop;
  }
  set scrollTop(val: number) {
    const maxTop = Math.max(0, this.scrollHeight - this.clientHeight);
    this._scrollTop = Math.max(0, Math.min(val, maxTop));
  }

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

if (typeof globalThis.ResizeObserver === "undefined") {
  class MockResizeObserver {
    callback: (entries: any[]) => void;
    static instances: MockResizeObserver[] = [];
    constructor(callback: (entries: any[]) => void) {
      this.callback = callback;
      MockResizeObserver.instances.push(this);
    }
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
}

test("stickToBottom re-anchors to bottom on resize while pinned", () => {
  const node = new MockNode();
  node.scrollHeight = 1000;
  node.clientHeight = 600;
  node.scrollTop = 400; // distanceFromBottom = 0 (pinned)

  const action = stickToBottom(node as unknown as HTMLElement, { key: "session-1" });

  // Simulate window narrowing / text re-wrapping: scrollHeight increases to 1500
  node.scrollHeight = 1500;

  // Trigger the ResizeObserver callback
  const observerInstance = (globalThis.ResizeObserver as any).instances?.at(-1);
  assert.ok(observerInstance, "ResizeObserver should be instantiated");
  observerInstance.callback([]);

  // scrollTop should immediately re-anchor to new bottom (1500 - 600 = 900)
  assert.equal(node.scrollTop, 900);

  // If user scrolls up and unpins, resize should NOT force jump to bottom
  node.scrollTop = 200;
  node.dispatchEvent(new Event("scroll"));
  node.scrollHeight = 2000;
  observerInstance.callback([]);
  assert.equal(node.scrollTop, 200);

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

  // Synthetic scroll event during session DOM replacement does not unpin
  node.scrollTop = 200;
  node.scrollHeight = 3000;
  node.dispatchEvent(new Event("scroll"));
  assert.deepEqual(pinnedEvents, [false, true]);
  assert.equal(node.scrollTop, 2400);

  action.destroy?.();
});
