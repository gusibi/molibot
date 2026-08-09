/**
 * Turning results into a scoreboard.
 *
 * `unproven` is a first-class outcome, separate from pass and fail. A task
 * whose only check needs a judge model that was not configured has not passed —
 * counting it either way would make the headline number a lie in one direction
 * or the other, and the headline number is the whole point of this harness.
 */

const GROUP_TITLES = {
  A: "基础工具",
  B: "输入摄入",
  C: "记忆",
  D: "任务与调度",
  E: "会话",
  F: "失败姿态",
  G: "代码改动",
  H: "扩展面"
};

const SYMBOL = { pass: "PASS", fail: "FAIL", unproven: "????", error: "ERR ", skipped: "skip" };

export function summarize(results) {
  const totals = { pass: 0, fail: 0, unproven: 0, error: 0, skipped: 0 };
  for (const result of results) totals[result.status] += 1;
  const scored = totals.pass + totals.fail + totals.unproven + totals.error;
  return { totals, scored, score: scored === 0 ? 0 : totals.pass / scored };
}

/** Tasks whose outcome contradicts the prediction written into the YAML. */
export function baselineSurprises(results) {
  return results.filter((result) => {
    if (result.status === "skipped" || result.baseline === "unknown") return false;
    if (result.baseline === "pass") return result.status !== "pass";
    if (result.baseline === "fail") return result.status === "pass";
    return false;
  });
}

export function renderReport(results, { elapsedMs } = {}) {
  const lines = [];
  const groups = new Map();
  for (const result of results) {
    if (!groups.has(result.group)) groups.set(result.group, []);
    groups.get(result.group).push(result);
  }

  for (const [group, groupResults] of [...groups.entries()].sort()) {
    const passed = groupResults.filter((result) => result.status === "pass").length;
    const scored = groupResults.filter((result) => result.status !== "skipped").length;
    lines.push("");
    lines.push(`${group} · ${GROUP_TITLES[group] ?? group}   ${passed}/${scored}`);
    for (const result of groupResults) {
      lines.push(`  ${SYMBOL[result.status]}  ${result.id.padEnd(3)} ${result.title}`);
      for (const check of result.checks ?? []) {
        if (check.ok === true) continue;
        const mark = check.ok === null ? "?" : "x";
        lines.push(`         ${mark} ${check.kind}${check.detail ? `: ${check.detail}` : ""}`);
      }
      if (result.error) lines.push(`         ! ${result.error}`);
    }
  }

  const { totals, scored, score } = summarize(results);
  lines.push("");
  lines.push("─".repeat(64));
  lines.push(
    `BASELINE  ${totals.pass}/${scored}  (${(score * 100).toFixed(0)}%)   ` +
      `fail ${totals.fail} · unproven ${totals.unproven} · error ${totals.error} · skipped ${totals.skipped}` +
      (elapsedMs ? `   ${(elapsedMs / 1000).toFixed(0)}s` : "")
  );

  const surprises = baselineSurprises(results);
  if (surprises.length > 0) {
    lines.push("");
    lines.push("与预期不符（YAML 里的 baseline 需要更新，或者这是一个回归）:");
    for (const result of surprises) {
      lines.push(`  ${result.id}  预期 ${result.baseline} → 实际 ${result.status}`);
    }
  }
  return lines.join("\n");
}
