import { promises as fs, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, extname, isAbsolute, relative, resolve } from "node:path";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { marked } from "marked";
import type { RunOutputLayout } from "$lib/server/agent/tools/outputLayout.js";
import { createPathGuard } from "$lib/server/agent/tools/path.js";

const MAX_MARKDOWN_CHARS = 500_000;
const MAX_WORKBOOK_CELLS = 100_000;
const MAX_SHEETS = 32;
const MAX_ROWS_PER_SHEET = 20_000;
const MAX_COLUMNS = 128;
const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const PAGE_MARGIN = 54;

const scalarSchema = Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Null()]);
const documentExportSchema = Type.Object({
  format: Type.Union([Type.Literal("docx"), Type.Literal("xlsx"), Type.Literal("pdf")]),
  path: Type.String({ description: "Output file name/path. Extension must match format." }),
  title: Type.Optional(Type.String()),
  content: Type.Optional(Type.String({ description: "Markdown body for DOCX/PDF." })),
  sheets: Type.Optional(Type.Array(Type.Object({
    name: Type.String(),
    rows: Type.Array(Type.Array(scalarSchema))
  }))),
  target: Type.Optional(Type.Union([Type.Literal("project"), Type.Literal("scratch")])),
  attach: Type.Optional(Type.Boolean({ description: "Send the verified file through the active channel. Defaults to true." }))
});

export type DocumentExportFormat = "docx" | "xlsx" | "pdf";
export type WorkbookScalar = string | number | boolean | null;

export interface DocumentExportInput {
  format: DocumentExportFormat;
  path: string;
  title?: string;
  content?: string;
  sheets?: Array<{ name: string; rows: WorkbookScalar[][] }>;
  target?: "project" | "scratch";
  attach?: boolean;
}

interface TextBlock {
  kind: "heading" | "paragraph" | "list" | "quote" | "code" | "rule";
  text?: string;
  level?: number;
  ordered?: boolean;
  items?: string[];
}

interface TableBlock {
  kind: "table";
  rows: string[][];
}

type DocumentBlock = TextBlock | TableBlock;

export interface DocumentExportDetails {
  requestedPath: string;
  relativePath: string;
  rootKind: "project" | "scratch";
  action: "generated";
  sizeBytes: number;
  format: DocumentExportFormat;
  verified: true;
  verification: {
    method: "re-read";
    extractedCharacters?: number;
    pages?: number;
    sheets?: string[];
    checkedCells?: number;
  };
}

export interface DocumentExportResult {
  absolutePath: string;
  details: DocumentExportDetails;
}

interface ExportOptions {
  cwd: string;
  workspaceDir: string;
  artifactDir?: string;
  outputLayout?: RunOutputLayout;
  uploadFile?: (filePath: string, title?: string, text?: string) => Promise<void>;
}

