<script lang="ts">
  import { onMount } from "svelte";
  import Layers from "../icons/duotone/components/Layers.svelte";
  import ChatHeader from "../chat/ChatHeader.svelte";
  import WorkspaceSearch from "../components/ui/WorkspaceSearch.svelte";
  import WorkspaceEmpty from "../components/ui/WorkspaceEmpty.svelte";
  import Button from "../components/ui/Button.svelte";
  import SelectControl from "../components/ui/SelectControl.svelte";
  import PlanEditor from "./PlanEditor.svelte";
  import CheckCircle from "reicon-svelte/icons/CheckCircle";
  import Help from "reicon-svelte/icons/Help";
  import Loader from "reicon-svelte/icons/Loader";
  import TriangleWarning from "reicon-svelte/icons/TriangleWarning";
  import X from "reicon-svelte/icons/X";
  import type { DesktopDurableExecutionStatus, DesktopPlanDetail, DesktopPlanListItem, DesktopPlanStatus, DesktopPlanActionRequest } from "@molibot/desktop-contract";
  import { loadDesktopPlan, loadDesktopPlans, runDesktopPlanAction, streamDesktopPlans } from "../api";
  import type { Translation } from "../i18n";

  export let copy: Translation;
  export let endpoint: string;
  export let targetSessionId = "";
  export let formatTime: (iso: string) => string = (iso) => iso;
  export let onContinuePlan: (input: { planId: string; sessionId?: string; projectId?: string; resume: boolean }) => void = () => {};
  type FilterBucket = "all" | DesktopPlanStatus;
  const filterOptions: Array<{ value: FilterBucket; key: keyof Translation }> = [
    { value: "all", key: "planBoardFilterAll" }, { value: "not_started", key: "planBoardFilterNotStarted" },
    { value: "in_progress", key: "planBoardFilterInProgress" }, { value: "needs_attention", key: "planBoardFilterAttention" },
    { value: "finished", key: "planBoardFilterFinished" }, { value: "archived", key: "planBoardFilterArchived" }
  ];
  const planStatusKeys: Record<DesktopPlanStatus, keyof Translation> = { not_started: "planBoardStatusNotStarted", in_progress: "planBoardStatusInProgress", needs_attention: "planBoardStatusAttention", finished: "planBoardStatusFinished", archived: "planBoardStatusArchived" };
  const stepStatusKeys: Record<string, keyof Translation> = { pending: "durableStatusPlanned", running: "planStatusExecuting", completed: "planStatusCompleted", skipped: "planEditorSkipped", uncertain: "planStatusBlocked", blocked: "planStatusBlocked", failed: "planStatusBlocked" };
  let items: DesktopPlanListItem[] = [];
  let listLoading = true, listError = "", search = "", selectedId = "", detailLoading = false, busy = false, actionError = "", editorOpen = false;
  let detail: DesktopPlanDetail | null = null;
  let filter: FilterBucket = "all";
  let offset = 0, total = 0, projectId = "", mounted = false, online = false, lastUpdated = "", listSeq = 0, requestSeq = 0;
  let projectIds: string[] = [];
  let mode: "manual" | "accept_edits" = "manual";
  let receiver = "current";
  let counts: Record<string, number> = {};
  $: visibleItems = items;
  $: filterItems = filterOptions.map(({ value, key }) => ({ value, label: copy[key], count: counts[value] ?? 0 }));
  $: statuses = filter === "all" ? undefined : Object.entries({ planned: "not_started", queued: "in_progress", running: "in_progress", verifying: "in_progress", completed: "archived", cancelled: "finished", paused: "needs_attention", waiting_for_user: "needs_attention", waiting_for_approval: "needs_attention", recovery_required: "needs_attention", partial: "needs_attention", failed: "needs_attention" }).filter(([, bucket]) => bucket === filter).map(([status]) => status);
  $: queryKey = JSON.stringify([search, filter, projectId, offset]);
  $: if (mounted && queryKey) void refreshList();
  $: currentVersion = detail?.execution.currentPlanVersion ?? -1;
  $: currentCriteria = detail?.acceptanceCriteria.filter((criterion) => criterion.planVersion === currentVersion) ?? [];
  $: completedCount = detail?.projection.progress.completed ?? 0;
  $: totalCount = detail?.projection.progress.total ?? 0;
  $: progressPercent = totalCount > 0 ? Math.round(completedCount / totalCount * 100) : 0;
  $: waitingText = detail ? resolveWaitingText(detail) : "";
  $: showDetailPane = detailLoading || Boolean(detail) || Boolean(selectedId);
  $: canContinue = detail !== null && ["planned", "paused", "recovery_required", "failed"].includes(detail.execution.status);
  $: canOpenSession = Boolean(detail?.binding?.sessionId ?? detail?.execution.sourceUiSessionId);
  $: canRework = detail !== null && detail.execution.status !== "cancelled";
  $: canDelete = detail !== null && !["queued", "running", "verifying", "waiting_for_approval"].includes(detail.execution.status);
  $: canComplete = detail?.decisions.some(item => item.status === "open" && item.options.includes("confirm_completion")) ?? false;

  onMount(() => {
    mounted = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const connect = async () => {
      try {
        await streamDesktopPlans(endpoint, controller.signal, event => {
          online = true;
          if (event.type !== "heartbeat") { void refreshList(true); if (selectedId) void loadDetail(selectedId, true); }
        });
      } catch { /* Keep the last persisted snapshot visible during reconnection. */ }
      if (!controller.signal.aborted) { online = false; timer = setTimeout(() => void connect(), 1000); }
    };
    void connect();
    return () => { mounted = false; controller.abort(); clearTimeout(timer); };
  });
  async function refreshList(silent = false): Promise<void> {
    if (!endpoint) return;
    const seq = ++listSeq;
    if (!silent && items.length === 0) listLoading = true;
    try {
      const next = await loadDesktopPlans(endpoint, { includeArchived: true, limit: 25, offset, search, projectId, statuses });
      if (seq !== listSeq) return;
      items = next.items; total = next.total; counts = next.counts; projectIds = next.projectIds; lastUpdated = new Date().toISOString(); listError = "";
    } catch (cause) { if (seq === listSeq) { listError = String(cause instanceof Error ? cause.message : cause); online = false; } }
    finally { if (seq === listSeq) listLoading = false; }
  }
  async function selectPlan(planId: string): Promise<void> {
    if (selectedId === planId && detail) return;
    selectedId = planId; detail = null; editorOpen = false; actionError = "";
    await loadDetail(planId);
  }
  async function loadDetail(planId: string, silent = false): Promise<void> {
    const seq = ++requestSeq;
    if (!silent) detailLoading = true;
    try {
      const next = await loadDesktopPlan(endpoint, planId);
      if (seq === requestSeq && selectedId === planId && (!detail || next.execution.version >= detail.execution.version)) detail = next;
    } catch (cause) { if (!silent && seq === requestSeq) actionError = String(cause instanceof Error ? cause.message : cause); }
    finally { if (seq === requestSeq) detailLoading = false; }
  }
  async function action(input: DesktopPlanActionRequest): Promise<void> {
    if (busy) return;
    busy = true; actionError = "";
    try {
      const response = await runDesktopPlanAction(endpoint, input);
      if (response.item && selectedId === response.item.execution.id && (!detail || response.item.execution.version >= detail.execution.version)) detail = response.item;
      if (response.deleted && "planId" in input && selectedId === input.planId) { detail = null; selectedId = ""; }
      await refreshList(true);
    } catch (cause) { actionError = String(cause instanceof Error ? cause.message : cause); }
    finally { busy = false; }
  }
  async function completePlan() { if (detail) await action({ action: "complete", planId: detail.execution.id, expectedVersion: detail.execution.version, actionId: crypto.randomUUID() }); }
  async function deletePlan() { if (detail && window.confirm(copy.planBoardDeleteConfirm)) await action({ action: "delete", planId: detail.execution.id, expectedVersion: detail.execution.version }); }
  async function control(kind: "pause" | "cancel") { if (detail) await action({ action: kind, planId: detail.execution.id, expectedVersion: detail.execution.version, actionId: crypto.randomUUID() }); }
  async function continuePlan(resume: boolean) {
    if (!detail) return;
    if (!resume) { onContinuePlan({ planId: detail.execution.id, sessionId: detail.binding?.sessionId ?? detail.execution.sourceUiSessionId, projectId: detail.execution.sourceProjectId, resume: false }); return; }
    const sessionId = receiver === "current" ? targetSessionId : receiver === "source" ? detail.binding?.sessionId ?? detail.execution.sourceUiSessionId : undefined;
    await action({ action: "approve", planId: detail.execution.id, expectedVersion: detail.execution.version, sessionId: sessionId || undefined, mode });
  }
  async function decide(kind: "approval" | "answer", id: string, value: string) {
    if (!detail) return;
    const common = { planId: detail.execution.id, expectedVersion: detail.execution.version, actionId: crypto.randomUUID() };
    await action(kind === "approval" ? { ...common, action: "approval", approvalId: id, status: value as "approved" | "rejected" } : { ...common, action: "answer", decisionId: id, answer: value });
  }
  function planStatusLabel(status: DesktopPlanStatus): string { return copy[planStatusKeys[status]]; }
  function stepStatusLabel(status: string): string { return copy[stepStatusKeys[status] ?? "durableStatusPlanned"]; }
  function statusBucket(status: DesktopDurableExecutionStatus): DesktopPlanStatus {
    if (status === "planned") return "not_started"; if (status === "completed") return "archived"; if (status === "cancelled") return "finished";
    return ["queued", "running", "verifying"].includes(status) ? "in_progress" : "needs_attention";
  }
  function taskProgress(task: DesktopPlanDetail["tasks"][number]) { return copy.planBoardStepsCount.replace("{done}", String(task.steps.filter(step => step.status === "completed").length)).replace("{total}", String(task.steps.length)); }
  function stepOutputSummary(summary?: string) { return summary === "The bounded Agent attempt completed this plan step." ? copy.durableStepAttemptCompleted : summary?.startsWith("Run detail for completed step") ? copy.durableEvidence : summary ?? ""; }
  function criterionLabel(description: string) { return description === "The plan's requested outcome is verified." ? copy.planBoardDefaultCriterion : description === "Every step in the accepted plan has completed." ? copy.durableCriterionAllStepsComplete : description; }
  function criterionResultLabel(result: "unproven" | "passed" | "failed") { return result === "passed" ? copy.planStatusCompleted : result === "failed" ? copy.planStatusBlocked : copy.durableStatusPlanned; }
  function resolveWaitingText(plan: DesktopPlanDetail) { return plan.projection.waiting?.kind === "review" ? copy.planReviewPrompt : plan.projection.waiting?.kind === "recovery" ? copy.planBoardRecoveryReason : plan.execution.waitingReason ?? ""; }
