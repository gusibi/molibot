import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runDocumentExport } from "$lib/server/agent/tools/documentExport.js";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "molibot-document-export-"));
  return {
    root,
    options: {
      cwd: root,
      workspaceDir: root,
      artifactDir: "artifacts",
      outputLayout: { scratchRoot: join(root, "artifacts") }
    }
  };
}

test("DOCX export is re-read and verified before success", async () => {
  const fx = fixture();
  try {
    const result = await runDocumentExport({
      format: "docx",
      path: "quarterly-report.docx",
      title: "季度报告",
      content: "# 摘要\n\n本季度完成三个关键目标。\n\n- 稳定运行\n- 正式交付"
    }, fx.options);
    assert.equal(result.details.verified, true);
    assert.equal(result.details.format, "docx");
    assert.ok(result.details.verification.extractedCharacters > 10);
    assert.ok(readFileSync(result.absolutePath).byteLength > 1_000);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("XLSX export preserves typed cells and verifies every sheet", async () => {
  const fx = fixture();
  try {
    const result = await runDocumentExport({
      format: "xlsx",
      path: "summary.xlsx",
      title: "项目汇总",
      sheets: [
        { name: "汇总", rows: [["项目", "完成率", "通过"], ["Agent", 0.95, true]] },
        { name: "明细", rows: [["编号", "说明"], [1, "重启恢复"]] }
      ]
    }, fx.options);
    assert.deepEqual(result.details.verification.sheets, ["汇总", "明细"]);
    assert.equal(result.details.verification.checkedCells, 10);
    assert.equal(result.details.verified, true);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("PDF export embeds CJK glyphs and is re-read after generation", async () => {
  const fx = fixture();
  try {
    const result = await runDocumentExport({
      format: "pdf",
      path: "contract-summary.pdf",
      title: "合同摘要",
      content: "# 服务范围\n\n甲方与乙方确认：交付文件必须经过重新读取验证。\n\n| 项目 | 状态 |\n| --- | --- |\n| 报告 | 完成 |"
    }, fx.options);
    assert.equal(result.details.verified, true);
    assert.ok(result.details.verification.pages >= 1);
    assert.ok(result.details.verification.extractedCharacters > 10);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("export rejects mismatched extensions and paths outside the output root", async () => {
  const fx = fixture();
  try {
    await assert.rejects(() => runDocumentExport({
      format: "pdf",
      path: "wrong.docx",
      content: "hello"
    }, fx.options), /must end with \.pdf/);
    await assert.rejects(() => runDocumentExport({
      format: "docx",
      path: "../escape.docx",
      content: "hello"
    }, fx.options), /inside the selected output root/);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});
