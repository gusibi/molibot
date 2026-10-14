import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown } from "../markdown";
import { chatImageResolver } from "./markdownImages";
import type { TranscriptAttachmentActions, TranscriptMessage } from "./transcript";

const href = "/workspace/runtime/chat/scratch/2026/10/14/cover-v3.png";
const local = "chat/attachments/123_cover-v3.png";
const file = { id: "file-3", local, original: "cover-v3.png", mediaType: "image" as const, size: 8, origin: "generated" as const, createdAt: "" };
const message: TranscriptMessage = {
  role: "assistant", content: `![Cover](${href})`,
  attachments: [{ original: file.original, local, mediaType: "image" }],
  activities: [{ key: "generate", kind: "tool", tool: "image", label: "Image", state: "success", fileOutput: { path: "2026/10/14/cover-v3.png", rootKind: "scratch", action: "created" } }]
};
function actions(loads: string[]): TranscriptAttachmentActions {
  return { filesByLocal: new Map([[local, file]]), mediaUrls: new Map(), mediaLoading: new Set(), mediaFailed: new Set(), loadMedia: f => { loads.push(f.id); }, canPreview: () => true, preview: () => {}, download: () => {} };
}
function render(msg: TranscriptMessage, state: TranscriptAttachmentActions | null): string {
  return renderMarkdown(msg.content, "Copy", { sanitize: x => x, resolveImage: chatImageResolver(msg, state) });
}

test("scratch image in chat loads its attached bytes and updates when the blob arrives", () => {
  const loads: string[] = [];
  const state = actions(loads);
  const pending = render(message, state);
  assert.doesNotMatch(pending, /src="\/workspace/);
  assert.deepEqual(loads, [file.id]);
  state.mediaUrls = new Map([[local, "blob:cover"]]);
  assert.match(render(message, state), /src="blob:cover"/);
  assert.deepEqual(loads, [file.id]);
});

test("loading and failed images do not repeat requests or expose disk paths", () => {
  const loads: string[] = [];
  const state = actions(loads);
  state.mediaLoading.add(local);
  assert.doesNotMatch(render(message, state), /src="\/workspace/);
  state.mediaLoading.clear();
  state.mediaFailed.add(local);
  assert.doesNotMatch(render(message, state), /src="\/workspace/);
  assert.deepEqual(loads, []);
});

test("unrecorded disk paths and ambiguous attachments cannot select a same-name file", () => {
  const loads: string[] = [];
  const state = actions(loads);
  const unrecorded = { ...message, activities: [], content: "![Cover](/other/cover-v3.png)" };
  assert.match(render(unrecorded, state), /src="\/other\/cover-v3.png"/);
  assert.deepEqual(loads, []);
  assert.match(render({ ...message, content: "![Routed](/api/image?id=1)" }, state), /src="\/api\/image\?id=1"/);
  const ambiguous = { ...message, attachments: [...message.attachments!, { original: file.original, local: "other", mediaType: "image" as const }] };
  assert.doesNotMatch(render(ambiguous, state), /blob:cover/);
  assert.deepEqual(loads, []);
});

test("remote URLs pass through and attachment locators resolve without a scratch activity", () => {
  const state = actions([]);
  state.mediaUrls.set(local, "blob:cover");
  assert.match(render({ ...message, content: "![Remote](https://example.com/cover.png)" }, state), /src="https:\/\/example.com\/cover.png"/);
  assert.match(render({ ...message, activities: [], content: `![Cover](${local})` }, state), /src="blob:cover"/);
});
