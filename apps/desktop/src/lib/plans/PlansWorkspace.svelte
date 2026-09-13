<script lang="ts">
  import { onMount } from "svelte";
  import Layers from "../icons/duotone/components/Layers.svelte";
  import Magnifier from "../icons/duotone/components/Magnifier.svelte";
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
  $: criteria = detail?.acceptanceCriteria.filter((criterion) => criterion.planVersion === currentVersion) ?? [];
  $: completedCount = detail?.projection.progress.completed ?? 0;
  $: totalCount = detail?.projection.progress.total ?? 0;
  $: progressPercent = totalCount > 0 ? Math.round(completedCount / totalCount * 100) : 0;
  $: showDetailPane = detailLoading || Boolean(detail) || Boolean(selectedId);
  $: canStart = detail?.execution.status === "planned";
  $: canPause = detail?.execution.status === "queued" || detail?.execution.status === "running" || detail?.execution.status === "verifying";
  $: canResume = detail?.execution.status === "paused" || detail?.execution.status === "recovery_required";
  $: canRework = detail !== null && !["queued", "running", "verifying", "waiting_for_user", "waiting_for_approval", "cancelled"].includes(detail.execution.status);

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

  function taskProgress(task: DesktopPlanDetail["tasks"][number]): string {
    const done = task.steps.filter((step) => step.status === "completed" || step.status === "skipped").length;
    return `${done}/${task.steps.length}`;
  }

  function statusBucket(status: DesktopDurableExecutionStatus): DesktopPlanStatus {
    if (status === "planned") return "not_started";
    if (status === "completed") return "archived";
    if (status === "cancelled") return "finished";
    if (["queued", "running", "verifying"].includes(status)) return "in_progress";
    return "needs_attention";
  }
</script>

