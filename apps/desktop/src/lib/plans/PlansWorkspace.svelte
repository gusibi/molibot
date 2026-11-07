<script lang="ts">
  import { onMount } from "svelte";
  import Layers from "../icons/duotone/components/Layers.svelte";
  import ChatHeader from "../chat/ChatHeader.svelte";
  import WorkspaceSearch from "../components/ui/WorkspaceSearch.svelte";
  import WorkspaceEmpty from "../components/ui/WorkspaceEmpty.svelte";
  import Button from "../components/ui/Button.svelte";
  import SelectControl from "../components/ui/SelectControl.svelte";
  import PlanEditor from "./PlanEditor.svelte";
  import KanbanBoard from "./KanbanBoard.svelte";
  import KanbanTaskCreate from "./KanbanTaskCreate.svelte";
  import KanbanTaskDetail from "./KanbanTaskDetail.svelte";
  import CheckCircle from "reicon-svelte/icons/CheckCircle";
  import Help from "reicon-svelte/icons/Help";
  import Loader from "reicon-svelte/icons/Loader";
  import TriangleWarning from "reicon-svelte/icons/TriangleWarning";
  import X from "reicon-svelte/icons/X";
  import type { DesktopDurableExecutionStatus, DesktopKanbanBoardItem, DesktopKanbanBoardPage, DesktopKanbanStage, DesktopKanbanTaskBundle, DesktopPlanDetail, DesktopPlanStatus, DesktopPlanActionRequest } from "@molibot/desktop-contract";
  import { loadDesktopAgents, loadDesktopKanbanBoard, loadDesktopKanbanTask, loadDesktopPlan, runDesktopPlanAction, streamDesktopPlans } from "../api";
  import type { DesktopAgentItem } from "@molibot/desktop-contract";
  import type { Translation } from "../i18n";

  export let copy: Translation;
  export let endpoint: string;
  export let targetSessionId = "";
  export let targetPlanId = "";
  let appliedTargetPlanId = "";
  export let formatTime: (iso: string) => string = (iso) => iso;
  export let onContinuePlan: (input: { planId: string; sessionId?: string; projectId?: string; resume: boolean }) => void = () => {};

  // Board (kanban + legacy projection)
  let boardPage: DesktopKanbanBoardPage | null = null;
  let boardLoading = true, boardError = "", search = "", projectId = "", projectIds: string[] = [];
  let createOpen = false, createBusy = false, createError = "";
  let agents: DesktopAgentItem[] = [];
  // Selection: a kanban task or a legacy plan.
  let selectedKind: "" | "kanban" | "plan" = "";
  let selectedId = "";
  let listSeq = 0, requestSeq = 0;
  let mounted = false, online = false, lastUpdated = "";
  // Legacy plan detail
  let detail: DesktopPlanDetail | null = null;
  let detailLoading = false, detailError = "", actionError = "", editorOpen = false;
  // Kanban detail
  let kanbanBundle: DesktopKanbanTaskBundle | null = null;
  let kanbanLoading = false, kanbanError = "";
  let busy = false;
  let mode: "manual" | "accept_edits" = "manual";
  let receiver = "current";

  $: if (mounted && targetPlanId && targetPlanId !== appliedTargetPlanId) {
    appliedTargetPlanId = targetPlanId;
    void selectPlan(targetPlanId);
  }
  $: queryKey = JSON.stringify([search, projectId]);
  $: if (mounted && queryKey) void refreshList();
  $: currentVersion = detail?.execution.currentPlanVersion ?? -1;
  $: currentCriteria = detail?.acceptanceCriteria.filter((criterion) => criterion.planVersion === currentVersion) ?? [];
  $: completedCount = detail?.projection.progress.completed ?? 0;
  $: totalCount = detail?.projection.progress.total ?? 0;
  $: progressPercent = totalCount > 0 ? Math.round(completedCount / totalCount * 100) : 0;
  $: waitingText = detail ? resolveWaitingText(detail) : "";
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
          if (event.type !== "heartbeat") { void refreshList(true); if (selectedId && selectedKind === "plan") void loadDetail(selectedId, true); if (selectedId && selectedKind === "kanban") void loadKanbanDetail(selectedId, true); }
        });
      } catch { /* Keep the last persisted snapshot visible during reconnection. */ }
      if (!controller.signal.aborted) { online = false; timer = setTimeout(() => void connect(), 1000); }
    };
    void connect();
    void loadDesktopAgents(endpoint).then(summary => { agents = summary.items; }).catch(() => { agents = []; });
    return () => { mounted = false; controller.abort(); clearTimeout(timer); };
  });

  async function refreshList(silent = false): Promise<void> {
    if (!endpoint) return;
    const seq = ++listSeq;
    if (!silent && !boardPage) boardLoading = true;
    try {
      const next = await loadDesktopKanbanBoard(endpoint, { search, projectId, limit: 200 });
      if (seq !== listSeq) return;
      boardPage = next; projectIds = next.projectIds; boardError = ""; lastUpdated = new Date().toISOString();
    } catch (cause) { if (seq === listSeq) { boardError = String(cause instanceof Error ? cause.message : cause); online = false; } }
    finally { if (seq === listSeq) boardLoading = false; }
  }
  function clearSelection(): void {
    selectedKind = ""; selectedId = ""; detail = null; kanbanBundle = null;
    detailError = ""; kanbanError = ""; editorOpen = false; actionError = "";
  }
  async function selectPlan(planId: string): Promise<void> {
    selectedKind = "plan"; selectedId = planId; kanbanBundle = null; kanbanError = ""; detail = null; detailError = ""; editorOpen = false; actionError = "";
    await loadDetail(planId);
  }
  async function selectKanban(executionId: string): Promise<void> {
    selectedKind = "kanban"; selectedId = executionId; detail = null; detailError = ""; kanbanBundle = null; kanbanError = ""; actionError = "";
    await loadKanbanDetail(executionId);
  }
  async function loadDetail(planId: string, silent = false): Promise<void> {
    const seq = ++requestSeq;
    if (!silent) { detailLoading = true; detailError = ""; }
    try {
      const next = await loadDesktopPlan(endpoint, planId);
      if (seq === requestSeq && selectedId === planId && (!detail || next.execution.version >= detail.execution.version)) detail = next;
    } catch (cause) { if (seq === requestSeq && (!silent || !detail)) detailError = String(cause instanceof Error ? cause.message : cause); }
    finally { if (seq === requestSeq) detailLoading = false; }
  }
  async function loadKanbanDetail(executionId: string, silent = false): Promise<void> {
    const seq = ++requestSeq;
    if (!silent) { kanbanLoading = true; kanbanError = ""; }
    try {
      const next = await loadDesktopKanbanTask(endpoint, executionId);
      if (seq === requestSeq && selectedId === executionId && (!kanbanBundle || next.detail.execution.version >= kanbanBundle.detail.execution.version)) kanbanBundle = next;
    } catch (cause) { if (seq === requestSeq && (!silent || !kanbanBundle)) kanbanError = String(cause instanceof Error ? cause.message : cause); }
    finally { if (seq === requestSeq) kanbanLoading = false; }
  }
  async function action(input: DesktopPlanActionRequest): Promise<void> {
    if (busy) return;
    busy = true; actionError = "";
    try {
      const response = await runDesktopPlanAction(endpoint, input);
      const nextId = response.item?.execution.id;
      if (nextId && selectedId === nextId) {
        if (selectedKind === "kanban") void loadKanbanDetail(nextId, true);
        else if (!detail || (response.item && response.item.execution.version >= detail.execution.version)) detail = response.item ?? detail;
      }
      if (response.deleted && "planId" in input && selectedId === input.planId) clearSelection();
      await refreshList(true);
    } catch (cause) { actionError = String(cause instanceof Error ? cause.message : cause); }
    finally { busy = false; }
  }
  async function createTask(payload: Extract<DesktopPlanActionRequest, { action: "kanban_create" }>): Promise<void> {
    if (createBusy) return;
    createBusy = true; createError = "";
    try {
      const response = await runDesktopPlanAction(endpoint, payload);
      createOpen = false;
      await refreshList(true);
      if (response.item) void selectKanban(response.item.execution.id);
    } catch (cause) { createError = String(cause instanceof Error ? cause.message : cause); }
    finally { createBusy = false; }
  }
  function openItem(item: DesktopKanbanBoardItem): void {
    if (item.kind === "kanban") void selectKanban(item.executionId);
    else void selectPlan(item.executionId);
  }
  async function moveItem(item: DesktopKanbanBoardItem, stage: DesktopKanbanStage): Promise<void> {
    if (stage === "cancelled") {
      if (!window.confirm(copy.planBoardDeleteConfirm)) return;
      await action({ action: "cancel", planId: item.executionId, expectedVersion: item.version, actionId: crypto.randomUUID() });
      return;
    }
    if (item.kind !== "kanban") return;
    if (stage === "doing") {
      await action({ action: "kanban_start", planId: item.executionId, expectedVersion: item.version, actionId: crypto.randomUUID() });
      return;
    }
    if (stage === "todo") {
      await action({ action: "pause", planId: item.executionId, expectedVersion: item.version, actionId: crypto.randomUUID() });
    }
  }
  async function completeActive(): Promise<void> {
    const version = selectedKind === "kanban" ? kanbanBundle?.detail.execution.version : detail?.execution.version;
    const planId = selectedId;
    if (!version) return;
    await action({ action: "complete", planId, expectedVersion: version, actionId: crypto.randomUUID() });
  }
  async function deletePlan() { if (detail && window.confirm(copy.planBoardDeleteConfirm)) await action({ action: "delete", planId: detail.execution.id, expectedVersion: detail.execution.version }); }
  async function control(kind: "pause" | "cancel") {
    const version = selectedKind === "kanban" ? kanbanBundle?.detail.execution.version : detail?.execution.version;
    if (version) await action({ action: kind, planId: selectedId, expectedVersion: version, actionId: crypto.randomUUID() });
  }
  async function startKanban() {
    const version = kanbanBundle?.detail.execution.version;
    if (version) await action({ action: "kanban_start", planId: selectedId, expectedVersion: version, actionId: crypto.randomUUID() });
  }
  async function answerKanban(text: string) {
    await action({ action: "kanban_answer", planId: selectedId, text });
  }
  async function addKanbanBudget(tokens: number) {
    const version = kanbanBundle?.detail.execution.version;
    if (version) await action({ action: "kanban_budget", planId: selectedId, expectedVersion: version, addTokens: tokens });
  }
  async function saveKanbanConditions(conditions: string[]) {
    const version = kanbanBundle?.detail.execution.version;
    if (version) await action({ action: "kanban_conditions", planId: selectedId, expectedVersion: version, conditions });
  }
  async function decide(kind: "approval" | "answer", id: string, value: string) {
    const version = selectedKind === "kanban" ? kanbanBundle?.detail.execution.version : detail?.execution.version;
    if (!version) return;
    const common = { planId: selectedId, expectedVersion: version, actionId: crypto.randomUUID() };
    await action(kind === "approval" ? { ...common, action: "approval", approvalId: id, status: value as "approved" | "rejected" } : { ...common, action: "answer", decisionId: id, answer: value });
  }
  async function continuePlan(resume: boolean) {
    if (!detail) return;
    if (!resume) { onContinuePlan({ planId: detail.execution.id, sessionId: detail.binding?.sessionId ?? detail.execution.sourceUiSessionId, projectId: detail.execution.sourceProjectId, resume: false }); return; }
    const sessionId = receiver === "current" ? targetSessionId : receiver === "source" ? detail.binding?.sessionId ?? detail.execution.sourceUiSessionId : undefined;
    await action({ action: "approve", planId: detail.execution.id, expectedVersion: detail.execution.version, sessionId: sessionId || undefined, mode });
  }
  const planStatusKeys: Record<DesktopPlanStatus, keyof Translation> = { not_started: "planBoardStatusNotStarted", in_progress: "planBoardStatusInProgress", needs_attention: "planBoardStatusAttention", finished: "planBoardStatusFinished", archived: "planBoardStatusArchived" };
  const stepStatusKeys: Record<string, keyof Translation> = { pending: "durableStatusPlanned", running: "planStatusExecuting", completed: "planStatusCompleted", skipped: "planEditorSkipped", uncertain: "planStatusBlocked", blocked: "planStatusBlocked", failed: "planStatusBlocked" };
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
  <div class="workspace-header-tools">
    <WorkspaceSearch value={search} label={copy.planBoardSearchLabel} placeholder={copy.planBoardSearchPlaceholder} closeLabel={copy.closeSearch} onInput={(value) => { search = value; }} />
    <Button variant="primary" onclick={() => { createError = ""; createOpen = true; }}>{copy.kanbanNewTask}</Button>
  </div>
{/snippet}
<ChatHeader title={copy.planBoardTitle} actions={headerActions} />

