import type { AgentCityStatus } from "./agentCityProjection";

export type PugClip =
  | "off"
  | "phone"
  | "roll"
  | "sleep"
  | "stretch"
  | "lookAround"
  | "typing"
  | "reading"
  | "writing"
  | "cheer"
  | "panic"
  | "greet";

export type PugProp = "none" | "phone" | "book" | "pen";

/**
 * A frame of animation expressed as plain numbers so the clips stay testable
 * without a WebGL context. `agentCityScene` maps every channel onto a rig part.
 * Angles are radians; front-paw pivots hang down at 0 and point forward near
 * -1.5, straight up near -2.6.
 */
export interface PugPose {
  bodyOffsetY: number;
  bodyTiltX: number;
  bodyRollZ: number;
  bodyTurnY: number;
  headPitch: number;
  headYaw: number;
  headRoll: number;
  frontPawLeft: number;
  frontPawRight: number;
  pawSpreadLeft: number;
  pawSpreadRight: number;
  tailWag: number;
  earFlop: number;
  squash: number;
  prop: PugProp;
  propSpin: number;
  screenGlow: number;
}

export const OFF_CLIPS: readonly PugClip[] = ["off"];
export const IDLE_CLIPS: readonly PugClip[] = ["phone", "roll", "sleep", "stretch", "lookAround"];
export const WORK_CLIPS: readonly PugClip[] = ["typing", "reading", "writing"];
export const ALERT_CLIPS: readonly PugClip[] = ["panic"];

export const IDLE_CLIP_DURATION_MS = 11_000;
export const WORK_CLIP_DURATION_MS = 9_000;

export const ONE_SHOT_CLIP_DURATION_MS: Record<"cheer" | "panic" | "greet", number> = {
  cheer: 2200,
  panic: 1800,
  greet: 1600
};

const NEUTRAL_POSE: PugPose = {
  bodyOffsetY: 0,
  bodyTiltX: 0,
  bodyRollZ: 0,
  bodyTurnY: 0,
  headPitch: 0,
  headYaw: 0,
  headRoll: 0,
  frontPawLeft: 0,
  frontPawRight: 0,
  pawSpreadLeft: 0,
  pawSpreadRight: 0,
  tailWag: 0,
  earFlop: 0,
  squash: 1,
  prop: "none",
  propSpin: 0,
  screenGlow: 0
};

export function neutralPugPose(): PugPose {
  return { ...NEUTRAL_POSE };
}

/** Stable 32-bit hash so a given agent always keeps the same personality. */
export function pugSeed(id: string): number {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = left;
  let b = right;
  while (b !== 0) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a;
}

/**
 * Walks the clip list with a per-pug stride that is coprime with the list
 * length, so a pug never repeats a clip back-to-back and eventually plays them
 * all. Deterministic in (seed, cycle) — no hidden RNG state.
 */
export function clipIndexAt(seed: number, cycle: number, length: number): number {
  if (length <= 1) return 0;
  let step = 1 + (seed % (length - 1));
  while (greatestCommonDivisor(step, length) !== 1) step = (step % (length - 1)) + 1;
  const base = (seed >>> 3) % length;
  return (((base + cycle * step) % length) + length) % length;
}

export interface ScheduledClip {
  clip: PugClip;
  cycle: number;
  localTime: number;
}

export function scheduledClip(
  clips: readonly PugClip[],
  seed: number,
  timeMs: number,
  durationMs: number
): ScheduledClip {
  const list = clips.length > 0 ? clips : OFF_CLIPS;
  const offset = seed % durationMs;
  const shifted = Math.max(0, timeMs) + offset;
  const cycle = Math.floor(shifted / durationMs);
  return {
    clip: list[clipIndexAt(seed, cycle, list.length)],
    cycle,
    localTime: (shifted % durationMs) / 1000
  };
}

export function clipsForStatus(status: AgentCityStatus): readonly PugClip[] {
  if (status === "disabled") return OFF_CLIPS;
  if (status === "working") return WORK_CLIPS;
  if (status === "error") return ALERT_CLIPS;
  return IDLE_CLIPS;
}

export function clipDurationForStatus(status: AgentCityStatus): number {
  return status === "working" ? WORK_CLIP_DURATION_MS : IDLE_CLIP_DURATION_MS;
}

/** One-shot reaction to play when a floor changes status mid-session. */
export function transitionClip(
  previous: AgentCityStatus | null,
  next: AgentCityStatus
): "cheer" | "panic" | null {
  if (!previous || previous === next) return null;
  if (next === "completed") return "cheer";
  if (next === "error") return "panic";
  return null;
}

function decay(progress: number): number {
  return Math.max(0, 1 - progress);
}

/** Smooth 0→1→0 pulse used for stretches and other once-per-cycle accents. */
function pulse(value: number): number {
  const clamped = Math.min(1, Math.max(0, value));
  return Math.sin(clamped * Math.PI) ** 2;
}

