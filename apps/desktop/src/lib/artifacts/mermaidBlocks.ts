/**
 * Splits Markdown source into Mermaid/D2 diagram blocks and everything else
 * (PRD §3.38 Slice 3).
 *
 * Mermaid is rendered by the library and D2 by the service-side renderer; the rest by the transcript's own
 * `renderMarkdown`. Doing the split on the source - rather than post-processing
 * the rendered HTML - keeps the diagram text exactly as the author wrote it, and
 * makes the rule ("a fenced block whose info string is mermaid") testable
 * without a DOM or the library.
 */

export type MarkdownSegment =
  | { kind: "markdown"; content: string }
  | { kind: "mermaid"; content: string; id: string }
  | { kind: "d2"; content: string; id: string };

export type DiagramKind = "mermaid" | "d2";

/**
 * A fenced block opened by at least three backticks or tildes. The closing fence
 * must use the same character and be at least as long, per CommonMark, so a
 * diagram containing a shorter run of backticks does not terminate its own block.
 */
const FENCE_OPEN = /^([ \t]{0,3})(`{3,}|~{3,})[ \t]*([^\n`]*)$/;

function diagramKindFromInfo(info: string): DiagramKind | null {
  // The info string may carry attributes (```mermaid {theme=x}); only the first
  // word names the language.
  const kind = String(info ?? "").trim().split(/\s+/)[0]?.toLowerCase();
  return kind === "mermaid" || kind === "d2" ? kind : null;
}

function splitFencedDiagramBlocks(source: string, acceptedKinds: ReadonlySet<DiagramKind>): MarkdownSegment[] {
  const lines = String(source ?? "").split("\n");
  const segments: MarkdownSegment[] = [];
  const diagramIndexes = new Map<DiagramKind, number>();
  let buffer: string[] = [];

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
    const kind = match ? diagramKindFromInfo(match[3]) : null;
    if (!match || !kind || !acceptedKinds.has(kind)) {
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
    const diagramIndex = (diagramIndexes.get(kind) ?? 0) + 1;
    diagramIndexes.set(kind, diagramIndex);
    segments.push({ kind, content: body.join("\n"), id: `${kind}-${diagramIndex}` });
    index = cursor;
  }

  flushMarkdown();
  return segments;
}

export function splitDiagramBlocks(source: string): MarkdownSegment[] {
  return splitFencedDiagramBlocks(source, new Set<DiagramKind>(["mermaid", "d2"]));
}

export function splitMermaidBlocks(source: string): MarkdownSegment[] {
  return splitFencedDiagramBlocks(source, new Set<DiagramKind>(["mermaid"]));
}

/** True when the source contains at least one mermaid block worth loading the library for. */
export function hasMermaidBlock(source: string): boolean {
  return splitMermaidBlocks(source).some((segment) => segment.kind === "mermaid" && segment.content.trim().length > 0);
}

/** True when the source contains at least one complete D2 block with content. */
export function hasD2Block(source: string): boolean {
  return splitDiagramBlocks(source).some((segment) => segment.kind === "d2" && segment.content.trim().length > 0);
}
