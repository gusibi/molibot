import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateAssertion, evaluateTask, resolveFilePattern } from "./lib/assertions.mjs";
import { loadTasks, validateTask } from "./lib/tasks.mjs";
import { baselineSurprises, summarize } from "./lib/report.mjs";
import { buildCompressedPdf, buildCsv, buildPdf, buildPng, PDF_SECRET } from "./fixtures/build-fixtures.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

function scratch() {
  const root = mkdtempSync(path.join(os.tmpdir(), "molibot-eval-test-"));
  const file = (relative, contents = "") => {
    const target = path.join(root, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents, "utf8");
    return target;
  };
  return { root, file };
}

// ---------------------------------------------------------------- task schema

/**
 * The one failure a scoreboard must never have: a typo in an assertion key
 * makes the task assert nothing and report a pass. Validation runs before any
 * model is called, so a bad golden file fails loudly and immediately.
 */
test("an unknown assertion kind is rejected rather than silently ignored", () => {
  assert.throws(
    () => validateTask({ id: "A1", title: "t", assert: [{ file_contain: "x" }] }, "t.yaml"),
    /unknown assertion "file_contain"/
  );
});

test("a task with no assertions is rejected", () => {
  assert.throws(
    () => validateTask({ id: "A1", title: "t", prompt: "hi", assert: [] }, "t.yaml"),
    /at least one assertion/
  );
});

test("an assertion carrying two kinds is rejected", () => {
  assert.throws(
    () => validateTask(
      { id: "A1", title: "t", prompt: "hi", assert: [{ reply_contains: "a", tool_used: "bash" }] },
      "t.yaml"
    ),
    /exactly one assertion kind/
  );
});

test("a malformed regular expression is caught at load time, not mid-run", () => {
  assert.throws(
    () => validateTask({ id: "A1", title: "t", prompt: "hi", assert: [{ reply_matches: "([" }] }, "t.yaml"),
    /not a valid regular expression/
  );
});

test("prompt and turns are mutually exclusive", () => {
  assert.throws(
    () => validateTask(
      { id: "A1", title: "t", prompt: "hi", turns: [{ prompt: "hi" }], assert: [{ reply_contains: "x" }] },
      "t.yaml"
    ),
    /either prompt or turns/
  );
});

test("auto_approve is explicit and boolean", () => {
  const task = validateTask({
    id: "H2",
    title: "approval",
    why: "exercise an approved install",
    prompt: "install it",
    auto_approve: true,
    assert: [{ tool_used: "miniAppManage" }]
  }, "t.yaml");
  assert.equal(task.autoApprove, true);
  assert.throws(
    () => validateTask({ id: "H2", title: "t", prompt: "x", auto_approve: "yes", assert: [{ tool_used: "x" }] }, "t.yaml"),
    /auto_approve must be a boolean/
  );
});

test("the shipped golden set loads, validates, and has unique ids", () => {
  const tasks = loadTasks(path.join(here, "golden"));
  assert.equal(tasks.length > 0, true);
  const ids = tasks.map((task) => task.id);
  assert.equal(new Set(ids).size, ids.length);
  // Every task states a prediction and a reason; those two columns are what
  // make the first run readable as a baseline rather than a wall of results.
  for (const task of tasks) {
    assert.equal(task.why.trim().length > 0, true, `${task.id} has no "why"`);
    assert.equal(["pass", "fail", "unknown"].includes(task.baseline), true);
  }
});

// ------------------------------------------------------------- file patterns

