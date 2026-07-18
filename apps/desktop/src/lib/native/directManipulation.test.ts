import assert from "node:assert/strict";
import test from "node:test";
import { DirectManipulation, type ManipulationSnapshot } from "./directManipulation";

function createController(reducedMotion = false): { controller: DirectManipulation; updates: ManipulationSnapshot[]; settled: number[] } {
  const updates: ManipulationSnapshot[] = [];
  const settled: number[] = [];
  return {
    controller: new DirectManipulation({
      min: 0,
      max: 320,
      reducedMotion: () => reducedMotion,
      onUpdate: (snapshot) => updates.push(snapshot),
      onSettled: (target) => settled.push(target)
    }),
    updates,
    settled
  };
}

test("DirectManipulation requires eight pixels before it activates", () => {
  const { controller } = createController();
  controller.begin(1, 100, 0);
  controller.move(1, 107, 16);
  assert.equal(controller.current().phase, "tracking");
  assert.equal(controller.current().position, 0);
  controller.move(1, 109, 32);
  assert.equal(controller.current().phase, "dragging");
  assert.equal(controller.current().position, 9);
});

test("DirectManipulation projects a fast flick but returns a slow short drag", () => {
  const slow = createController().controller;
  slow.begin(1, 0, 0);
  slow.move(1, 70, 120);
  assert.equal(slow.end(1, 160), 0);

  const fast = createController().controller;
  fast.begin(1, 0, 0);
  fast.move(1, 70, 16);
  fast.move(1, 130, 32);
  assert.equal(fast.end(1, 40), 320);
});

test("DirectManipulation rubber-bands bounds and ignores other pointers", () => {
  const { controller } = createController();
  controller.begin(1, 0, 0);
  controller.move(2, 500, 16);
  assert.equal(controller.current().position, 0);
  controller.move(1, 500, 16);
  assert.equal(controller.current().position, 383);
});

test("DirectManipulation interrupts a settle and cancels safely", () => {
  const { controller } = createController();
  controller.begin(1, 0, 0);
  controller.move(1, 200, 16);
  controller.end(1, 24);
  controller.step(16);
  const current = controller.current().position;
  controller.interrupt(2, 200, 40);
  assert.equal(controller.current().phase, "tracking");
  assert.equal(controller.current().position, current);
  assert.equal(controller.cancel(), 0);
  assert.equal(controller.current().target, 0);
});

test("DirectManipulation keeps a continuous resize in bounds and settles at its current position", () => {
  const settled: number[] = [];
  const controller = new DirectManipulation({
    min: 220,
    max: 420,
    mode: "continuous",
    onSettled: (target) => settled.push(target)
  });

  controller.begin(3, 260, 0, 260);
  controller.move(3, 500, 16);
  assert.equal(controller.current().position, 448);
  assert.equal(controller.end(3, 24), 420);
  assert.deepEqual(controller.current(), { phase: "idle", position: 420, velocity: 0, target: null });
  assert.deepEqual(settled, [420]);
});

test("DirectManipulation emits one commit only after an activated pointer gesture settles", () => {
  const commits: number[] = [];
  const controller = new DirectManipulation({
    min: 0,
    max: 320,
    reducedMotion: () => true,
    onCommitted: (target) => commits.push(target)
  });

  controller.begin(1, 0, 0);
  controller.end(1, 16);
  controller.begin(2, 0, 32);
  controller.move(2, 200, 48);
  controller.end(2, 64);
  controller.cancel();

  assert.deepEqual(commits, [320]);
});
test("DirectManipulation settles synchronously when reduced motion is preferred", () => {
  const { controller, settled } = createController(true);
  controller.begin(1, 0, 0);
  controller.move(1, 200, 16);
  assert.equal(controller.end(1, 24), 320);
  assert.deepEqual(controller.current(), { phase: "idle", position: 320, velocity: 0, target: null });
  assert.deepEqual(settled, [320]);
});
