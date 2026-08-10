/**
 * Durable Execution cold-start acceptance, driven through the public API.
 *
 * PRD §430: "The recovery harness must be able to stop the scratch service at a
 * declared fault point, restart it with the same temporary data directory, and
 * continue through the public API. This seam proves persistence, process
 * ownership, event dispatch, Runner continuation and user-visible status
 * together."
 *
 * That had been done once by hand and written up in findings.md, which proves
 * it worked that day and nothing about tomorrow. This is the same walk as a
 * script, so a regression in persistence, startup reconcile or status
 * projection fails a command instead of waiting for someone to repeat the
 * manual run.
 *
 * What it deliberately does NOT do: call a model. Activation here is explicit
 * (`action: "create"`), because the property under test is what survives a
 * process boundary, not whether a model decides to promote a turn. Keeping the
 * model out is what makes this runnable in CI and deterministic — the lazy
 * promotion path has its own focused tests.
 *
 *   node evals/durable-restart-live.mjs
 *   node evals/durable-restart-live.mjs --keep-data-dir
 */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  createScratchDataDir,
  findFreePort,
  removeScratchDataDir,
  startScratchService,
  stopScratchService
} from "./lib/service.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const keepDataDir = process.argv.includes("--keep-data-dir");
const OWNER = "owner";

const checks = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok, detail });
  const mark = ok ? "PASS" : "FAIL";
  console.log(`  ${mark}  ${name}${detail ? `\n         ${detail}` : ""}`);
}

