import assert from "node:assert/strict";
import test from "node:test";
import {
  activePromptIndex,
  dockMarkerWidth,
  extractPromptNavigationItems,
  layoutPromptMarkers,
  promptMarkerWindow
} from "./conversationNavigation";

const labels = {
  image: "[Image]",
  audio: "[Audio]",
  file: (name: string) => `[File: ${name}]`,
  empty: "Message"
};

test("prompt navigation projects each stable user turn with its following assistant reply", () => {
  const items = extractPromptNavigationItems([
    { id: "u1", role: "user", content: "## Review **this** [design](https://example.com) &amp; flow" },
    { id: "a1", role: "assistant", content: "Working on the design" },
    { id: "tool", role: "tool", content: "Read file" },
    { role: "user", content: "Missing stable id" },
    { id: "u2", role: "user", content: "(attachment)", attachments: [{ original: "screen.png", mediaType: "image" }] },
    { id: "u3", role: "user", content: "Summarize it", attachments: [{ original: "brief.pdf", mediaType: "file" }] }
  ], labels);

  assert.deepEqual(items, [
    { messageId: "u1", turnIndex: 0, userPreviewText: "Review this design & flow", assistantPreviewText: "Working on the design", createdAt: undefined },
    { messageId: "u2", turnIndex: 1, userPreviewText: "[Image]", assistantPreviewText: "", createdAt: undefined },
    { messageId: "u3", turnIndex: 2, userPreviewText: "[File: brief.pdf] Summarize it", assistantPreviewText: "", createdAt: undefined }
  ]);
});

test("prompt markers form a centered compact stack with ten pixels of space", () => {
  const positions = layoutPromptMarkers(4, 100, 12);
  assert.deepEqual(positions, [32, 44, 56, 68]);
});

test("prompt marker layout compresses only when the compact stack cannot fit", () => {
  const positions = layoutPromptMarkers(30, 100, 12);
  assert.equal(positions.length, 30);
  assert.equal(positions[0], 8);
  assert.equal(positions.at(-1), 92);
  assert.ok(positions.every((position, index) => index === 0 || position > positions[index - 1]));
});

test("marker window shows everything while the fixed-pitch stack fits", () => {
  assert.deepEqual(promptMarkerWindow(8, 3, 100), { start: 0, end: 8, hiddenAbove: 0, hiddenBelow: 0 });
  assert.deepEqual(promptMarkerWindow(0, 0, 100), { start: 0, end: 0, hiddenAbove: 0, hiddenBelow: 0 });
});

test("marker window keeps the active turn centered with fixed pitch when items overflow", () => {
  assert.deepEqual(promptMarkerWindow(30, 15, 100), { start: 13, end: 18, hiddenAbove: 13, hiddenBelow: 12 });
  const tall = promptMarkerWindow(300, 100, 600);
  assert.equal(tall.end - tall.start, 47);
  assert.ok(tall.start < 100 && 100 < tall.end);
  assert.equal(tall.hiddenAbove + tall.hiddenBelow + (tall.end - tall.start), 300);
});

test("marker window clamps at both transcript edges", () => {
  assert.deepEqual(promptMarkerWindow(30, 0, 100), { start: 0, end: 5, hiddenAbove: 0, hiddenBelow: 25 });
  assert.deepEqual(promptMarkerWindow(30, 29, 100), { start: 25, end: 30, hiddenAbove: 25, hiddenBelow: 0 });
});

test("marker window grows with navigator height", () => {
  const short = promptMarkerWindow(300, 150, 240);
  const tall = promptMarkerWindow(300, 150, 720);
  assert.ok(tall.end - tall.start > short.end - short.start);
});

test("active prompt uses the user-turn interval rather than element visibility", () => {
  const offsets = [24, 420, 980, 1510];
  assert.equal(activePromptIndex(offsets, 0), 0);
  assert.equal(activePromptIndex(offsets, 700), 1);
  assert.equal(activePromptIndex(offsets, 1509), 2);
  assert.equal(activePromptIndex(offsets, 9999), 3);
  assert.equal(activePromptIndex([], 100), -1);
});

test("dock width falls off continuously with pointer distance", () => {
  const direct = dockMarkerWidth(50, 50);
  const neighbor = dockMarkerWidth(50, 80);
  const remote = dockMarkerWidth(50, 240);
  assert.ok(direct > neighbor);
  assert.ok(neighbor > remote);
  assert.ok(Math.abs(remote - 6) < 0.01);
});
