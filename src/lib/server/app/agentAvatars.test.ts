import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_AVATAR_BYTES, readAgentAvatar, saveAgentAvatar } from "./agentAvatars";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
test("avatar saves and reloads in the Agent workspace with a stable relative reference", () => {
  const root = mkdtempSync(join(tmpdir(), "agent-avatar-"));
  try {
    const url = new URL(saveAgentAvatar(root, "demo", png), "http://localhost");
    assert.equal(saveAgentAvatar(root, "demo", png), url.pathname + url.search);
    const result = readAgentAvatar(root, "demo", url.searchParams.get("file")!);
    assert.deepEqual(result.bytes, png); assert.equal(result.mime, "image/png");
    assert.throws(() => saveAgentAvatar(root, "../outside", png));
    assert.throws(() => readAgentAvatar(root, "demo", "../../outside"));
    assert.throws(() => saveAgentAvatar(root, "demo", Buffer.from("<svg/>")));
    assert.throws(() => saveAgentAvatar(root, "demo", Buffer.alloc(MAX_AVATAR_BYTES + 1)));
    mkdirSync(join(root, "sessions", "linked"));
    symlinkSync(tmpdir(), join(root, "sessions", "linked", "avatars"));
    assert.throws(() => saveAgentAvatar(root, "linked", png), /symbolic/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
