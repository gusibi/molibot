export const DEFAULT_MAX_LINES = 2000;
export const DEFAULT_MAX_BYTES = 50 * 1024;

export interface TruncationResult {
  content: string;
  truncated: boolean;
  truncatedBy: "lines" | "bytes" | null;
  totalLines: number;
  totalBytes: number;
  outputLines: number;
  outputBytes: number;
  lastLinePartial: boolean;
  firstLineExceedsLimit: boolean;
}

export interface TruncationOptions {
  maxLines?: number;
  maxBytes?: number;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function truncateHead(content: string, options: TruncationOptions = {}): TruncationResult {
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
      firstLineExceedsLimit: false
    };
  }

  const firstLineBytes = Buffer.byteLength(lines[0] ?? "", "utf-8");
  if (firstLineBytes > maxBytes) {
    return {
      content: "",
      truncated: true,
      truncatedBy: "bytes",
      totalLines,
      totalBytes,
      outputLines: 0,
      outputBytes: 0,
      lastLinePartial: false,
      firstLineExceedsLimit: true
    };
  }

  const outLines: string[] = [];
  let outBytes = 0;
  let truncatedBy: "lines" | "bytes" = "lines";

  for (let i = 0; i < lines.length && i < maxLines; i += 1) {
    const line = lines[i] ?? "";
    const lineBytes = Buffer.byteLength(line, "utf-8") + (i > 0 ? 1 : 0);
    if (outBytes + lineBytes > maxBytes) {
      truncatedBy = "bytes";
      break;
    }
    outLines.push(line);
    outBytes += lineBytes;
  }

  if (outLines.length >= maxLines && outBytes <= maxBytes) {
    truncatedBy = "lines";
  }

  const output = outLines.join("\n");
  return {
    content: output,
    truncated: true,
    truncatedBy,
    totalLines,
    totalBytes,
    outputLines: outLines.length,
    outputBytes: Buffer.byteLength(output, "utf-8"),
    lastLinePartial: false,
    firstLineExceedsLimit: false
  };
}

export function truncateTail(content: string, options: TruncationOptions = {}): TruncationResult {
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
      firstLineExceedsLimit: false
    };
  }

  const outLines: string[] = [];
  let outBytes = 0;
  let truncatedBy: "lines" | "bytes" = "lines";
  let lastLinePartial = false;

  for (let i = lines.length - 1; i >= 0 && outLines.length < maxLines; i -= 1) {
    const line = lines[i] ?? "";
    const lineBytes = Buffer.byteLength(line, "utf-8") + (outLines.length > 0 ? 1 : 0);
    if (outBytes + lineBytes > maxBytes) {
      truncatedBy = "bytes";
      if (outLines.length === 0) {
        outLines.unshift(truncateStringToBytesFromEnd(line, maxBytes));
        outBytes = Buffer.byteLength(outLines[0] ?? "", "utf-8");
        lastLinePartial = true;
      }
      break;
    }
    outLines.unshift(line);
    outBytes += lineBytes;
  }

  if (outLines.length >= maxLines && outBytes <= maxBytes) {
    truncatedBy = "lines";
  }

  const output = outLines.join("\n");
  return {
    content: output,
    truncated: true,
    truncatedBy,
    totalLines,
    totalBytes,
    outputLines: outLines.length,
    outputBytes: Buffer.byteLength(output, "utf-8"),
    lastLinePartial,
    firstLineExceedsLimit: false
  };
}

function truncateStringToBytesFromEnd(text: string, maxBytes: number): string {
  const buf = Buffer.from(text, "utf-8");
  if (buf.length <= maxBytes) return text;

  let start = buf.length - maxBytes;
  while (start < buf.length && (buf[start] & 0xc0) === 0x80) {
    start += 1;
  }
  return buf.slice(start).toString("utf-8");
}
