<script lang="ts">
  import type {
    DesktopDurableExecutionActionRequest,
    DesktopDurableExecutionEvidenceRead,
    DesktopDurableExecutionInspection,
    DesktopDurableExecutionStatus
  } from "@molibot/desktop-contract";
  import { loadDesktopDurableEvidence, loadDesktopDurableExecution, runDesktopDurableExecutionAction } from "../api";
  import type { Translation } from "../i18n";

  export let endpoint: string;
  export let executionId: string;
  export let copy: Translation;
  export let onClose: () => void;
  export let onChanged: () => void = () => {};

  let detail: DesktopDurableExecutionInspection | null = null;
  let loading = false;
  let busy = false;
  let error = "";
  let loadedKey = "";
  let requestKey = "";
  let evidenceReads: Record<string, DesktopDurableExecutionEvidenceRead> = {};

  const statusKeys: Record<DesktopDurableExecutionStatus, keyof Translation> = {
    planned: "durableStatusPlanned",
    queued: "durableStatusQueued",
    running: "durableStatusRunning",
    verifying: "durableStatusVerifying",
    waiting_for_user: "durableStatusWaitingForUser",
    waiting_for_approval: "durableStatusWaitingForApproval",
    paused: "durableStatusPaused",
    recovery_required: "durableStatusRecoveryRequired",
    partial: "durableStatusPartial",
    completed: "durableStatusCompleted",
    failed: "durableStatusFailed",
    cancelled: "durableStatusCancelled"
  };

  $: requestKey = endpoint + "|" + executionId;
  $: if (requestKey && requestKey !== loadedKey) {
    loadedKey = requestKey;
    detail = null;
    error = "";
    evidenceReads = {};
    void loadDetail();
  }
  $: currentPlanVersion = detail?.execution.currentPlanVersion ?? -1;
  $: currentSteps = detail
    ? detail.steps
      .filter((step) => step.planVersion === currentPlanVersion)
      .sort((left, right) => left.index - right.index)
    : [];
  $: currentCriteria = detail
    ? detail.acceptanceCriteria.filter((criterion) => criterion.planVersion === currentPlanVersion)
    : [];
  $: openDecisions = detail?.decisions.filter((decision) => decision.status === "open") ?? [];
  $: progress = detail && detail.projection.progress.total > 0
    ? Math.round(detail.projection.progress.completed / detail.projection.progress.total * 100)
    : 0;

  async function loadDetail(): Promise<void> {
    loading = true;
    try {
      detail = await loadDesktopDurableExecution(endpoint, executionId);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loading = false;
    }
  }

  function actionId(action: string): string {
    return "desktop-durable-" + action + "-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
  }

  async function runAction(action: "pause" | "resume" | "cancel"): Promise<void> {
    if (!detail || busy) return;
    if (action === "cancel" && !window.confirm(copy.durableCancelConfirm)) return;
    const input: DesktopDurableExecutionActionRequest = action === "pause"
      ? { action: "pause", executionId, expectedVersion: detail.execution.version, actionId: actionId(action) }
      : action === "resume"
        ? { action: "resume", executionId, expectedVersion: detail.execution.version, actionId: actionId(action) }
        : { action: "cancel", executionId, expectedVersion: detail.execution.version, actionId: actionId(action) };
    busy = true;
    error = "";
    try {
      await runDesktopDurableExecutionAction(endpoint, input);
      await loadDetail();
      onChanged();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      busy = false;
    }
  }

  function decisionOptionLabel(option: string): string {
    if (option === "confirm_completion") return copy.durableConfirmCompletion;
    if (option === "continue_work") return copy.durableContinueWorking;
    if (option === "retry_after_recovery_review") return copy.durableRetryAfterRecoveryReview;
    return option;
  }

  function approvalOptionLabel(option: string): string {
    if (option === "approve_once") return copy.durableApproveOnce;
    if (option === "approve_session") return copy.durableApproveSession;
    if (option === "approve_persistent") return copy.durableApprovePersistent;
    if (option === "reject") return copy.durableReject;
    return option;
  }

  async function answerDecision(decisionId: string, answer: string): Promise<void> {
    if (!detail || busy) return;
    busy = true;
    error = "";
    const input: DesktopDurableExecutionActionRequest = {
      action: "answer_decision",
      executionId,
      decisionId,
      answer,
      expectedVersion: detail.execution.version,
      actionId: actionId("answer")
    };
    try {
      await runDesktopDurableExecutionAction(endpoint, input);
      await loadDetail();
      onChanged();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      busy = false;
    }
  }

  async function resolveApproval(approvalId: string, option: string): Promise<void> {
    if (!detail || busy) return;
    busy = true;
    error = "";
    const input: DesktopDurableExecutionActionRequest = {
      action: "resolve_approval",
      executionId,
      approvalId,
      status: option === "reject" ? "rejected" : "approved",
      ...(option === "approve_session" ? { selectedScope: "session" } : {}),
      ...(option === "approve_persistent" ? { selectedScope: "persistent" } : {}),
      ...(option === "approve_once" ? { selectedScope: "once" } : {}),
      expectedVersion: detail.execution.version,
      actionId: actionId("approval")
    };
    try {
      await runDesktopDurableExecutionAction(endpoint, input);
      await loadDetail();
      onChanged();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      busy = false;
    }
  }

  async function readEvidence(evidenceId: string): Promise<void> {
    if (!detail || busy) return;
    busy = true;
    error = "";
    try {
      const evidence = await loadDesktopDurableEvidence(endpoint, executionId, evidenceId);
      evidenceReads = { ...evidenceReads, [evidenceId]: evidence };
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      busy = false;
    }
  }

  function statusLabel(status: DesktopDurableExecutionStatus): string {
    return copy[statusKeys[status]];
  }
