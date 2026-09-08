import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MomRuntimeStore } from "$lib/server/agent/session/store.js";

function makeStore(): { store: MomRuntimeStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "molibot-attachment-"));
  return { store: new MomRuntimeStore(dir), dir };
}

const CHAT = "chat1";
const TS = "1757200000.123";

test("same-named attachments in one turn keep distinct files instead of overwriting", () => {
  const { store, dir } = makeStore();
  try {
    const first = store.saveAttachment(CHAT, "image.png", TS, Buffer.from("first-image"), { mimeType: "image/png" });
    const second = store.saveAttachment(CHAT, "image.png", TS, Buffer.from("second-image"), { mimeType: "image/png" });
    const third = store.saveAttachment(CHAT, "image.png", TS, Buffer.from("third-image"), { mimeType: "image/png" });

    assert.notEqual(first.local, second.local);
    assert.notEqual(second.local, third.local);
    assert.equal(readFileSync(join(dir, first.local)).toString(), "first-image");
    assert.equal(readFileSync(join(dir, second.local)).toString(), "second-image");
    assert.equal(readFileSync(join(dir, third.local)).toString(), "third-image");
    // The dedupe suffix lands before the extension so type inference keeps working.
    assert.match(second.local, /_image-2\.png$/);
    assert.equal(second.isImage, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("same name at a different timestamp still maps to its own unsuffixed path", () => {
  const { store, dir } = makeStore();
  try {
    const first = store.saveAttachment(CHAT, "image.png", TS, Buffer.from("a"), { mimeType: "image/png" });
    const second = store.saveAttachment(CHAT, "image.png", "1757200001.456", Buffer.from("b"), { mimeType: "image/png" });

    assert.equal(first.local, `${CHAT}/attachments/1757200000123_image.png`);
    assert.equal(second.local, `${CHAT}/attachments/1757200001456_image.png`);
    assert.ok(existsSync(join(dir, first.local)));
    assert.ok(existsSync(join(dir, second.local)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
