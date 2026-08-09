/**
 * Full-bleed image viewer with left/right navigation.
 *
 * One viewer for every surface that shows images: chat attachments and images
 * inside rendered Markdown both open it, so navigation, keyboard handling and
 * dismissal cannot drift apart (pitfall #7).
 *
 * Built imperatively and attached to `document.body` rather than mounted as a
 * component, because it must escape the transcript's `overflow` and any panel's
 * stacking context — the two places a component rendered in-flow would be
 * clipped or trapped.
 */

export interface LightboxItem {
  src: string;
  alt?: string;
  /** Offered as a download from the viewer when present. */
  onDownload?: () => void;
}

export interface LightboxCopy {
  closeImage?: string;
  prevImage?: string;
  nextImage?: string;
  download?: string;
  /** `{index}` / `{total}` template for the position readout. */
  imageCounter?: string;
}

const OVERLAY_CLASS = "image-lightbox";

function icon(name: string): string {
  return `<i class="ph ph-${name}" aria-hidden="true"></i>`;
}

/** Closes any open viewer. Safe to call when none is open. */
export function closeImageLightbox(): void {
  document.querySelector(`.${OVERLAY_CLASS}`)?.dispatchEvent(new CustomEvent("molibot:lightbox-dismiss"));
}

export function openImageLightbox(items: LightboxItem[], startIndex: number, copy: LightboxCopy = {}): void {
  const gallery = items.filter((item) => item.src);
  if (gallery.length === 0) return;
  closeImageLightbox();

  let index = Math.min(Math.max(startIndex, 0), gallery.length - 1);

  const overlay = document.createElement("div");
  overlay.className = OVERLAY_CLASS;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", copy.closeImage || "Image");

  const stage = document.createElement("div");
  stage.className = "image-lightbox-stage";

  const image = document.createElement("img");
  stage.appendChild(image);

  const close = document.createElement("button");
  close.type = "button";
  close.className = "image-lightbox-close";
  close.setAttribute("aria-label", copy.closeImage || "Close");
  close.innerHTML = icon("x");

  const prev = document.createElement("button");
  prev.type = "button";
  prev.className = "image-lightbox-nav is-prev";
  prev.setAttribute("aria-label", copy.prevImage || "Previous");
  prev.innerHTML = icon("caret-left");

  const next = document.createElement("button");
  next.type = "button";
  next.className = "image-lightbox-nav is-next";
  next.setAttribute("aria-label", copy.nextImage || "Next");
  next.innerHTML = icon("caret-right");

  const bar = document.createElement("div");
  bar.className = "image-lightbox-bar";
  const counter = document.createElement("span");
  counter.className = "image-lightbox-counter";
  const download = document.createElement("button");
  download.type = "button";
  download.className = "image-lightbox-download";
  download.setAttribute("aria-label", copy.download || "Download");
  download.innerHTML = icon("download-simple");
  bar.append(counter, download);

  // A single image is not a gallery: the arrows and the "1 / 1" readout would
  // be controls that do nothing, which is worse than no controls.
  const multiple = gallery.length > 1;
  prev.hidden = !multiple;
  next.hidden = !multiple;
  counter.hidden = !multiple;

  function render(): void {
    const item = gallery[index];
    image.src = item.src;
    image.alt = item.alt ?? "";
    counter.textContent = (copy.imageCounter || "{index} / {total}")
      .replace("{index}", String(index + 1))
      .replace("{total}", String(gallery.length));
    download.hidden = !item.onDownload;
  }

  // Wraps around: at the last image the next arrow returns to the first, which
  // is what a viewer with a visible position readout leads people to expect.
  function step(delta: number): void {
    if (!multiple) return;
    index = (index + delta + gallery.length) % gallery.length;
    render();
  }

  function dismiss(): void {
    document.removeEventListener("keydown", onKeydown, true);
    overlay.remove();
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      dismiss();
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      event.stopPropagation();
      step(event.key === "ArrowLeft" ? -1 : 1);
    }
  }

  prev.addEventListener("click", (event) => { event.stopPropagation(); step(-1); });
  next.addEventListener("click", (event) => { event.stopPropagation(); step(1); });
  close.addEventListener("click", (event) => { event.stopPropagation(); dismiss(); });
  download.addEventListener("click", (event) => {
    event.stopPropagation();
    gallery[index].onDownload?.();
  });
  // The image itself is what the reader opened the viewer to look at, so a
  // click on it must not close; only the backdrop dismisses.
  image.addEventListener("click", (event) => event.stopPropagation());
  bar.addEventListener("click", (event) => event.stopPropagation());
  overlay.addEventListener("click", dismiss);
  overlay.addEventListener("molibot:lightbox-dismiss", dismiss);
  document.addEventListener("keydown", onKeydown, true);

  overlay.append(stage, prev, next, close, bar);
  render();
  document.body.appendChild(overlay);
  close.focus();
}