</script>

{#snippet headerActions()}
  <div class="workspace-header-tools"><WorkspaceSearch value={search} label={copy.planBoardSearchLabel} placeholder={copy.planBoardSearchPlaceholder} closeLabel={copy.closeSearch} onInput={(value) => { search = value; offset = 0; }} /></div>
{/snippet}
<ChatHeader title={copy.planBoardTitle} actions={headerActions} />

<div class="plans-shell">
  <p class="workspace-description" title={copy.planBoardHint}>{copy.planBoardHint}</p>
  <div class="workspace-filterbar">
    <SelectControl value={projectId} ariaLabel={copy.projects} options={[{ value: "", label: copy.planEditorAllProjects }, ...projectIds.map(value => ({ value, label: value }))]} onChange={value => { projectId = value; offset = 0; }} />
    <div class="segmented workspace-plan-filters" role="group" aria-label={copy.tasksByStatus}>
      {#each filterItems as item (item.value)}
        <Button class={`segmented-item${filter === item.value ? " active" : ""}`} aria-pressed={filter === item.value} onclick={() => { filter = item.value; offset = 0; }}>{item.label} <span class="workspace-category-count">{item.count}</span></Button>
      {/each}
    </div>
  </div>
  <div class="plans-workspace workspace-master-detail" class:detail-open={showDetailPane}>
  <aside class="plans-rail" aria-label={copy.planBoardTitle}>
    <p class="plans-connection-status" role="status">{online ? copy.planEditorLive : copy.planEditorOffline}{lastUpdated ? ` · ${copy.planBoardUpdated} ${formatTime(lastUpdated)}` : ""}</p>

    {#if listLoading && items.length === 0}
      <div class="plans-state" role="status">{copy.loading}</div>
    {:else if listError && items.length === 0}
      <div class="plans-state" role="alert"><p>{copy.planBoardLoadFailed}</p><small>{listError}</small><button class="secondary-button" type="button" onclick={() => void refreshList()}>{copy.retryLoading}</button></div>
    {:else if items.length === 0}
      <div class="plans-state"><Layers size={22} aria-hidden="true" /><p>{search.trim() || projectId || statuses?.length ? copy.planBoardNoMatches : copy.planBoardEmpty}</p></div>
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
    <div class="plans-pagination"><Button disabled={offset === 0 || listLoading} onclick={() => offset = Math.max(0, offset - 25)}>{copy.planEditorPrevious}</Button><span>{Math.min(offset + 1, total)}–{Math.min(offset + 25, total)} / {total}</span><Button disabled={offset + 25 >= total || listLoading} onclick={() => offset += 25}>{copy.planEditorNext}</Button></div>
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

      {#if canContinue}<div class="plans-execution-options">
        <SelectControl value={mode} ariaLabel={copy.planEditorMode} options={[{ value: "manual", label: copy.permissionModeManual }, { value: "accept_edits", label: copy.permissionModeAcceptEdits }]} onChange={value => mode = value as typeof mode} />
        <SelectControl value={receiver} ariaLabel={copy.planEditorReceiver} options={[{ value: "current", label: copy.planEditorCurrentSession, disabled: !targetSessionId }, { value: "source", label: copy.planBoardOpenSession, disabled: !detail.execution.sourceUiSessionId && !detail.binding }, { value: "new", label: copy.planEditorNewSession }]} onChange={value => receiver = value} />
      </div>{/if}
      <div class="plans-actions">
        <div class="plans-actions-leading">
          {#if canRework}<Button disabled={busy || editorOpen} onclick={() => editorOpen = true}>{copy.planEditorTitle}</Button>{/if}
        </div>
        <div class="plans-actions-trailing">
          {#if detail.controlRequest}<span role="status">{detail.controlRequest === "pause" ? copy.planEditorPausing : copy.planEditorCancelling}</span>{/if}
          {#if ["queued", "running", "waiting_for_approval", "waiting_for_user", "verifying"].includes(detail.execution.status)}
            <Button disabled={busy || Boolean(detail.controlRequest)} onclick={() => void control("pause")}>{copy.durablePause}</Button>
            <Button danger disabled={busy || Boolean(detail.controlRequest)} onclick={() => void control("cancel")}>{copy.durableCancel}</Button>
          {/if}
          {#if canDelete}<Button danger disabled={busy} onclick={() => void deletePlan()}>{copy.planBoardDelete}</Button>{/if}
          {#if canComplete}<Button disabled={busy} onclick={() => void completePlan()}>{copy.planBoardMarkComplete}</Button>{/if}
          {#if canOpenSession}<Button onclick={() => void continuePlan(false)}>{copy.planBoardOpenSession}</Button>{/if}
          {#if canContinue}<Button variant="primary" disabled={busy || editorOpen} onclick={() => void continuePlan(true)}>{detail?.execution.status === "planned" ? copy.planBoardStart : copy.planBoardResume}</Button>{/if}
        </div>
      </div>

      <div class="plans-detail-scroll">
        {#if editorOpen}
          {#key detail.execution.id}<PlanEditor {detail} {endpoint} {copy} onClose={() => editorOpen = false} onSaved={(next) => { if (selectedId === next.execution.id && (!detail || next.execution.version >= detail.execution.version)) { detail = next; editorOpen = false; } void refreshList(true); }} />{/key}
        {/if}
        {#each detail.approvals.filter(item => item.status === "pending") as approval}
          <section class="plans-card"><h3>{approval.title}</h3><p>{approval.summary}</p><Button disabled={busy} onclick={() => void decide("approval", approval.id, "rejected")}>{copy.planReject}</Button><Button variant="primary" disabled={busy} onclick={() => void decide("approval", approval.id, "approved")}>{copy.planEditorApproveOnce}</Button></section>
        {/each}
        {#each detail.decisions.filter(item => item.status === "open") as decision}
          <section class="plans-card"><h3>{copy.planBoardStatusAttention}</h3><p>{decision.question}</p>{#each decision.options as answer}<Button disabled={busy} onclick={() => void decide("answer", decision.id, answer)}>{answer === "confirm_completion" ? copy.planBoardMarkComplete : answer === "completed" ? copy.planStatusCompleted : answer === "not_completed" ? copy.continueAction : copy.continueAction}</Button>{/each}</section>
        {/each}
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