<div class="plans-workspace" class:detail-open={showDetailPane}>
  <aside class="plans-rail" aria-label={copy.planBoardTitle}>
    <div class="plans-toolbar">
      <label class="plans-search">
        <Magnifier size={14} aria-hidden="true" />
        <input
          type="search"
          value={search}
          placeholder={copy.planBoardSearchPlaceholder}
          aria-label={copy.planBoardSearchPlaceholder}
          oninput={(event) => (search = (event.currentTarget as HTMLInputElement).value)}
        />
      </label>
      <div class="plans-filters" role="tablist" aria-label={copy.planBoardTitle}>
        {#each filterOptions as option (option)}
          <button
            type="button"
            role="tab"
            aria-selected={filter === option}
            class:active={filter === option}
            onclick={() => (filter = option)}
          >{option === "all" ? copy.planBoardFilterAll : option === "not_started" ? copy.planBoardFilterNotStarted : option === "in_progress" ? copy.planBoardFilterInProgress : option === "needs_attention" ? copy.planBoardFilterAttention : option === "finished" ? copy.planBoardFilterFinished : copy.planBoardFilterArchived}</button>
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
              data-plan-status={item.planStatus}
              onclick={() => void selectPlan(item.planId)}
            >
              <span class="plans-row-head">
                <strong>{item.title}</strong>
                <span class="plans-chip" data-plan-status={item.planStatus}>{planStatusLabel(statusBucket(item.status))}</span>
              </span>
              <span class="plans-row-meta">
                <span>{item.shortHandle}</span>
                <span>{item.progress.completed}/{item.progress.total}</span>
                {#if item.projectId}<span>{item.projectId}</span>{/if}
              </span>
              {#if item.progress.currentStepTitle}<small class="plans-row-step">{item.progress.currentStepTitle}</small>{/if}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </aside>

  <section class="plans-detail" aria-label={detail?.meta.title ?? copy.planBoardTitle}>
    {#if detailLoading && !detail}
      <div class="plans-state" role="status">{copy.loading}</div>
    {:else if !detail}
      <div class="plans-state"><p>{copy.planBoardSelectHint}</p></div>
    {:else}
      <header class="plans-detail-head">
        <button type="button" class="plans-back" aria-label={copy.planBoardTitle} onclick={() => { selectedId = ""; detail = null; }}><X size={14} aria-hidden="true" /></button>
        <div class="plans-detail-title">
          <p class="plans-eyebrow">{detail.execution.shortHandle}{detail.execution.sourceProjectId ? ` · ${detail.execution.sourceProjectId}` : ""}</p>
          <h2>{detail.meta.title}</h2>
        </div>
        <span class="plans-chip" data-plan-status={statusBucket(detail.execution.status)}>{planStatusLabel(statusBucket(detail.execution.status))}</span>
      </header>

      <div class="plans-detail-scroll">
        <section class="plans-summary">
          {#if detail.meta.summary}<p class="plans-summary-text">{detail.meta.summary}</p>{/if}
          <div class="plans-progress">
            <div class="plans-progress-track" role="progressbar" aria-valuenow={progressPercent} aria-valuemin="0" aria-valuemax="100"><span style={"transform: scaleX(" + progressPercent / 100 + ")"}></span></div>
            <span>{completedCount}/{totalCount}</span>
          </div>
          <dl class="plans-facts">
            <div><dt>{copy.planBoardVersion}</dt><dd>{detail.execution.currentPlanVersion}</dd></div>
            <div><dt>{copy.planBoardUpdated}</dt><dd>{detail.execution.updatedAt}</dd></div>
            {#if detail.projection.nextStep}<div><dt>{copy.planBoardCurrentStep}</dt><dd>{detail.projection.nextStep.title}</dd></div>{/if}
          </dl>
          {#if detail.execution.waitingReason}<p class="plans-waiting"><strong>{copy.durableWaitingReason}</strong>{detail.execution.waitingReason}</p>{/if}
          {#if detail.execution.lastError}<p class="plans-error">{detail.execution.lastError}</p>{/if}
        </section>

        <section class="plans-block">
          <h3>{copy.planBoardTasks}</h3>
          <ol class="plans-tasks">
            {#each detail.tasks as task (task.id)}
              <li class="plans-task" data-task-id={task.id}>
                <header><strong>{task.title}</strong><span>{taskProgress(task)}</span></header>
                {#if task.description}<p>{task.description}</p>{/if}
                <ul class="plans-steps">
                  {#each task.steps as step (step.id)}
                    <li data-status={step.status}>
                      <span class="plans-step-index" aria-hidden="true">{step.status === "completed" || step.status === "skipped" ? "✓" : step.index + 1}</span>
                      <span class="plans-step-copy"><strong>{step.title}</strong>{#if step.outputSummary}<small>{step.outputSummary}</small>{/if}</span>
                      <span class="plans-step-status">{stepStatusLabel(step.status)}</span>
                    </li>
                  {/each}
                </ul>
              </li>
            {/each}
          </ol>
        </section>

        {#if criteria.length > 0}
          <section class="plans-block">
            <h3>{copy.planBoardAcceptance}</h3>
            <ul class="plans-criteria">
              {#each criteria as criterion (criterion.id)}
                <li data-result={criterion.result}><span>{criterion.description}</span><small>{criterion.result === "passed" ? copy.planStatusCompleted : criterion.result === "failed" ? copy.planStatusBlocked : copy.durableStatusPlanned}</small></li>
              {/each}
            </ul>
          </section>
        {/if}

        {#if editorOpen && canRework}
          <section class="plans-block plans-rework">
            <h3>{copy.planBoardRework}</h3>
            {#each reworkTasks as task, index (index)}
              <div class="plans-rework-task">
                <input
                  type="text"
                  value={task.title}
                  placeholder={copy.planBoardReworkTitle}
                  aria-label={copy.planBoardReworkTitle}
                  oninput={(event) => (reworkTasks = reworkTasks.map((entry, current) => current === index ? { ...entry, title: (event.currentTarget as HTMLInputElement).value } : entry))}
                />
                <textarea
                  rows="3"
                  value={task.steps}
                  placeholder={copy.planBoardReworkSteps}
                  aria-label={copy.planBoardReworkSteps}
                  oninput={(event) => (reworkTasks = reworkTasks.map((entry, current) => current === index ? { ...entry, steps: (event.currentTarget as HTMLTextAreaElement).value } : entry))}
                ></textarea>
                <button type="button" class="plans-link" onclick={() => removeReworkTask(index)}>{copy.planBoardReworkRemove}</button>
              </div>
            {/each}
            {#if reworkError}<p class="plans-error" role="alert">{reworkError}</p>{/if}
            <div class="plans-rework-actions">
              <button type="button" class="secondary-button" onclick={addReworkTask}>{copy.planBoardReworkAdd}</button>
              <button type="button" class="primary-button" disabled={busy} onclick={() => void saveRework()}>{busy ? copy.planBoardRevising : copy.planBoardReworkSave}</button>
            </div>
          </section>
        {/if}
      </div>

      {#if actionError}<p class="plans-action-error" role="alert">{actionError}</p>{/if}
      <footer class="plans-actions">
        {#if canStart}<button type="button" class="primary-button" disabled={busy} onclick={() => void runControl("start")}>{copy.planBoardStart}</button>{/if}
        {#if canPause}<button type="button" class="secondary-button" disabled={busy} onclick={() => void runControl("pause")}>{copy.planBoardPause}</button>{/if}
        {#if canResume}<button type="button" class="primary-button" disabled={busy} onclick={() => void runControl("resume")}>{copy.planBoardResume}</button>{/if}
        {#if canRework && !editorOpen}<button type="button" class="secondary-button" disabled={busy} onclick={openEditor}>{copy.planBoardRework}</button>{/if}
        {#if canRework || canStart}<button type="button" class="danger-button" disabled={busy} onclick={() => void deletePlan()}>{copy.planBoardDelete}</button>{/if}
        {#if canPause}<button type="button" class="danger-button" disabled={busy} onclick={() => void runControl("cancel")}>{copy.planBoardCancel}</button>{/if}
      </footer>
    {/if}
  </section>
</div>

<style>
  .plans-workspace { display: grid; grid-template-columns: minmax(260px, 320px) minmax(0, 1fr); min-height: 0; height: 100%; }
  .plans-rail { display: flex; min-width: 0; min-height: 0; flex-direction: column; border-right: 1px solid var(--separator); background: var(--surface-secondary); }
  .plans-toolbar { display: grid; gap: 8px; padding: 12px; border-bottom: 1px solid var(--separator); }
  .plans-search { display: flex; align-items: center; gap: 6px; height: 30px; padding: 0 8px; border: 1px solid var(--separator); border-radius: var(--rounded-sm); background: var(--card-bg); color: var(--label-tertiary); }
  .plans-search input { min-width: 0; flex: 1; border: 0; background: transparent; color: var(--label-primary); font: var(--fs-label)/var(--lh-label) var(--font-ui); outline: none; }
  .plans-filters { display: flex; flex-wrap: wrap; gap: 4px; }
  .plans-filters button { min-height: 24px; padding: 0 8px; border: 1px solid transparent; border-radius: var(--radius-full); background: transparent; color: var(--label-secondary); font: var(--fs-meta)/var(--lh-meta) var(--font-ui); cursor: pointer; }
  .plans-filters button:hover { background: var(--fill); }
  .plans-filters button.active { border-color: var(--separator); background: var(--fill); color: var(--label-primary); font-weight: 600; }
  .plans-list { display: grid; gap: 2px; margin: 0; padding: 6px; list-style: none; overflow-y: auto; overscroll-behavior: contain; }
  .plans-row { display: grid; gap: 3px; width: 100%; padding: 8px; border: 0; border-radius: var(--rounded-sm); background: transparent; color: var(--label-primary); text-align: left; cursor: pointer; }
  .plans-row:hover { background: var(--fill); }
  .plans-row:focus-visible { outline: none; box-shadow: inset 0 0 0 2px var(--accent); }
  .plans-row.active { background: var(--accent-soft); }
  .plans-row-head { display: flex; align-items: center; gap: 8px; justify-content: space-between; }
  .plans-row-head strong { min-width: 0; overflow: hidden; font-size: var(--fs-label); font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
  .plans-row-meta { display: flex; flex-wrap: wrap; gap: 8px; color: var(--label-tertiary); font-size: var(--fs-meta); font-family: var(--font-mono); }
  .plans-row-step { overflow: hidden; color: var(--label-tertiary); font-size: var(--fs-meta); text-overflow: ellipsis; white-space: nowrap; }
  .plans-chip { flex: none; padding: 1px 8px; border-radius: var(--radius-full); background: var(--fill); color: var(--label-secondary); font-size: var(--fs-meta); font-weight: 600; white-space: nowrap; }
  .plans-chip[data-plan-status="in_progress"] { background: var(--accent-soft); color: var(--accent); }
  .plans-chip[data-plan-status="needs_attention"] { background: color-mix(in srgb, var(--warning) 14%, transparent); color: var(--warning); }
  .plans-chip[data-plan-status="archived"] { background: color-mix(in srgb, var(--online) 14%, transparent); color: var(--online); }
  .plans-detail { display: flex; min-width: 0; min-height: 0; flex-direction: column; background: var(--content-bg); }
  .plans-detail-head { display: flex; align-items: center; gap: 10px; min-height: 52px; padding: 8px 14px; border-bottom: 1px solid var(--separator); background: var(--card-bg); }
  .plans-back { display: none; flex: none; place-items: center; width: 28px; height: 28px; border: 0; border-radius: var(--radius-small); background: transparent; color: var(--label-secondary); cursor: pointer; }
  .plans-back:hover { background: var(--fill); color: var(--label-primary); }
  .plans-detail-title { min-width: 0; flex: 1; }
  .plans-eyebrow { margin: 0; color: var(--label-tertiary); font-size: var(--fs-meta); font-family: var(--font-mono); }
  .plans-detail-title h2 { overflow: hidden; margin: 0; font-size: var(--fs-title); font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
  .plans-detail-scroll { min-height: 0; flex: 1; overflow: auto; overscroll-behavior: contain; }
  .plans-summary, .plans-block { padding: 14px; border-bottom: 1px solid var(--separator); }
  .plans-summary-text { margin: 0 0 10px; color: var(--label-secondary); font-size: var(--fs-label); line-height: var(--lh-label); }
  .plans-progress { display: flex; align-items: center; gap: 10px; color: var(--label-secondary); font-family: var(--font-mono); font-size: var(--fs-label); }
  .plans-progress-track { flex: 1; height: 6px; overflow: hidden; border-radius: var(--radius-full); background: var(--fill); }
  .plans-progress-track span { display: block; height: 100%; border-radius: inherit; background: var(--accent); transform-origin: left; transition: transform 180ms var(--ease-standard); }
  .plans-facts { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px 14px; margin: 12px 0 0; }
  .plans-facts div { min-width: 0; }
  .plans-facts dt { color: var(--label-tertiary); font-size: var(--fs-meta); }
  .plans-facts dd { overflow: hidden; margin: 1px 0 0; color: var(--label-primary); font-size: var(--fs-label); text-overflow: ellipsis; }
  .plans-waiting { margin: 12px 0 0; padding: 8px 10px; border-radius: var(--radius-control); background: color-mix(in srgb, var(--warning) 10%, transparent); color: var(--label-secondary); font-size: var(--fs-meta); line-height: var(--lh-meta); }
  .plans-waiting strong { display: block; margin-bottom: 2px; color: var(--label-primary); }
  .plans-error { margin: 10px 0 0; padding: 8px 10px; border-radius: var(--radius-control); background: color-mix(in srgb, var(--danger) 9%, transparent); color: var(--danger); font-size: var(--fs-meta); line-height: var(--lh-meta); }
  .plans-block h3 { margin: 0 0 10px; color: var(--label-secondary); font-size: var(--fs-meta); font-weight: 600; }
  .plans-tasks { display: grid; gap: 14px; margin: 0; padding: 0; list-style: none; }
  .plans-task { display: grid; gap: 7px; }
  .plans-task > header { display: flex; align-items: baseline; gap: 8px; justify-content: space-between; }
  .plans-task > header strong { font-size: var(--fs-label); font-weight: 600; }
  .plans-task > header span { color: var(--label-tertiary); font-family: var(--font-mono); font-size: var(--fs-meta); }
  .plans-task > p { margin: 0; color: var(--label-secondary); font-size: var(--fs-meta); line-height: var(--lh-meta); }
  .plans-steps { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
  .plans-steps li { display: flex; align-items: flex-start; gap: 8px; }
  .plans-step-index { display: grid; flex: none; place-items: center; width: 20px; height: 20px; border: 1px solid var(--separator); border-radius: var(--radius-full); color: var(--label-secondary); font-family: var(--font-mono); font-size: var(--fs-meta); }
  .plans-steps li[data-status="completed"] .plans-step-index { border-color: var(--online); color: var(--online); }
  .plans-steps li[data-status="uncertain"] .plans-step-index, .plans-steps li[data-status="blocked"] .plans-step-index, .plans-steps li[data-status="failed"] .plans-step-index { border-color: var(--warning); color: var(--warning); }
  .plans-step-copy { display: grid; min-width: 0; flex: 1; gap: 1px; }
  .plans-step-copy strong { font-size: var(--fs-label); font-weight: 500; }
  .plans-step-copy small { overflow: hidden; color: var(--label-tertiary); font-size: var(--fs-meta); text-overflow: ellipsis; white-space: nowrap; }
  .plans-step-status { flex: none; color: var(--label-tertiary); font-family: var(--font-mono); font-size: var(--fs-meta); }
  .plans-criteria { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
  .plans-criteria li { display: flex; align-items: baseline; gap: 8px; justify-content: space-between; color: var(--label-secondary); font-size: var(--fs-meta); line-height: var(--lh-meta); }
  .plans-criteria li[data-result="passed"] small { color: var(--online); }
  .plans-criteria li[data-result="failed"] small { color: var(--danger); }
  .plans-criteria li[data-result="unproven"] small { color: var(--warning); }
  .plans-rework-task { display: grid; gap: 6px; margin-bottom: 10px; }
  .plans-rework-task input, .plans-rework-task textarea { width: 100%; padding: 7px 9px; border: 1px solid var(--separator); border-radius: var(--rounded-sm); background: var(--card-bg); color: var(--label-primary); font: var(--fs-label)/var(--lh-label) var(--font-ui); outline: none; resize: vertical; }
  .plans-rework-task input:focus-visible, .plans-rework-task textarea:focus-visible { border-color: var(--accent); }
  .plans-link { justify-self: start; padding: 0; border: 0; background: transparent; color: var(--danger); font: var(--fs-meta)/var(--lh-meta) var(--font-ui); cursor: pointer; }
  .plans-rework-actions { display: flex; gap: 8px; margin-top: 8px; }
  .plans-state { display: grid; place-items: center; gap: 8px; min-height: 160px; padding: 24px; color: var(--label-secondary); text-align: center; }
  .plans-state p { margin: 0; }
  .plans-state small { max-width: 280px; overflow-wrap: anywhere; color: var(--label-tertiary); }
  .plans-action-error { margin: 0; padding: 8px 14px; color: var(--danger); font-size: var(--fs-meta); }
  .plans-actions { display: flex; flex-wrap: wrap; gap: 8px; padding: 12px 14px; border-top: 1px solid var(--separator); background: var(--card-bg); }
  .plans-actions button { min-height: 32px; padding: 0 12px; }
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
