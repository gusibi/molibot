import assert from "node:assert/strict";
import test from "node:test";
import type { TranscriptAttachment } from "./transcript";
import { galleryColumns, groupTranscriptAttachments } from "./attachmentGroups";

function image(name: string): TranscriptAttachment {
  return { original: name, local: name, mediaType: "image" };
}
function file(name: string): TranscriptAttachment {
  return { original: name, local: name, mediaType: "file" };
}

test("consecutive images collapse into one gallery", () => {
  const groups = groupTranscriptAttachments([image("a.png"), image("b.png"), image("c.png")]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].kind, "gallery");
  assert.deepEqual(
    groups[0].kind === "gallery" ? groups[0].items.map((item) => item.original) : [],
    ["a.png", "b.png", "c.png"]
  );
});

test("a non-image breaks the run, preserving the author's order", () => {
  // Hoisting every image into one gallery would reorder them relative to the
  // files between them, and that order is what says which image goes with what.
  const groups = groupTranscriptAttachments([
    image("a.png"),
    file("notes.txt"),
    image("b.png"),
    image("c.png")
  ]);
  assert.deepEqual(groups.map((group) => group.kind), ["gallery", "single", "gallery"]);
  assert.equal(groups[0].kind === "gallery" ? groups[0].items.length : 0, 1);
  assert.equal(groups[2].kind === "gallery" ? groups[2].items.length : 0, 2);
});

test("a gallery records where it started so keys stay stable", () => {
  const groups = groupTranscriptAttachments([file("a.txt"), image("b.png"), image("c.png")]);
  assert.equal(groups[1].kind === "gallery" ? groups[1].startIndex : -1, 1);
});

test("non-image attachments alone produce no gallery", () => {
  const groups = groupTranscriptAttachments([file("a.txt"), file("b.txt")]);
  assert.deepEqual(groups.map((group) => group.kind), ["single", "single"]);
});

test("an empty attachment list produces no groups", () => {
  assert.deepEqual(groupTranscriptAttachments([]), []);
});

test("column count: one stays full width, two split, three or more grid", () => {
  // Shrinking a lone result to a thumbnail loses the thing the turn was about.
  assert.equal(galleryColumns(1), 1);
  assert.equal(galleryColumns(2), 2);
  assert.equal(galleryColumns(3), 3);
  assert.equal(galleryColumns(9), 3);
  assert.equal(galleryColumns(0), 1);
});
