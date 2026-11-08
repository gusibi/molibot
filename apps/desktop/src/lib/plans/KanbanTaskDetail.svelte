<script lang="ts">
  import ArrowLeft from "reicon-svelte/icons/ArrowLeft";
  import Check from "reicon-svelte/icons/Check";
  import CheckCircle from "reicon-svelte/icons/CheckCircle";
  import Coins from "reicon-svelte/icons/Coins";
  import Help from "reicon-svelte/icons/Help";
  import Loader from "reicon-svelte/icons/Loader";
  import Message from "reicon-svelte/icons/Message";
  import Pause from "reicon-svelte/icons/Pause";
  import Pen from "reicon-svelte/icons/Pen";
  import Plane2 from "reicon-svelte/icons/Plane2";
  import Play from "reicon-svelte/icons/Play";
  import StopCircle from "reicon-svelte/icons/StopCircle";
  import TriangleWarning from "reicon-svelte/icons/TriangleWarning";
  import Button from "../components/ui/Button.svelte";
  import ChatMarkdown from "../chat/ChatMarkdown.svelte";
  import ProcessTimeline from "../chat/ProcessTimeline.svelte";
  import type { DesktopConversationActivity, DesktopKanbanTaskBundle } from "@molibot/desktop-contract";
  import type { Translation } from "../i18n";
  import type { TranscriptProcessBlock } from "../chat/transcript";

  interface Props {
    bundle: DesktopKanbanTaskBundle | null;
    loading: boolean;
    error: string;
    busy: boolean;
    copy: Translation;
    formatTime: (iso: string) => string;
    onBack: () => void;
    onOpenSession: (input: { sessionId: string; projectId?: string }) => void;
    onOpenMemberSession: (input: { sessionId: string; agentId: string; title: string }) => void;
    onStart: () => void;
    onPause: () => void;
    onCancel: () => void;
    onComplete: () => void;
    onAnswer: (text: string) => void;
    onAddBudget: (tokens: number) => void;
    onApproval: (approvalId: string, status: "approved" | "rejected") => void;
    onDecide: (decisionId: string, answer: string) => void;
    onConditions: (descriptions: string[]) => void;
  }
  let { bundle, loading, error, busy, copy, formatTime, onBack, onOpenSession, onOpenMemberSession, onStart, onPause, onCancel, onComplete, onAnswer, onAddBudget, onApproval, onDecide, onConditions }: Props = $props();

  let answerText = $state("");
  let conditionsEditing = $state(false);
  let conditionsDraft = $state("");

  const status = $derived(bundle?.detail.execution.status ?? "");
  const active = $derived(["queued", "running", "verifying", "waiting_for_user", "waiting_for_approval"].includes(status));
  const canStart = $derived(["planned", "paused", "recovery_required", "failed", "partial"].includes(status));
  const openDecision = $derived(bundle?.detail.decisions.find(item => item.status === "open" && item.options.includes("confirm_completion")));
  const pendingApprovals = $derived(bundle?.detail.approvals.filter(item => item.status === "pending") ?? []);
  const currentCriteria = $derived.by(() => {
    if (!bundle) return [];
    const version = bundle.detail.execution.currentPlanVersion;
    return bundle.detail.acceptanceCriteria.filter(criterion => criterion.planVersion === version);
  });
  const checkedTotal = $derived(bundle?.checklist.length ?? 0);
  const doneChecked = $derived(bundle?.checklist.filter(item => item.done).length ?? 0);
  const checklistPercent = $derived(checkedTotal > 0 ? Math.round(doneChecked / checkedTotal * 100) : 0);

  type FeedEntry =
    | { kind: "input"; at: string; inputId: string; text: string; consumedRound: number | null }
    | { kind: "receipt"; at: string; receiptId: string; round: number; actorAgentId: string; conclusion: string; evidence: string[]; intents: string[]; question?: string }
    | { kind: "handoff"; at: string; id: string; round: number; fromAgentId: string | null; toAgentId: string; brief: string }
    | { kind: "attempt"; at: string; attemptId: string; runId: string; round: number | null; text: string; blocks: TranscriptProcessBlock[] };

  const feed = $derived.by((): FeedEntry[] => {
    if (!bundle) return [];
    const entries: FeedEntry[] = [];
    for (const input of bundle.inputs) {
      entries.push({ kind: "input", at: input.createdAt, inputId: input.inputId, text: input.text, consumedRound: input.consumedRound });
    }
    for (const receipt of bundle.receipts) {
      const intents: string[] = [];
      if (receipt.actions.continueWork) intents.push(copy.kanbanIntentContinue);
      if (receipt.actions.requestCompletion) intents.push(copy.kanbanIntentVerify);
      if (receipt.actions.question?.text) intents.push(copy.kanbanIntentQuestion);
      if (receipt.actions.verifyAt) intents.push(copy.kanbanIntentReview);
      if (receipt.actions.handoffTo) intents.push(copy.kanbanIntentHandoff);
      entries.push({
        kind: "receipt", at: receipt.createdAt, receiptId: receipt.receiptId, round: receipt.round,
        actorAgentId: receipt.actorAgentId,
        conclusion: receipt.actions.conclusion ?? "",
        evidence: receipt.actions.evidence ?? [],
        intents,
        ...(receipt.actions.question?.text ? { question: receipt.actions.question.text } : {})
      });
    }
    for (const handoff of bundle.handoffs) {
      if (handoff.kind === "assign") continue;
      entries.push({ kind: "handoff", at: handoff.createdAt, id: handoff.id, round: handoff.round, fromAgentId: handoff.fromAgentId, toAgentId: handoff.toAgentId, brief: handoff.brief });
    }
    for (const attempt of bundle.attempts) {
      // A suspended approval can leave the last tool "running" forever in the
      // snapshot; the attempt is over, so it reads as info, not a live spinner.
      const activities: DesktopConversationActivity[] = attempt.activities.map(activity =>
        activity.state === "running" ? { ...activity, state: "info" } : activity
      );
      if (!attempt.text.trim() && activities.length === 0) continue;
      entries.push({
        kind: "attempt", at: attempt.updatedAt, attemptId: attempt.attemptId, runId: attempt.runId,
        round: attempt.round, text: attempt.text,
        blocks: activities.length > 0 ? [{ id: attempt.attemptId, kind: "activities", activities }] : []
      });
    }
    return entries.sort((left, right) => left.at.localeCompare(right.at));
  });

  function intentSubmit(): void {
    const text = answerText.trim();
    if (!text) return;
    answerText = "";
    onAnswer(text);
  }
  function addBudget(): void {
    const raw = window.prompt(copy.kanbanAddBudgetPrompt, "500000");
    if (!raw) return;
    const tokens = Number(raw);
    if (Number.isFinite(tokens) && tokens > 0) onAddBudget(Math.round(tokens));
  }
  function memberName(agentId: string): string {
    return bundle?.task.members.find(member => member.agentId === agentId)?.name ?? agentId;
  }
  function editConditions(): void {
    conditionsDraft = currentCriteria.filter(criterion => !criterion.userEdited || criterion.result !== "passed").map(criterion => criterion.description).join("\n");
    conditionsEditing = true;
  }
  function saveConditions(): void {
    const descriptions = conditionsDraft.split("\n").map(line => line.trim()).filter(Boolean);
    if (descriptions.length === 0) return;
    conditionsEditing = false;
    onConditions(descriptions);
  }
