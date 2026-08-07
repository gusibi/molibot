import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  MAX_INCOMING_RESOURCE_BYTES,
  stageIncomingResource,
  validateIncomingResource
} from "$lib/server/miniapps/incomingResources.js";

test("stages a resource with an opaque name and returns only an App-relative path", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "molibot-incoming-"));
  try {
    const source = path.join(root, "owner-secret.txt");
    fs.writeFileSync(source, "hello");
    const resource = stageIncomingResource({
      dataRoot: path.join(root, "data"),
      appId: "capture-app",
      sourcePath: source,
      original: "notes.txt",
      mediaType: "file",
      mimeType: "text/plain"
    });

    assert.match(resource.path, /^incoming\/[0-9a-f-]+\.txt$/);
    assert.equal(JSON.stringify(resource).includes(source), false);
    assert.equal(resource.bytes, 5);
    assert.equal(validateIncomingResource(path.join(root, "data"), "capture-app", resource.path), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("rejects oversized sources before copying and rejects staged path escapes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "molibot-incoming-limit-"));
  try {
    const source = path.join(root, "large.bin");
    fs.writeFileSync(source, Buffer.alloc(1));
    fs.truncateSync(source, MAX_INCOMING_RESOURCE_BYTES + 1);
    assert.throws(() => stageIncomingResource({
      dataRoot: path.join(root, "data"),
      appId: "capture-app",
      sourcePath: source,
      original: "large.bin",
      mediaType: "file"
    }), /64 MiB/);
    assert.equal(validateIncomingResource(path.join(root, "data"), "capture-app", "../large.bin"), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
