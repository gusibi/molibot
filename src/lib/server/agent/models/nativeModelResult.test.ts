import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Harness, createRegistry } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { createModels } from "@earendil-works/pi-ai";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { withPiInvocation, type NativeInvocation } from "$lib/server/agent/durable/piInvocation.js";
import { nativeModelResult } from "./nativeModelResult.js";

async function fixture(directory: string) {
  const storagePath = join(directory, "native.sqlite");
  const harness = await Harness.open(await openNodeSqliteStorage(storagePath), { models: createModels(), registry: createRegistry() }, BACKGROUND_CONTEXT);
  const root = await harness.root(BACKGROUND_CONTEXT);
  return {
    run: <T>(id: number, work: () => Promise<T>) => withPiInvocation({ storagePath, context: BACKGROUND_CONTEXT,
      api: { taskId: id, commit: root.commit.bind(root) } as unknown as NativeInvocation["api"],
      child: async () => { throw new Error("No child in this fixture."); }, nested: async () => { throw new Error("No tool in this fixture."); } }, work),
    close: () => harness.close(BACKGROUND_CONTEXT)
  };
}

test("a raw model response survives reopening and is reused before media projection", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-model-receipt-"));
  let owner = await fixture(dir);
  let requests = 0;
  const accounted: string[] = [];
  const execute = () => nativeModelResult({ model: "image|fixture|one", prompt: "cat" }, async () => { requests++; return { data: "committed-image", usage: 4 }; }, result => accounted.push(result.data));
  try {
    assert.deepEqual(await owner.run(1, execute), { data: "committed-image", usage: 4 });
    await owner.close(); owner = await fixture(dir);
    assert.deepEqual(await owner.run(1, execute), { data: "committed-image", usage: 4 });
    assert.equal(requests, 1);
    assert.deepEqual(accounted, ["committed-image", "committed-image"]);
    await assert.rejects(owner.run(1, () => nativeModelResult({ model: "image|fixture|one", prompt: "changed" }, async () => { requests++; return {}; }, () => {})), /arguments changed/);
    assert.equal(requests, 1);
  } finally { await owner.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("an unknown billed operation blocks a new call ID for the same parameters", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-model-unknown-"));
  const owner = await fixture(dir);
  let requests = 0;
  try {
    await assert.rejects(owner.run(1, () => nativeModelResult({ prompt: "cat", model: "image" }, async () => { requests++; throw new Error("Disconnected after external submission"); }, () => {})), /Disconnected/);
    await assert.rejects(owner.run(2, () => nativeModelResult({ model: "image", prompt: "cat" }, async () => { requests++; return {}; }, () => {})), /new call ID/);
    assert.equal(requests, 1);
  } finally { await owner.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("parallel calls retain separate responses even when their arguments are identical", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-model-parallel-"));
  const owner = await fixture(dir);
  let entered = 0;
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  try {
    const invoke = (id: number) => owner.run(id, () => nativeModelResult({ prompt: "classify" }, async () => {
      if (++entered === 2) release(); await barrier; return { id };
    }, () => {}));
    assert.deepEqual(await Promise.all([invoke(1), invoke(2)]), [{ id: 1 }, { id: 2 }]);
    assert.deepEqual(await Promise.all([invoke(1), invoke(2)]), [{ id: 1 }, { id: 2 }]);
    assert.equal(entered, 2);
  } finally { await owner.close(); rmSync(dir, { recursive: true, force: true }); }
});