</script>

{#if loading && !bundle}
  <header class="plans-detail-head">
    <button type="button" class="plans-back" title={copy.back} aria-label={copy.back} onclick={onBack}><ArrowLeft size={16} aria-hidden="true" /></button>
  </header>
  <div class="kanban-state" role="status"><Loader size={16} aria-hidden="true" />{copy.loading}</div>
{:else if !bundle && error}
  <header class="plans-detail-head">
    <button type="button" class="plans-back" title={copy.back} aria-label={copy.back} onclick={onBack}><ArrowLeft size={16} aria-hidden="true" /></button>
  </header>
  <div class="kanban-state" role="alert"><p>{error}</p></div>
{:else if bundle}
  <header class="plans-detail-head">
    <button type="button" class="plans-back" title={copy.back} aria-label={copy.back} onclick={onBack}><ArrowLeft size={16} aria-hidden="true" /></button>
    <div class="plans-detail-title">
      <div class="plans-title-row">
        <h2>{bundle.task.title}</h2>
        {#if bundle.task.form === "team"}<span class="kanban-card-tag" data-form="team">{copy.kanbanFormTeam}</span>{/if}
      </div>
      <p class="plans-subtitle">
        <span class="plans-mono" translate="no">{bundle.detail.execution.shortHandle}</span>
        <span class="plans-dot" aria-hidden="true">·</span>
        <span>{copy.kanbanRoundLabel.replace("{round}", String(bundle.task.roundCount))}</span>
        {#if bundle.task.currentAgentId}
          <span class="plans-dot" aria-hidden="true">·</span>
          <span>{copy.kanbanCurrentMember}: {bundle.task.currentAgentId}</span>
        {/if}
        {#if bundle.task.retryCount > 0}
          <span class="plans-dot" aria-hidden="true">·</span>
          <span>{copy.kanbanRetryState.replace("{count}", String(bundle.task.retryCount)).replace("{max}", "3")}</span>
        {/if}
        <span class="plans-dot" aria-hidden="true">·</span>
        <span>{copy.planBoardUpdated} {formatTime(bundle.detail.execution.updatedAt)}</span>
      </p>
    </div>
  </header>

  <div class="plans-actions">
    <div class="plans-actions-leading">
      {#if bundle.task.budgetTokenLimit}
        <span class="kanban-budget-chip" title={copy.kanbanFieldBudget}>{bundle.detail.execution.tokensUsed}/{bundle.task.budgetTokenLimit}</span>
      {/if}
    </div>
    <div class="plans-actions-trailing">
      {#if bundle.detail.controlRequest}<span role="status">{bundle.detail.controlRequest === "pause" ? copy.planEditorPausing : copy.planEditorCancelling}</span>{/if}
      {#if bundle.detail.execution.sourceUiSessionId}
        <Button variant="icon" title={copy.planBoardOpenSession} onclick={() => onOpenSession({ sessionId: bundle!.detail.execution.sourceUiSessionId!, projectId: bundle!.detail.execution.sourceProjectId })}><Message size={16} aria-hidden="true" /></Button>
      {/if}
      {#if active}
        <Button variant="icon" title={copy.durablePause} disabled={busy || Boolean(bundle.detail.controlRequest)} onclick={onPause}><Pause size={16} aria-hidden="true" /></Button>
        <Button variant="icon" danger title={copy.durableCancel} disabled={busy || Boolean(bundle.detail.controlRequest)} onclick={onCancel}><StopCircle size={16} aria-hidden="true" /></Button>
      {/if}
      {#if canStart}<Button variant="primary" class="plans-icon-action" title={copy.kanbanStartTask} disabled={busy} onclick={onStart}><Play size={16} aria-hidden="true" /></Button>{/if}
      {#if openDecision}<Button variant="primary" class="plans-icon-action" title={copy.planBoardMarkComplete} disabled={busy} onclick={onComplete}><Check size={16} aria-hidden="true" /></Button>{/if}
      <Button variant="icon" title={copy.kanbanAddBudget} disabled={busy} onclick={addBudget}><Coins size={16} aria-hidden="true" /></Button>
    </div>
  </div>

  <div class="plans-detail-scroll">
    {#each pendingApprovals as approval (approval.id)}
      <section class="plans-card plans-attention"><h3>{approval.title}</h3><p>{approval.summary}</p>
        <div class="plans-response-actions">
          <Button disabled={busy} onclick={() => onApproval(approval.id, "rejected")}>{copy.planReject}</Button>
          <Button variant="primary" disabled={busy} onclick={() => onApproval(approval.id, "approved")}>{copy.planEditorApproveOnce}</Button>
        </div>
      </section>
    {/each}
    {#each bundle.detail.decisions.filter(item => item.status === "open") as decision (decision.id)}
      <section class="plans-card plans-attention"><h3>{copy.planBoardStatusAttention}</h3><p>{decision.question}</p>
        <div class="plans-response-actions">
          {#each decision.options as answer (answer)}
            <Button disabled={busy} onclick={() => onDecide(decision.id, answer)}>{answer === "confirm_completion" ? copy.planBoardMarkComplete : copy.continueAction}</Button>
          {/each}
        </div>
      </section>
    {/each}

    {#if status === "waiting_for_user" && bundle.detail.execution.waitingReason}
      <section class="plans-card plans-attention"><p>{bundle.detail.execution.waitingReason}</p></section>
    {/if}
    {#if bundle.detail.execution.lastError && status !== "waiting_for_user"}
      <p class="plans-error-alert">{bundle.detail.execution.lastError}</p>
    {/if}

    <section class="plans-card">
      <div class="plans-progress-heading">
        <h3 class="plans-section-title">{bundle.task.goal}</h3>
        {#if !conditionsEditing}
          <Button variant="icon" title={copy.kanbanConditionsEdit} disabled={busy} onclick={editConditions}><Pen size={15} aria-hidden="true" /></Button>
        {/if}
      </div>
      {#if conditionsEditing}
        <p class="plans-task-desc">{copy.kanbanConditionsHint}</p>
        <textarea class="kanban-conditions-input" rows={Math.max(2, conditionsDraft.split("\n").length)} bind:value={conditionsDraft}></textarea>
        <div class="plans-response-actions">
          <Button disabled={busy} onclick={() => { conditionsEditing = false; }}>{copy.planBoardCancel}</Button>
          <Button variant="primary" disabled={busy || conditionsDraft.trim().length === 0} onclick={saveConditions}>{copy.kanbanConditionsSave}</Button>
        </div>
      {:else if currentCriteria.length > 0}
        <ul class="plans-criteria">
          {#each currentCriteria as criterion (criterion.id)}
            <li class="plans-criterion" data-result={criterion.result}>
              <span class="plans-criterion-marker" aria-hidden="true">
                {#if criterion.result === "passed"}<CheckCircle size={14} />
                {:else if criterion.result === "failed"}<TriangleWarning size={14} />
                {:else}<Help size={14} />{/if}
              </span>
              <span class="plans-criterion-text">{criterion.description}</span>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="plans-task-desc">{copy.kanbanConditionsEmpty}</p>
      {/if}
    </section>

    <section class="kanban-feed" aria-label={copy.planBoardTitle}>
      {#each feed as entry (entry.kind === "receipt" ? entry.receiptId : entry.kind === "handoff" ? entry.id : entry.kind === "attempt" ? entry.attemptId : entry.inputId)}
        {#if entry.kind === "input"}
          <article class="kanban-feed-item kanban-feed-user" data-consumed={entry.consumedRound !== null}>
            <header><span class="kanban-feed-role">{copy.kanbanUserInputLabel}</span>{#if entry.consumedRound !== null}<span class="kanban-feed-round">{copy.kanbanRoundLabel.replace("{round}", String(entry.consumedRound))}</span>{/if}<time>{formatTime(entry.at)}</time></header>
            <p>{entry.text}</p>
          </article>
        {:else if entry.kind === "handoff"}
          <article class="kanban-feed-item kanban-feed-system">
            <header><span class="kanban-feed-role">{copy.kanbanHandoffLabel}</span><span class="kanban-feed-round">{copy.kanbanRoundLabel.replace("{round}", String(entry.round))}</span><time>{formatTime(entry.at)}</time></header>
            <p>{entry.fromAgentId ?? "—"} → {entry.toAgentId}</p>
            {#if entry.brief}<p class="kanban-feed-brief"><strong>{copy.kanbanHandoffBrief}</strong>{entry.brief}</p>{/if}
          </article>
        {:else if entry.kind === "attempt"}
          <article class="kanban-feed-item kanban-feed-attempt">
            <header>
              <span class="kanban-feed-role">{copy.kanbanAttemptLabel}</span>
              {#if entry.round !== null}<span class="kanban-feed-round">{copy.kanbanRoundLabel.replace("{round}", String(entry.round))}</span>{/if}
              <time>{formatTime(entry.at)}</time>
            </header>
            {#if entry.blocks.length > 0}
              <div class="kanban-feed-process">
                <ProcessTimeline blocks={entry.blocks} {copy} stateKey={entry.attemptId} />
              </div>
            {/if}
            {#if entry.text.trim()}
              <ChatMarkdown source={entry.text} {copy} className="kanban-feed-reply markdown-body" contentKey={entry.attemptId} />
            {/if}
          </article>
        {:else}
          <article class="kanban-feed-item kanban-feed-receipt">
            <header>
              <span class="kanban-feed-role">{copy.kanbanReceiptYou}</span>
              <span class="kanban-feed-round">{copy.kanbanRoundLabel.replace("{round}", String(entry.round))}</span>
              <span class="kanban-feed-actor" translate="no">{entry.actorAgentId}</span>
              <time>{formatTime(entry.at)}</time>
            </header>
            {#if entry.conclusion}<p>{entry.conclusion}</p>{/if}
            {#if entry.question}<p class="kanban-feed-question">{entry.question}</p>{/if}
            {#if entry.evidence.length > 0}
              <ul class="kanban-feed-evidence">
                {#each entry.evidence as item (item)}<li>{item}</li>{/each}
              </ul>
            {/if}
            {#if entry.intents.length > 0}
              <footer class="kanban-feed-intents">{#each entry.intents as intent (intent)}<span>{intent}</span>{/each}</footer>
            {/if}
          </article>
        {/if}
      {:else}
        <p class="kanban-column-empty">{copy.kanbanEmptyColumn}</p>
      {/each}
    </section>

    {#if bundle.task.form === "team" && bundle.memberSessions.length > 0}
      <section class="plans-card">
        <h3 class="plans-section-title">{copy.kanbanMemberSessionsTitle}<span class="plans-section-count">{bundle.memberSessions.length}</span></h3>
        <ul class="kanban-member-sessions">
          {#each bundle.memberSessions as member (member.sessionId)}
            <li>
              <button type="button" class="kanban-member-session" onclick={() => onOpenMemberSession({ sessionId: member.sessionId, agentId: member.agentId, title: `${bundle!.task.title} · ${memberName(member.agentId)}` })}>
                <span class="kanban-member-name">{memberName(member.agentId)}</span>
                <span class="kanban-member-agent" translate="no">{member.agentId}</span>
              </button>
            </li>
          {/each}
        </ul>
        <p class="plans-task-desc">{copy.kanbanMemberSessionsHint}</p>
      </section>
    {/if}

    <section class="plans-card">
      <div class="plans-progress-heading">
        <h3 class="plans-section-title">{copy.kanbanChecklistTitle}</h3>
        <span class="plans-count">{doneChecked}/{checkedTotal}</span>
      </div>
      {#if checkedTotal > 0}
        <div class="plans-progress">
          <div class="plans-progress-track" role="progressbar" aria-label={copy.kanbanChecklistTitle} aria-valuenow={checklistPercent} aria-valuemin="0" aria-valuemax="100"><span style={"transform: scaleX(" + checklistPercent / 100 + ")"}></span></div>
        </div>
        <ul class="kanban-checklist">
          {#each bundle.checklist as item (item.itemId)}
            <li class="kanban-checklist-item" data-done={item.done}>
              <span class="kanban-checklist-marker" aria-hidden="true">{#if item.done}<CheckCircle size={14} />{:else}<Help size={14} />{/if}</span>
              <span>{item.text}</span>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="plans-task-desc">{copy.kanbanEmptyColumn}</p>
      {/if}
    </section>

    <section class="kanban-answer">
      <textarea rows={2} bind:value={answerText} placeholder={copy.kanbanAnswerPlaceholder}></textarea>
      <Button variant="primary" class="plans-icon-action" title={copy.kanbanAnswerSend} disabled={busy || answerText.trim().length === 0} onclick={intentSubmit}><Plane2 size={16} aria-hidden="true" /></Button>
    </section>
  </div>
{/if}