/** 0→1 sawtooth, for page flips and other repeating discrete beats. */
function sawtooth(time: number, period: number): number {
  return ((time % period) + period) % period / period;
}

/**
 * Exaggerated, cartoon-scale posing: amplitudes are deliberately large so the
 * activity still reads when the camera is pulled back over the whole city.
 */
export function pugPose(clip: PugClip, localTime: number, seed = 0): PugPose {
  const pose = neutralPugPose();
  const time = Math.max(0, localTime);
  const drift = (seed % 100) / 100;

  switch (clip) {
    case "off": {
      pose.squash = 0.97;
      pose.headPitch = 0.18;
      pose.earFlop = 0.12;
      return pose;
    }

    case "phone": {
      // Slumped back on the floor, both paws up holding a glowing phone.
      pose.bodyOffsetY = -0.06;
      pose.bodyTiltX = -0.55;
      pose.frontPawLeft = -1.62;
      pose.frontPawRight = -1.5;
      pose.pawSpreadLeft = 0.16;
      pose.pawSpreadRight = -0.16;
      pose.headPitch = 0.46 + Math.sin(time * 3.1 + drift) * 0.05;
      pose.headYaw = Math.sin(time * 0.7) * 0.06;
      pose.tailWag = Math.sin(time * 2.2) * 0.22;
      pose.prop = "phone";
      pose.propSpin = Math.sin(time * 5.4) * 0.09;
      pose.screenGlow = 0.75 + Math.sin(time * 7.3) * 0.25;
      // Every ~4.5s something funny happens and the whole pug shakes.
      const laugh = pulse(sawtooth(time + drift, 4.5) * 3);
      pose.squash = 1 + laugh * 0.14;
      pose.bodyOffsetY += laugh * 0.06;
      pose.headPitch -= laugh * 0.35;
      return pose;
    }

    case "roll": {
      // On its back, rolling side to side with all four paws flailing.
      pose.bodyOffsetY = -0.2;
      pose.bodyTiltX = -1.32;
      pose.bodyRollZ = Math.sin(time * 2.2 + drift) * 2.2;
      pose.frontPawLeft = -2.1 + Math.sin(time * 6.4) * 0.9;
      pose.frontPawRight = -2.1 + Math.sin(time * 6.4 + Math.PI) * 0.9;
      pose.pawSpreadLeft = 0.5 + Math.sin(time * 5.1) * 0.3;
      pose.pawSpreadRight = -0.5 + Math.sin(time * 5.1 + Math.PI) * 0.3;
      pose.headRoll = Math.sin(time * 2.2 + drift + 0.4) * 0.7;
      pose.headPitch = -0.3;
      pose.tailWag = Math.sin(time * 7.5) * 0.6;
      pose.earFlop = Math.sin(time * 4.4) * 0.4;
      pose.squash = 1 + Math.sin(time * 4.4) * 0.05;
      return pose;
    }

    case "sleep": {
      pose.bodyOffsetY = -0.21;
      pose.bodyTiltX = 0.16;
      pose.headPitch = 0.52;
      pose.headRoll = 0.24;
      pose.frontPawLeft = -1.35;
      pose.frontPawRight = -1.35;
      pose.earFlop = 0.5;
      pose.squash = 1 + Math.sin(time * 1.1 + drift) * 0.07;
      pose.tailWag = Math.sin(time * 0.5) * 0.06;
      return pose;
    }

    case "stretch": {
      // Mostly loafing, with one long full-body stretch per cycle.
      const accent = pulse(sawtooth(time + drift * 2, 5.5) * 1.7);
      pose.bodyOffsetY = -0.08 - accent * 0.1;
      pose.bodyTiltX = -0.1 - accent * 0.62;
      pose.frontPawLeft = -0.35 - accent * 0.95;
      pose.frontPawRight = -0.35 - accent * 0.95;
      pose.headPitch = 0.2 - accent * 0.75;
      pose.tailWag = Math.sin(time * 3) * (0.18 + accent * 0.5);
      pose.earFlop = accent * 0.3;
      pose.squash = 1 - accent * 0.12;
      return pose;
    }

    case "lookAround": {
      pose.bodyOffsetY = Math.sin(time * 1.6 + drift) * 0.05;
      pose.bodyTurnY = Math.sin(time * 0.45 + drift) * 0.42;
      pose.headYaw = Math.sin(time * 0.9 + drift) * 0.95;
      pose.headPitch = Math.sin(time * 0.6) * 0.16;
      pose.headRoll = Math.sin(time * 1.3) * 0.22;
      pose.tailWag = Math.sin(time * 4.6) * 0.45;
      pose.earFlop = Math.sin(time * 2.1) * 0.2;
      return pose;
    }

    case "typing": {
      // Both paws hammering the desk, screen flickering in time.
      const beat = time * 11.5;
      pose.bodyOffsetY = 0.02 + Math.sin(beat) * 0.022;
      pose.bodyTiltX = -0.12;
      pose.frontPawLeft = -1.34 + Math.sin(beat) * 0.34;
      pose.frontPawRight = -1.34 + Math.sin(beat + Math.PI) * 0.34;
      pose.pawSpreadLeft = 0.2;
      pose.pawSpreadRight = -0.2;
      pose.headPitch = 0.3 + Math.sin(beat * 0.5) * 0.05;
      pose.headYaw = Math.sin(time * 1.4) * 0.12;
      pose.tailWag = Math.sin(time * 8.5) * 0.55;
      pose.squash = 1 + Math.sin(beat) * 0.03;
      pose.screenGlow = 0.7 + Math.sin(beat * 0.7) * 0.3;
      return pose;
    }

    case "reading": {
      // Holding an open book, flipping a page roughly every 1.6s.
      const page = sawtooth(time + drift, 1.6);
      pose.bodyTiltX = -0.24;
      pose.frontPawLeft = -1.24;
      pose.frontPawRight = -1.24;
      pose.pawSpreadLeft = 0.3;
      pose.pawSpreadRight = -0.3;
      pose.headPitch = 0.42;
      pose.headYaw = Math.sin(time * 2.4) * 0.26;
      pose.tailWag = Math.sin(time * 3.1) * 0.3;
      pose.prop = "book";
      pose.propSpin = pulse(page) * Math.PI * 0.95;
      pose.bodyOffsetY = Math.sin(time * 1.8) * 0.02;
      return pose;
    }

    case "writing": {
      const stroke = time * 7.2;
      pose.bodyTiltX = -0.2;
      pose.frontPawLeft = -0.62;
      pose.frontPawRight = -1.1 + Math.sin(stroke) * 0.46;
      pose.pawSpreadLeft = 0.34;
      pose.pawSpreadRight = -0.16 + Math.sin(stroke) * 0.32;
      pose.headPitch = 0.5;
      pose.headYaw = Math.sin(stroke) * 0.14;
      pose.tailWag = Math.sin(time * 5.2) * 0.35;
      pose.prop = "pen";
      pose.propSpin = Math.sin(stroke) * 0.4;
      pose.bodyOffsetY = Math.sin(stroke * 0.5) * 0.015;
      return pose;
    }

    case "cheer": {
      const progress = Math.min(1, time / (ONE_SHOT_CLIP_DURATION_MS.cheer / 1000));
      const energy = decay(progress) * 0.6 + 0.4;
      const hop = Math.abs(Math.sin(time * 4.2));
      pose.bodyOffsetY = hop * 0.55 * energy;
      pose.bodyTurnY = Math.sin(time * 6.1) * 0.34;
      pose.frontPawLeft = -2.5;
      pose.frontPawRight = -2.5;
      pose.pawSpreadLeft = 0.55;
      pose.pawSpreadRight = -0.55;
      pose.headPitch = -0.34;
      pose.tailWag = Math.sin(time * 14) * 0.8;
      pose.earFlop = Math.sin(time * 9) * 0.35;
      pose.squash = 1 + (hop - 0.5) * 0.24 * energy;
      return pose;
    }

    case "panic": {
      pose.bodyOffsetY = 0.02 + Math.abs(Math.sin(time * 6)) * 0.05;
      pose.bodyTiltX = 0.14;
      pose.frontPawLeft = -2.62;
      pose.frontPawRight = -2.62;
      pose.pawSpreadLeft = -0.42;
      pose.pawSpreadRight = 0.42;
      pose.headRoll = Math.sin(time * 9.4) * 0.26;
      pose.headYaw = Math.sin(time * 12.7) * 0.14;
      pose.headPitch = -0.12;
      pose.tailWag = Math.sin(time * 3) * 0.1;
      pose.earFlop = 0.34;
      pose.squash = 1 - Math.abs(Math.sin(time * 6)) * 0.06;
      return pose;
    }

    case "greet": {
      const progress = Math.min(1, time / (ONE_SHOT_CLIP_DURATION_MS.greet / 1000));
      const energy = 0.55 + decay(progress) * 0.45;
      pose.bodyOffsetY = Math.abs(Math.sin(time * 3.1)) * 0.18 * energy;
      pose.frontPawRight = -2.05 + Math.sin(time * 9.5) * 0.52 * energy;
      pose.pawSpreadRight = -0.48;
      pose.frontPawLeft = -0.5;
      pose.headPitch = -0.16;
      pose.headRoll = Math.sin(time * 9.5) * 0.16 * energy;
      pose.tailWag = Math.sin(time * 15) * 0.85;
      pose.earFlop = Math.sin(time * 7) * 0.28;
      pose.squash = 1 + Math.sin(time * 6.2) * 0.06;
      return pose;
    }

    default:
      return pose;
  }
}
