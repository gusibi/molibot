/**
 * Splits Markdown source into mermaid diagram blocks and everything else
 * (PRD §3.38 Slice 3).
 *
 * Mermaid is rendered by the library, the rest by the transcript's own
 * `renderMarkdown`. Doing the split on the source - rather than post-processing
 * the rendered HTML - keeps the diagram text exactly as the author wrote it, and
 * makes the rule ("a fenced block whose info string is mermaid") testable
 * without a DOM or the library.
 */

export type MarkdownSegment =
  | { kind: "markdown"; content: string }
  | { kind: "mermaid"; content: string; id: string };

/**
 * A fenced block opened by at least three backticks or tildes. The closing fence
 * must use the same character and be at least as long, per CommonMark, so a
 * diagram containing a shorter run of backticks does not terminate its own block.
 */
const FENCE_OPEN = /^([ \t]{0,3})(`{3,}|~{3,})[ \t]*([^\n`]*)$/;

function isMermaidInfo(info: string): boolean {
  // The info string may carry attributes (```mermaid {theme=x}); only the first
  // word names the language.
  return String(info ?? "").trim().split(/\s+/)[0]?.toLowerCase() === "mermaid";
}

export function splitMermaidBlocks(source: string): MarkdownSegment[] {
  const lines = String(source ?? "").split("\n");
  const segments: MarkdownSegment[] = [];
  let buffer: string[] = [];
  let diagramIndex = 0;

  const flushMarkdown = (): void => {
    if (buffer.length === 0) return;
    const content = buffer.join("\n");
    buffer = [];
    // Keep whitespace-only runs out of the segment list; they render nothing and
    // would otherwise add empty blocks between diagrams.
    if (content.trim()) segments.push({ kind: "markdown", content });
  };

  for (let index = 0; index < lines.length; index += 1) {
    const match = FENCE_OPEN.exec(lines[index]);
    if (!match || !isMermaidInfo(match[3])) {
      buffer.push(lines[index]);
      continue;
    }

    const fence = match[2];
    const closer = new RegExp(`^[ \\t]{0,3}${fence[0] === "`" ? "`" : "~"}{${fence.length},}[ \\t]*$`);
    const body: string[] = [];
    let closed = false;
    let cursor = index + 1;
    for (; cursor < lines.length; cursor += 1) {
      if (closer.test(lines[cursor])) {
        closed = true;
        break;
      }
      body.push(lines[cursor]);
    }

    if (!closed) {
      // An unterminated fence is still being streamed or is malformed; leave it
      // to the Markdown renderer rather than rendering a broken diagram.
      buffer.push(lines[index]);
      continue;
    }

    flushMarkdown();
    diagramIndex += 1;
    segments.push({ kind: "mermaid", content: body.join("\n"), id: `mermaid-${diagramIndex}` });
    index = cursor;
  }

  flushMarkdown();
  return segments;
}

/** True when the source contains at least one mermaid block worth loading the library for. */
export function hasMermaidBlock(source: string): boolean {
  return splitMermaidBlocks(source).some((segment) => segment.kind === "mermaid" && segment.content.trim().length > 0);
}
