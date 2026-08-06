import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyFilePreview,
  rawPreviewKindFromName,
  mimeFromFilename,
  mediaTypeFromName,
  isTextPreviewKind
} from "./filePreview";

test("text dotfiles classify as text, not binary (issue #31 bug 3)", () => {
  // extensionOf treats the whole filename as the extension (`.gitignore` ->
  // ext `.gitignore`), so without the TEXT_DOTFILES set these fell through to
  // "binary" and the Artifact Panel offered only a system-open card.
  for (const name of [
    ".gitignore",
    ".gitattributes",
    ".gitmodules",
    ".dockerignore",
    ".npmignore",
    ".editorconfig",
    ".npmrc",
    ".nvmrc",
    ".node-version",
    ".prettierrc",
    ".eslintrc",
    ".babelrc"
  ]) {
    assert.equal(classifyFilePreview({ name }), "text", `${name} should classify as text`);
  }
});

test("binary dotfiles stay binary so they still get the system card", () => {
  assert.equal(classifyFilePreview({ name: ".DS_Store" }), "binary");
});

test("isTextPreviewKind covers the text family including dotfiles", () => {
  assert.equal(isTextPreviewKind("text"), true);
  assert.equal(isTextPreviewKind("code"), true);
  assert.equal(isTextPreviewKind("markdown"), true);
  assert.equal(isTextPreviewKind("binary"), false);
  assert.equal(isTextPreviewKind("image"), false);
});

test("code, markdown, json, csv and yaml extensions still classify by extension", () => {
  assert.equal(classifyFilePreview({ name: "app.ts" }), "code");
  assert.equal(classifyFilePreview({ name: "readme.md" }), "markdown");
  assert.equal(classifyFilePreview({ name: "data.json" }), "json");
  assert.equal(classifyFilePreview({ name: "rows.csv" }), "csv");
  assert.equal(classifyFilePreview({ name: "config.yaml" }), "yaml");
});

test("media is classified from MIME and mediaType", () => {
  assert.equal(classifyFilePreview({ name: "x", mediaType: "image" }), "image");
  assert.equal(classifyFilePreview({ name: "x", mimeType: "image/png" }), "image");
  assert.equal(classifyFilePreview({ name: "x", mimeType: "audio/mpeg" }), "audio");
  assert.equal(classifyFilePreview({ name: "x", mimeType: "video/mp4" }), "video");
  assert.equal(classifyFilePreview({ name: "doc.pdf" }), "pdf");
});

test("rawPreviewKindFromName / mimeFromFilename / mediaTypeFromName basics", () => {
  assert.equal(rawPreviewKindFromName("photo.png"), "image");
  assert.equal(rawPreviewKindFromName("clip.mp4"), "video");
  assert.equal(rawPreviewKindFromName("song.mp3"), "audio");
  assert.equal(rawPreviewKindFromName("doc.pdf"), "pdf");
  assert.equal(rawPreviewKindFromName("unknown.xyz"), "file");
  assert.equal(mimeFromFilename("photo.png"), "image/png");
  assert.equal(mimeFromFilename("unknown.xyz"), null);
  assert.equal(mediaTypeFromName("photo.png"), "image");
  assert.equal(mediaTypeFromName("unknown.xyz"), "file");
});
