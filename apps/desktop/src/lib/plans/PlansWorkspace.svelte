<script lang="ts">
  import { onMount } from "svelte";
  import Layers from "../icons/duotone/components/Layers.svelte";
  import Magnifier from "../icons/duotone/components/Magnifier.svelte";
  import CheckCircle from "reicon-svelte/icons/CheckCircle";
  import Help from "reicon-svelte/icons/Help";
  import Loader from "reicon-svelte/icons/Loader";
  import TriangleWarning from "reicon-svelte/icons/TriangleWarning";
  import X from "reicon-svelte/icons/X";
  import type {
    DesktopDurableExecutionStatus,
    DesktopPlanDetail,
    DesktopPlanListItem,
    DesktopPlanStatus,
    DesktopPlanTaskInput
  } from "@molibot/desktop-contract";
  import { loadDesktopPlan, loadDesktopPlans, runDesktopPlanAction } from "../api";
  import type { Translation } from "../i18n";

  export let copy: Translation;
  export let endpoint: string;
  export let formatTime: (iso: string) => string = (iso) => iso;

  type FilterBucket = "all" | DesktopPlanStatus;

  const filterOptions: FilterBucket[] = ["all", "not_started", "in_progress", "needs_attention", "finished", "archived"];
  const planStatusKeys: Record<DesktopPlanStatus, keyof Translation> = {
    not_started: "planBoardStatusNotStarted",
    in_progress: "planBoardStatusInProgress",
    needs_attention: "planBoardStatusAttention",
    finished: "planBoardStatusFinished",
    archived: "planBoardStatusArchived"
  };
  const stepStatusKeys: Record<string, keyof Translation> = {
    pending: "durableStatusPlanned",
    running: "planStatusExecuting",
    completed: "planStatusCompleted",
    skipped: "planStatusCompleted",
    uncertain: "planStatusBlocked",
    blocked: "planStatusBlocked",
    failed: "planStatusBlocked"
  };

  let items: DesktopPlanListItem[] = [];
  let listLoading = true;
  let listError = "";
  let search = "";
  let filter: FilterBucket = "all";
  let selectedId = "";
  let detail: DesktopPlanDetail | null = null;
  let detailLoading = false;
  let busy = false;
  let actionError = "";
  let editorOpen = false;
  let reworkTasks: Array<{ title: string; steps: string }> = [];
  let reworkError = "";
  let requestSeq = 0;

  $: visibleItems = items.filter((item) => {
    if (filter !== "all" && item.planStatus !== filter) return false;
    const query = search.trim().toLowerCase();
    if (!query) return true;
    return item.title.toLowerCase().includes(query) || item.planId.toLowerCase().includes(query);
  });
  $: currentVersion = detail?.execution.currentPlanVersion ?? -1;
  $: currentCriteria = detail?.acceptanceCriteria.filter((criterion) => criterion.planVersion === currentVersion) ?? [];
  $: completedCount = detail?.projection.progress.completed ?? 0;
  $: totalCount = detail?.projection.progress.total ?? 0;
  $: progressPercent = totalCount > 0 ? Math.round(completedCount / totalCount * 100) : 0;
  $: waitingText = detail ? resolveWaitingText(detail) : "";
  $: showDetailPane = detailLoading || Boolean(detail) || Boolean(selectedId);
  $: canStart = detail?.execution.status === "planned";
  $: canPause = detail?.execution.status === "queued" || detail?.execution.status === "running" || detail?.execution.status === "verifying";
  $: canResume = detail?.execution.status === "paused" || detail?.execution.status === "recovery_required";
  $: canRework = detail !== null && !["queued", "running", "verifying", "waiting_for_user", "waiting_for_approval", "cancelled"].includes(detail.execution.status);
  $: canDelete = Boolean(detail) && (canRework || canStart);

  onMount(() => {
    void refreshList();
    const timer = setInterval(() => {
      if (document.hidden) return;
      void refreshList(true);
      if (selectedId && !busy) void loadDetail(selectedId, true);
    }, 5000);
    return () => clearInterval(timer);
  });

  async function refreshList(silent = false): Promise<void> {
    if (!endpoint) return;
    if (!silent && items.length === 0) listLoading = true;
    try {
      const next = await loadDesktopPlans(endpoint, { includeArchived: true, limit: 200 });
      items = next;
      listError = "";
      if (!selectedId && next.length > 0) await selectPlan(next[0].planId);
    } catch (cause) {
      if (!silent) listError = cause instanceof Error ? cause.message : String(cause);
    } finally {
      listLoading = false;
    }
  }

  async function selectPlan(planId: string): Promise<void> {
    if (selectedId === planId && detail) return;
    selectedId = planId;
    editorOpen = false;
    reworkError = "";
    actionError = "";
    await loadDetail(planId);
  }

  async function loadDetail(planId: string, silent = false): Promise<void> {
    if (!endpoint) return;
    const seq = ++requestSeq;
    if (!silent) detailLoading = true;
    try {
      const next = await loadDesktopPlan(endpoint, planId);
      if (seq === requestSeq && selectedId === planId) { detail = next; actionError = ""; }
    } catch (cause) {
      if (!silent && seq === requestSeq) { detail = null; actionError = cause instanceof Error ? cause.message : String(cause); }
    } finally {
      if (seq === requestSeq) detailLoading = false;
    }
  }

  function actionId(action: string): string {
    return "desktop-plan-" + action + "-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
  }

  async function runControl(action: "start" | "pause" | "resume" | "cancel"): Promise<void> {
    if (!detail || busy) return;
    if (action === "start" && !window.confirm(copy.planBoardStartConfirm)) return;
    if (action === "cancel" && !window.confirm(copy.durableCancelConfirm)) return;
    busy = true;
    actionError = "";
    try {
      const response = await runDesktopPlanAction(endpoint, {
        action,
        planId: detail.execution.id,
        expectedVersion: detail.execution.version,
        actionId: actionId(action)
      });
      if (response.item) detail = response.item;
      await refreshList(true);
    } catch (cause) {
      actionError = cause instanceof Error ? cause.message : String(cause);
    } finally {
      busy = false;
    }
  }

  async function deletePlan(): Promise<void> {
    if (!detail || busy) return;
    if (!window.confirm(copy.planBoardDeleteConfirm)) return;
    busy = true;
    actionError = "";
    try {
      await runDesktopPlanAction(endpoint, { action: "delete", planId: detail.execution.id, expectedVersion: detail.execution.version });
      detail = null;
      selectedId = "";
      await refreshList(true);
    } catch (cause) {
      actionError = cause instanceof Error ? cause.message : String(cause);
    } finally {
      busy = false;
    }
  }

  function openEditor(): void {
    editorOpen = true;
    reworkError = "";
    if (reworkTasks.length === 0) reworkTasks = [{ title: "", steps: "" }];
  }

  function addReworkTask(): void {
    reworkTasks = [...reworkTasks, { title: "", steps: "" }];
  }

  function removeReworkTask(index: number): void {
    reworkTasks = reworkTasks.filter((_, current) => current !== index);
  }

  async function saveRework(): Promise<void> {
    if (!detail || busy) return;
    const addTasks: DesktopPlanTaskInput[] = [];
    for (const task of reworkTasks) {
      const title = task.title.trim();
      const steps = task.steps.split("\n").map((line) => line.trim()).filter(Boolean);
      if (!title || steps.length === 0) continue;
      addTasks.push({ title, steps: steps.map((stepTitle) => ({ title: stepTitle })) });
    }
    if (addTasks.length === 0) {
      reworkError = copy.planBoardReworkEmpty;
      return;
    }
    busy = true;
    reworkError = "";
    actionError = "";
    try {
      const response = await runDesktopPlanAction(endpoint, {
        action: "revise",
        executionId: detail.execution.id,
        expectedVersion: detail.execution.version,
        reason: "desktop rework",
        addTasks
      });
      if (response.item) detail = response.item;
      editorOpen = false;
      reworkTasks = [{ title: "", steps: "" }];
      await refreshList(true);
    } catch (cause) {
      reworkError = cause instanceof Error ? cause.message : String(cause);
    } finally {
      busy = false;
    }
  }

  function planStatusLabel(status: DesktopPlanStatus): string {
    return copy[planStatusKeys[status]];
  }

  function stepStatusLabel(status: string): string {
    return copy[stepStatusKeys[status] ?? "durableStatusPlanned"];
  }

  function filterLabel(option: FilterBucket): string {
    switch (option) {
      case "all": return copy.planBoardFilterAll;
      case "not_started": return copy.planBoardFilterNotStarted;
      case "in_progress": return copy.planBoardFilterInProgress;
      case "needs_attention": return copy.planBoardFilterAttention;
      case "finished": return copy.planBoardFilterFinished;
      case "archived": return copy.planBoardFilterArchived;
    }
  }

  function statusBucket(status: DesktopDurableExecutionStatus): DesktopPlanStatus {
    if (status === "planned") return "not_started";
    if (status === "completed") return "archived";
    if (status === "cancelled") return "finished";
    if (["queued", "running", "verifying"].includes(status)) return "in_progress";
    return "needs_attention";
  }

  function taskProgress(task: DesktopPlanDetail["tasks"][number]): string {
    const done = task.steps.filter((step) => step.status === "completed" || step.status === "skipped").length;
    return copy.planBoardStepsCount.replace("{done}", String(done)).replace("{total}", String(task.steps.length));
  }

  /** Runtime-authored English markers must not leak into the localized board. */
  function stepOutputSummary(summary: string | undefined): string {
    if (!summary) return "";
    if (summary === "The bounded Agent attempt completed this plan step.") return copy.durableStepAttemptCompleted;
    if (summary.startsWith("Run detail for completed step")) return copy.durableEvidence;
    return summary;
  }

  function criterionLabel(description: string): string {
    if (description === "The plan's requested outcome is verified.") return copy.planBoardDefaultCriterion;
    if (description === "Every step in the accepted plan has completed.") return copy.durableCriterionAllStepsComplete;
    return description;
  }

  function criterionResultLabel(result: "unproven" | "passed" | "failed"): string {
    return result === "passed" ? copy.planStatusCompleted : result === "failed" ? copy.planStatusBlocked : copy.durableStatusPlanned;
  }

  /** Runtime waiting text is English; known kinds render localized copy instead. */
  function resolveWaitingText(plan: DesktopPlanDetail): string {
    const waiting = plan.projection.waiting;
    if (waiting?.kind === "review") return copy.planReviewPrompt;
    if (waiting?.kind === "recovery") return copy.planBoardRecoveryReason;
    return plan.execution.waitingReason ?? "";
  }