test("**/name finds a file at any depth, skipping dependency trees", () => {
  const { root, file } = scratch();
  try {
    file("moli-w/bots/momo/scratch/notes.md", "hello");
    file("node_modules/pkg/notes.md", "decoy");
    assert.deepEqual(
      resolveFilePattern(root, "**/notes.md").map((match) => path.relative(root, match)),
      [path.join("moli-w", "bots", "momo", "scratch", "notes.md")]
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a pattern may pin a parent directory and wildcard the filename", () => {
  const { root, file } = scratch();
  try {
    file("moli-w/bots/momo/events/evt-1.json", '{"type":"one-shot"}');
    file("moli-w/bots/momo/other/evt-2.json", '{"type":"periodic"}');
    const matches = resolveFilePattern(root, "**/events/*.json").map((m) => path.basename(m));
    assert.deepEqual(matches, ["evt-1.json"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * A task that writes several event files must pass when *any* of them carries
 * the expected content — checking only the first match on disk would make the
 * verdict depend on directory ordering.
 */
test("file_contains is satisfied by any matching file", async () => {
  const { root, file } = scratch();
  try {
    file("bots/a/events/one.json", '{"type":"periodic"}');
    file("bots/a/events/two.json", '{"type":"one-shot","text":"周报"}');
    const hit = await evaluateAssertion(
      { file_contains: { file: "**/events/*.json", text: "one-shot" } },
      { dataDir: root }
    );
    assert.equal(hit.ok, true);
    const miss = await evaluateAssertion(
      { file_contains: { file: "**/events/*.json", text: "immediate" } },
      { dataDir: root }
    );
    assert.equal(miss.ok, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- assertions

test("reply and tool assertions report what was missing", async () => {
  const outcome = { reply: "已经写好了 done", tools: ["write", "bash"], dataDir: os.tmpdir() };
  assert.equal((await evaluateAssertion({ reply_contains: "done" }, outcome)).ok, true);
  assert.equal((await evaluateAssertion({ reply_contains: ["done", "nope"] }, outcome)).ok, false);
  assert.equal((await evaluateAssertion({ reply_contains_any: ["nope", "done"] }, outcome)).ok, true);
  assert.equal((await evaluateAssertion({ tool_used: ["write", "edit"] }, outcome)).ok, false);
  assert.equal((await evaluateAssertion({ tool_not_used: ["imageGenerate"] }, outcome)).ok, true);
  const missing = await evaluateAssertion({ tool_used: "edit" }, outcome);
  assert.match(missing.detail, /never called: edit/);
});

/** The pitfall-19 guard in F4 has to catch invocation syntax in prose. */
test("reply_not_matches catches a tool call written out as text", async () => {
  const assertion = { reply_not_matches: "miniapp__|<function|<invoke|tool_call|<" };
  const clean = await evaluateAssertion(assertion, { reply: "已经记好了，20 元餐饮。", dataDir: os.tmpdir() });
  assert.equal(clean.ok, true);
  const leaked = await evaluateAssertion(assertion, {
    reply: "run tool miniapp__expense-tracker__add with amount 20",
    dataDir: os.tmpdir()
  });
  assert.equal(leaked.ok, false);
});

/**
 * Without a judge model a `judge` assertion is unproven, never green. A harness
 * that quietly passed it would inflate the headline number in exactly the cases
 * where it is least certain.
 */
test("a judge assertion without a judge model is unproven, not passed", async () => {
  const check = await evaluateAssertion({ judge: { rubric: "是否礼貌" } }, { reply: "hi", dataDir: os.tmpdir() });
  assert.equal(check.ok, null);
  const task = { assertions: [{ reply_contains: "hi" }, { judge: { rubric: "是否礼貌" } }] };
  const evaluated = await evaluateTask(task, { reply: "hi", tools: [], dataDir: os.tmpdir() });
  assert.equal(evaluated.status, "unproven");
});

test("one failing check outranks an unproven one", async () => {
  const task = { assertions: [{ reply_contains: "nope" }, { judge: { rubric: "x" } }] };
  const evaluated = await evaluateTask(task, { reply: "hi", tools: [], dataDir: os.tmpdir() });
  assert.equal(evaluated.status, "fail");
});

// -------------------------------------------------------------------- report

test("the score counts only tasks that ran, and surprises are flagged both ways", () => {
  const results = [
    { id: "A1", group: "A", baseline: "pass", status: "pass" },
    { id: "A2", group: "A", baseline: "pass", status: "fail" },
    { id: "B1", group: "B", baseline: "fail", status: "pass" },
    { id: "B2", group: "B", baseline: "fail", status: "fail" },
    { id: "H1", group: "H", baseline: "unknown", status: "unproven" },
    { id: "H2", group: "H", baseline: "unknown", status: "skipped" }
  ];
  const { totals, scored, score } = summarize(results);
  assert.equal(scored, 5, "a skipped task is not part of the denominator");
  assert.equal(totals.pass, 2);
  assert.equal(Number(score.toFixed(2)), 0.4);

  const surprises = baselineSurprises(results).map((result) => result.id);
  // A2 regressed; B1 improved. Both are news; B2 and the unknowns are not.
  assert.deepEqual(surprises, ["A2", "B1"]);
});

// ------------------------------------------------------------------ fixtures

test("the generated PDF is a parseable document carrying the secret", () => {
  const pdf = buildPdf().toString("latin1");
  assert.equal(pdf.startsWith("%PDF-1.4"), true);
  assert.equal(pdf.includes(PDF_SECRET), true);
  assert.equal(pdf.trimEnd().endsWith("%%EOF"), true);
  // The xref offsets must point at the real object headers, or every extractor
  // rejects the file and B2 fails for a reason that has nothing to do with the
  // Agent.
  const startxref = Number(pdf.slice(pdf.lastIndexOf("startxref") + 9).trim().split("\n")[0]);
  assert.equal(pdf.slice(startxref, startxref + 4), "xref");
  const firstOffset = Number(pdf.slice(startxref).match(/\n(\d{10}) 00000 n/)[1]);
  assert.equal(pdf.slice(firstOffset).startsWith("1 0 obj"), true);
});

test("the compressed PDF fixture hides the secret inside a valid FlateDecode stream", () => {
  const bytes = buildCompressedPdf();
  const pdf = bytes.toString("latin1");
  assert.equal(pdf.startsWith("%PDF-1.4"), true);
  assert.equal(pdf.includes("/Filter /FlateDecode"), true);
  assert.equal(pdf.includes(PDF_SECRET), false, "the raw PDF must not expose the answer to grep/read");
  const startxref = Number(pdf.slice(pdf.lastIndexOf("startxref") + 9).trim().split("\n")[0]);
  assert.equal(pdf.slice(startxref, startxref + 4), "xref");
});

test("the generated PNG is a valid truecolour image", () => {
  const png = buildPng({ width: 4, height: 4 });
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(png.subarray(12, 16).toString("ascii"), "IHDR");
  assert.equal(png.readUInt32BE(16), 4);
  assert.equal(png.subarray(png.length - 8, png.length - 4).toString("ascii"), "IEND");
});

test("the CSV fixture has exactly one largest row", () => {
  const rows = buildCsv().toString("utf8").trim().split("\n").slice(1);
  const amounts = rows.map((row) => Number(row.split(",")[2]));
  const largest = Math.max(...amounts);
  assert.equal(amounts.filter((amount) => amount === largest).length, 1);
  assert.equal(rows.find((row) => Number(row.split(",")[2]) === largest).includes("Bookstore"), true);
});
