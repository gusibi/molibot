import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { parseSpreadsheet } from "./spreadsheet";

test("parseSpreadsheet exposes every sheet as a read-only table", async () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Name", "Status"],
      ["Ada", "Done"],
      ["Ada", "Done"]
    ]),
    "Overview"
  );
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Only header"]]), "Empty");

  const bytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  const parsed = await parseSpreadsheet(bytes);

  assert.deepEqual(parsed.sheets.map((sheet) => sheet.name), ["Overview", "Empty"]);
  assert.deepEqual(parsed.sheets[0]?.headers, ["Name", "Status"]);
  assert.deepEqual(parsed.sheets[0]?.rows, [["Ada", "Done"], ["Ada", "Done"]]);
  assert.deepEqual(parsed.sheets[1]?.headers, ["Only header"]);
  assert.deepEqual(parsed.sheets[1]?.rows, []);
});

test("parseSpreadsheet keeps a bounded workbook and reports truncation", async () => {
  const workbook = XLSX.utils.book_new();
  const rows = [["value"], ...Array.from({ length: 5_010 }, (_, index) => [`row-${index}`])];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Rows");

  const bytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  const parsed = await parseSpreadsheet(bytes);
  const sheet = parsed.sheets[0];

  assert.ok(sheet);
  assert.equal(sheet.rows.length, 5_000);
  assert.equal(sheet.truncated, true);
});

test("parseSpreadsheet does not flag a sheet that ends at the render budget", async () => {
  const workbook = XLSX.utils.book_new();
  const rows = [["value"], ...Array.from({ length: 5_000 }, (_, index) => [`row-${index}`])];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Rows");

  const bytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  const parsed = await parseSpreadsheet(bytes);

  assert.equal(parsed.sheets[0]?.rows.length, 5_000);
  assert.equal(parsed.sheets[0]?.truncated, false);
});
