import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import * as XLSX from "xlsx";
import { buildCompressedPdf, PDF_SECRET } from "../../../../../evals/fixtures/build-fixtures.mjs";
import { defaultRuntimeSettings } from "$lib/server/settings/index.js";
import { DEFAULT_MAX_BYTES } from "$lib/server/agent/tools/truncate.js";
import { createDocExtractTool, runDocExtract } from "./docExtract.js";

function zipStored(entries: Array<[string, string]>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, value] of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const data = Buffer.from(value, "utf8");
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, eocd]);
}

function buildDocx(text: string): Buffer {
  const escaped = text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return zipStored([
    ["[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`],
    ["_rels/.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`],
    ["word/_rels/document.xml.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`],
    ["word/document.xml", `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Weekly Report</w:t></w:r></w:p><w:p><w:r><w:t>${escaped}</w:t></w:r></w:p></w:body></w:document>`]
  ]);
}

function workspace(): string {
  return mkdtempSync(join(tmpdir(), "molibot-doc-extract-"));
}

function buildImageOnlyPdf(): Buffer {
  const image = deflateSync(Buffer.alloc(100 * 100, 0));
  const pageContent = Buffer.from("q 500 0 0 700 56 46 cm /Im0 Do Q\n", "latin1");
  const objects = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>", "latin1"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "latin1"),
    Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /XObject << /Im0 5 0 R >> >> >>", "latin1"),
    Buffer.concat([
      Buffer.from(`<< /Length ${pageContent.length} >>\nstream\n`, "latin1"),
      pageContent,
      Buffer.from("endstream", "latin1")
    ]),
    Buffer.concat([
      Buffer.from(`<< /Type /XObject /Subtype /Image /Width 100 /Height 100 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${image.length} >>\nstream\n`, "latin1"),
      image,
      Buffer.from("\nendstream", "latin1")
    ])
  ];
  const parts = [Buffer.from("%PDF-1.4\n", "latin1")];
  const offsets: number[] = [];
  let byteLength = parts[0].length;
  objects.forEach((body, index) => {
    const prefix = Buffer.from(`${index + 1} 0 obj\n`, "latin1");
    const suffix = Buffer.from("\nendobj\n", "latin1");
    offsets.push(byteLength);
    parts.push(prefix, body, suffix);
    byteLength += prefix.length + body.length + suffix.length;
  });
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) xref += `${String(offset).padStart(10, "0")} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${byteLength}\n%%EOF\n`;
  parts.push(Buffer.from(xref, "latin1"));
  return Buffer.concat(parts);
}

test("runDocExtract reads a FlateDecode PDF whose answer is not present in raw bytes", async () => {
  const cwd = workspace();
  try {
    const bytes = buildCompressedPdf();
    assert.equal(bytes.includes(Buffer.from(PDF_SECRET)), false);
    writeFileSync(join(cwd, "compressed.pdf"), bytes);
    const result = await runDocExtract({ path: "compressed.pdf" }, { cwd, workspaceDir: cwd });
    assert.match(result.text, new RegExp(PDF_SECRET));
    assert.equal(result.details.format, "pdf");
    assert.equal(result.details.metadata?.pages, 1);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("runDocExtract OCRs an image-only PDF through the shared configured vision capability", async () => {
  const cwd = workspace();
  try {
    writeFileSync(join(cwd, "scan.pdf"), buildImageOnlyPdf());
    const calls: any[] = [];
    const result = await runDocExtract({ path: "scan.pdf" }, {
      cwd,
      workspaceDir: cwd,
      channel: "test",
      getSettings: () => defaultRuntimeSettings,
      recognizeImage: async (options) => {
        calls.push(options);
        return {
          text: "Invoice A-42\n\nTotal: $19.90",
          engineId: "ocr-primary",
          providerId: "vision-provider",
          modelId: "vision-model",
          attempts: [],
          warnings: []
        };
      }
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].image.mimeType, "image/png");
    assert.match(calls[0].prompt, /Transcribe all visible text/);
    assert.match(result.text, /Invoice A-42/);
    assert.deepEqual(result.details.metadata?.ocrPages, [1]);
    assert.equal(result.details.metadata?.ocrModelId, "vision-model");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("runDocExtract can disable OCR for image-only PDFs without calling a model", async () => {
  const cwd = workspace();
  try {
    writeFileSync(join(cwd, "scan.pdf"), buildImageOnlyPdf());
    let called = false;
    await assert.rejects(
      runDocExtract({ path: "scan.pdf", ocr: "never" }, {
        cwd,
        workspaceDir: cwd,
        recognizeImage: async () => {
          called = true;
          return { text: "must not run", engineId: "unused", attempts: [], warnings: [] };
        }
      }),
      /No extractable text/
    );
    assert.equal(called, false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("runDocExtract converts DOCX semantic content to Markdown without external file access", async () => {
  const cwd = workspace();
  try {
    writeFileSync(join(cwd, "report.docx"), buildDocx("Revenue reached 42."));
    const result = await runDocExtract({ path: "report.docx" }, { cwd, workspaceDir: cwd });
    assert.match(result.text, /^# Weekly Report/);
    assert.match(result.text, /Revenue reached 42\./);
    assert.equal(result.details.format, "docx");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("runDocExtract renders every XLSX sheet as readable CSV sections", async () => {
  const cwd = workspace();
  try {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ["vendor", "amount"], ["Bookstore", 247.9]
    ]), "Expenses");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["status"], ["approved"]]), "Review");
    writeFileSync(join(cwd, "invoice.xlsx"), XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
    const result = await runDocExtract({ path: "invoice.xlsx" }, { cwd, workspaceDir: cwd });
    assert.match(result.text, /# Sheet: Expenses\n\nvendor,amount\nBookstore,247\.9/);
    assert.match(result.text, /# Sheet: Review\n\nstatus\napproved/);
    assert.deepEqual(result.details.metadata?.sheets, ["Expenses", "Review"]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("runDocExtract uses the shared UTF-8-safe cap and spills the full extraction", async () => {
  const cwd = workspace();
  try {
    const original = "界".repeat(DEFAULT_MAX_BYTES);
    writeFileSync(join(cwd, "large.docx"), buildDocx(original));
    const result = await runDocExtract({ path: "large.docx" }, { cwd, workspaceDir: cwd, spillDir: join(cwd, "spill") });
    assert.equal(result.details.truncated, true);
    assert.ok(Buffer.byteLength(result.text) <= DEFAULT_MAX_BYTES);
    assert.doesNotMatch(result.text, /�/);
    assert.ok(result.details.fullOutputPath && existsSync(result.details.fullOutputPath));
    assert.match(readFileSync(result.details.fullOutputPath!, "utf8"), /界界界/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("runDocExtract rejects an Office archive that declares zip-bomb expansion", async () => {
  const cwd = workspace();
  try {
    const bomb = Buffer.from(buildDocx("tiny"));
    const localHeader = bomb.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    const centralHeader = bomb.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    assert.ok(localHeader >= 0 && centralHeader >= 0);
    bomb.writeUInt16LE(8, localHeader + 8);
    bomb.writeUInt32LE(300 * 1024 * 1024, localHeader + 22);
    bomb.writeUInt16LE(8, centralHeader + 10);
    bomb.writeUInt32LE(300 * 1024 * 1024, centralHeader + 24);
    writeFileSync(join(cwd, "bomb.docx"), bomb);
    await assert.rejects(
      runDocExtract({ path: "bomb.docx" }, { cwd, workspaceDir: cwd }),
      /expands beyond 256\.0MB/
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("runDocExtract rejects unsupported types and paths outside the workspace", async () => {
  const cwd = workspace();
  const outside = join(tmpdir(), `molibot-doc-outside-${Date.now()}.pdf`);
  try {
    writeFileSync(join(cwd, "plain.txt"), "hello");
    writeFileSync(outside, buildCompressedPdf());
    symlinkSync(outside, join(cwd, "linked.pdf"));
    await assert.rejects(runDocExtract({ path: "plain.txt" }, { cwd, workspaceDir: cwd }), /supports PDF, DOCX, and XLSX/);
    await assert.rejects(runDocExtract({ path: "../outside.pdf" }, { cwd, workspaceDir: cwd }), /outside allowed workspace roots/);
    await assert.rejects(runDocExtract({ path: "linked.pdf" }, { cwd, workspaceDir: cwd }), /outside allowed workspace roots/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(outside, { force: true });
  }
});

test("createDocExtractTool exposes a deferred-friendly read-only document contract", () => {
  const tool = createDocExtractTool({
    channel: "test",
    cwd: "/tmp",
    workspaceDir: "/tmp",
    getSettings: () => defaultRuntimeSettings
  });
  assert.equal(tool.name, "docExtract");
  assert.equal(tool.executionMode, "sequential");
  assert.match(tool.description, /PDF, DOCX, or XLSX/);
  assert.match(tool.description, /untrusted data/);
  assert.doesNotMatch(JSON.stringify(tool.parameters), /modelKey|providerId/);
});
