import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
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

/** The watcher's 250ms debounce plus slack for the event to reach us. */
const SETTLE_MS = 600;

/**
 * Applies `stimulus` until the watcher reports a batch satisfying `accept`.
 *
 * `fs.watch(root, { recursive: true })` registers its backing OS stream
 * asynchronously (FSEvents on macOS), so writes issued in the window right
 * after `watchProject` resolves are dropped outright — locally ~40% of runs saw
 * zero events for a one-shot write. Node exposes no readiness signal, so rather
 * than race a fixed timer we re-apply the stimulus until it is observed; once
 * registration completes the very next attempt lands.
 */
async function batchAfterStimulus(
  batches: ProjectChangeBatch[],
  stimulus: () => void,
  accept: (batch: ProjectChangeBatch) => boolean,
  timeoutMs = 15_000
): Promise<ProjectChangeBatch | null> {
  const deadline = Date.now() + timeoutMs;
  do {
    stimulus();
    const found = await nextBatch(batches, accept, SETTLE_MS);
    if (found) return found;
  } while (Date.now() < deadline);
  return null;
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

    // Every attempt rewrites the noise alongside the tracked file, so the batch
    // we assert on always exercises the filtering.
    const touchAll = () => {
      writeFileSync(join(root, "node_modules", "pkg", "index.js"), "noise");
      writeFileSync(join(root, "ignored.log"), "noise");
      writeFileSync(join(root, "tracked.ts"), "real");
    };

    const batch = await batchAfterStimulus(first, touchAll, (candidate) => candidate.paths.includes("tracked.ts") || candidate.overflow);
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

test("watcher drops the root's own basename, which macOS reports when the root directory is touched", async () => {
  const root = mkdtempSync(join(tmpdir(), "molibot-watch-"));
  const rootName = basename(root);
  try {
    const batches: ProjectChangeBatch[] = [];
    const release = await watchProject(fixture(root), (batch) => batches.push(batch));

    // Writing at the root touches the root directory itself, which is what makes
    // macOS emit `change "<rootName>"` alongside the real `rename "tracked.ts"`.
    const batch = await batchAfterStimulus(
      batches,
      () => writeFileSync(join(root, "tracked.ts"), "real"),
      (candidate) => candidate.paths.includes("tracked.ts") || candidate.overflow
    );
    assert.ok(batch, "expected a change batch for tracked.ts");
    assert.equal(batch.overflow, false);
    for (const seen of batches) {
      assert.equal(seen.paths.includes(rootName), false, `batch leaked the root basename: ${seen.paths.join(", ")}`);
    }

    release();
  } finally {
    closeAllProjectWatchers();
    rmSync(root, { recursive: true, force: true });
  }
});
