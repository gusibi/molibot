import type { TranscriptAttachment } from "./transcript";

/**
 * Layout grouping for a message's attachments.
 *
 * A turn that produced six images used to render six full-width cards stacked
 * vertically, which pushed the rest of the conversation off screen. Consecutive
 * images collapse into one gallery instead; everything else keeps rendering one
 * per row exactly as before.
 */
export type AttachmentGroup =
  | { kind: "gallery"; items: TranscriptAttachment[]; startIndex: number }
  | { kind: "single"; item: TranscriptAttachment; index: number };

/**
 * Groups *consecutive* images rather than hoisting every image in the message
 * into one gallery: hoisting would reorder the attachments relative to the
 * files between them, and the order is the only thing telling the reader which
 * image belongs to which part of the answer.
 */
export function groupTranscriptAttachments(attachments: TranscriptAttachment[]): AttachmentGroup[] {
  const groups: AttachmentGroup[] = [];
  let run: TranscriptAttachment[] = [];
  let runStart = 0;

  const flush = (): void => {
    if (run.length === 0) return;
    groups.push({ kind: "gallery", items: run, startIndex: runStart });
    run = [];
  };

  attachments.forEach((attachment, index) => {
    if (attachment.mediaType === "image") {
      if (run.length === 0) runStart = index;
      run.push(attachment);
      return;
    }
    flush();
    groups.push({ kind: "single", item: attachment, index });
  });
  flush();
  return groups;
}

/**
 * Columns for a gallery of `count` images.
 *
 * One image keeps the old full-width card — shrinking a single result to a
 * thumbnail loses the thing the turn was about. Two sit side by side. Three or
 * more use a three-column grid, so the block's height stops growing with the
 * number of images.
 */
export function galleryColumns(count: number): 1 | 2 | 3 {
  if (count <= 1) return 1;
  if (count === 2) return 2;
  return 3;
}
