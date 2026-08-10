import { invoke } from "@tauri-apps/api/core";
import { externalHttpUrlFromClick } from "./chat/markdownLinks";
import { openImageLightbox } from "./imageLightbox";

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
  /** Label of the per-block soft-wrap toggle the renderer emits. */
  wrapLines?: string;
  /** Accessible name of the image lightbox's close button. */
  closeImage?: string;
  prevImage?: string;
  nextImage?: string;
  imageCounter?: string;
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
 * Toggles soft wrapping for one code block. The state lives on the DOM node
 * rather than in a component: the block is `{@html}` output with no component
 * identity, and the transcript re-renders it from a cached string, so a store
 * keyed on "which block" would have nothing stable to key on.
 */
function toggleCodeWrapFromClick(event: MouseEvent): boolean {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-wrap-code]");
  const block = button?.closest<HTMLElement>(".code-block");
  if (!button || !block) return false;
  const next = block.getAttribute("data-wrap") !== "on";
  block.setAttribute("data-wrap", next ? "on" : "off");
  button.setAttribute("aria-pressed", next ? "true" : "false");
  return true;
}

function openArtifactFromClick(event: MouseEvent): boolean {
  const preview = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-preview-artifact]");
  if (preview) {
    const code = preview.closest(".code-block")?.querySelector("code")?.textContent ?? "";
    if (!code) return false;
    window.dispatchEvent(new CustomEvent("molibot:markdown-artifact", { detail: { kind: "html", source: code } }));
    return true;
  }
  const tableButton = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-open-table]");
  const table = tableButton?.closest(".markdown-table-wrap")?.querySelector("table");
  if (!tableButton || !table) return false;
  const csv = [...table.querySelectorAll("tr")].map((row) => [...row.querySelectorAll("th,td")]
    .map((cell) => `"${(cell.textContent ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
  window.dispatchEvent(new CustomEvent("molibot:markdown-artifact", { detail: { kind: "table", source: csv } }));
  return true;
}

/**
 * Opens the image the click landed on, as a gallery over every image in the
 * same rendered-Markdown block.
 *
 * A reply that returns several images is the common case, and paging between
 * them is the same gesture as paging between chat attachments — so both go
 * through the one shared viewer rather than each growing their own.
 */
function openImageFromClick(event: MouseEvent, copy: MarkdownClickCopy): boolean {
  const image = (event.target as HTMLElement).closest<HTMLImageElement>(".markdown-body img");
  // An image wrapped in a link is a link first; the anchor handler above owns it.
  if (!image || image.closest("a") || (!image.currentSrc && !image.src)) return false;
  const body = image.closest<HTMLElement>(".markdown-body");
  const siblings = body
    ? [...body.querySelectorAll<HTMLImageElement>("img")].filter((candidate) => !candidate.closest("a"))
    : [image];
  const items = siblings.map((candidate) => ({
    src: candidate.currentSrc || candidate.src,
    alt: candidate.alt ?? ""
  }));
  openImageLightbox(items, Math.max(0, siblings.indexOf(image)), copy);
  return true;
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
  if (toggleCodeWrapFromClick(event)) return;
  if (openArtifactFromClick(event)) return;
  if (openImageFromClick(event, copy)) return;
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
