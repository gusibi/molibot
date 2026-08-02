import assert from "node:assert/strict";
import test from "node:test";
import {
  ALERT_CLIPS,
  IDLE_CLIPS,
  IDLE_CLIP_DURATION_MS,
  ONE_SHOT_CLIP_DURATION_MS,
  WORK_CLIPS,
  WORK_CLIP_DURATION_MS,
  clipDurationForStatus,
  clipIndexAt,
  clipsForStatus,
  pugPose,
  pugSeed,
  scheduledClip,
  transitionClip,
  type PugClip
} from "./agentCityPugAnimation";

test("clipsForStatus keeps disabled pugs still and working pugs busy", () => {
  assert.deepEqual([...clipsForStatus("disabled")], ["off"]);
  assert.deepEqual([...clipsForStatus("working")], [...WORK_CLIPS]);
  assert.deepEqual([...clipsForStatus("error")], [...ALERT_CLIPS]);
  // A finished agent goes back to slacking; the celebration is a one-shot.
  assert.deepEqual([...clipsForStatus("completed")], [...IDLE_CLIPS]);
  assert.deepEqual([...clipsForStatus("idle")], [...IDLE_CLIPS]);
});

test("clipDurationForStatus gives working pugs a faster rotation", () => {
  assert.equal(clipDurationForStatus("working"), WORK_CLIP_DURATION_MS);
  assert.equal(clipDurationForStatus("idle"), IDLE_CLIP_DURATION_MS);
});

test("clipIndexAt never repeats a clip back to back and covers the whole list", () => {
  for (const length of [3, 5]) {
    for (const seed of [0, 1, 7, 12345, 999983]) {
      const seen = new Set<number>();
      let previous = clipIndexAt(seed, 0, length);
      seen.add(previous);
      for (let cycle = 1; cycle <= length * 2; cycle += 1) {
        const index = clipIndexAt(seed, cycle, length);
        assert.ok(index >= 0 && index < length, `index ${index} out of range`);
        assert.notEqual(index, previous, `seed ${seed} repeated index ${index}`);
        seen.add(index);
        previous = index;
      }
      assert.equal(seen.size, length, `seed ${seed} never played every clip`);
    }
  }
});

test("scheduledClip is deterministic and advances through the cycle", () => {
  const seed = pugSeed("agent-alpha");
  const first = scheduledClip(IDLE_CLIPS, seed, 1_000, IDLE_CLIP_DURATION_MS);
  assert.deepEqual(scheduledClip(IDLE_CLIPS, seed, 1_000, IDLE_CLIP_DURATION_MS), first);
  const later = scheduledClip(IDLE_CLIPS, seed, 1_000 + IDLE_CLIP_DURATION_MS, IDLE_CLIP_DURATION_MS);
  assert.equal(later.cycle, first.cycle + 1);
  assert.notEqual(later.clip, first.clip);
  assert.ok(later.localTime >= 0 && later.localTime < IDLE_CLIP_DURATION_MS / 1000);
});

test("different agents do not all play the same clip at the same moment", () => {
  const clips = new Set(
    ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"].map(
      (id) => scheduledClip(IDLE_CLIPS, pugSeed(id), 0, IDLE_CLIP_DURATION_MS).clip
    )
  );
  assert.ok(clips.size > 1, "every pug started on the same idle clip");
});

test("pugSeed is stable and differs across agents", () => {
  assert.equal(pugSeed("agent-alpha"), pugSeed("agent-alpha"));
  assert.notEqual(pugSeed("agent-alpha"), pugSeed("agent-beta"));
});

test("transitionClip only reacts to a real status change", () => {
  assert.equal(transitionClip(null, "completed"), null);
  assert.equal(transitionClip("working", "working"), null);
  assert.equal(transitionClip("working", "completed"), "cheer");
  assert.equal(transitionClip("working", "error"), "panic");
  assert.equal(transitionClip("completed", "idle"), null);
});

test("every clip stays finite and inside sane pose limits", () => {
  const clips: PugClip[] = [
    "off", "phone", "roll", "sleep", "stretch", "lookAround",
    "typing", "reading", "writing", "cheer", "panic", "greet"
  ];
  for (const clip of clips) {
    for (let step = 0; step <= 40; step += 1) {
      const pose = pugPose(clip, step * 0.3, 7);
      for (const [channel, value] of Object.entries(pose)) {
        if (typeof value !== "number") continue;
        assert.ok(Number.isFinite(value), `${clip}.${channel} was not finite`);
        assert.ok(Math.abs(value) <= 4, `${clip}.${channel} = ${value} is out of range`);
      }
      assert.ok(pose.squash > 0.2, `${clip} squashed the pug inside out`);
      // Never sink below the floor of the room.
      assert.ok(pose.bodyOffsetY >= -0.3, `${clip} sank through the floor`);
    }
  }
});

test("work clips carry the props that make the activity readable", () => {
  assert.equal(pugPose("reading", 0.4).prop, "book");
  assert.equal(pugPose("writing", 0.4).prop, "pen");
  assert.equal(pugPose("phone", 0.4).prop, "phone");
  assert.equal(pugPose("typing", 0.4).prop, "none");
  assert.equal(pugPose("off", 0.4).prop, "none");
});

test("typing and phone light their screens, resting clips do not", () => {
  assert.ok(pugPose("typing", 0.4).screenGlow > 0);
  assert.ok(pugPose("phone", 0.4).screenGlow > 0);
  assert.equal(pugPose("sleep", 0.4).screenGlow, 0);
});

test("cheer and greet raise a paw well above the resting pose", () => {
  // Front-paw pivots hang at 0 and point up near -2.6.
  assert.ok(pugPose("cheer", 0.2).frontPawLeft < -2, "cheer did not raise both paws");
  assert.ok(pugPose("greet", 0.05).frontPawRight < -1.5, "greet did not raise the waving paw");
  assert.ok(pugPose("off", 0.2).frontPawLeft > -0.5, "an off-duty pug should not hold a paw up");
});

test("one-shot clips settle down as they finish", () => {
  const duration = ONE_SHOT_CLIP_DURATION_MS.cheer / 1000;
  const early = Math.abs(pugPose("cheer", duration * 0.05).bodyOffsetY);
  const late = Math.abs(pugPose("cheer", duration * 0.98).bodyOffsetY);
  assert.ok(late <= early, "the cheer never decayed");
});