</script>

<div class="plans-shell">
  <div class="plans-workspace" class:detail-open={showDetailPane}>
  <aside class="plans-rail" aria-label={copy.planBoardTitle}>
    <div class="plans-toolbar">
      <label class="plans-search">
        <Magnifier size={14} aria-hidden="true" />
        <input
          type="search"
          name="plan-search"
          autocomplete="off"
          spellcheck="false"
          value={search}
          placeholder={copy.planBoardSearchPlaceholder}
          aria-label={copy.planBoardSearchLabel}
          oninput={(event) => (search = (event.currentTarget as HTMLInputElement).value)}
        />
      </label>
      <div class="plans-filters" role="group" aria-label={copy.planBoardTitle}>
        {#each filterOptions as option (option)}
          <button
            type="button"
            aria-pressed={filter === option}
            class:active={filter === option}
            onclick={() => (filter = option)}
          >{filterLabel(option)}</button>
        {/each}
      </div>
    </div>

    {#if listLoading && items.length === 0}
      <div class="plans-state" role="status">{copy.loading}</div>
    {:else if listError}
      <div class="plans-state" role="alert"><p>{copy.planBoardLoadFailed}</p><small>{listError}</small><button class="secondary-button" type="button" onclick={() => void refreshList()}>{copy.retryLoading}</button></div>
    {:else if items.length === 0}
      <div class="plans-state"><Layers size={22} aria-hidden="true" /><p>{copy.planBoardEmpty}</p></div>
    {:else if visibleItems.length === 0}
      <div class="plans-state"><p>{copy.planBoardNoMatches}</p></div>
    {:else}
      <ul class="plans-list">
        {#each visibleItems as item (item.planId)}
          <li>
            <button
              type="button"
              class="plans-row"
              class:active={selectedId === item.planId}
              aria-current={selectedId === item.planId ? "true" : undefined}
              onclick={() => void selectPlan(item.planId)}
            >
              <span class="plans-row-top">
                <strong>{item.title}</strong>
                <span class="plans-chip" data-plan-status={item.planStatus}>{planStatusLabel(item.planStatus)}</span>
              </span>
              <span class="plans-row-sub">
                <span class="plans-mono" translate="no">{item.shortHandle}</span>
                <span class="plans-dot" aria-hidden="true">·</span>
                <span class="plans-count">{item.progress.completed}/{item.progress.total}</span>
                {#if item.projectId}<span class="plans-dot" aria-hidden="true">·</span><span translate="no">{item.projectId}</span>{/if}
              </span>
              {#if item.progress.currentStepTitle}<span class="plans-row-step">{item.progress.currentStepTitle}</span>{/if}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </aside>

  <section class="plans-detail" aria-label={detail?.meta.title ?? copy.planBoardTitle}>
    {#if detailLoading && !detail}
      <div class="plans-state" role="status"><Loader size={16} aria-hidden="true" />{copy.loading}</div>
    {:else if !detail}
      <div class="plans-state"><Layers size={26} aria-hidden="true" /><p>{copy.planBoardSelectHint}</p></div>
    {:else}
      <header class="plans-detail-head">
        <button type="button" class="plans-back" aria-label={copy.planBoardTitle} onclick={() => { selectedId = ""; detail = null; }}><X size={15} aria-hidden="true" /></button>
        <div class="plans-detail-title">
          <div class="plans-title-row">
            <h2>{detail.meta.title}</h2>
            <span class="plans-chip" data-plan-status={statusBucket(detail.execution.status)}>{planStatusLabel(statusBucket(detail.execution.status))}</span>
          </div>
          <p class="plans-subtitle">
            <span class="plans-mono" translate="no">{detail.execution.shortHandle}</span>
            <span class="plans-dot" aria-hidden="true">·</span>
            <span>{copy.planBoardVersion} {detail.execution.currentPlanVersion}</span>
            <span class="plans-dot" aria-hidden="true">·</span>
            <span>{copy.planBoardUpdated} {formatTime(detail.execution.updatedAt)}</span>
          </p>
        </div>
      </header>

      <div class="plans-detail-scroll">
        <section class="plans-card plans-overview">
          {#if detail.meta.summary}<p class="plans-summary-text">{detail.meta.summary}</p>{/if}
          <div class="plans-progress">
            <div class="plans-progress-track" role="progressbar" aria-label={copy.planBoardProgress} aria-valuenow={progressPercent} aria-valuemin="0" aria-valuemax="100"><span style={"transform: scaleX(" + progressPercent / 100 + ")"}></span></div>
            <span class="plans-progress-count">{completedCount}/{totalCount}</span>
          </div>
          {#if detail.projection.nextStep}<p class="plans-current"><span>{copy.planBoardCurrentStep}</span>{detail.projection.nextStep.title}</p>{/if}
          {#if waitingText}<p class="plans-waiting"><strong>{copy.durableWaitingReason}</strong>{waitingText}</p>{/if}
          {#if detail.execution.lastError}<p class="plans-error-alert">{detail.execution.lastError}</p>{/if}
        </section>

        <section class="plans-card">
          <h3 class="plans-section-title">{copy.planBoardTasks}</h3>
          <ol class="plans-tasks">
            {#each detail.tasks as task (task.id)}
              <li class="plans-task">
                <header class="plans-task-head">
                  <strong>{task.title}</strong>
                  <span>{taskProgress(task)}</span>
                </header>
                {#if task.description}<p class="plans-task-desc">{task.description}</p>{/if}
                {#if task.steps.length === 0}
                  <p class="plans-task-desc">{copy.planBoardNoSteps}</p>
                {:else}
                  <ul class="plans-steps">
                    {#each task.steps as step (step.id)}
                      <li class="plans-step" data-status={step.status}>
                        <span class="plans-step-marker" aria-hidden="true">
                          {#if step.status === "completed" || step.status === "skipped"}<CheckCircle size={15} />
                          {:else if step.status === "running"}<Loader size={15} />
                          {:else if step.status === "blocked" || step.status === "failed" || step.status === "uncertain"}<TriangleWarning size={15} />
                          {:else}<Help size={15} />{/if}
                        </span>
                        <span class="plans-step-body">
                          <strong>{step.title}</strong>
                          {#if stepOutputSummary(step.outputSummary)}<small>{stepOutputSummary(step.outputSummary)}</small>{/if}
                        </span>
                        <span class="plans-step-status">{stepStatusLabel(step.status)}</span>
                      </li>
                    {/each}
                  </ul>
                {/if}
              </li>
            {/each}
          </ol>
        </section>

        {#if currentCriteria.length > 0}
          <section class="plans-card">
            <h3 class="plans-section-title">{copy.planBoardAcceptance}</h3>
            <ul class="plans-criteria">
              {#each currentCriteria as criterion (criterion.id)}
                <li class="plans-criterion" data-result={criterion.result}>
                  <span class="plans-criterion-marker" aria-hidden="true">
                    {#if criterion.result === "passed"}<CheckCircle size={14} />
                    {:else if criterion.result === "failed"}<TriangleWarning size={14} />
                    {:else}<Help size={14} />{/if}
                  </span>
                  <span class="plans-criterion-text">{criterionLabel(criterion.description)}</span>
                  <span class="plans-criterion-result">{criterionResultLabel(criterion.result)}</span>
                </li>
              {/each}
            </ul>
          </section>
        {/if}

        {#if editorOpen && canRework}
          <section class="plans-card plans-rework">
            <h3 class="plans-section-title">{copy.planBoardRework}</h3>
            {#each reworkTasks as task, index (index)}
              <div class="plans-rework-task">
                <div class="plans-rework-head">
                  <input
                    type="text"
                    value={task.title}
                    placeholder={copy.planBoardReworkTitle}
                    aria-label={copy.planBoardReworkTitle}
                    oninput={(event) => (reworkTasks = reworkTasks.map((entry, current) => current === index ? { ...entry, title: (event.currentTarget as HTMLInputElement).value } : entry))}
                  />
                  {#if reworkTasks.length > 1}<button type="button" class="plans-remove" onclick={() => removeReworkTask(index)}>{copy.planBoardReworkRemove}</button>{/if}
                </div>
                <textarea
                  rows="3"
                  value={task.steps}
                  placeholder={copy.planBoardReworkSteps}
                  aria-label={copy.planBoardReworkSteps}
                  oninput={(event) => (reworkTasks = reworkTasks.map((entry, current) => current === index ? { ...entry, steps: (event.currentTarget as HTMLTextAreaElement).value } : entry))}
                ></textarea>
              </div>
            {/each}
            {#if reworkError}<p class="plans-error-alert" role="alert">{reworkError}</p>{/if}
            <div class="plans-rework-actions">
              <button type="button" class="secondary-button" onclick={addReworkTask}>{copy.planBoardReworkAdd}</button>
              <button type="button" class="primary-button" disabled={busy} onclick={() => void saveRework()}>{busy ? copy.planBoardRevising : copy.planBoardReworkSave}</button>
            </div>
          </section>
        {/if}
      </div>

      {#if actionError}<p class="plans-action-error" role="alert">{actionError}</p>{/if}
      <footer class="plans-actions">
        <div class="plans-actions-leading">
          {#if canRework && !editorOpen}<button type="button" class="secondary-button" disabled={busy} onclick={openEditor}>{copy.planBoardRework}</button>{/if}
        </div>
        <div class="plans-actions-trailing">
          {#if canDelete}<button type="button" class="secondary-button danger-action" disabled={busy} onclick={() => void deletePlan()}>{copy.planBoardDelete}</button>{/if}
          {#if canPause}<button type="button" class="secondary-button danger-action" disabled={busy} onclick={() => void runControl("cancel")}>{copy.planBoardCancel}</button>{/if}
          {#if canPause}<button type="button" class="secondary-button" disabled={busy} onclick={() => void runControl("pause")}>{copy.planBoardPause}</button>{/if}
          {#if canStart}<button type="button" class="primary-button" disabled={busy} onclick={() => void runControl("start")}>{copy.planBoardStart}</button>{/if}
          {#if canResume}<button type="button" class="primary-button" disabled={busy} onclick={() => void runControl("resume")}>{copy.planBoardResume}</button>{/if}
        </div>
      </footer>
    {/if}
  </section>
  </div>
</div>

<style>
  .plans-shell { width: var(--workspace-col); margin: 0 auto; }
  .plans-workspace {
    display: grid;
    grid-template-columns: minmax(280px, 336px) minmax(0, 1fr);
    height: calc(100vh - 220px);
    min-height: min(560px, calc(100vh - 220px));
    overflow: hidden;
    border: 1px solid var(--separator);
    border-radius: var(--rounded-md);
    background: var(--card-bg);
  }

  /* Left rail */
  .plans-rail {
    display: flex;
    min-width: 0;
    min-height: 0;
    flex-direction: column;
    border-right: 1px solid var(--separator);
    background: var(--surface-secondary);
  }
  .plans-toolbar {
    display: grid;
    gap: 10px;
    padding: 12px 12px 10px;
    border-bottom: 1px solid var(--separator);
  }
  .plans-search {
    display: flex;
    align-items: center;
    gap: 7px;
    height: 32px;
    padding: 0 10px;
    border: 1px solid var(--control-border);
    border-radius: var(--rounded-sm);
    background: var(--card-bg);
    color: var(--label-tertiary);
  }
  .plans-search:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
  .plans-search input {
    min-width: 0;
    flex: 1;
    border: 0;
    background: transparent;
    color: var(--label-primary);
    font: var(--fs-label)/var(--lh-label) var(--font-ui);
    outline: none;
  }
  .plans-filters { display: flex; flex-wrap: wrap; gap: 5px; }
  .plans-filters button {
    height: 25px;
    padding: 0 10px;
    border: 1px solid transparent;
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--label-secondary);
    font: 500 var(--fs-meta)/var(--lh-meta) var(--font-ui);
    cursor: pointer;
    transition: background var(--duration-instant) var(--ease-standard), color var(--duration-instant) var(--ease-standard);
  }
  .plans-filters button:hover { background: var(--fill); color: var(--label-primary); }
  .plans-filters button:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--card-bg), 0 0 0 4px var(--accent); }
  .plans-filters button.active { background: var(--accent-soft); color: var(--accent); }
  .plans-list {
    display: grid;
    align-content: start;
    gap: 2px;
    min-height: 0;
    flex: 1 1 auto;
    margin: 0;
    padding: 8px;
    list-style: none;
    overflow-y: auto;
    overflow-x: hidden;
    overscroll-behavior: contain;
  }
  .plans-list > li { min-width: 0; }
  .plans-row {
    display: grid;
    gap: 4px;
    width: 100%;
    min-width: 0;
    padding: 9px 10px;
    border: 1px solid transparent;
    border-radius: var(--radius-control);
    background: transparent;
    color: var(--label-primary);
    text-align: left;
    cursor: pointer;
    transition: background var(--duration-instant) var(--ease-standard), border-color var(--duration-instant) var(--ease-standard);
  }
  .plans-row:hover { background: var(--fill); }
  .plans-row:focus-visible { outline: none; box-shadow: inset 0 0 0 2px var(--accent); }
  .plans-row.active { background: var(--card-bg); border-color: var(--separator); }
  .plans-row-top { display: flex; align-items: center; gap: 8px; justify-content: space-between; min-width: 0; }
  .plans-row-top strong { min-width: 0; overflow: hidden; font-size: var(--fs-label); font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
  .plans-row-sub { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; min-width: 0; overflow: hidden; color: var(--label-tertiary); font-size: var(--fs-meta); }
  .plans-row-step { overflow: hidden; color: var(--label-secondary); font-size: var(--fs-meta); text-overflow: ellipsis; white-space: nowrap; }
  .plans-mono, .plans-row-sub .plans-mono { font-family: var(--font-mono); }
  .plans-count { font-variant-numeric: tabular-nums; }
  .plans-dot { color: var(--label-tertiary); }

  .plans-chip {
    flex: none;
    padding: 2px 8px;
    border-radius: var(--radius-full);
    background: var(--fill);
    color: var(--label-secondary);
    font-size: var(--fs-meta);
    font-weight: 600;
    white-space: nowrap;
  }
  .plans-chip[data-plan-status="in_progress"] { background: var(--accent-soft); color: var(--accent); }
  .plans-chip[data-plan-status="needs_attention"] { background: color-mix(in srgb, var(--warning) 16%, transparent); color: var(--warning); }
  .plans-chip[data-plan-status="archived"] { background: color-mix(in srgb, var(--online) 16%, transparent); color: var(--online); }

  /* Detail */
  .plans-detail { display: flex; min-width: 0; min-height: 0; flex-direction: column; background: var(--card-bg); }
  .plans-detail-head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 18px;
    border-bottom: 1px solid var(--separator);
    background: var(--card-bg);
  }
  .plans-back {
    display: none;
    flex: none;
    place-items: center;
    width: 28px;
    height: 28px;
    border: 1px solid var(--control-border);
    border-radius: var(--radius-small);
    background: var(--card-bg);
    color: var(--label-secondary);
    cursor: pointer;
  }
  .plans-back:hover { color: var(--label-primary); }
  .plans-detail-title { min-width: 0; flex: 1; }
  .plans-title-row { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .plans-title-row h2 { overflow: hidden; margin: 0; font-size: var(--fs-title); line-height: var(--lh-title); font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
  .plans-subtitle { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 4px 0 0; color: var(--label-tertiary); font-size: var(--fs-meta); line-height: var(--lh-meta); }

  .plans-detail-scroll {
    display: grid;
    align-content: start;
    gap: 14px;
    min-height: 0;
    flex: 1;
    padding: 16px 18px 24px;
    overflow: auto;
    overscroll-behavior: contain;
  }
  .plans-card {
    border: 1px solid var(--separator);
    border-radius: var(--radius-panel);
    background: var(--card-bg);
    padding: 14px 16px;
  }
  .plans-card.plans-overview { display: grid; gap: 12px; }
  .plans-summary-text { margin: 0; color: var(--label-secondary); font-size: var(--fs-label); line-height: var(--lh-label); }
  .plans-progress { display: flex; align-items: center; gap: 12px; }
  .plans-progress-track { flex: 1; height: 5px; overflow: hidden; border-radius: var(--radius-full); background: var(--fill); }
  .plans-progress-track span { display: block; height: 100%; border-radius: inherit; background: var(--accent); transform-origin: left; transition: transform 180ms var(--ease-standard); }
  .plans-progress-count { color: var(--label-secondary); font-size: var(--fs-label); font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
  .plans-current { display: flex; gap: 6px; margin: 0; color: var(--label-secondary); font-size: var(--fs-meta); line-height: var(--lh-meta); }
  .plans-current span { color: var(--label-tertiary); }
  .plans-waiting { margin: 0; padding: 9px 11px; border-radius: var(--radius-control); background: color-mix(in srgb, var(--warning) 10%, transparent); color: var(--label-secondary); font-size: var(--fs-meta); line-height: var(--lh-meta); }
  .plans-waiting strong { display: block; margin-bottom: 2px; color: var(--label-primary); }
  .plans-error-alert { margin: 0; padding: 9px 11px; border-radius: var(--radius-control); background: color-mix(in srgb, var(--danger) 9%, transparent); color: var(--danger); font-size: var(--fs-meta); line-height: var(--lh-meta); overflow-wrap: anywhere; }

  .plans-section-title { margin: 0 0 12px; color: var(--label-secondary); font-size: var(--fs-meta); font-weight: 600; letter-spacing: var(--tracking-caps); text-transform: uppercase; }
  .plans-tasks { display: grid; gap: 16px; margin: 0; padding: 0; list-style: none; }
  .plans-task { display: grid; gap: 8px; }
  .plans-task-head { display: flex; align-items: baseline; gap: 8px; justify-content: space-between; }
  .plans-task-head strong { font-size: var(--fs-label); font-weight: 600; }
  .plans-task-head span { color: var(--label-tertiary); font-family: var(--font-mono); font-size: var(--fs-meta); }
  .plans-task-desc { margin: 0; color: var(--label-secondary); font-size: var(--fs-meta); line-height: var(--lh-meta); }
  .plans-steps { display: grid; gap: 2px; margin: 0; padding: 0; list-style: none; }
  .plans-step { display: flex; align-items: flex-start; gap: 10px; padding: 6px 8px; border-radius: var(--radius-small); }
  .plans-step + .plans-step { border-top: 1px solid color-mix(in srgb, var(--separator) 55%, transparent); }
  .plans-step-marker { display: grid; flex: none; place-items: center; width: 18px; height: 20px; color: var(--label-tertiary); }
  .plans-step[data-status="completed"] .plans-step-marker, .plans-step[data-status="skipped"] .plans-step-marker { color: var(--online); }
  .plans-step[data-status="running"] .plans-step-marker { color: var(--accent); }
  .plans-step[data-status="blocked"] .plans-step-marker, .plans-step[data-status="failed"] .plans-step-marker, .plans-step[data-status="uncertain"] .plans-step-marker { color: var(--warning); }
  .plans-step-body { display: grid; min-width: 0; flex: 1; gap: 2px; }
  .plans-step-body strong { font-size: var(--fs-label); font-weight: 500; }
  .plans-step-body small { color: var(--label-tertiary); font-size: var(--fs-meta); line-height: var(--lh-meta); overflow-wrap: anywhere; }
  .plans-step-status { flex: none; color: var(--label-tertiary); font-size: var(--fs-meta); white-space: nowrap; }

  .plans-criteria { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; }
  .plans-criterion { display: flex; align-items: flex-start; gap: 10px; padding: 6px 8px; border-radius: var(--radius-small); }
  .plans-criterion + .plans-criterion { border-top: 1px solid color-mix(in srgb, var(--separator) 55%, transparent); }
  .plans-criterion-marker { display: grid; flex: none; place-items: center; width: 18px; color: var(--label-tertiary); }
  .plans-criterion[data-result="passed"] .plans-criterion-marker { color: var(--online); }
  .plans-criterion[data-result="failed"] .plans-criterion-marker { color: var(--danger); }
  .plans-criterion[data-result="unproven"] .plans-criterion-marker { color: var(--warning); }
  .plans-criterion-text { min-width: 0; flex: 1; color: var(--label-secondary); font-size: var(--fs-label); line-height: var(--lh-label); overflow-wrap: anywhere; }
  .plans-criterion-result { flex: none; color: var(--label-tertiary); font-size: var(--fs-meta); white-space: nowrap; }

  .plans-rework-task { display: grid; gap: 8px; margin-bottom: 12px; }
  .plans-rework-head { display: flex; align-items: center; gap: 8px; }
  .plans-rework-task input, .plans-rework-task textarea {
    width: 100%;
    padding: 8px 10px;
    border: 1px solid var(--control-border);
    border-radius: var(--rounded-sm);
    background: var(--content-bg);
    color: var(--label-primary);
    font: var(--fs-label)/var(--lh-label) var(--font-ui);
    outline: none;
    resize: vertical;
  }
  .plans-rework-task input:focus-visible, .plans-rework-task textarea:focus-visible { border-color: var(--accent); }
  .plans-remove { flex: none; padding: 0; border: 0; background: transparent; color: var(--label-tertiary); font: var(--fs-meta)/var(--lh-meta) var(--font-ui); cursor: pointer; }
  .plans-remove:hover { color: var(--danger); }
  .plans-remove:focus-visible { outline: none; color: var(--danger); text-decoration: underline; }
  .plans-rework-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }

  .plans-state { display: grid; place-items: center; align-content: center; gap: 10px; height: 100%; min-height: 180px; padding: 24px; color: var(--label-secondary); text-align: center; }
  .plans-state p { margin: 0; font-size: var(--fs-label); }
  .plans-state small { max-width: 300px; overflow-wrap: anywhere; color: var(--label-tertiary); }
  .plans-state :global(svg) { color: var(--label-tertiary); }

  .plans-action-error { margin: 0; padding: 8px 18px; color: var(--danger); font-size: var(--fs-meta); }
  .plans-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 18px;
    border-top: 1px solid var(--separator);
    background: var(--card-bg);
  }
  .plans-actions-leading { display: flex; gap: 8px; }
  .plans-actions-trailing { display: flex; flex-wrap: wrap; gap: 8px; margin-left: auto; }

  @media (max-width: 900px) {
    .plans-workspace { grid-template-columns: 1fr; }
    .plans-workspace.detail-open .plans-rail { display: none; }
    .plans-workspace:not(.detail-open) .plans-detail { display: none; }
    .plans-back { display: grid; }
  }
  @media (prefers-reduced-motion: reduce) {
    .plans-progress-track span { transition: none; }
  }
</style>
