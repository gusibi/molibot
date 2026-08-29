/**
 * WAI-ARIA tab/raido keyboard interaction, shared by every `role="tablist"`
 * (and single-select `role="radiogroup"`) in the app. Attach with `use:tablist`
 * on the group element; items default to `button[role="tab"]`, pass a selector
 * for other item roles (`use:tablist={'[role="radio"]'}`). Activation follows
 * focus — the universal pattern here, every item switches content immediately.
 *
 * Handles Arrow keys (both axes so vertical rails work), Home/End, and skips
 * disabled items. Panel wiring (`aria-controls`/`role="tabpanel"`/
 * `aria-labelledby`) stays per-component since ids live in each template.
 */
const PREVIOUS_KEYS = new Set(["ArrowLeft", "ArrowUp"]);
const NEXT_KEYS = new Set(["ArrowRight", "ArrowDown"]);

export function tablist(node: HTMLElement, itemSelector = '[role="tab"]'): { destroy: () => void } {
  function tabs(): HTMLElement[] {
    return Array.from(node.querySelectorAll<HTMLElement>(itemSelector));
  }

  function enabled(index: number, all: HTMLElement[]): boolean {
    return !all[index]?.hasAttribute("disabled");
  }

  function step(from: number, delta: number): number {
    const all = tabs();
    for (let i = 1; i <= all.length; i += 1) {
      const index = (from + delta * i + all.length) % all.length;
      if (enabled(index, all)) return index;
    }
    return from;
  }

  function onKeydown(event: KeyboardEvent): void {
    const all = tabs();
    if (all.length === 0) return;
    const current = all.indexOf(document.activeElement as HTMLElement);
    if (current === -1) return;
    let next = -1;
    if (PREVIOUS_KEYS.has(event.key)) next = step(current, -1);
    else if (NEXT_KEYS.has(event.key)) next = step(current, 1);
    else if (event.key === "Home") {
      next = all.findIndex((tab) => !tab.hasAttribute("disabled"));
    } else if (event.key === "End") {
      for (let i = all.length - 1; i >= 0; i -= 1) {
        if (!all[i].hasAttribute("disabled")) {
          next = i;
          break;
        }
      }
    } else return;

    event.preventDefault();
    const target = all[next];
    if (!target) return;
    target.focus();
    target.click();
  }

  node.addEventListener("keydown", onKeydown);
  return {
    destroy() {
      node.removeEventListener("keydown", onKeydown);
    }
  };
}
