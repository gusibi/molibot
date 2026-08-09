/**
 * Small, read-only workbook model for the Artifact Panel. SheetJS does the
 * binary format work; this module keeps the UI independent from SheetJS's
 * worksheet objects and enforces the same row ceiling as document extraction.
 */

/** Keep the DOM bounded; this matches the existing CSV table's safe UI budget. */
export const SPREADSHEET_MAX_ROWS = 5_000;

export interface SpreadsheetSheet {
  name: string;
  headers: string[];
  rows: string[][];
  truncated: boolean;
}

export interface SpreadsheetWorkbook {
  sheets: SpreadsheetSheet[];
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

function normalizeRows(rows: unknown[][]): { headers: string[]; values: string[][] } {
  const values = rows.map((row) => (Array.isArray(row) ? row.map(cellText) : []));
  const width = values.reduce((max, row) => Math.max(max, row.length), 0);
  if (width === 0) return { headers: [], values: [] };

  const padded = values.map((row) => Array.from({ length: width }, (_, index) => row[index] ?? ""));
  return { headers: padded[0] ?? [], values: padded.slice(1) };
}

/**
 * Parses XLS/XLSX bytes lazily. The import stays inside this function so the
 * desktop's initial bundle does not pay for a binary spreadsheet parser until
 * a workbook is actually opened.
 */
export async function parseSpreadsheet(input: ArrayBuffer | Uint8Array): Promise<SpreadsheetWorkbook> {
  const XLSX = await import("xlsx");
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const workbook = XLSX.read(bytes, {
    type: "array",
    cellDates: true,
    cellFormula: false,
    // Read one sentinel row past the render budget so an exactly-at-cap
    // workbook is not reported as truncated.
    sheetRows: SPREADSHEET_MAX_ROWS + 2
  });

  const sheets = workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    if (!sheet) return { name, headers: [], rows: [], truncated: false } satisfies SpreadsheetSheet;

    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: false,
      defval: "",
      blankrows: false
    });
    const normalized = normalizeRows(rows);
    const range = typeof sheet["!ref"] === "string" ? XLSX.utils.decode_range(sheet["!ref"] as string) : null;
    const sourceRowCount = range ? range.e.r - range.s.r + 1 : rows.length;
    // SheetJS trims `!ref` to the requested `sheetRows` ceiling, so a capped
    // row array is the reliable signal that more source rows may exist.
    const truncated = sourceRowCount > SPREADSHEET_MAX_ROWS + 1 || rows.length > SPREADSHEET_MAX_ROWS + 1;

    return {
      name,
      headers: normalized.headers,
      rows: normalized.values.slice(0, SPREADSHEET_MAX_ROWS),
      truncated
    } satisfies SpreadsheetSheet;
  });

  return { sheets };
}
