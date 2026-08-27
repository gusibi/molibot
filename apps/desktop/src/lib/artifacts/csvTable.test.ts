import test from "node:test";
import assert from "node:assert/strict";
import { parseCsv, sortCsvRows, CSV_MAX_ROWS } from "./csvTable";

test("a simple comma-separated table uses the first row as headers", () => {
  const result = parseCsv("name,age\nAda,36\nAlan,41\n");
  assert.deepEqual(result.headers, ["name", "age"]);
  assert.deepEqual(result.rows, [["Ada", "36"], ["Alan", "41"]]);
  assert.equal(result.truncated, false);
});

test("quoted fields preserve commas, quotes and newlines", () => {
  const result = parseCsv('a,b\n"has,comma","line1\nline2"\n"quote""mark",x\n');
  assert.deepEqual(result.headers, ["a", "b"]);
  assert.deepEqual(result.rows[0], ["has,comma", "line1\nline2"]);
  assert.deepEqual(result.rows[1], ['quote"mark', "x"]);
});

test("a tab-separated file is detected and split on tabs", () => {
  const result = parseCsv("col1\tcol2\nv1\tv2\n");
  assert.deepEqual(result.headers, ["col1", "col2"]);
  assert.deepEqual(result.rows, [["v1", "v2"]]);
});

test("CRLF, CR and LF line endings all terminate a record once", () => {
  assert.deepEqual(parseCsv("a,b\r\nc,d").rows, [["c", "d"]]);
  assert.deepEqual(parseCsv("a,b\rc,d").rows, [["c", "d"]]);
  assert.deepEqual(parseCsv("a,b\nc,d").rows, [["c", "d"]]);
});

test("CJK cell content is preserved without width estimation", () => {
  // Pitfall #8: CJK must not be collapsed or half-counted.
  const result = parseCsv("项目,状态\n数据库迁移,已完成\n");
  assert.deepEqual(result.headers, ["项目", "状态"]);
  assert.deepEqual(result.rows[0], ["数据库迁移", "已完成"]);
});

test("quoted CJK CSV from a Markdown table stays readable in the table viewer", () => {
  // `markdownInteractions` serializes HTML table cells as quoted CSV. Keep
  // this exact shape covered because it is the chat preview's hand-off format.
  const result = parseCsv('"姓名","状态"\n"张三","完成"\n"李四","进行中"');
  assert.deepEqual(result.headers, ["姓名", "状态"]);
  assert.deepEqual(result.rows, [["张三", "完成"], ["李四", "进行中"]]);
});

test("a BOM at the start of the file is stripped from the first header", () => {
  const result = parseCsv("﻿name,value\nAda,1\n");
  assert.deepEqual(result.headers, ["name", "value"]);
});

test("a file with more than the cap is truncated and flagged", () => {
  const lines = ["h1,h2"];
  for (let i = 0; i < CSV_MAX_ROWS + 50; i += 1) lines.push(`r${i},${i}`);
  const result = parseCsv(lines.join("\n"));
  assert.equal(result.truncated, true);
  // Headers + cap rows kept.
  assert.equal(result.rows.length, CSV_MAX_ROWS);
});

test("an unterminated quoted field throws so the viewer falls back to source", () => {
  assert.throws(() => parseCsv('a,b\n"unterminated,row\n'));
});

test("an empty input parses to an empty table", () => {
  const result = parseCsv("");
  assert.deepEqual(result.headers, []);
  assert.deepEqual(result.rows, []);
  assert.equal(result.truncated, false);
});

test("percent and thousands-separated cells sort numerically, not lexically", () => {
  const rows = [["75%"], ["100%"], ["0%"], ["1,200"], ["900"]];
  assert.deepEqual(sortCsvRows(rows, 0, 1).map((row) => row[0]), ["0%", "75%", "100%", "900", "1,200"]);
  assert.deepEqual(sortCsvRows(rows, 0, -1).map((row) => row[0]), ["1,200", "900", "100%", "75%", "0%"]);
});

test("CJK cells sort by locale collation, not code points", () => {
  const rows = [["进行中"], ["已完成"], ["未开始"]];
  const sorted = sortCsvRows(rows, 0, 1).map((row) => row[0]);
  assert.equal(sorted.length, 3);
  assert.notDeepEqual(sorted, rows.map((row) => row[0]));
  // Ascending and descending are exact mirrors of one another.
  assert.deepEqual(sortCsvRows(rows, 0, -1).map((row) => row[0]), [...sorted].reverse());
});

test("mixed numeric and text cells fall back to string comparison", () => {
  const rows = [["P0"], ["P1"], ["P10"], ["P2"]];
  assert.deepEqual(sortCsvRows(rows, 0, 1).map((row) => row[0]), ["P0", "P1", "P2", "P10"]);
});

test("rows shorter than the sort column sort as empty cells", () => {
  const rows = [["b", "1"], ["a"], ["c", "2"]];
  assert.deepEqual(sortCsvRows(rows, 1, 1), [["a"], ["b", "1"], ["c", "2"]]);
});

test("sorting returns a new array and never mutates the parsed rows", () => {
  const rows = [["2"], ["1"]];
  const sorted = sortCsvRows(rows, 0, 1);
  assert.deepEqual(sorted, [["1"], ["2"]]);
  assert.deepEqual(rows, [["2"], ["1"]]);
});
