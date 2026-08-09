#!/usr/bin/env node
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Generates the binary attachments the ingestion tasks upload.
 *
 * They are built rather than committed for one reason: an eval fixture whose
 * contents nobody can read is a fixture nobody can reason about when the task
 * fails. Each file here is produced by ~20 lines of visible code, so "what is
 * the Agent supposed to see" is answerable from the repository.
 */

const here = path.dirname(fileURLToPath(import.meta.url));

/** The string the PDF task looks for in the reply. */
export const PDF_SECRET = "MOLIBOT-EVAL-7391";
/** The colour the image task looks for. */
export const IMAGE_COLOR = { r: 220, g: 20, b: 60, name: "红" };

/**
 * A minimal uncompressed PDF 1.4. Text is a single Tj in a content stream, so
 * any real extractor (pdftotext, a PDF library, a vision model) reaches it,
 * while a naive `read` sees binary — which is exactly the distinction B2 tests.
 */
export function buildPdf(secret = PDF_SECRET) {
  const content = `BT /F1 24 Tf 72 700 Td (${secret}) Tj ET\n`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}endstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

/**
 * A PDF whose page content is a real FlateDecode stream. The answer is absent
 * from the raw file bytes, so passing this fixture proves that a PDF parser
 * decompressed and interpreted the stream rather than grepping the attachment.
 */
export function buildCompressedPdf(secret = PDF_SECRET) {
  const compressed = deflateSync(Buffer.from(`BT /F1 24 Tf 72 700 Td (${secret}) Tj ET\n`, "latin1"));
  const objects = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>", "latin1"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "latin1"),
    Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>", "latin1"),
    Buffer.concat([
      Buffer.from(`<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`, "latin1"),
      compressed,
      Buffer.from("\nendstream", "latin1")
    ]),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", "latin1")
  ];
  const parts = [Buffer.from("%PDF-1.4\n", "latin1")];
  const offsets = [];
  let byteLength = parts[0].length;
  objects.forEach((body, index) => {
    const prefix = Buffer.from(`${index + 1} 0 obj\n`, "latin1");
    const suffix = Buffer.from("\nendobj\n", "latin1");
    offsets.push(byteLength);
    parts.push(prefix, body, suffix);
    byteLength += prefix.length + body.length + suffix.length;
  });
  const xrefOffset = byteLength;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) xref += `${String(offset).padStart(10, "0")} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  parts.push(Buffer.from(xref, "latin1"));
  return Buffer.concat(parts);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

/** A solid-colour PNG: unambiguous ground truth, and it contains no people. */
export function buildPng({ width = 64, height = 64, color = IMAGE_COLOR } = {}) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolour
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (1 + width * 3);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      const pixel = rowStart + 1 + x * 3;
      raw[pixel] = color.r;
      raw[pixel + 1] = color.g;
      raw[pixel + 2] = color.b;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

/** One row is unmistakably the largest, so the answer is a single number. */
export const CSV_ROWS = [
  ["date", "vendor", "amount"],
  ["2026-08-01", "Cafe Loop", "38.50"],
  ["2026-08-02", "Metro Card", "100.00"],
  ["2026-08-03", "Bookstore", "247.90"],
  ["2026-08-04", "Lunch", "62.00"]
];
export const CSV_MAX_VENDOR = "Bookstore";
export const CSV_MAX_AMOUNT = "247.90";

export function buildCsv() {
  return Buffer.from(CSV_ROWS.map((row) => row.join(",")).join("\n") + "\n", "utf8");
}

export function buildFixtures(targetDir = here) {
  mkdirSync(targetDir, { recursive: true });
  const written = [
    ["eval-document.pdf", buildPdf()],
    ["eval-compressed-document.pdf", buildCompressedPdf()],
    ["eval-image.png", buildPng()],
    ["eval-expenses.csv", buildCsv()]
  ];
  for (const [name, bytes] of written) {
    writeFileSync(path.join(targetDir, name), bytes);
  }
  return written.map(([name]) => path.join(targetDir, name));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const file of buildFixtures()) console.log(`wrote ${file}`);
}
