/**
 * CSV/TSV parser for the Artifact Panel's CsvTable viewer (PRD §3.38 Slice 1c).
 *
 * RFC-4180-style: quoted fields, escaped double quotes, CRLF/CR/LF line ends,
 * and a comma/tab delimiter auto-detected from the first line. CJK cells are
 * passed through verbatim - no ASCII width estimation (pitfall #8: that is a
 * rendering concern, not a parsing one). Rows are capped so a multi-megabyte
 * export never freezes the panel; the raw-text toggle still shows every byte.
 */

export interface CsvParseResult {
  headers: string[];
  rows: string[][];
  truncated: boolean;
}

export const CSV_MAX_ROWS = 5000;

/**
 * Parses CSV/TSV text into headers + rows. Throws on an unterminated quoted
 * field so the caller can fall back to CodeViewer for genuinely malformed input.
 */
export function parseCsv(input: string): CsvParseResult {
  const text = String(input ?? "").replace(/^\uFEFF/, "");
  if (!text) return { headers: [], rows: [], truncated: false };

  const delimiter = detectDelimiter(text.split(/\r\n|\n|\r/)[0] ?? "");
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  let truncated = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
        continue;
      }
      field += char;
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === delimiter) {
      record.push(field);
      field = "";
      continue;
    }
    if (char === "\r" || char === "\n") {
      record.push(field);
      field = "";
      // CRLF is one terminator, not two empty records.
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      records.push(record);
      record = [];
      if (records.length > CSV_MAX_ROWS) {
        truncated = true;
        break;
      }
      continue;
    }
    field += char;
  }

  if (inQuotes) {
    throw new Error("Malformed CSV: unterminated quoted field.");
  }

  // A trailing field/record with no newline.
  if (field !== "" || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  if (records.length === 0) return { headers: [], rows: [], truncated };
  const [headers, ...rows] = records;
  return { headers, rows, truncated };
}

function detectDelimiter(line: string): "," | "\t" {
  let commas = 0;
  let tabs = 0;
  for (const char of line) {
    if (char === ",") commas += 1;
    else if (char === "\t") tabs += 1;
  }
  return tabs > commas ? "\t" : ",";
}

/**
 * Column sort for the table viewer. Cells that read as numbers — optionally
 * carrying `%`, thousands separators, or surrounding spaces — compare as
 * numbers, so "75%" sorts before "100%"; everything else falls back to a
 * locale-aware string compare, which keeps CJK stable and orders
 * "2026-08" / "2026-Q3" style values predictably. Returns a new array: the
 * viewer keeps the parsed order as the reset state.
 */
export function sortCsvRows(rows: string[][], column: number, dir: 1 | -1): string[][] {
  return [...rows].sort((left, right) => dir * compareCells(left[column] ?? "", right[column] ?? ""));
}

function compareCells(left: string, right: string): number {
  const leftNumber = numericValue(left);
  const rightNumber = numericValue(right);
  if (leftNumber !== null && rightNumber !== null) return leftNumber - rightNumber;
  return left.trim().localeCompare(right.trim(), undefined, { numeric: true, sensitivity: "base" });
}

function numericValue(cell: string): number | null {
  const text = cell.trim().replace(/[,\s%]/g, "");
  return /^[+-]?\d+(?:\.\d+)?$/.test(text) ? Number(text) : null;
}
