/**
 * Convert markdown-formatted model reply to Feishu-friendly format.
 * Preserves structure while adapting syntax for optimal Feishu rendering.
 */
export function markdownToFeishuMarkdown(text: string): string {
  const normalized = String(text ?? "").replace(/\r\n?/g, "\n");
  const chunks = splitMarkdownByCodeFence(normalized);
  return chunks
    .map((chunk) => chunk.isCode ? chunk.content : convertMarkdownOutsideCode(chunk.content))
    .join("")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function splitMarkdownByCodeFence(text: string): Array<{ content: string; isCode: boolean }> {
  const chunks: Array<{ content: string; isCode: boolean }> = [];
  let cursor = 0;
  const fencePattern = /^```[^\n]*\n[\s\S]*?^```[ \t]*$/gm;
  for (const match of text.matchAll(fencePattern)) {
    const start = match.index ?? 0;
    if (start > cursor) chunks.push({ content: text.slice(cursor, start), isCode: false });
    chunks.push({ content: match[0], isCode: true });
    cursor = start + match[0].length;
  }
  if (cursor < text.length) chunks.push({ content: text.slice(cursor), isCode: false });
  return chunks;
}

function convertMarkdownOutsideCode(text: string): string {
  let result = text;

  // Headers: convert # to bold (Feishu cards render headers poorly)
  result = result.replace(/^#{1,6}\s+(.+)$/gm, "**$1**");

  // Bold: **text** or __text__ - keep (supported)
  result = result.replace(/__(.+?)__/g, "**$1**");

  // Italic: *text* or _text_ - keep (supported)
  result = result.replace(/(?<!\*)\*(?!\*)([^\*\n]+?)(?<!\*)\*(?!\*)/g, "_$1_");

  // Lists: convert to simple format
  result = result.replace(/^\s*[-\*]\s+/gm, "• ");

  // Horizontal rules: convert to simple line
  result = result.replace(/^[\s]*[-*_]{3,}[\s]*$/gm, "---");

  // Blockquotes: > text
  result = result.replace(/^>\s+(.+)$/gm, "_$1_");

  return result;
}

/**
 * Detect if text contains significant markdown formatting
 */
export function hasSignificantMarkdown(text: string): boolean {
  const patterns = [
    /```[\s\S]*?```/,           // Code blocks
    /\*\*[\s\S]+?\*\*/,         // Bold
    /__[^\n]+?__/,               // Bold (alt)
    /\*(?!\*)[^\n]+?\*(?!\*)/,   // Italic
    /_[^\n]+?_/,                 // Italic (alt)
    /~~[^\n]+?~~/,               // Strikethrough
    /`[^`\n]+?`/,                // Inline code
    /\[[^\]]+\]\([^)]+\)/,       // Links
    /!\[[^\]]*\]\([^)]+\)/,      // Images
    /^#{1,6}\s+/m,               // Headers
    /^\s*[-\*]\s+/m,             // Lists
    /^\|.+\|$/m                  // Tables
  ];

  return patterns.some(pattern => pattern.test(text));
}

/**
 * Format plain text for Feishu display
 * Adds basic structure and escaping if needed
 */
export function formatPlainTextForFeishu(text: string): string {
  // Normalize line endings
  let result = text.replace(/\r\n?/g, "\n");

  // Preserve paragraph breaks
  result = result.replace(/\n{3,}/g, "\n\n");

  // Escape special markdown characters that might be misinterpreted
  // Only escape if they look like they might be formatting
  if (result.includes("**") || result.includes("__")) {
    // If it has asterisks or underscores, it might be intentional markdown
    // Leave it as is
  }

  return result.trim();
}

export type FeishuRichTextSegment =
  | {
      type: "markdown";
      content: string;
    }
  | {
      type: "table";
      columns: string[];
      rows: string[][];
    };

function splitMarkdownTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let current = "";
  let escaped = false;

  for (const char of trimmed) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function isMarkdownTableSeparatorRow(line: string): boolean {
  const cells = splitMarkdownTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isMarkdownTableHeaderRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("|") && trimmed.endsWith("|") && splitMarkdownTableRow(line).length >= 2;
}

function normalizeTableCells(cells: string[], width: number): string[] {
  if (cells.length === width) return cells;
  if (cells.length > width) return cells.slice(0, width);
  return [...cells, ...Array.from({ length: width - cells.length }, () => "")];
}

export function parseFeishuRichTextSegments(text: string): FeishuRichTextSegment[] {
  const normalized = String(text ?? "").replace(/\r\n?/g, "\n").trim();
  if (!normalized) return [];

  const lines = normalized.split("\n");
  const segments: FeishuRichTextSegment[] = [];
  let markdownBuffer: string[] = [];
  let insideCodeFence = false;

  const flushMarkdown = (): void => {
    const content = markdownBuffer.join("\n").trim();
    if (content) {
      segments.push({ type: "markdown", content });
    }
    markdownBuffer = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const next = lines[index + 1] ?? "";
    if (line.trim().startsWith("```")) {
      insideCodeFence = !insideCodeFence;
      markdownBuffer.push(line);
      continue;
    }
    if (!insideCodeFence && isMarkdownTableHeaderRow(line) && isMarkdownTableSeparatorRow(next)) {
      const columns = splitMarkdownTableRow(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length) {
        const rowLine = lines[index];
        if (rowLine.trim().startsWith("```")) {
          index -= 1;
          break;
        }
        if (!isMarkdownTableHeaderRow(rowLine)) {
          index -= 1;
          break;
        }
        rows.push(normalizeTableCells(splitMarkdownTableRow(rowLine), columns.length));
        index += 1;
      }
      flushMarkdown();
      segments.push({ type: "table", columns, rows });
      continue;
    }
    markdownBuffer.push(line);
  }

  flushMarkdown();
  return segments;
}
