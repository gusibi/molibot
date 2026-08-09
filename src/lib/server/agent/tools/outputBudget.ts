import { spillFullOutput } from "$lib/server/agent/tools/outputSpill.js";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  sliceToBytes,
  truncateHead,
  type TruncationResult
} from "$lib/server/agent/tools/truncate.js";

export interface CappedToolOutput {
  text: string;
  truncation?: TruncationResult;
  fullOutputPath?: string;
}

export function capToolOutput(
  text: string,
  options: { spillDir?: string; spillPrefix: string }
): CappedToolOutput {
  const truncation = truncateHead(text, { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES });
  if (!truncation.truncated) return { text };
  return {
    text: truncation.firstLineExceedsLimit
      ? sliceToBytes(text, DEFAULT_MAX_BYTES)
      : truncation.content,
    truncation,
    fullOutputPath: options.spillDir
      ? spillFullOutput(options.spillDir, text, options.spillPrefix) ?? undefined
      : undefined
  };
}