<div class="plans-shell">
  <p class="workspace-description" title={copy.planBoardHint}>{copy.planBoardHint}</p>
  <div class="workspace-filterbar">
    <SelectControl value={projectId} ariaLabel={copy.projects} options={[{ value: "", label: copy.planEditorAllProjects }, ...projectIds.map(value => ({ value, label: value }))]} onChange={value => { projectId = value; }} />
  </div>
  <div class="plans-workspace workspace-master-detail" class:detail-open={Boolean(selectedId)}>
  <aside class="plans-rail kanban-rail" aria-label={copy.planBoardTitle}>
    <p class="plans-connection-status" class:online role="status"><span class="plans-live-dot" aria-hidden="true"></span>{online ? copy.planEditorLive : copy.planEditorOffline}{lastUpdated ? ` · ${copy.planBoardUpdated} ${formatTime(lastUpdated)}` : ""}</p>
    <KanbanBoard page={boardPage} loading={boardLoading} error={boardError} {selectedId} {copy} onOpen={openItem} onMove={moveItem} />
  </aside>

  <section class="plans-detail" aria-label={selectedKind === "kanban" ? kanbanBundle?.task.title ?? copy.planBoardTitle : detail?.meta.title ?? copy.planBoardTitle}>
    {#if selectedKind === "kanban"}
      {#key selectedId}
        <KanbanTaskDetail
          bundle={kanbanBundle}
          loading={kanbanLoading}
          error={kanbanError}
          {busy}
          {copy}
          {formatTime}
          onStart={startKanban}
          onBack={clearSelection}
          onPause={() => void control("pause")}
          onCancel={() => void control("cancel")}
          onComplete={() => void completeActive()}
          onAnswer={(text) => void answerKanban(text)}
          onAddBudget={(tokens) => void addKanbanBudget(tokens)}
          onApproval={(approvalId, status) => void decide("approval", approvalId, status)}
          onDecide={(decisionId, answer) => void decide("answer", decisionId, answer)}
          onConditions={(conditions) => void saveKanbanConditions(conditions)}
        />
      {/key}
      {#if actionError}<p class="plans-action-error" role="alert">{actionError}</p>{/if}
    {:else if detailLoading && !detail}
      <div class="plans-state" role="status"><Loader size={16} aria-hidden="true" />{copy.loading}</div>
    {:else if !detail && detailError}
      <div class="plans-state" role="alert"><p>{detailError}</p><Button onclick={() => void loadDetail(selectedId)}>{copy.retryLoading}</Button></div>
    {:else if !detail}
      {#if boardLoading}
        <div class="plans-state" role="status">{copy.loading}</div>
      {:else if boardError}
        <div class="plans-state" role="alert"><p>{copy.kanbanLoadFailed}</p><Button onclick={() => void refreshList()}>{copy.retryLoading}</Button></div>
      {:else}
        <div class="plans-landing">
          <div class="plans-landing-heading"><span class="plans-landing-mark"><Layers size={24} aria-hidden="true" /></span><h2>{copy.planBoardOverviewTitle}</h2><p>{copy.planBoardOverviewHint}</p></div>
          <div class="plans-overview-stats" role="group" aria-label={copy.tasksByStatus}>
            <button type="button" class="plans-stat" data-plan-status="in_progress"><span>{copy.kanbanColumnDoing}</span><strong>{boardPage?.counts.doing ?? 0}</strong></button>
            <button type="button" class="plans-stat" data-plan-status="needs_attention"><span>{copy.kanbanColumnTodo}</span><strong>{boardPage?.counts.todo ?? 0}</strong></button>
            <button type="button" class="plans-stat" data-plan-status="archived"><span>{copy.kanbanColumnDone}</span><strong>{boardPage?.counts.done ?? 0}</strong></button>
          </div>
          <WorkspaceEmpty title={copy.planBoardSelectHint} />
        </div>
      {/if}
    {:else}
      <header class="plans-detail-head">
        <button type="button" class="plans-back" aria-label={copy.planBoardTitle} onclick={() => clearSelection()}><X size={15} aria-hidden="true" /></button>
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

      {#if !editorOpen}
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
          {#if canComplete}<Button variant="primary" disabled={busy} onclick={() => void completeActive()}>{copy.planBoardMarkComplete}</Button>{/if}
          {#if canOpenSession}<Button onclick={() => void continuePlan(false)}>{copy.planBoardOpenSession}</Button>{/if}
          {#if canContinue}<Button variant="primary" disabled={busy || editorOpen} onclick={() => void continuePlan(true)}>{detail?.execution.status === "planned" ? copy.planBoardStart : copy.planBoardResume}</Button>{/if}
        </div>
      </div>

      {/if}
      <div class="plans-detail-scroll" class:editing={editorOpen}>
        {#if editorOpen}
          {#key detail.execution.id}<PlanEditor {detail} {endpoint} {copy} onClose={() => editorOpen = false} onSaved={(next) => { if (selectedId === next.execution.id && (!detail || next.execution.version >= detail.execution.version)) { detail = next; editorOpen = false; } void refreshList(true); }} />{/key}
        {:else}
        {#each detail.approvals.filter(item => item.status === "pending") as approval (approval.id)}
          <section class="plans-card plans-attention"><h3>{approval.title}</h3><p>{approval.summary}</p><div class="plans-response-actions"><Button disabled={busy} onclick={() => void decide("approval", approval.id, "rejected")}>{copy.planReject}</Button><Button variant="primary" disabled={busy} onclick={() => void decide("approval", approval.id, "approved")}>{copy.planEditorApproveOnce}</Button></div></section>
        {/each}
        {#each detail.decisions.filter(item => item.status === "open") as decision (decision.id)}
          <section class="plans-card plans-attention"><h3>{copy.planBoardStatusAttention}</h3><p>{decision.question}</p><div class="plans-response-actions">{#each decision.options as answer (answer)}<Button disabled={busy} onclick={() => void decide("answer", decision.id, answer)}>{answer === "confirm_completion" ? copy.planBoardMarkComplete : answer === "completed" ? copy.planStatusCompleted : answer === "not_completed" ? copy.continueAction : copy.continueAction}</Button>{/each}</div></section>
        {/each}
        <section class="plans-card plans-overview">
          {#if detail.meta.summary}<p class="plans-summary-text">{detail.meta.summary}</p>{/if}
          <div class="plans-progress-heading"><h3 class="plans-section-title">{copy.planBoardProgress}</h3><span class="plans-count">{copy.planBoardStepsCount.replace("{done}", String(completedCount)).replace("{total}", String(totalCount))}</span></div>
          <div class="plans-progress">
            <div class="plans-progress-track" role="progressbar" aria-label={copy.planBoardProgress} aria-valuenow={progressPercent} aria-valuemin="0" aria-valuemax="100"><span style={"transform: scaleX(" + progressPercent / 100 + ")"}></span></div>
          </div>
          {#if detail.projection.nextStep}<p class="plans-current"><span>{copy.planBoardCurrentStep}</span>{detail.projection.nextStep.title}</p>{/if}
          {#if waitingText}<p class="plans-waiting"><strong>{copy.durableWaitingReason}</strong>{waitingText}</p>{/if}
          {#if detail.execution.lastError}<p class="plans-error-alert">{detail.execution.lastError}</p>{/if}
        </section>

        <section class="plans-card">
          <h3 class="plans-section-title">{copy.planBoardTasks}<span class="plans-section-count">{detail.tasks.length}</span></h3>
          <ol class="plans-tasks">
            {#each detail.tasks as task, taskIndex (task.id)}
              <li class="plans-task">
                <header class="plans-task-head">
                  <strong><span class="plans-task-index">{String(taskIndex + 1).padStart(2, "0")}</span>{task.title}</strong>
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
            <h3 class="plans-section-title">{copy.planBoardAcceptance}<span class="plans-section-count">{currentCriteria.length}</span></h3>
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

        {/if}
      </div>

      {#if actionError}<p class="plans-action-error" role="alert">{actionError}</p>{/if}

    {/if}
  </section>
  </div>
</div>

<KanbanTaskCreate open={createOpen} busy={createBusy} {copy} {projectIds} {agents} onCreate={(payload) => void createTask(payload)} onClose={() => createOpen = false} />
{#if createError}<p class="plans-action-error" role="alert">{createError}</p>{/if}
