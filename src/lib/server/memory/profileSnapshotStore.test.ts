import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MemoryProfileSnapshotStore } from "./profileSnapshotStore.js";
import type { MemoryInjectionItem } from "./types.js";

function item(memoryId: string, content: string): MemoryInjectionItem {
  return { memoryId, order: 0, promptText: `- ${content}`, source: "profile", namespace: "owner:owner", domain: "owner", snapshot: { displayText: content, content, layer: "long_term", tags: [], updatedAt: "2026-07-17T00:00:00.000Z" } };
}

test("profile base snapshot stays byte-stable after store reconstruction and ignores new candidates", () => {
  const dir = mkdtempSync(join(tmpdir(), "molibot-profile-snapshot-"));
  const file = join(dir, "settings.sqlite");
  try {
    const firstStore = new MemoryProfileSnapshotStore(file);
    const first = firstStore.getOrCreate("session-1", "scope-1", [item("memory-1", "Prefers concise replies")]);
    firstStore.close();
    const restarted = new MemoryProfileSnapshotStore(file);
    const restored = restarted.getOrCreate("session-1", "scope-1", [item("memory-2", "New preference")]);
    restarted.close();
    assert.equal(restored.baseFingerprint, first.baseFingerprint);
    assert.deepEqual(restored.baseItems, first.baseItems);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