async function api(endpoint, pathname, init = {}) {
  const url = `${endpoint}${pathname}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      // Same-origin: this client started the service it is talking to. See the
      // note in evals/lib/client.mjs — the trusted-origin list is not the place
      // to work around a header a harness simply failed to send.
      origin: new URL(endpoint).origin,
      ...(init.headers ?? {})
    }
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

function listUrl() {
  return `/api/desktop/durable-executions?ownerId=${encodeURIComponent(OWNER)}`;
}

function inspectUrl(id) {
  return `${listUrl()}&id=${encodeURIComponent(id)}`;
}

/**
 * Put an execution into the state a crash actually leaves behind: `running`,
 * holding a lease owned by a process id that is now gone, with a `running`
 * step and a `running` attempt.
 *
 * This is done against the stopped service's database on purpose. Reaching that
 * state through the API would need a model to drive a real attempt and a kill
 * timed inside its tool call — nondeterministic, slow, and it would still only
 * produce the rows written here. `reconcileOrphanedAttempts` selects exactly
 * `status IN ('running','verifying') AND lease_owner_id != <this process>`, so
 * this is the input that startup recovery is written against.
 *
 * Two ordering traps, both hit while writing this:
 *
 * 1. The first version left the probe in `queued`, holding no lease, so it
 *    reached `recovery_required` through the missed-continuation seam instead.
 *    Every check still passed with `reconcile()` stubbed to `return 0` — a
 *    green harness asserting nothing. The startup-log check below is what makes
 *    reconcile load-bearing here.
 * 2. `create` + `activate` dispatches a real attempt immediately. That attempt
 *    keeps writing after the API call returns, so an injection racing it is
 *    silently overwritten. The injection therefore happens only after the
 *    service is stopped (no writer left) and is read back before continuing.
 */
function markExecutionCrashed(dataDir, executionId) {
  const db = new DatabaseSync(path.join(dataDir, "db", "durable-execution.sqlite"));
  try {
    const deadOwner = "dead-process-owner-from-a-previous-boot";
    const leaseExpiry = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    db.prepare(
      `UPDATE durable_executions
         SET status = 'running', lease_owner_id = ?, lease_expires_at = ?
       WHERE id = ?`
    ).run(deadOwner, leaseExpiry, executionId);
    db.prepare(
      `UPDATE durable_steps SET status = 'running'
        WHERE execution_id = ? AND id = (
          SELECT id FROM durable_steps WHERE execution_id = ? ORDER BY step_index LIMIT 1
        )`
    ).run(executionId, executionId);
    const planVersion = db
      .prepare("SELECT MAX(plan_version) AS v FROM durable_steps WHERE execution_id = ?")
      .get(executionId)?.v ?? 1;
    db.prepare(
      `INSERT INTO durable_attempts
         (id, execution_id, owner_id, run_id, context_session_id, plan_version, status, started_at)
       VALUES (?, ?, ?, ?, ?, ?, 'running', ?)`
    ).run(
      `att-crashed-${executionId}`,
      executionId,
      OWNER,
      `run-crashed-${executionId}`,
      `s-crashed-${executionId}`,
      planVersion,
      new Date().toISOString()
    );
    const row = db.prepare("SELECT status, lease_owner_id FROM durable_executions WHERE id = ?").get(executionId);
    return { status: row?.status, leaseOwner: row?.lease_owner_id };
  } finally {
    db.close();
  }
}

async function main() {
  const dataDir = createScratchDataDir({ seedFrom: process.env.MOLIBOT_EVAL_SEED_FROM });
  const port = await findFreePort();
  console.log(`scratch DATA_DIR : ${dataDir}`);
  console.log(`port             : ${port}`);

  let service = null;
  let executionId = null;
  try {
    // ---- Phase 1: first process creates and activates an execution ----------
    console.log("\nPhase 1 · create and activate");
    service = await startScratchService({ repoRoot, dataDir, port });
    console.log(`service ready    : ${service.endpoint}`);

    const created = await api(service.endpoint, "/api/desktop/durable-executions", {
      method: "POST",
      body: JSON.stringify({
        action: "create",
        ownerId: OWNER,
        botId: "default",
        sourceChannel: "web",
        sourceChatId: "web:personal:durable-live",
        goal: "Durable restart acceptance probe",
        activationPath: "deterministic",
        // A plan is required: the aggregate stores steps and criteria as rows,
        // never as prose the model can rewrite (PRD §482 / ADR 0004).
        steps: [
          { title: "Step one", description: "A step that outlives the process." },
          { title: "Step two", description: "Still pending when the service dies." }
        ],
        acceptanceCriteria: [
          { description: "The execution survives a restart", required: true, checkerType: "deterministic" }
        ]
      })
    });
    check(
      "create returns an activated execution",
      created.status === 200 && created.body?.ok === true && Boolean(created.body?.item?.execution?.id),
      created.status === 200 ? "" : `status=${created.status} body=${JSON.stringify(created.body).slice(0, 200)}`
    );
    executionId = created.body?.item?.execution?.id ?? null;
    if (!executionId) throw new Error("no execution id; cannot continue");

    const activeStatus = created.body.item.execution.status;
    check(
      "a newly activated execution is not terminal",
      !["completed", "failed", "cancelled", "partial"].includes(activeStatus),
      `status=${activeStatus}`
    );

    // ---- Phase 2: kill the process mid-flight -------------------------------
    // SIGTERM through the same helper the eval runner uses, so the lease and
    // signal handling are the real ones, not a test double.
    console.log("\nPhase 2 · stop the service (the fault point)");
    await stopScratchService(service);
    service = null;
    check("service stopped", true);

    // Leave behind exactly what a crash leaves behind, now that no process
    // holds the database open.
    const crashed = markExecutionCrashed(dataDir, executionId);
    check(
      "the stopped service left a `running` execution holding a dead process's lease",
      crashed.status === "running" && Boolean(crashed.leaseOwner),
      `status=${crashed.status} leaseOwner=${crashed.leaseOwner}`
    );

    // ---- Phase 3: restart on the SAME data dir -----------------------------
    console.log("\nPhase 3 · restart on the same DATA_DIR");
    let startupLog = "";
    service = await startScratchService({
      repoRoot,
      dataDir,
      port,
      onLog: (chunk) => { startupLog += chunk; }
    });
    console.log(`service ready    : ${service.endpoint}`);

    // Deep health builds the runtime, and `reconcile()` runs inside that same
    // initialization — but the probe returns as soon as the route answers, so
    // poll for the reclaimed state instead of reading once and racing it.
    let found = null;
    for (let i = 0; i < 20; i++) {
      const list = await api(service.endpoint, listUrl());
      found = (list.body?.items ?? []).find((item) => item.execution?.id === executionId) ?? null;
      if (found && found.execution?.status !== "running") break;
      await new Promise((r) => setTimeout(r, 500));
    }
    const items = found ? [found] : [];

    // Reconcile must be what reclaimed it, not some later sweep: the startup
    // pass reports the count it took over. Without this the checks below would
    // still pass with `reconcile()` stubbed out, because other seams can also
    // move an execution out of `running`.
    const reconcileLine = startupLog
      .split("\n")
      .find((line) => line.includes("durable_execution_reconciled"));
    check(
      "startup runs the durable reconcile pass and reports what it reclaimed",
      Boolean(reconcileLine),
      reconcileLine?.trim() ?? "(no durable_execution_reconciled line in startup output)"
    );
    check(
      "the execution survives the restart and is still listed",
      Boolean(found),
      found ? "" : `listed ids: ${items.map((i) => i.execution?.id).join(", ") || "(none)"}`
    );

    // The central claim of pitfall 23: age is not liveness. The lease was still
    // 10 minutes from expiry, so a timeout-based sweep would have left this
    // pinned as `running` forever — which is the production bug that rule came
    // from. Ownership, not age, is what has to reclaim it.
    const afterStatus = found?.execution?.status;
    check(
      "startup reconcile reclaims an unexpired lease owned by a dead process",
      afterStatus === "recovery_required",
      `status=${afterStatus}`
    );

    const detail = await api(service.endpoint, inspectUrl(executionId));
    check(
      "inspect still resolves the execution after restart",
      detail.status === 200 && detail.body?.ok === true,
      detail.status === 200 ? `status=${detail.body?.item?.execution?.status}` : `status=${detail.status}`
    );

    const attempts = detail.body?.item?.attempts ?? [];
    const liveAttempts = attempts.filter((a) => a.status === "running");
    check(
      "no attempt is left in `running` after the owning process died",
      liveAttempts.length === 0,
      `attempt statuses: ${attempts.map((a) => a.status).join(", ") || "(none)"}`
    );
    check(
      "the orphaned attempt is recorded as interrupted, not failed",
      attempts.some((a) => a.status === "interrupted"),
      `attempt statuses: ${attempts.map((a) => a.status).join(", ") || "(none)"}`
    );
    const uncertainSteps = (detail.body?.item?.steps ?? []).filter((s) => s.status === "uncertain");
    check(
      "a step that was running becomes `uncertain`, never silently `pending`",
      uncertainSteps.length > 0,
      `step statuses: ${(detail.body?.item?.steps ?? []).map((s) => s.status).join(", ") || "(none)"}`
    );

    // ---- Phase 4: the public API still drives it ---------------------------
    // A recovered execution has to remain operable, not just visible: the whole
    // point of the restart contract is that the user can still act on it.
    console.log("\nPhase 4 · the recovered execution is still operable");
    const cancelActionId = `live-cancel-${Date.now()}`;
    const cancelBody = {
      action: "cancel",
      ownerId: OWNER,
      executionId,
      expectedVersion: detail.body?.item?.execution?.version,
      // Control actions are keyed so a retried delivery cannot apply twice.
      actionId: cancelActionId,
      reason: "durable restart acceptance probe"
    };
    const cancelled = await api(service.endpoint, "/api/desktop/durable-executions", {
      method: "POST",
      body: JSON.stringify(cancelBody)
    });
    check(
      "a recovered execution can still be cancelled through the public API",
      cancelled.status === 200 && cancelled.body?.ok === true,
      cancelled.status === 200 ? "" : `status=${cancelled.status} body=${JSON.stringify(cancelled.body).slice(0, 200)}`
    );

    const finalDetail = await api(service.endpoint, inspectUrl(executionId));
    check(
      "cancellation is terminal and persisted",
      finalDetail.body?.item?.execution?.status === "cancelled",
      `status=${finalDetail.body?.item?.execution?.status}`
    );

    // "取消不重启" (PRD user story 21) starts with the control action itself
    // being idempotent: a redelivered cancel must not produce a second
    // transition or resurrect the execution.
    const replay = await api(service.endpoint, "/api/desktop/durable-executions", {
      method: "POST",
      body: JSON.stringify(cancelBody)
    });
    const afterReplay = await api(service.endpoint, inspectUrl(executionId));
    check(
      "replaying the same cancel action leaves it cancelled",
      afterReplay.body?.item?.execution?.status === "cancelled",
      `replay status=${replay.status}, execution status=${afterReplay.body?.item?.execution?.status}`
    );
  } finally {
    if (service) await stopScratchService(service);
    removeScratchDataDir(dataDir, { keep: keepDataDir });
    if (keepDataDir) console.log(`\nkept scratch data dir: ${dataDir}`);
  }

  const failed = checks.filter((c) => !c.ok);
  console.log("\n" + "─".repeat(64));
  console.log(`DURABLE RESTART  ${checks.length - failed.length}/${checks.length}`);
  if (failed.length > 0) {
    console.log("\nfailed:");
    for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ""}`);
    process.exitCode = 1;
  }
}

await main();
