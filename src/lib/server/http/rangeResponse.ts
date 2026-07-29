import { createReadStream } from "node:fs";
import { Readable } from "node:stream";

export interface ByteRange {
  start: number;
  end: number;
}

/**
 * Parses a single-range `Range` header. Multi-range requests and unknown units
 * return `null` so the caller answers with the whole file, which RFC 9110 allows;
 * only a well-formed but unsatisfiable range returns `"invalid"`, which must be
 * answered with 416.
 */
export function parseByteRange(header: string | null | undefined, size: number): ByteRange | "invalid" | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return null;
  let start: number;
  let end: number;
  if (!rawStart) {
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return "invalid";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd ? Number(rawEnd) : size - 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "invalid";
  if (start > end || start >= size) return "invalid";
  return { start, end: Math.min(end, size - 1) };
}

export function weakEtagFor(input: { size: number; mtimeMs: number }): string {
  return `W/"${input.size.toString(16)}-${Math.floor(input.mtimeMs).toString(16)}"`;
}

export interface RangeStreamInput {
  path: string;
  size: number;
  mtimeMs: number;
  mimeType?: string;
  rangeHeader?: string | null;
  ifNoneMatch?: string | null;
  /** Extra headers merged into every response, e.g. `content-disposition`. */
  headers?: Record<string, string>;
  cacheControl?: string;
}

/**
 * Serves a file as a seekable stream. Range support is what lets a WebView
 * `<video>` scrub instead of downloading the whole file first, and streaming
 * keeps a large file off the service's heap.
 */
export function streamFileWithRange(input: RangeStreamInput): Response {
  const etag = weakEtagFor(input);
  const headers: Record<string, string> = {
    "content-type": input.mimeType || "application/octet-stream",
    "accept-ranges": "bytes",
    "cache-control": input.cacheControl ?? "no-cache",
    etag,
    "last-modified": new Date(input.mtimeMs).toUTCString(),
    ...input.headers
  };

  if (input.ifNoneMatch && input.ifNoneMatch === etag) {
    return new Response(null, { status: 304, headers });
  }
  if (input.size === 0) {
    return new Response(null, { status: 200, headers: { ...headers, "content-length": "0" } });
  }

  const range = parseByteRange(input.rangeHeader, input.size);
  if (range === "invalid") {
    return new Response(null, {
      status: 416,
      headers: { ...headers, "content-range": `bytes */${input.size}` }
    });
  }

  const start = range ? range.start : 0;
  const end = range ? range.end : input.size - 1;
  const stream = Readable.toWeb(createReadStream(input.path, { start, end })) as ReadableStream<Uint8Array>;
  return new Response(stream, {
    status: range ? 206 : 200,
    headers: {
      ...headers,
      "content-length": String(end - start + 1),
      ...(range ? { "content-range": `bytes ${start}-${end}/${input.size}` } : {})
    }
  });
}
