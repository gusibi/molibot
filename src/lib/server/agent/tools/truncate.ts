/**
 * Tool-output truncation.
 *
 * `truncateHead` / `truncateTail` and the shared limits are re-exported from pi
 * rather than maintained here: the local copy had drifted into a line-for-line
 * duplicate of pi's implementation. `truncateMiddle` stays local because pi has
 * no equivalent — bash output keeps the head and tail and elides the middle.
 */
export {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
  truncateLine,
  truncateTail,
  type TruncationOptions,
  type TruncationResult
} from "@earendil-works/pi-coding-agent";

import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  type TruncationOptions,
  type TruncationResult
} from "@earendil-works/pi-coding-agent";

/**
 * Cut a string to a byte budget without splitting a character.
 *
 * `truncateHead`/`truncateTail` never return partial lines, so a payload that is
 * one enormous line (minified JSON is the common case) comes back **empty** with
 * `firstLineExceedsLimit`. Callers that must still show something — an MCP
 * result, an oversized message being compacted — fall back to this. Stepping
 * back over UTF-8 continuation bytes (`10xxxxxx`) keeps a multi-byte character
 * from being cut in half, which would otherwise decode to U+FFFD.
 */
export function sliceToBytes(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  const buffer = Buffer.from(text, "utf-8");
  if (buffer.byteLength <= maxBytes) return text;
  let end = maxBytes;
  while (end > 0 && ((buffer[end] ?? 0) & 0xc0) === 0x80) end -= 1;
  return buffer.subarray(0, end).toString("utf-8");
}

export function truncateMiddle(
  content: string,
  options: TruncationOptions & { headLines?: number; tailLines?: number } = {}
): TruncationResult {
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const totalBytes = Buffer.byteLength(content, "utf-8");
  const lines = content.split("\n");
  const totalLines = lines.length;

  if (totalLines <= maxLines && totalBytes <= maxBytes) {
    return {
      content,
      truncated: false,
      truncatedBy: null,
      totalLines,
      totalBytes,
      outputLines: totalLines,
      outputBytes: totalBytes,
      lastLinePartial: false,
      firstLineExceedsLimit: false,
      maxLines,
      maxBytes
    };
  }

  const desiredHeadLines = Math.max(1, Math.min(options.headLines ?? Math.ceil(maxLines / 3), maxLines - 1));
  const desiredTailLines = Math.max(1, Math.min(options.tailLines ?? Math.floor((maxLines * 2) / 3), maxLines - desiredHeadLines));

  const pushWithinBudget = (target: string[], source: string[], fromStart: boolean): void => {
    for (const line of source) {
      const next = fromStart ? [...target, line] : [line, ...target];
      if (next.length > maxLines) break;
      if (Buffer.byteLength(next.join("\n"), "utf-8") > maxBytes) break;
      target.splice(0, target.length, ...next);
    }
  };

  const head: string[] = [];
  pushWithinBudget(head, lines.slice(0, desiredHeadLines), true);

  const remainingLineBudget = Math.max(1, maxLines - head.length);
  const tailCandidates = lines.slice(Math.max(head.length, lines.length - desiredTailLines));
  const tail: string[] = [];
  for (let i = tailCandidates.length - 1; i >= 0; i -= 1) {
    const line = tailCandidates[i] ?? "";
    const next = [line, ...tail];
    if (next.length > remainingLineBudget) break;
    const joined = [...head, "[... output truncated ...]", ...next].join("\n");
    if (Buffer.byteLength(joined, "utf-8") > maxBytes) break;
    tail.splice(0, tail.length, ...next);
  }

  const hiddenLines = Math.max(0, totalLines - head.length - tail.length);
  const marker = hiddenLines > 0 ? `[... ${hiddenLines} lines omitted ...]` : "[... output truncated ...]";
  const output = [...head, marker, ...tail].join("\n");

  return {
    content: output,
    truncated: true,
    truncatedBy: totalBytes > maxBytes ? "bytes" : "lines",
    totalLines,
    totalBytes,
    outputLines: output.split("\n").length,
    outputBytes: Buffer.byteLength(output, "utf-8"),
    lastLinePartial: false,
    firstLineExceedsLimit: false,
    maxLines,
    maxBytes
  };
}
