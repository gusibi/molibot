import test from "node:test";
import assert from "node:assert/strict";
import {
  matchViewer,
  isInlineViewer,
  needsTextContent,
  hasSourceToggle,
  type ArtifactMeta
} from "./viewerRegistry";

function meta(name: string, overrides: Partial<ArtifactMeta> = {}): ArtifactMeta {
  return { name, scope: "project", ...overrides };
}

test("image / audio / video / pdf map to the media viewer", () => {
  assert.equal(matchViewer(meta("photo.png")), "media");
  assert.equal(matchViewer(meta("song.mp3")), "media");
  assert.equal(matchViewer(meta("clip.mp4")), "media");
  assert.equal(matchViewer(meta("doc.pdf")), "media");
});

test("svg gets its own viewer so the source stays one toggle away", () => {
  // Ahead of the media check: SVG's MIME is `image/svg+xml`, so a plain media
  // dispatch would render it with no way back to the markup.
  assert.equal(matchViewer(meta("logo.svg")), "svg");
  assert.equal(matchViewer(meta("logo.svg", { mimeType: "image/svg+xml" })), "svg");
  assert.equal(matchViewer(meta("logo.svg", { mimeType: "" })), "svg");
});

test("markdown and json get structured viewers, other text stays source", () => {
  assert.equal(matchViewer(meta("readme.md")), "markdown");
  assert.equal(matchViewer(meta("readme.markdown")), "markdown");
  assert.equal(matchViewer(meta("data.json")), "json");
  assert.equal(matchViewer(meta("app.ts")), "code");
  assert.equal(matchViewer(meta("style.css")), "code");
  assert.equal(matchViewer(meta("notes.txt")), "code");
  assert.equal(matchViewer(meta("config.yaml")), "code");
});

test("a declared markdown/json MIME reaches its viewer without a matching extension", () => {
  assert.equal(matchViewer(meta("notes", { mimeType: "text/markdown" })), "markdown");
  assert.equal(matchViewer(meta("payload", { mimeType: "application/json" })), "json");
});

test("CSV and TSV map to the table viewer", () => {
  assert.equal(matchViewer(meta("rows.csv")), "csv");
  assert.equal(matchViewer(meta("rows.tsv")), "csv");
  assert.equal(matchViewer(meta("rows.csv", { mimeType: "text/csv" })), "csv");
});

test("HTML maps to the sandboxed preview viewer, not source", () => {
  assert.equal(matchViewer(meta("page.html")), "html");
  assert.equal(matchViewer(meta("page.htm")), "html");
  assert.equal(matchViewer(meta("page.xhtml")), "html");
  // An empty declared MIME does not downgrade an HTML file to source.
  assert.equal(matchViewer(meta("page.html", { mimeType: "" })), "html");
});

test("office and unrecognized binary formats fall through to the system card", () => {
  assert.equal(matchViewer(meta("report.docx")), "system");
  assert.equal(matchViewer(meta("sheet.xlsx")), "system");
  assert.equal(matchViewer(meta("deck.pptx")), "system");
  assert.equal(matchViewer(meta("blob.unknownext")), "system");
});

test("text dotfiles such as .gitignore open as code, not the system card (issue #31 bug 3)", () => {
  // extensionOf treats the whole filename as the extension (`.gitignore` ->
  // ext `.gitignore`), so without shared text-dotfile recognition these fell
  // through to "binary" -> "system" and the panel showed no contents.
  assert.equal(matchViewer(meta(".gitignore")), "code");
  assert.equal(matchViewer(meta(".gitattributes")), "code");
  assert.equal(matchViewer(meta(".dockerignore")), "code");
  assert.equal(matchViewer(meta(".editorconfig")), "code");
  assert.equal(matchViewer(meta(".npmrc")), "code");
  // A binary dotfile still gets the system card.
  assert.equal(matchViewer(meta(".DS_Store")), "system");
});

test("empty declared MIME falls back to the extension, not to a plain file", () => {
  // Pitfall #26e: the WebView hands over an empty File.type for drag-and-drop
  // and unknown formats. A screenshot must still reach the media viewer.
  assert.equal(matchViewer(meta("screenshot.png", { mimeType: "" })), "media");
  assert.equal(matchViewer(meta("screenshot.png", { mimeType: "application/octet-stream" })), "media");
  assert.equal(matchViewer(meta("voice.m4a", { mimeType: "" })), "media");
  assert.equal(matchViewer(meta("clip.mov", { mimeType: "" })), "media");
});

test("declared MIME wins over a misleading extension", () => {
  assert.equal(matchViewer(meta("data.bin", { mimeType: "image/png" })), "media");
  assert.equal(matchViewer(meta("payload.dat", { mimeType: "application/pdf" })), "media");
  assert.equal(matchViewer(meta("payload.dat", { mimeType: "text/csv" })), "csv");
});

test("project and session scopes dispatch identically", () => {
  // The scope only affects the action bar / @-reference target, never the viewer.
  for (const name of ["photo.png", "app.ts", "doc.pdf", "report.docx", "logo.svg"]) {
    assert.equal(
      matchViewer(meta(name, { scope: "project" })),
      matchViewer(meta(name, { scope: "session" })),
      `${name} should dispatch the same viewer in both scopes`
    );
  }
});

test("isInlineViewer flags everything except the system card", () => {
  assert.equal(isInlineViewer("code"), true);
  assert.equal(isInlineViewer("media"), true);
  assert.equal(isInlineViewer("markdown"), true);
  assert.equal(isInlineViewer("json"), true);
  assert.equal(isInlineViewer("svg"), true);
  assert.equal(isInlineViewer("system"), false);
});

test("needsTextContent covers exactly the viewers that render decoded text", () => {
  // media/html stream bytes through a URL; system renders no content at all.
  for (const viewer of ["code", "csv", "markdown", "json", "svg"] as const) {
    assert.equal(needsTextContent(viewer), true, `${viewer} needs text`);
  }
  for (const viewer of ["media", "html", "system", "diff"] as const) {
    assert.equal(needsTextContent(viewer), false, `${viewer} must not need text`);
  }
});

test("hasSourceToggle is a registry fact, not a template condition", () => {
  assert.equal(hasSourceToggle("markdown"), true);
  assert.equal(hasSourceToggle("svg"), true);
  // CSV owns its own Table/Raw switch inside the viewer; HTML has no source view.
  assert.equal(hasSourceToggle("csv"), false);
  assert.equal(hasSourceToggle("html"), false);
  assert.equal(hasSourceToggle("code"), false);
});