function stripInlineMarkdown(value: string): string {
  return String(value ?? "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/[`*_~]/g, "")
    .replace(/\\([\\`*{}\[\]()#+\-.!_>])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenText(token: any): string {
  if (Array.isArray(token?.tokens)) {
    return token.tokens.map((child: any) => tokenText(child)).join("").replace(/\s+/g, " ").trim();
  }
  if (typeof token?.text === "string") return stripInlineMarkdown(token.text);
  if (typeof token?.raw === "string") return stripInlineMarkdown(token.raw);
  return "";
}

export function parseExportMarkdown(markdown: string): DocumentBlock[] {
  const blocks: DocumentBlock[] = [];
  for (const token of marked.lexer(markdown, { gfm: true })) {
    if (token.type === "space") continue;
    if (token.type === "heading") {
      blocks.push({ kind: "heading", text: tokenText(token), level: token.depth });
      continue;
    }
    if (token.type === "paragraph" || token.type === "text") {
      const text = tokenText(token);
      if (text) blocks.push({ kind: "paragraph", text });
      continue;
    }
    if (token.type === "blockquote") {
      const text = tokenText(token) || stripInlineMarkdown(token.raw);
      if (text) blocks.push({ kind: "quote", text });
      continue;
    }
    if (token.type === "code") {
      blocks.push({ kind: "code", text: String(token.text ?? "") });
      continue;
    }
    if (token.type === "hr") {
      blocks.push({ kind: "rule" });
      continue;
    }
    if (token.type === "list") {
      blocks.push({
        kind: "list",
        ordered: Boolean(token.ordered),
        items: (token.items ?? []).map((item: any) => tokenText(item) || stripInlineMarkdown(item.text))
      });
      continue;
    }
    if (token.type === "table") {
      const header = (token.header ?? []).map((cell: any) => tokenText(cell));
      const rows = (token.rows ?? []).map((row: any[]) => row.map((cell) => tokenText(cell)));
      blocks.push({ kind: "table", rows: [header, ...rows] });
      continue;
    }
    const text = tokenText(token);
    if (text) blocks.push({ kind: "paragraph", text });
  }
  return blocks;
}

function expectedFragments(title: string, blocks: DocumentBlock[]): string[] {
  const values = [title];
  for (const block of blocks) {
    if (block.kind === "table") values.push(...block.rows.flat());
    else if (block.kind === "list") values.push(...(block.items ?? []));
    else if (block.text) values.push(block.text);
  }
  return values.map((value) => value.trim()).filter((value) => value.length >= 2);
}

function normalizeVerificationText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function assertTextCoverage(actual: string, fragments: string[], format: string): void {
  const normalizedActual = normalizeVerificationText(actual);
  const missing = fragments.filter((fragment) => {
    const normalized = normalizeVerificationText(fragment);
    return normalized.length >= 2 && !normalizedActual.includes(normalized);
  });
  if (missing.length > 0) {
    throw new Error(`${format} verification failed after re-read; missing content: ${missing.slice(0, 3).join(" | ")}`);
  }
}

async function buildDocx(title: string, blocks: DocumentBlock[]): Promise<Buffer> {
  const {
    AlignmentType,
    BorderStyle,
    Document,
    Footer,
    HeadingLevel,
    LevelFormat,
    Packer,
    PageNumber,
    Paragraph,
    ShadingType,
    Table,
    TableCell,
    TableRow,
    TextRun,
    WidthType
  } = await import("docx");

  const children: Array<InstanceType<typeof Paragraph> | InstanceType<typeof Table>> = [];
  children.push(new Paragraph({
    children: [new TextRun({ text: title, bold: true, size: 34, color: "172033" })],
    spacing: { after: 320 }
  }));

  for (const block of blocks) {
    if (block.kind === "rule") {
      children.push(new Paragraph({
        border: { bottom: { color: "CBD5E1", style: BorderStyle.SINGLE, size: 6, space: 8 } },
        spacing: { before: 120, after: 180 }
      }));
      continue;
    }
    if (block.kind === "table") {
      const columnCount = Math.max(1, ...block.rows.map((row) => row.length));
      children.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: block.rows.map((row, rowIndex) => new TableRow({
          tableHeader: rowIndex === 0,
          children: Array.from({ length: columnCount }, (_, index) => new TableCell({
            width: { size: Math.floor(100 / columnCount), type: WidthType.PERCENTAGE },
            shading: rowIndex === 0 ? { fill: "E8EEF7", type: ShadingType.CLEAR } : undefined,
            margins: { top: 100, bottom: 100, left: 120, right: 120 },
            children: [new Paragraph({
              children: [new TextRun({ text: row[index] ?? "", bold: rowIndex === 0, size: 20 })],
              spacing: { after: 0 }
            })]
          }))
        }))
      }));
      children.push(new Paragraph({ spacing: { after: 120 } }));
      continue;
    }
    if (block.kind === "list") {
      for (const item of block.items ?? []) {
        children.push(new Paragraph({
          children: [new TextRun({ text: item, size: 22 })],
          ...(block.ordered
            ? { numbering: { reference: "document-export-numbering", level: 0 } }
            : { bullet: { level: 0 } }),
          spacing: { after: 80, line: 300 }
        }));
      }
      continue;
    }
    const text = block.text ?? "";
    if (!text) continue;
    if (block.kind === "heading") {
      const level = Math.min(3, Math.max(1, block.level ?? 1));
      children.push(new Paragraph({
        text,
        heading: level === 1 ? HeadingLevel.HEADING_1 : level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
        spacing: { before: level === 1 ? 280 : 220, after: 120 }
      }));
    } else if (block.kind === "quote") {
      children.push(new Paragraph({
        children: [new TextRun({ text, italics: true, color: "475569", size: 21 })],
        indent: { left: 360 },
        border: { left: { color: "64748B", style: BorderStyle.SINGLE, size: 12, space: 12 } },
        spacing: { before: 80, after: 160, line: 300 }
      }));
    } else if (block.kind === "code") {
      children.push(new Paragraph({
        children: [new TextRun({ text, font: "Consolas", size: 19, color: "E2E8F0" })],
        shading: { fill: "172033", type: ShadingType.CLEAR },
        spacing: { before: 80, after: 160, line: 280 }
      }));
    } else {
      children.push(new Paragraph({
        children: [new TextRun({ text, size: 22 })],
        spacing: { after: 140, line: 320 }
      }));
    }
  }

  const document = new Document({
    creator: "Molibot",
    title,
    description: "Generated and verified by Molibot documentExport",
    styles: {
      default: { document: { run: { font: "Arial", size: 22, color: "1E293B" } } },
      paragraphStyles: [
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { bold: true, size: 30, color: "172033" } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { bold: true, size: 26, color: "26354D" } },
        { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true, run: { bold: true, size: 23, color: "334155" } }
      ]
    },
    numbering: {
      config: [{
        reference: "document-export-numbering",
        levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.START, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }]
      }]
    },
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 }
        }
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: "Molibot  |  ", color: "64748B", size: 18 }), new TextRun({ children: [PageNumber.CURRENT], color: "64748B", size: 18 })]
          })]
        })
      },
      children
    }]
  });
  return Packer.toBuffer(document);
}

interface UnicodeFontRange { start: number; end: number }
interface UnicodeFontSubset { slug: string; ranges: UnicodeFontRange[] }

const require = createRequire(import.meta.url);
let unicodeSubsets: UnicodeFontSubset[] | null = null;

function parseUnicodeRanges(value: string): UnicodeFontRange[] {
  return value.split(",").map((part) => {
    const [start, end] = part.trim().replace(/^U\+/i, "").split("-").map((hex) => Number.parseInt(hex, 16));
    return { start, end: end ?? start };
  });
}

function loadUnicodeSubsets(): UnicodeFontSubset[] {
  if (unicodeSubsets) return unicodeSubsets;
  const jsonPath = require.resolve("@fontsource-variable/noto-sans-sc/unicode.json");
  const source = JSON.parse(readFileSync(jsonPath, "utf8")) as Record<string, string>;
  unicodeSubsets = Object.entries(source).map(([key, ranges]) => ({
    slug: key.startsWith("[") ? key.slice(1, -1) : key,
    ranges: parseUnicodeRanges(ranges)
  }));
  return unicodeSubsets;
}

function subsetForCharacter(character: string): string {
  const codePoint = character.codePointAt(0) ?? 0;
  return loadUnicodeSubsets().find((subset) => subset.ranges.some((range) => codePoint >= range.start && codePoint <= range.end))?.slug ?? "latin";
}

async function buildPdf(title: string, blocks: DocumentBlock[]): Promise<Buffer> {
  const [{ PDFDocument, rgb }, { default: fontkit }] = await Promise.all([
    import("pdf-lib"),
    import("@pdf-lib/fontkit")
  ]);
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle(title);
  pdf.setAuthor("Molibot");
  pdf.setCreator("Molibot documentExport");
  const fonts = new Map<string, Awaited<ReturnType<typeof pdf.embedFont>>>();

  const fontForSubset = async (slug: string) => {
    const existing = fonts.get(slug);
    if (existing) return existing;
    const fontPath = require.resolve(`@fontsource-variable/noto-sans-sc/files/noto-sans-sc-${slug}-wght-normal.woff2`);
    const bytes = await fs.readFile(fontPath);
    const font = await pdf.embedFont(bytes, { subset: true });
    fonts.set(slug, font);
    return font;
  };

  const runsForText = async (text: string) => {
    const runs: Array<{ text: string; font: Awaited<ReturnType<typeof fontForSubset>> }> = [];
    for (const character of text) {
      const slug = subsetForCharacter(character);
      const font = await fontForSubset(slug);
      const previous = runs[runs.length - 1];
      if (previous?.font === font) previous.text += character;
      else runs.push({ text: character, font });
    }
    return runs;
  };

  const widthOf = async (text: string, size: number) => (await runsForText(text))
    .reduce((sum, run) => sum + run.font.widthOfTextAtSize(run.text, size), 0);

  const wrap = async (text: string, size: number, maxWidth: number): Promise<string[]> => {
    const tokens = text.match(/\s+|[A-Za-z0-9][A-Za-z0-9.,:;!?_+\-/]*|./gu) ?? [];
    const lines: string[] = [];
    let current = "";
    for (const token of tokens) {
      const candidate = current + token;
      if (!current || await widthOf(candidate, size) <= maxWidth) {
        current = candidate;
      } else {
        lines.push(current.trimEnd());
        current = token.trimStart();
      }
    }
    if (current) lines.push(current.trimEnd());
    return lines.length > 0 ? lines : [""];
  };

  let page = pdf.addPage([A4_WIDTH, A4_HEIGHT]);
  let y = A4_HEIGHT - PAGE_MARGIN;
  const pages: typeof page[] = [page];
  const ensureSpace = (height: number) => {
    if (y - height >= PAGE_MARGIN + 18) return;
    page = pdf.addPage([A4_WIDTH, A4_HEIGHT]);
    pages.push(page);
    y = A4_HEIGHT - PAGE_MARGIN;
  };
  const drawLine = async (text: string, x: number, baseline: number, size: number, color = rgb(0.12, 0.16, 0.23)) => {
    let cursor = x;
    for (const run of await runsForText(text)) {
      page.drawText(run.text, { x: cursor, y: baseline, size, font: run.font, color });
      cursor += run.font.widthOfTextAtSize(run.text, size);
    }
  };
  const drawWrapped = async (text: string, options: { size: number; indent?: number; color?: ReturnType<typeof rgb>; before?: number; after?: number; lineHeight?: number }) => {
    const indent = options.indent ?? 0;
    const lineHeight = options.lineHeight ?? options.size * 1.5;
    const lines = await wrap(text, options.size, A4_WIDTH - PAGE_MARGIN * 2 - indent);
    ensureSpace((options.before ?? 0) + lines.length * lineHeight + (options.after ?? 0));
    y -= options.before ?? 0;
    for (const line of lines) {
      await drawLine(line, PAGE_MARGIN + indent, y - options.size, options.size, options.color);
      y -= lineHeight;
    }
    y -= options.after ?? 0;
  };

  await drawWrapped(title, { size: 22, color: rgb(0.08, 0.13, 0.22), after: 18, lineHeight: 29 });
  for (const block of blocks) {
    if (block.kind === "rule") {
      ensureSpace(18);
      page.drawLine({ start: { x: PAGE_MARGIN, y: y - 6 }, end: { x: A4_WIDTH - PAGE_MARGIN, y: y - 6 }, thickness: 0.7, color: rgb(0.75, 0.8, 0.87) });
      y -= 18;
      continue;
    }
    if (block.kind === "table") {
      const columns = Math.max(1, ...block.rows.map((row) => row.length));
      const tableWidth = A4_WIDTH - PAGE_MARGIN * 2;
      const columnWidth = tableWidth / columns;
      for (let rowIndex = 0; rowIndex < block.rows.length; rowIndex += 1) {
        const row = block.rows[rowIndex];
        const wrappedCells = await Promise.all(Array.from({ length: columns }, (_, index) => wrap(row[index] ?? "", 9, columnWidth - 12)));
        const rowHeight = Math.max(28, ...wrappedCells.map((lines) => lines.length * 13 + 10));
        ensureSpace(rowHeight);
        const top = y;
        if (rowIndex === 0) page.drawRectangle({ x: PAGE_MARGIN, y: top - rowHeight, width: tableWidth, height: rowHeight, color: rgb(0.91, 0.94, 0.97) });
        for (let column = 0; column < columns; column += 1) {
          const x = PAGE_MARGIN + column * columnWidth;
          page.drawRectangle({ x, y: top - rowHeight, width: columnWidth, height: rowHeight, borderWidth: 0.5, borderColor: rgb(0.72, 0.77, 0.83) });
          let cellY = top - 10;
          for (const line of wrappedCells[column]) {
            await drawLine(line, x + 6, cellY - 9, 9, rgb(0.12, 0.16, 0.23));
            cellY -= 13;
          }
        }
        y -= rowHeight;
      }
      y -= 14;
      continue;
    }
    if (block.kind === "list") {
      for (let index = 0; index < (block.items ?? []).length; index += 1) {
        const prefix = block.ordered ? `${index + 1}. ` : "• ";
        await drawWrapped(`${prefix}${block.items![index]}`, { size: 10.5, indent: 14, after: 3, lineHeight: 16 });
      }
      y -= 5;
      continue;
    }
    const text = block.text ?? "";
    if (!text) continue;
    if (block.kind === "heading") {
      const level = Math.min(3, Math.max(1, block.level ?? 1));
      await drawWrapped(text, { size: level === 1 ? 16 : level === 2 ? 13 : 11.5, color: rgb(0.08, 0.13, 0.22), before: level === 1 ? 12 : 8, after: 7, lineHeight: level === 1 ? 22 : 19 });
    } else if (block.kind === "quote") {
      await drawWrapped(text, { size: 10, indent: 16, color: rgb(0.28, 0.35, 0.45), before: 4, after: 8, lineHeight: 15 });
    } else if (block.kind === "code") {
      await drawWrapped(text, { size: 9, indent: 10, color: rgb(0.15, 0.2, 0.28), before: 5, after: 9, lineHeight: 14 });
    } else {
      await drawWrapped(text, { size: 10.5, after: 8, lineHeight: 16 });
    }
  }

  for (let index = 0; index < pages.length; index += 1) {
    page = pages[index];
    await drawLine(`Molibot  |  ${index + 1} / ${pages.length}`, A4_WIDTH / 2 - 34, 26, 8, rgb(0.4, 0.46, 0.56));
  }
  return Buffer.from(await pdf.save());
}

function validateWorkbookInput(sheets: DocumentExportInput["sheets"]): asserts sheets is NonNullable<DocumentExportInput["sheets"]> {
  if (!Array.isArray(sheets) || sheets.length === 0) throw new Error("XLSX export requires at least one sheet.");
  if (sheets.length > MAX_SHEETS) throw new Error(`XLSX export supports at most ${MAX_SHEETS} sheets.`);
  const names = new Set<string>();
  let cells = 0;
  for (const sheet of sheets) {
    const name = String(sheet.name ?? "").trim();
    if (!name || name.length > 31 || /[\\/*?:\[\]]/.test(name)) throw new Error(`Invalid XLSX sheet name: ${name || "(empty)"}`);
    if (names.has(name)) throw new Error(`Duplicate XLSX sheet name: ${name}`);
    names.add(name);
    if (!Array.isArray(sheet.rows) || sheet.rows.length > MAX_ROWS_PER_SHEET) throw new Error(`Sheet ${name} exceeds ${MAX_ROWS_PER_SHEET} rows.`);
    for (const row of sheet.rows) {
      if (!Array.isArray(row) || row.length > MAX_COLUMNS) throw new Error(`Sheet ${name} exceeds ${MAX_COLUMNS} columns.`);
      cells += row.length;
    }
  }
  if (cells > MAX_WORKBOOK_CELLS) throw new Error(`XLSX export exceeds ${MAX_WORKBOOK_CELLS} cells.`);
}

async function buildXlsx(title: string, sheets: NonNullable<DocumentExportInput["sheets"]>): Promise<Buffer> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();
  workbook.Props = { Title: title, Author: "Molibot", CreatedDate: new Date() };
  for (const input of sheets) {
    const sheet = XLSX.utils.aoa_to_sheet(input.rows);
    const widthCount = Math.max(0, ...input.rows.map((row) => row.length));
    sheet["!cols"] = Array.from({ length: widthCount }, (_, column) => ({
      wch: Math.min(48, Math.max(10, ...input.rows.map((row) => String(row[column] ?? "").length + 2)))
    }));
    if (input.rows.length > 0 && widthCount > 0) {
      sheet["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: input.rows.length - 1, c: widthCount - 1 } }) };
    }
    XLSX.utils.book_append_sheet(workbook, sheet, input.name.trim());
  }
  return Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx", compression: true }));
}

async function verifyDocx(buffer: Buffer, title: string, blocks: DocumentBlock[]) {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  assertTextCoverage(result.value, expectedFragments(title, blocks), "DOCX");
  return { method: "re-read" as const, extractedCharacters: result.value.length };
}

async function verifyPdf(buffer: Buffer, title: string, blocks: DocumentBlock[]) {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: Uint8Array.from(buffer) });
  try {
    const result = await parser.getText();
    assertTextCoverage(result.text, expectedFragments(title, blocks), "PDF");
    return { method: "re-read" as const, extractedCharacters: result.text.length, pages: result.total };
  } finally {
    await parser.destroy();
  }
}

async function verifyXlsx(buffer: Buffer, sheets: NonNullable<DocumentExportInput["sheets"]>) {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false, cellFormula: true });
  const expectedNames = sheets.map((sheet) => sheet.name.trim());
  if (JSON.stringify(workbook.SheetNames) !== JSON.stringify(expectedNames)) throw new Error("XLSX verification failed: sheet names changed after re-read.");
  let checkedCells = 0;
  for (const expectedSheet of sheets) {
    const actualSheet = workbook.Sheets[expectedSheet.name.trim()];
    if (!actualSheet) throw new Error(`XLSX verification failed: missing sheet ${expectedSheet.name}.`);
    const actualRows = XLSX.utils.sheet_to_json<WorkbookScalar[]>(actualSheet, { header: 1, raw: true, defval: null });
    for (let row = 0; row < expectedSheet.rows.length; row += 1) {
      for (let column = 0; column < expectedSheet.rows[row].length; column += 1) {
        checkedCells += 1;
        const expected = expectedSheet.rows[row][column];
        const actual = actualRows[row]?.[column] ?? null;
        if (actual !== expected) throw new Error(`XLSX verification failed at ${expectedSheet.name}!${XLSX.utils.encode_cell({ r: row, c: column })}.`);
      }
    }
  }
  return { method: "re-read" as const, sheets: expectedNames, checkedCells };
}

function resolveOutput(input: DocumentExportInput, options: ExportOptions): { path: string; root: string; rootKind: "project" | "scratch"; relativePath: string } {
  const requestedPath = String(input.path ?? "").trim();
  if (!requestedPath) throw new Error("Document output path is required.");
  if (isAbsolute(requestedPath)) throw new Error("Document output path must be relative to the selected output root.");
  const expectedExtension = `.${input.format}`;
  if (extname(requestedPath).toLowerCase() !== expectedExtension) throw new Error(`${input.format.toUpperCase()} output path must end with ${expectedExtension}.`);
  const rootKind = input.target ?? (options.outputLayout?.projectRoot ? "project" : "scratch");
  if (rootKind === "project" && !options.outputLayout?.projectRoot) throw new Error("Project output is only available in a Project Session.");
  const root = rootKind === "project"
    ? options.outputLayout!.projectRoot!
    : options.outputLayout?.scratchRoot ?? resolve(options.cwd, options.artifactDir?.trim() || ".");
  const target = resolve(root, requestedPath);
  const rel = relative(root, target);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error("Document output path must stay inside the selected output root.");
  createPathGuard(options.cwd, options.workspaceDir)(target);
  return { path: target, root, rootKind, relativePath: rel.replaceAll("\\", "/") };
}

export async function runDocumentExport(input: DocumentExportInput, options: ExportOptions): Promise<DocumentExportResult> {
  const format = input.format;
  if (format !== "docx" && format !== "xlsx" && format !== "pdf") throw new Error("documentExport supports DOCX, XLSX, and PDF only.");
  const output = resolveOutput(input, options);
  const title = String(input.title ?? basename(input.path, extname(input.path))).trim() || "Untitled document";
  let bytes: Buffer;
  let verification: DocumentExportDetails["verification"];

  if (format === "xlsx") {
    validateWorkbookInput(input.sheets);
    bytes = await buildXlsx(title, input.sheets);
    verification = await verifyXlsx(bytes, input.sheets);
  } else {
    const content = String(input.content ?? "").trim();
    if (!content) throw new Error(`${format.toUpperCase()} export requires Markdown content.`);
    if (content.length > MAX_MARKDOWN_CHARS) throw new Error(`Document content exceeds ${MAX_MARKDOWN_CHARS} characters.`);
    const blocks = parseExportMarkdown(content);
    if (blocks.length === 0) throw new Error("Document content produced no renderable blocks.");
    bytes = format === "docx" ? await buildDocx(title, blocks) : await buildPdf(title, blocks);
    verification = format === "docx" ? await verifyDocx(bytes, title, blocks) : await verifyPdf(bytes, title, blocks);
  }

  await withFileMutationQueue(output.path, async () => {
    await fs.mkdir(dirname(output.path), { recursive: true });
    const tempPath = `${output.path}.tmp-${process.pid}-${Date.now()}`;
    try {
      await fs.writeFile(tempPath, bytes);
      const reread = await fs.readFile(tempPath);
      if (!reread.equals(bytes)) throw new Error("Generated document changed during filesystem re-read.");
      await fs.rename(tempPath, output.path);
    } finally {
      await fs.rm(tempPath, { force: true });
    }
  });

  if (input.attach !== false && options.uploadFile) {
    await options.uploadFile(output.path, title, `Generated and verified ${format.toUpperCase()}: ${title}`);
  }
  return {
    absolutePath: output.path,
    details: {
      requestedPath: input.path,
      relativePath: output.relativePath,
      rootKind: output.rootKind,
      action: "generated",
      sizeBytes: bytes.byteLength,
      format,
      verified: true,
      verification
    }
  };
}

export function createDocumentExportTool(options: ExportOptions): AgentTool<typeof documentExportSchema> {
  return {
    name: "documentExport",
    label: "documentExport",
    description: [
      "Generate a polished, deliverable DOCX, XLSX, or PDF inside the Project/scratch output root.",
      "DOCX/PDF accept Markdown content; XLSX accepts typed sheets/rows. PPTX is intentionally unsupported.",
      "Every output is reopened and content-verified before success is returned; a write alone never counts as completion.",
      "The verified file is attached to the active channel by default. Set attach=false only when the user wants it saved without sending."
    ].join("\n"),
    parameters: documentExportSchema,
    executionMode: "sequential",
    execute: async (_toolCallId, params, signal): Promise<AgentToolResult<DocumentExportDetails>> => {
      if (signal?.aborted) throw new Error("Aborted");
      const result = await runDocumentExport(params as DocumentExportInput, options);
      return {
        content: [{ type: "text", text: `Generated and re-read verified ${result.details.format.toUpperCase()}: ${result.absolutePath}` }],
        details: result.details
      };
    }
  };
}
