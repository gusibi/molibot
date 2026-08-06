import { invoke } from "@tauri-apps/api/core";
import { externalHttpUrlFromClick } from "./chat/markdownLinks";

/**
 * Click behaviour for any surface that renders `renderMarkdown` output.
 *
 * The rendered HTML carries two interactive affordances - external links and
 * the `data-copy-code` button in every code block - and both are inert without
 * a delegated handler. The transcript and the Artifact Panel's Markdown viewer
 * share this one implementation rather than each wiring their own (pitfall #7);
 * a second copy is how one surface silently loses the copy button.
 */

export interface MarkdownClickCopy {
  copyCode: string;
  copied: string;
}

/** Copies the code block behind a `data-copy-code` button, with a transient label. */
async function copyCodeFromClick(event: MouseEvent, copy: MarkdownClickCopy): Promise<void> {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-copy-code]");
  if (!button) return;
  const code = button.closest(".code-block")?.querySelector("code")?.textContent ?? "";
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
    button.textContent = copy.copied;
    window.setTimeout(() => { if (button.isConnected) button.textContent = copy.copyCode; }, 1200);
  } catch { /* clipboard unavailable */ }
}

/**
 * Links win over the copy button: a link inside a code block would otherwise be
 * swallowed by the copy handler.
 */
export async function handleMarkdownBodyClick(event: MouseEvent, copy: MarkdownClickCopy): Promise<void> {
  const url = externalHttpUrlFromClick(event);
  if (url) {
    if ("__TAURI_INTERNALS__" in window) await invoke("open_external_url", { url });
    else window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  await copyCodeFromClick(event, copy);
}

/**
 * Svelte action form of the same handler, for containers that are pure layout.
 * A delegated listener on a plain wrapper is not a widget - the interactive
 * elements are the links and buttons the renderer emitted inside it - so this
 * avoids annotating the wrapper with a role it does not have.
 */
export function markdownBody(node: HTMLElement, copy: MarkdownClickCopy) {
  let current = copy;
  const onClick = (event: MouseEvent): void => { void handleMarkdownBodyClick(event, current); };
  node.addEventListener("click", onClick);
  return {
    update(next: MarkdownClickCopy) { current = next; },
    destroy() { node.removeEventListener("click", onClick); }
  };
}
