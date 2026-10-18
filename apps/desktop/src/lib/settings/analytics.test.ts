import assert from "node:assert/strict";
import test from "node:test";
import { cacheHitRate, compactCount, estimatedUsd, modelSuccessRate, percentage } from "./analytics";
import { trendLinePath, trendY } from "./charts";

test("trend curves stay within each pair of recorded values, including zero plateaus", () => {
  const values = [0, 0, 100, 0, 0, 70, 100, 100];
  const segments = [...trendLinePath(values, 100).matchAll(/C([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+)/g)];
  assert.equal(segments.length, values.length - 1);
  segments.forEach((segment, index) => {
    const start = trendY(values[index], 100);
    const end = trendY(values[index + 1], 100);
    const firstControl = Number(segment[2]);
    const secondControl = Number(segment[4]);
    for (let step = 0; step <= 100; step += 1) {
      const t = step / 100;
      const y = (1 - t) ** 3 * start + 3 * (1 - t) ** 2 * t * firstControl + 3 * (1 - t) * t ** 2 * secondControl + t ** 3 * end;
      assert.ok(y >= Math.min(start, end) - 0.001 && y <= Math.max(start, end) + 0.001, `segment ${index} invents an extremum at ${t}: ${y}`);
    }
  });
});

test("cache includes writes in the input denominator and distinguishes empty input", () => {
  const totals = { requests: 2, inputTokens: 100, outputTokens: 900, cacheReadTokens: 600, cacheWriteTokens: 300, totalTokens: 1900 };
  assert.equal(cacheHitRate(totals), 60);
  assert.equal(cacheHitRate({ ...totals, inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }), null);
  assert.equal(percentage(null), "—");
});

test("success rate excludes unfinished, cancelled, blocked and unknown requests", () => {
  const outcomes = { success: 17, error: 3, pending: 10, aborted: 4, blocked: 2, other: 6 };
  assert.equal(modelSuccessRate(outcomes), 85);
  assert.equal(modelSuccessRate({ ...outcomes, success: 0, error: 0 }), null);
  assert.equal(percentage(modelSuccessRate(outcomes)), "85%");
  assert.equal(compactCount(755803), "755.8K");
  assert.equal(compactCount(0), "0");
});


test("recorded costs distinguish missing estimates from zero and preserve small costs", () => {
  assert.equal(estimatedUsd(null), "—");
  assert.equal(estimatedUsd(0), "$0.00");
  assert.equal(estimatedUsd(0.000025), "$0.000025");
});
