import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { getBuiltinMiniApp } from "$lib/server/miniapps/bootstrap.js";
import { materializeBuiltinMiniApp } from "$lib/server/miniapps/builtinPackage.js";

test("Note polls the host revision so Agent writes refresh an already-open panel", () => {
  const note = getBuiltinMiniApp("note");
  assert.ok(note);
  const script = note.files["ui/app.js"] ?? "";

  assert.match(script, /const POLL_INTERVAL_MS = 2000;/);
  assert.match(script, /api\("\/_host\/state"\)/);
  assert.match(script, /if \(revision !== lastRevision\)/);
  assert.match(script, /setInterval\(\(\) => void poll\(\), POLL_INTERVAL_MS\)/);
  assert.match(script, /if \(halted \|\| document\.hidden \|\| polling\) return;/);

  const pollRefresh = script.match(/if \(revision !== lastRevision\) \{([\s\S]*?)\n    \}/)?.[1] ?? "";
  assert.ok(
    pollRefresh.indexOf("await loadNotes()") < pollRefresh.indexOf("lastRevision = revision"),
    "the revision must only be committed after the refreshed notes load successfully"
  );

  const start = script.match(/async function start\(\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.ok(
    start.indexOf("lastRevision = await currentRevision()") < start.indexOf("await loadNotes()"),
    "startup must snapshot the revision before loading notes so concurrent Agent writes are not missed"
  );
});

test("Note renders useful Markdown while keeping raw HTML and unsafe links inert", async () => {
  const note = getBuiltinMiniApp("note");
  assert.ok(note);
  const root = mkdtempSync(join(tmpdir(), "molibot-note-ui-"));
  materializeBuiltinMiniApp(root, note);
  const moduleUrl = pathToFileURL(join(root, "note", "ui", "markdown.js")).href;
  const { renderMarkdown } = await import(`${moduleUrl}?test=${Date.now()}`) as {
    renderMarkdown(source: string): string;
  };

  const rendered = renderMarkdown([
    "## Release notes",
    "",
    "- **Fixed** refresh",
    "- [Docs](https://example.com/docs)",
    "",
    "| Item | State |",
    "| --- | --- |",
    "| Note | Live |",
    "",
    "<img src=x onerror=alert(1)>",
    "[bad](javascript:alert(1))"
  ].join("\n"));

  assert.match(rendered, /<h2>Release notes<\/h2>/);
  assert.match(rendered, /<strong>Fixed<\/strong>/);
  assert.match(rendered, /<table>/);
  assert.match(rendered, /href="https:\/\/example\.com\/docs"/);
  assert.doesNotMatch(rendered, /<img/i);
  assert.doesNotMatch(rendered, /onerror/i);
  assert.doesNotMatch(rendered, /href="javascript:/i);
});