</script>

<aside class="durable-inspector" aria-label={copy.durableExecution}>
  <header class="durable-inspector-head">
    <div>
      <p class="durable-inspector-eyebrow">{copy.durableExecution} · {detail?.execution.shortHandle ?? "…"}</p>
      <h2>{detail?.execution.goal ?? copy.loading}</h2>
    </div>
    <button type="button" class="durable-inspector-close" aria-label={copy.closePanel} title={copy.closePanel} onclick={onClose}>
      <i class="ph ph-x" aria-hidden="true"></i>
    </button>
  </header>

  {#if loading && !detail}
    <div class="durable-inspector-empty" role="status"><i class="ph ph-spinner-gap" aria-hidden="true"></i>{copy.loading}</div>
  {:else if error && !detail}
    <div class="durable-inspector-empty" role="alert"><p>{copy.durableLoadFailed}</p><small>{error}</small><button type="button" class="secondary-button" onclick={() => void loadDetail()}>{copy.retryLoading}</button></div>
  {:else if detail}
    <div class="durable-inspector-scroll">
      <section class="durable-inspector-summary">
        <div class="durable-inspector-status" data-status={detail.execution.status}>
          <span class="durable-inspector-status-dot" aria-hidden="true"></span>
          <span>{statusLabel(detail.execution.status)}</span>
        </div>
        <div class="durable-inspector-progress">
          <div class="durable-inspector-progress-track" aria-hidden="true"><span style={"width: " + progress + "%"}></span></div>
          <span>{detail.projection.progress.completed}/{detail.projection.progress.total}</span>
        </div>
        {#if detail.projection.queuePosition !== undefined}
          <p class="durable-inspector-queue">{copy.durableStatusQueued} · {copy.durableQueueAhead.replace("{count}", String(Math.max(0, detail.projection.queuePosition - 1)))}</p>
        {/if}
        {#if detail.execution.waitingReason}
          <p class="durable-inspector-waiting"><strong>{copy.durableWaitingReason}</strong>{detail.execution.waitingReason}</p>
        {/if}
        {#if detail.execution.lastError}
          <p class="durable-inspector-error">{detail.execution.lastError}</p>
        {/if}
      </section>

      <section class="durable-inspector-section">
        <h3>{copy.durableProgress}</h3>
        <ol class="durable-step-list">
          {#each currentSteps as step (step.id)}
            <li class="durable-step" data-status={step.status}>
              <span class="durable-step-index" aria-hidden="true">{step.status === "completed" ? "✓" : step.index + 1}</span>
              <span class="durable-step-copy"><strong>{step.title}</strong><small>{step.description || step.sideEffectClass}</small></span>
              <span class="durable-step-status">{step.status}</span>
            </li>
          {/each}
        </ol>
      </section>

      <section class="durable-inspector-section">
        <h3>{copy.durableCriteria}</h3>
        {#if currentCriteria.length > 0}
          <ul class="durable-criteria-list">
            {#each currentCriteria as criterion (criterion.id)}
              <li data-result={criterion.result}><i class={"ph " + (criterion.result === "passed" ? "ph-check-circle" : criterion.result === "failed" ? "ph-x-circle" : "ph-question")} aria-hidden="true"></i><span>{criterion.description}</span></li>
            {/each}
          </ul>
        {/if}
        <p class="durable-criteria-summary">
          {copy.durableCriteriaSummary
            .replace("{passed}", String(detail.projection.requiredCriteria.passed))
            .replace("{unproven}", String(detail.projection.requiredCriteria.unproven))
            .replace("{failed}", String(detail.projection.requiredCriteria.failed))}
        </p>
      </section>

      {#if detail.evidenceRefs.length > 0}
        <section class="durable-inspector-section">
          <h3>{copy.durableEvidence}</h3>
          <div class="durable-evidence-list">
            {#each detail.evidenceRefs as evidence (evidence.id)}
              <article class="durable-evidence" data-status={evidence.status}>
                <div class="durable-evidence-head">
                  <span>{evidence.summary}</span>
                  <button type="button" class="secondary-button" disabled={busy} onclick={() => void readEvidence(evidence.id)}>
                    {copy.durableReadEvidence}
                  </button>
                </div>
                {#if evidenceReads[evidence.id]}
                  {@const read = evidenceReads[evidence.id]}
                  {#if read.content}
                    <pre class="durable-evidence-content">{read.content}</pre>
                    <small class="durable-evidence-note">{copy.durableEvidenceUntrusted}{read.truncated ? ` ${copy.durableEvidenceUnavailable}` : ""}</small>
                  {:else}
                    <small class="durable-evidence-note">{read.unavailableReason ?? copy.durableEvidenceUnavailable}</small>
                  {/if}
                {:else if evidence.status === "unavailable"}
                  <small class="durable-evidence-note">{evidence.unavailableReason ?? copy.durableEvidenceUnavailable}</small>
                {/if}
              </article>
            {/each}
          </div>
        </section>
      {/if}

      {#if openDecisions.length > 0}
        <section class="durable-inspector-section durable-decision-section">
          <h3>{copy.durableDecision}</h3>
          {#each openDecisions as decision (decision.id)}
            <div class="durable-decision" data-decision-id={decision.id}>
              <p>{decision.question}</p>
              <div class="durable-decision-options">
                {#each decision.options as option (option)}
                  <button type="button" class="secondary-button" disabled={busy} onclick={() => void answerDecision(decision.id, option)}>
                    {decisionOptionLabel(option)}
                  </button>
                {/each}
              </div>
            </div>
          {/each}
        </section>
      {/if}

      {#if detail.approvals.some((approval) => approval.status === "pending")}
        <section class="durable-inspector-section durable-decision-section">
          <h3>{copy.durableApproval}</h3>
          {#each detail.approvals.filter((approval) => approval.status === "pending") as approval (approval.id)}
            <div class="durable-decision durable-approval" data-approval-id={approval.id}>
              <p><strong>{approval.title}</strong></p>
              <p>{approval.summary}</p>
              {#if approval.repeatCount > 1}<small>{copy.durableApprovalRepeat.replace("{count}", String(approval.repeatCount))}</small>{/if}
              <div class="durable-decision-options">
                {#each approval.options as option (option)}
                  <button type="button" class={option === "reject" ? "danger-button" : "secondary-button"} disabled={busy} onclick={() => void resolveApproval(approval.id, option)}>
                    {approvalOptionLabel(option)}
                  </button>
                {/each}
              </div>
            </div>
          {/each}
        </section>
      {/if}
    </div>

    {#if error}<p class="durable-inspector-action-error" role="alert">{error}</p>{/if}
    <footer class="durable-inspector-actions">
      {#if detail.execution.status === "paused" || detail.execution.status === "recovery_required"}
        <button type="button" class="primary-button" disabled={busy} onclick={() => void runAction("resume")}>{busy ? copy.loading : copy.durableResume}</button>
      {:else if detail.execution.status === "planned" || detail.execution.status === "queued" || detail.execution.status === "running"}
        <button type="button" class="secondary-button" disabled={busy} onclick={() => void runAction("pause")}>{copy.durablePause}</button>
      {/if}
      {#if !["completed", "failed", "cancelled"].includes(detail.execution.status)}
        <button type="button" class="danger-button" disabled={busy} onclick={() => void runAction("cancel")}>{copy.durableCancel}</button>
      {/if}
    </footer>
  {/if}
</aside>

<style>
  .durable-inspector {
    display: flex;
    min-width: 0;
    min-height: 0;
    flex-direction: column;
    height: 100%;
    background: var(--artifact-canvas, var(--surface-secondary));
    color: var(--label-primary);
  }
  .durable-inspector-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    height: 42px;
    min-height: 42px;
    box-sizing: border-box;
    padding: 0 14px;
    border-bottom: 1px solid var(--separator);
    background: var(--card-bg);
  }
  .durable-inspector-head > div { min-width: 0; flex: 1; display: flex; align-items: center; gap: 8px; }
  .durable-inspector-eyebrow { margin: 0; color: var(--label-tertiary); font-size: var(--fs-meta); line-height: 1; font-family: var(--font-mono); }
  .durable-inspector-head h2 { overflow: hidden; margin: 0; font-size: var(--fs-label); line-height: var(--lh-label); font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
  .durable-inspector-close {
    display: grid;
    flex: none;
    place-items: center;
    width: 28px;
    height: 28px;
    border: 0;
    border-radius: var(--radius-small);
    background: transparent;
    color: var(--label-secondary);
    cursor: pointer;
  }
  .durable-inspector-close:hover { background: var(--fill); color: var(--label-primary); }
  .durable-inspector-close:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--card-bg), 0 0 0 4px var(--accent); }
  .durable-inspector-scroll { min-height: 0; flex: 1; overflow: auto; }
  .durable-inspector-summary,
  .durable-inspector-section { padding: 16px; border-bottom: 1px solid var(--separator); }
  .durable-inspector-status { display: inline-flex; align-items: center; gap: 7px; color: var(--label-secondary); font-size: var(--fs-label); font-weight: 600; }
  .durable-inspector-status-dot { width: 8px; height: 8px; border-radius: var(--radius-full); background: var(--accent); }
  .durable-inspector-status[data-status="completed"] .durable-inspector-status-dot { background: var(--online); }
  .durable-inspector-status[data-status="failed"] .durable-inspector-status-dot,
  .durable-inspector-status[data-status="cancelled"] .durable-inspector-status-dot { background: var(--danger); }
  .durable-inspector-status[data-status="waiting_for_user"] .durable-inspector-status-dot,
  .durable-inspector-status[data-status="waiting_for_approval"] .durable-inspector-status-dot,
  .durable-inspector-status[data-status="recovery_required"] .durable-inspector-status-dot { background: var(--warning); }
  .durable-inspector-progress { display: flex; align-items: center; gap: 10px; margin-top: 14px; color: var(--label-secondary); font-size: var(--fs-label); line-height: var(--lh-label); font-family: var(--font-mono); }
  .durable-inspector-progress-track { flex: 1; height: 6px; overflow: hidden; border-radius: var(--radius-full); background: var(--fill); }
  .durable-inspector-progress-track span { display: block; height: 100%; border-radius: inherit; background: var(--accent); transition: width 180ms var(--ease-standard); }
  .durable-inspector-waiting,
  .durable-inspector-error { margin: 12px 0 0; padding: 9px 10px; border-radius: var(--radius-control); color: var(--label-secondary); font-size: var(--fs-meta); line-height: var(--lh-meta); }
  .durable-inspector-waiting { background: color-mix(in srgb, var(--warning) 10%, transparent); }
  .durable-inspector-waiting strong { display: block; margin-bottom: 2px; color: var(--label-primary); }
  .durable-inspector-error { background: color-mix(in srgb, var(--danger) 9%, transparent); color: var(--danger); }
  .durable-inspector-section h3 { margin: 0 0 10px; color: var(--label-secondary); font-size: var(--fs-meta); font-weight: 600; }
  .durable-step-list,
  .durable-criteria-list { display: grid; gap: 7px; margin: 0; padding: 0; list-style: none; }
  .durable-step { display: flex; align-items: flex-start; gap: 8px; min-width: 0; }
  .durable-step-index { display: grid; flex: none; place-items: center; width: 20px; height: 20px; border: 1px solid var(--separator); border-radius: var(--radius-full); color: var(--label-secondary); font-size: var(--fs-meta); line-height: var(--lh-meta); font-family: var(--font-mono); }
  .durable-step[data-status="completed"] .durable-step-index { border-color: var(--online); color: var(--online); }
  .durable-step[data-status="uncertain"] .durable-step-index { border-color: var(--warning); color: var(--warning); }
  .durable-step-copy { display: grid; min-width: 0; flex: 1; gap: 1px; }
  .durable-step-copy strong { font-size: var(--fs-label); line-height: var(--lh-label); font-weight: 500; }
  .durable-step-copy small { overflow: hidden; color: var(--label-tertiary); font-size: var(--fs-meta); line-height: var(--lh-meta); text-overflow: ellipsis; white-space: nowrap; }
  .durable-step-status { flex: none; color: var(--label-tertiary); font-size: var(--fs-meta); line-height: var(--lh-meta); font-family: var(--font-mono); text-transform: uppercase; }
  .durable-criteria-list li { display: flex; align-items: flex-start; gap: 7px; color: var(--label-secondary); font-size: var(--fs-meta); line-height: var(--lh-meta); }
  .durable-criteria-list li i { flex: none; color: var(--label-tertiary); }
  .durable-criteria-list li[data-result="passed"] i { color: var(--online); }
  .durable-criteria-list li[data-result="failed"] i { color: var(--danger); }
  .durable-criteria-list li[data-result="unproven"] i { color: var(--warning); }
  .durable-criteria-summary { margin: 10px 0 0; color: var(--label-tertiary); font-size: var(--fs-meta); line-height: var(--lh-meta); }
  .durable-decision { display: grid; gap: 10px; padding: 10px; border: 1px solid color-mix(in srgb, var(--warning) 35%, var(--separator)); border-radius: var(--radius-control); background: color-mix(in srgb, var(--warning) 7%, transparent); }
  .durable-decision + .durable-decision { margin-top: 8px; }
  .durable-decision p { margin: 0; color: var(--label-secondary); font-size: var(--fs-meta); line-height: var(--lh-meta); }
  .durable-decision-options { display: flex; flex-wrap: wrap; gap: 7px; }
  .durable-decision-options button { min-height: 30px; padding: 0 10px; }
  .durable-evidence-list { display: grid; gap: 8px; }
  .durable-evidence { display: grid; gap: 8px; padding: 10px; border: 1px solid var(--separator); border-radius: var(--radius-control); background: var(--card-bg); }
  .durable-evidence-head { display: flex; align-items: flex-start; gap: 8px; color: var(--label-secondary); font-size: var(--fs-meta); line-height: var(--lh-meta); }
  .durable-evidence-head > span { min-width: 0; flex: 1; overflow-wrap: anywhere; }
  .durable-evidence-head button { flex: none; min-height: 28px; padding: 0 9px; }
  .durable-evidence-content { max-height: 260px; overflow: auto; margin: 0; padding: 9px; border-radius: var(--radius-control); background: var(--fill); color: var(--label-secondary); font-size: var(--fs-meta); line-height: var(--lh-meta); font-family: var(--font-mono); white-space: pre-wrap; overflow-wrap: anywhere; }
  .durable-evidence-note { color: var(--label-tertiary); font-size: var(--fs-meta); line-height: var(--lh-meta); }
  .durable-inspector-empty { display: grid; place-items: center; gap: 8px; min-height: 180px; padding: 24px; color: var(--label-secondary); text-align: center; }
  .durable-inspector-empty p { margin: 0; color: var(--label-primary); font-weight: 600; }
  .durable-inspector-empty small { max-width: 280px; overflow-wrap: anywhere; color: var(--label-tertiary); }
  .durable-inspector-action-error { margin: 0; padding: 8px 16px; color: var(--danger); font-size: var(--fs-meta); line-height: var(--lh-meta); }
  .durable-inspector-actions { display: flex; gap: 8px; padding: 12px 16px 16px; border-top: 1px solid var(--separator); background: var(--card-bg); }
  .durable-inspector-actions button { flex: 1; }
  .primary-button,
  .danger-button { min-height: 32px; padding: 0 12px; border: 1px solid transparent; border-radius: var(--rounded-sm); font: 500 var(--fs-label)/var(--lh-label) var(--font-ui); cursor: pointer; }
  .primary-button { background: var(--accent); color: var(--on-accent); }
  .primary-button:hover { background: var(--accent-hover); }
  .danger-button { border-color: color-mix(in srgb, var(--danger) 35%, var(--separator)); background: transparent; color: var(--danger); }
  .danger-button:hover { background: color-mix(in srgb, var(--danger) 8%, transparent); }
  .primary-button:focus-visible,
  .danger-button:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--card-bg), 0 0 0 4px var(--accent); }
  button:disabled { cursor: wait; opacity: .55; }
  @media (prefers-reduced-motion: reduce) {
    .durable-inspector-progress-track span { transition: none; }
  }
</style>
