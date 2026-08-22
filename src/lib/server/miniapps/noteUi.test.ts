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

test("Note tags live inside tab-picker dropdown and do not occupy main list view", () => {
  const note = getBuiltinMiniApp("note");
  assert.ok(note);
  const html = note.files["ui/index.html"] ?? "";
  const script = note.files["ui/app.js"] ?? "";

  // Main UI should not have a persistent tag filter bar
  assert.doesNotMatch(html, /<div class="tag-filter-bar"/);
  
  // Tab picker should have tags header & list container
  assert.match(html, /id="tp-tags-header"/);
  assert.match(html, /id="tp-tags-list"/);
  assert.match(html, /id="tp-tags-divider"/);

  // Script renders tag menu inside tpTagsList
  assert.match(script, /function renderTagMenu/);
  assert.match(script, /tpTagsList/);
});

test("Note editor modal supports Markdown preview toggle and view container", () => {
  const note = getBuiltinMiniApp("note");
  assert.ok(note);
  const html = note.files["ui/index.html"] ?? "";
  const script = note.files["ui/app.js"] ?? "";
  const style = note.files["ui/styles.css"] ?? "";

  // Header has preview button with eye and edit icons
  assert.match(html, /id="modal-preview-btn"/);
  assert.match(html, /class="preview-icon"/);
  assert.match(html, /class="edit-icon/);

  // Body has edit fields container and preview view container
  assert.match(html, /id="editor-edit-fields"/);
  assert.match(html, /id="editor-preview-view"/);
  assert.match(html, /id="preview-title"/);
  assert.match(html, /id="preview-content"/);

  // Script has preview toggle handlers and i18n
  assert.match(script, /function updatePreviewContent/);
  assert.match(script, /function setPreviewMode/);
  assert.match(script, /previewMarkdown/);
  assert.match(script, /previewNote/);

  // Style has preview rules and avoids line-clamp truncation
  assert.match(style, /\.editor-preview-toggle/);
  assert.match(style, /\.editor-preview-view/);
  assert.match(style, /\.editor-preview-title/);
  assert.match(style, /\.editor-preview-content/);
  assert.match(style, /\.note-card \.card-content/);
});

