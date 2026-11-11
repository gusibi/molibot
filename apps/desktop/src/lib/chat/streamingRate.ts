/**
 * Client-side streaming-pace estimation for the pinned run-status row.
 * Stream deltas carry no token counts, so tokens are estimated from the
 * character mix (CJK chars sit near one token each in modern BPE vocabs;
 * other scripts average roughly four chars per token) and the rate is a
 * short sliding-window average, which reads steadier than per-second
 * bursts while still decaying to zero quickly once growth stops — a stall
 * must look like a stall, not linger as a diluted average. The UI marks
 * the number as an estimate (≈).
 */

const CJK_PATTERN = /[\u2E80-\u9FFF\u3400-\u4DBF\uF900-\uFAFF\u3000-\u303F\uFF01-\uFF5E\uFF00-\uFFEF]/g;

export function estimateTokens(text: string): number {
  const cjk = (text.match(CJK_PATTERN) ?? []).length;
  const other = text.length - cjk;
  return Math.max(1, Math.round(cjk * 0.75 + other / 4));
}

export function createStreamRateMeter(windowMs = 2500) {
  let samples: Array<{ at: number; chars: number }> = [];
  let lastTotal = 0;

  return {
    /** Feed the cumulative streamed length; a rewind (new turn, replace) restarts the window. */
    push(total: number, now: number): void {
      if (total < lastTotal) samples = [];
      lastTotal = total;
      samples.push({ at: now, chars: total });
      const cutoff = now - windowMs;
      while (samples.length > 1 && samples[0].at < cutoff) samples.shift();
    },

    /** Estimated tokens/second over the window; 0 once growth has stopped or gone stale. */
    tokensPerSecond(now: number, tokensPerChar: number): number {
      const last = samples[samples.length - 1];
      if (samples.length < 2 || !last || now - last.at > windowMs) return 0;
      const grown = last.chars - samples[0].chars;
      const elapsed = last.at - samples[0].at;
      if (grown <= 0 || elapsed <= 0) return 0;
      return (grown / elapsed) * 1000 * tokensPerChar;
    }
  };
}
