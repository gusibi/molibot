import type { ActionReturn } from "svelte/action";

/**
 * Gates transcript entrance transitions behind a `settled` class.
 *
 * Entrance motion (see `.messages.settled .message-row` in styles.css) should
 * only play for content appended while the user is watching — a sent bubble,
 * the streaming reply, the end-of-turn crossfade. Switching sessions (or the
 * initial transcript load) remounts the whole keyed `{#each}`, and replaying
 * every row's entrance there reads as a full-page refresh.
 *
 * So: on mount and whenever `key` changes (pass the session key combined with
 * the loading flag), drop `settled`, let the fresh rows render inert, and
 * re-add it two frames later so only subsequent insertions animate.
 */
export function settleEntrances(node: HTMLElement, key: unknown): ActionReturn<unknown> {
  let currentKey = key;
  let frame1 = 0;
  let frame2 = 0;

  const cancel = (): void => {
    cancelAnimationFrame(frame1);
    cancelAnimationFrame(frame2);
  };
  const arm = (): void => {
    cancel();
    node.classList.remove("settled");
    // Two frames: the first lets the remounted rows commit their initial
    // style pass without the entrance rules matching.
    frame1 = requestAnimationFrame(() => {
      frame2 = requestAnimationFrame(() => node.classList.add("settled"));
    });
  };

  arm();

  return {
    update(nextKey: unknown) {
      if (nextKey === currentKey) return;
      currentKey = nextKey;
      arm();
    },
    destroy() {
      cancel();
    }
  };
}
