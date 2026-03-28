import assert from "node:assert/strict";
import test from "node:test";
import { ChannelQueue } from "./queue.js";

test("ChannelQueue runs jobs in order", async () => {
  const queue = new ChannelQueue("test");
  const steps: string[] = [];

  const done = new Promise<void>((resolve) => {
    queue.enqueue(async () => {
      steps.push("first");
    });
    queue.enqueue(async () => {
      steps.push("second");
      resolve();
    });
  });

  await done;
  assert.deepEqual(steps, ["first", "second"]);
});
