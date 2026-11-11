/**
 * One-second sampling model for the pinned run-status row above the composer.
 *
 * The stream carries no token counts, so spelled text is the only live signal
 * of progress. `estimateTokens` converts the visible character mix into a
 * token estimate and `createStreamRateMeter` turns its growth into a pace;
 * this module adds what the row needs on top: a phase (the model is writing,
 * a tool owns the turn, or nothing has arrived for a while), the turn's token
 * total and the idle counter behind the "still running" reassurance.
 *
 * Keeping it out of the component makes the phase rules testable without a
 * DOM, and lets the row render a snapshot instead of recomputing per frame.
 */

import { createStreamRateMeter, estimateTokens } from "./streamingRate";

/**
 * `starting` covers the gap between sending and the first byte; `waiting` is
 * the honest silence state (no running tool, no growth for several ticks).
 */
export type RunStatusPhase = "starting" | "thinking" | "answering" | "tool" | "waiting";

export interface RunStatusMeterInput {
  now: number;
  /** Answer text streamed so far this turn. */
  text: string;
  /** Reasoning text streamed so far this turn. */
  thinking: string;
  /** True while any activity (tool, subagent, retry) is still running. */
  hasRunningActivity: boolean;
}

export interface RunStatusSnapshot {
  phase: RunStatusPhase;
  /** Estimated tokens produced this turn (answer + reasoning). */
  tokens: number;
  /** Estimated tokens per second over the recent window; 0 once growth stops. */
  tokensPerSecond: number;
  /** Consecutive idle ticks; the row alternates its reassurance copy on it. */
  idleTicks: number;
}

export interface RunStatusMeterOptions {
  /** Sliding sample window for the rate estimate. */
  windowMs?: number;
  /**
   * Idle ticks before silence is presented as `waiting` rather than the last
   * active phase. Five seconds keeps a normal inter-token gap from flickering
   * the copy while still reacting before "is it stuck?" sets in.
   */
  idleTicksBeforeWaiting?: number;
}

/** Tokens are whole numbers; compact only once the count would jitter width. */
export function formatRunTokens(tokens: number): string {
  const value = Number.isFinite(tokens) ? Math.max(0, Math.round(tokens)) : 0;
  if (value < 10_000) return String(value);
  if (value < 1_000_000) return `${(value / 1_000).toFixed(value < 100_000 ? 1 : 0)}k`;
  return `${(value / 1_000_000).toFixed(1)}m`;
}

/** One decimal below 10 tok/s, an integer above it: fine while slow, calm while fast. */
export function formatRunRate(tokensPerSecond: number): string {
  const value = Number.isFinite(tokensPerSecond) ? Math.max(0, tokensPerSecond) : 0;
  return value < 10 ? value.toFixed(1) : String(Math.round(value));
}

export function createRunStatusMeter(options: RunStatusMeterOptions = {}) {
  const idleTicksBeforeWaiting = options.idleTicksBeforeWaiting ?? 5;
  const windowMs = options.windowMs;
  let rateMeter = createStreamRateMeter(windowMs);
  let lastTextLen = 0;
  let lastThinkingLen = 0;
  let lastAnswerAt = 0;
  let lastThinkingAt = 0;
  let idleTicks = 0;
  let phase: RunStatusPhase = "starting";

  /** A new turn (or a replacement that shortens the text) starts a clean window. */
  function reset(): void {
    rateMeter = createStreamRateMeter(windowMs);
    lastTextLen = 0;
    lastThinkingLen = 0;
    lastAnswerAt = 0;
    lastThinkingAt = 0;
    idleTicks = 0;
    phase = "starting";
  }

  /**
   * "Answering" means prose is the newest thing the model produced. Text that
   * arrived before the latest thinking block is narration from an earlier
   * phase, so the label stays on thinking until the answer grows again.
   */
  function answeringPhase(): RunStatusPhase {
    return lastAnswerAt > 0 && lastAnswerAt >= lastThinkingAt ? "answering" : "thinking";
  }

  return {
    reset,

    /** Feed the turn's cumulative text; returns the snapshot the row renders. */
    tick({ now, text, thinking, hasRunningActivity }: RunStatusMeterInput): RunStatusSnapshot {
      const textLen = text.length;
      const thinkingLen = thinking.length;
      const total = textLen + thinkingLen;

      // A shorter total means the runtime replaced (or restarted) the text
      // rather than growing it; carrying the old samples would show a rate for
      // text that no longer exists.
      if (total < lastTextLen + lastThinkingLen) reset();
      if (textLen > lastTextLen) lastAnswerAt = now;
      if (thinkingLen > lastThinkingLen) lastThinkingAt = now;
      lastTextLen = textLen;
      lastThinkingLen = thinkingLen;

      const tokens = total > 0 ? estimateTokens(text + thinking) : 0;
      const tokensPerChar = total > 0 ? tokens / total : 0.3;
      rateMeter.push(total, now);
      const tokensPerSecond = Math.round(rateMeter.tokensPerSecond(now, tokensPerChar) * 10) / 10;

      if (tokensPerSecond > 0) idleTicks = 0;
      else idleTicks += 1;

      if (hasRunningActivity) phase = "tool";
      else if (tokensPerSecond > 0) phase = answeringPhase();
      else if (idleTicks >= idleTicksBeforeWaiting) phase = "waiting";
      else if (total === 0) phase = "starting";
      else phase = answeringPhase();

      return { phase, tokens, tokensPerSecond, idleTicks };
    }
  };
}
