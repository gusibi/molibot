<script lang="ts">
  import { onMount } from "svelte";
  import Layers from "../icons/duotone/components/Layers.svelte";
  import ChatHeader from "../chat/ChatHeader.svelte";
  import WorkspaceSearch from "../components/ui/WorkspaceSearch.svelte";
  import WorkspaceEmpty from "../components/ui/WorkspaceEmpty.svelte";
  import Button from "../components/ui/Button.svelte";
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
  /** Plans execute as ordinary Session turns, so "start/continue" opens the
   *  source Session and resumes there instead of running the Durable runtime. */
  export let onContinuePlan: (input: { planId: string; sessionId?: string; projectId?: string; resume: boolean }) => void = () => {};

  type FilterBucket = "all" | DesktopPlanStatus;

  const filterOptions: Array<{ value: FilterBucket; key: keyof Translation }> = [
    { value: "all", key: "planBoardFilterAll" },
    { value: "not_started", key: "planBoardFilterNotStarted" },
    { value: "in_progress", key: "planBoardFilterInProgress" },
    { value: "needs_attention", key: "planBoardFilterAttention" },
    { value: "finished", key: "planBoardFilterFinished" },
    { value: "archived", key: "planBoardFilterArchived" }
  ];
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

  $: searchItems = items.filter((item) => {
    const query = search.trim().toLowerCase();
    return !query || item.title.toLowerCase().includes(query) || item.planId.toLowerCase().includes(query);
  });
  $: visibleItems = searchItems.filter((item) => filter === "all" || item.planStatus === filter);
  $: filterItems = filterOptions.map(({ value, key }) => ({
    value, label: copy[key], count: searchItems.filter((item) => value === "all" || item.planStatus === value).length
  }));
  $: hasIncompleteRework = reworkTasks.some((task) => !task.title.trim() || !task.steps.split("\n").some((line) => line.trim()));
  $: canSaveRework = reworkTasks.length > 0 && !hasIncompleteRework;
  $: currentVersion = detail?.execution.currentPlanVersion ?? -1;
  $: currentCriteria = detail?.acceptanceCriteria.filter((criterion) => criterion.planVersion === currentVersion) ?? [];
  $: completedCount = detail?.projection.progress.completed ?? 0;
  $: totalCount = detail?.projection.progress.total ?? 0;
  $: progressPercent = totalCount > 0 ? Math.round(completedCount / totalCount * 100) : 0;
  $: waitingText = detail ? resolveWaitingText(detail) : "";
  $: showDetailPane = detailLoading || Boolean(detail) || Boolean(selectedId);
  $: canContinue = Boolean(detail?.execution.sourceUiSessionId) && ["planned", "paused", "recovery_required", "waiting_for_user", "waiting_for_approval"].includes(detail?.execution.status ?? "");
  $: canOpenSession = Boolean(detail?.execution.sourceUiSessionId);
  $: canRework = detail !== null && !["queued", "running", "verifying", "waiting_for_user", "waiting_for_approval", "cancelled"].includes(detail.execution.status);
  $: canDelete = detail !== null && !["queued", "running", "verifying"].includes(detail.execution.status);
  $: canComplete = detail !== null && totalCount > 0 && completedCount === totalCount && !["completed", "cancelled"].includes(detail.execution.status);

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
    reworkTasks = [];
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

  async function completePlan(): Promise<void> {
    if (!detail || busy) return;
    busy = true;
    actionError = "";
    try {
      const response = await runDesktopPlanAction(endpoint, { action: "complete", planId: detail.execution.id });
      if (response.item) detail = response.item;
      await refreshList(true);
    } catch (cause) {
      actionError = cause instanceof Error ? cause.message : String(cause);
    } finally {
      busy = false;
    }
  }

  function continuePlan(resume: boolean): void {    if (!detail?.execution.sourceUiSessionId) return;
    onContinuePlan({
      planId: detail.execution.id,
      sessionId: detail.execution.sourceUiSessionId,
      projectId: detail.execution.sourceProjectId,
      resume
    });
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
    if (busy || editorOpen || !canRework) return;
    editorOpen = true;
    reworkError = "";
    reworkTasks = [{ title: "", steps: "" }];
  }

  function cancelEditor(): void {
    if (busy) return;
    editorOpen = false;
    reworkTasks = [];
    reworkError = "";
  }

  function addReworkTask(): void {
    if (busy || !editorOpen || hasIncompleteRework) return;
    reworkTasks = [...reworkTasks, { title: "", steps: "" }];
  }

  function removeReworkTask(index: number): void {
    reworkTasks = reworkTasks.filter((_, current) => current !== index);
  }

  async function saveRework(): Promise<void> {
    if (!detail || busy) return;
    if (!canSaveRework) {
      reworkError = copy.planBoardReworkEmpty;
      return;
    }
    const addTasks: DesktopPlanTaskInput[] = [];
    for (const task of reworkTasks) {
      const title = task.title.trim();
      const steps = task.steps.split("\n").map((line) => line.trim()).filter(Boolean);
      addTasks.push({ title, steps: steps.map((stepTitle) => ({ title: stepTitle })) });
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
      reworkTasks = [];
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

{#snippet headerActions()}
  <div class="workspace-header-tools"><WorkspaceSearch value={search} label={copy.planBoardSearchLabel} placeholder={copy.planBoardSearchPlaceholder} closeLabel={copy.closeSearch} onInput={(value) => (search = value)} /></div>
{/snippet}
<ChatHeader title={copy.planBoardTitle} actions={headerActions} />

<div class="plans-shell">
  <p class="workspace-description" title={copy.planBoardHint}>{copy.planBoardHint}</p>
  <div class="workspace-filterbar">
    <div class="segmented workspace-plan-filters" role="group" aria-label={copy.tasksByStatus}>
      {#each filterItems as item (item.value)}
        <Button class={`segmented-item${filter === item.value ? " active" : ""}`} aria-pressed={filter === item.value} onclick={() => (filter = item.value)}>{item.label} <span class="workspace-category-count">{item.count}</span></Button>
      {/each}
    </div>
  </div>
  <div class="plans-workspace workspace-master-detail" class:detail-open={showDetailPane}>
  <aside class="plans-rail" aria-label={copy.planBoardTitle}>

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
      <WorkspaceEmpty title={copy.planBoardSelectHint} />
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

      <div class="plans-actions">
        <div class="plans-actions-leading">
          {#if canRework}<Button disabled={busy || editorOpen} onclick={openEditor}>{copy.planBoardRework}</Button>{/if}
        </div>
        <div class="plans-actions-trailing">
          {#if canDelete}<Button danger disabled={busy} onclick={() => void deletePlan()}>{copy.planBoardDelete}</Button>{/if}
          {#if canComplete}<Button disabled={busy} onclick={() => void completePlan()}>{copy.planBoardMarkComplete}</Button>{/if}
          {#if canOpenSession}<Button onclick={() => continuePlan(false)}>{copy.planBoardOpenSession}</Button>{/if}
          {#if canContinue}<Button variant="primary" onclick={() => continuePlan(detail?.execution.status === "planned")}>{detail?.execution.status === "planned" ? copy.planBoardStart : copy.planBoardResume}</Button>{/if}
        </div>
      </div>

      <div class="plans-detail-scroll">
        {#if editorOpen && canRework}
          <section class="plans-card plans-rework" aria-label={copy.planBoardRework}>
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
              <Button disabled={busy} onclick={cancelEditor}>{copy.cancel}</Button>
              <Button disabled={busy || hasIncompleteRework} onclick={addReworkTask}>{copy.planBoardReworkAdd}</Button>
              <Button variant="primary" disabled={busy || !canSaveRework} onclick={() => void saveRework()}>{busy ? copy.planBoardRevising : copy.planBoardReworkSave}</Button>
            </div>
          </section>
        {/if}
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


      </div>

      {#if actionError}<p class="plans-action-error" role="alert">{actionError}</p>{/if}

    {/if}
  </section>
  </div>
</div>
