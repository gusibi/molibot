import { renderMarkdown } from "../markdown";

export interface StreamBlock {
  /** Sanitized HTML for one top-level markdown block. */
  html: string;
}

export interface StreamingRenderDeps {
  copyCode: string;
  wrapLinesLabel: string;
}

export type StreamingParse = (content: string, deps: StreamingRenderDeps) => string;

/**
 * Renders a growing streamed reply one top-level block at a time.
 *
 * `ConversationLiveView` used to call `renderMarkdown(streamingText)` on every
 * frame and swap the whole `{@html}` tree. That is O(whole source) per frame
 * and, because the entire `innerHTML` is replaced, blows away any text the
 * reader had selected. Splitting the source into top-level blocks fixes both:
 * the sealed blocks (everything before the final block boundary, which is
 * immutable for the rest of the stream) are parsed once and their html cached,
 * so Svelte 5's `{@html}` runtime sees an unchanged value and skips the
 * innerHTML write (`value === (value = get_value())` in
 * `runtime/client/dom/blocks/html.js`) - the DOM node and its selection
 * survive - while only the still-growing last block is re-parsed per frame.
 */
export const defaultStreamingParse: StreamingParse = (content, deps) =>
  renderMarkdown(content, deps.copyCode, {
    streaming: true,
    labels: { wrapLines: deps.wrapLinesLabel }
  });

const FENCE_LINE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

export interface SplitResult {
  contents: string[];
  /**
   * The marker character of an open code fence when the last block has not yet
   * been closed, else `null`. Only the last block can be open: a fence that
   * spans a block boundary would have kept the blank line inside it.
   */
  openFenceMarker: string | null;
}

/**
 * Splits a markdown source into top-level blocks. A block boundary is a blank
 * line *outside* a fenced code block; blank lines inside a fence are part of
 * the code. The last entry is the active (still-growing) block.
 *
 * This is a deliberate simplification of marked's own block grammar: it covers
 * the shapes LLM output actually takes (paragraphs separated by blank lines,
 * fenced code with internal blank lines) without pulling in `marked.Lexer`. A
 * fence immediately followed by non-blank text with no separating blank line
 * lands in the same block - that renders correctly (marked still parses the
 * sub-blocks inside it) and the active block is merely a little larger.
 */
export function splitMarkdownBlocks(source: string): SplitResult {
  const lines = String(source ?? "").split("\n");
  const contents: string[] = [];
  let current: string[] = [];
  let inFence = false;
  let fenceChar = "";
  for (const line of lines) {
    const fence = line.match(FENCE_LINE_RE);
    if (fence) {
      const char = fence[1][0];
      const info = fence[2];
      if (!inFence) {
        inFence = true;
        fenceChar = char;
      } else if (char === fenceChar && info.trim() === "") {
        inFence = false;
        fenceChar = "";
      }
      // else: a fence-shaped line inside a fence (the other marker char, or
      // the same char with an info string - ```` ```python ```` inside a ```
      // block) is code content, not a boundary.
    }
    const blank = line.trim() === "";
    if (blank && !inFence) {
      if (current.length > 0) {
        contents.push(current.join("\n"));
        current = [];
      }
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) contents.push(current.join("\n"));
  return { contents, openFenceMarker: inFence ? fenceChar : null };
}

const BLOCK_CACHE_LIMIT = 300;

export interface StreamingRenderer {
  derive(source: string, deps: StreamingRenderDeps): StreamBlock[];
}

/**
 * Builds a renderer with its own sealed-block cache. The cache is per renderer
 * (not module-global) so a test injecting a spy parse never sees another test's
 * entries, and the component owns one renderer for its lifetime.
 */
export function createStreamingRenderer(parse: StreamingParse = defaultStreamingParse): StreamingRenderer {
  // The cache holds the rendered html *string* for a sealed block. The
  // selection-preservation mechanism is Svelte 5's `{@html}` runtime, which
  // guards `value === (value = get_value())` and skips the innerHTML write when
  // the value is unchanged - so a sealed block handing back the same html
  // string leaves its DOM node (and any selection in it) untouched, even across
  // the active->sealed transition where the wrapper object is new. Caching the
  // string is what makes that value identical across frames; caching the
  // wrapper object would not (Svelte's each treats every object item as
  // changed, so it buys nothing).
  const cache = new Map<string, string>();
  return {
    derive(source, deps) {
      const { contents, openFenceMarker } = splitMarkdownBlocks(source);
      if (contents.length === 0) return [];
      const lastIndex = contents.length - 1;
      const blocks: StreamBlock[] = [];
      for (let i = 0; i <= lastIndex; i++) {
        const content = contents[i];
        if (i === lastIndex) {
          // The active, still-growing block. Re-parsed every frame and never
          // cached: its content changes each frame, so caching would leak one
          // entry per frame. If it is an open code fence, synthetically close
          // it so marked does not swallow the lines that follow into the code
          // block - the violent "everything after ``` is code" reflow.
          const closed = openFenceMarker ? `${content}\n${openFenceMarker.repeat(3)}` : content;
          blocks.push({ html: parse(closed, deps) });
          continue;
        }
        // A sealed block: its content is immutable for the rest of the stream,
        // so cache the rendered html string and hand it back unchanged. The
        // `{@html}` value guard is what preserves a selection in this block -
        // the wrapper object is fresh each frame, but its html value is
        // identical, so Svelte skips the innerHTML write.
        const key = `${deps.copyCode}\0${deps.wrapLinesLabel}\0${content}`;
        const cached = cache.get(key);
        if (cached !== undefined) {
          cache.delete(key);
          cache.set(key, cached); // LRU recency
          blocks.push({ html: cached });
          continue;
        }
        const html = parse(content, deps);
        cache.set(key, html);
        if (cache.size > BLOCK_CACHE_LIMIT) {
          const oldest = cache.keys().next().value;
          if (oldest !== undefined) cache.delete(oldest);
        }
        blocks.push({ html });
      }
      return blocks;
    }
  };
}
