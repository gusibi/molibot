import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeAllProjectWatchers, watchProject, type ProjectChangeBatch } from "./watcher.js";
import type { ProjectRecord } from "./store.js";

function fixture(rootPath: string): ProjectRecord {
  return { id: "test", name: "Test", rootPath, createdAt: "", updatedAt: "" };
}

/** Waits for the debounced batch that satisfies `accept`, or resolves null. */
function nextBatch(batches: ProjectChangeBatch[], accept: (batch: ProjectChangeBatch) => boolean, timeoutMs = 3_000): Promise<ProjectChangeBatch | null> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const poll = () => {
      const found = batches.find(accept);
      if (found) return resolve(found);
      if (Date.now() > deadline) return resolve(null);
      setTimeout(poll, 25);
    };
    poll();
  });
}

test("watcher batches changes, filters vendor noise, and reference-counts one OS watch", async () => {
  const root = mkdtempSync(join(tmpdir(), "molibot-watch-"));
  try {
    writeFileSync(join(root, ".gitignore"), "ignored.log\n");
    mkdirSync(join(root, "node_modules", "pkg"), { recursive: true });

    const first: ProjectChangeBatch[] = [];
    const second: ProjectChangeBatch[] = [];
    const releaseFirst = await watchProject(fixture(root), (batch) => first.push(batch));
    const releaseSecond = await watchProject(fixture(root), (batch) => second.push(batch));

    writeFileSync(join(root, "node_modules", "pkg", "index.js"), "noise");
    writeFileSync(join(root, "ignored.log"), "noise");
    writeFileSync(join(root, "tracked.ts"), "real");

    const batch = await nextBatch(first, (candidate) => candidate.paths.includes("tracked.ts") || candidate.overflow);
    assert.ok(batch, "expected a change batch for tracked.ts");
    assert.equal(batch.overflow, false);
    assert.equal(batch.paths.some((entry) => entry.startsWith("node_modules/")), false);
    assert.equal(batch.paths.includes("ignored.log"), false);
    // Both subscribers share the same watcher and receive the same batches.
    assert.ok(await nextBatch(second, (candidate) => candidate.paths.includes("tracked.ts")));

    releaseFirst();
    releaseSecond();
    // Releasing every subscriber must be idempotent.
    releaseFirst();
  } finally {
    closeAllProjectWatchers();
    rmSync(root, { recursive: true, force: true });
  }
});
