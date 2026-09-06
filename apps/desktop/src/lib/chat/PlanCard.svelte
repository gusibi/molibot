<script lang="ts">
  import Loader from "reicon-svelte/icons/Loader";
  import Check from "reicon-svelte/icons/Check";
  import Record from "reicon-svelte/icons/Record";
  import TriangleWarning from "reicon-svelte/icons/TriangleWarning";
  import type { DesktopConversationPlan } from "@molibot/desktop-contract";
  import type { Translation } from "../i18n";
  import { sessionPlanProgress, sessionPlanInspector } from "./sessionPlanUi";
  import DecisionCard from "./DecisionCard.svelte";

  export let plan: DesktopConversationPlan;
  export let copy: Translation;
  export let disabled = false;
  export let inInspector = false;
  export let onResolve: (
    decision: "accept" | "reject" | "modify" | "complete",
    edits?: { title: string; summary: string; steps: string[]; mode?: "manual" | "accept_edits" }
  ) => void;

  let editing = false;
  let title = plan.title;
  let summary = plan.summary;
  let steps = plan.steps.map((step) => step.text).join("\n");

  $: live = $sessionPlanProgress[plan.id];
  $: current = live && (live.updatedAt ?? "") >= (plan.updatedAt ?? "") ? live : plan;
  $: completedCount = current.steps.filter((step) => step.status === "completed").length;
  $: statusLabel = {
    proposed: copy.planStatusProposed,
    accepted: copy.planStatusAccepted,
    rejected: copy.planStatusRejected,
    executing: copy.planStatusExecuting,
    completed: copy.planStatusCompleted,
    blocked: copy.planStatusBlocked,
    waiting_review: copy.planStatusReview,
    paused: copy.durableStatusPaused,
    queued: copy.durableStatusQueued,
    verifying: copy.durableStatusVerifying,
    waiting_for_approval: copy.durableStatusWaitingForApproval,
    waiting_for_user: copy.durableStatusWaitingForUser,
    cancelled: copy.durableStatusCancelled,
    failed: copy.durableStatusFailed
  }[current.status];

  function openProgress(): void {
    sessionPlanInspector.set({ plan: current, complete: () => onResolve("complete") });
  }

  function resolve(option: string): void {
    if (option === "modify") {
      if (!editing) {
        editing = true;
        return;
      }
      onResolve("modify", { title, summary, steps: splitSteps() });
      editing = false;
      return;
    }
    if (option === "reject") return onResolve("reject");
    onResolve("accept", {
      title,
      summary,
      steps: splitSteps(),
      mode: option === "accept_manual" ? "manual" : "accept_edits"
    });
  }

  function splitSteps(): string[] {
    return steps.split(/\r?\n/).map((step) => step.trim()).filter(Boolean).slice(0, 30);
  }
</script>

{#if current.status === "proposed" && inInspector}
  <p role="status">{copy.loading}</p>
{:else if current.status === "proposed"}
  <DecisionCard
    id={`plan-${plan.id}`}
    title={copy.planTitle}
    subtitle={plan.title}
    options={[
      { id: "reject", label: copy.planReject },
      { id: "modify", label: editing ? copy.planSaveChanges : copy.planModify },
      { id: "accept_manual", label: copy.planAcceptManual },
      { id: "accept_edits", label: copy.planAcceptEdits }
    ]}
    defaultOptionId="accept_edits"
    {disabled}
    onResolve={resolve}
  >
    {#if editing}
      <div class="plan-editor">
        <label><span>{copy.planName}</span><input bind:value={title} autocomplete="off" /></label>
        <label><span>{copy.planSummary}</span><textarea rows="3" bind:value={summary}></textarea></label>
        <label><span>{copy.planSteps}</span><textarea rows="8" bind:value={steps}></textarea></label>
      </div>
    {:else}
      {#if current.summary}<p class="plan-summary">{current.summary}</p>{/if}
      <ol class="plan-steps">
        {#each current.steps as step (step.id)}
          <li class:completed={step.status === "completed"}><span class="plan-step-marker">{#if step.status === "completed"}<Check size={12} aria-hidden="true" />{:else if step.status === "blocked"}<TriangleWarning size={12} aria-hidden="true" />{:else}<Record size={12} aria-hidden="true" />{/if}</span><span>{step.text}</span></li>
        {/each}
      </ol>
    {/if}
  </DecisionCard>
{:else}
  <section class={`plan-card plan-card-${current.status}`} aria-label={copy.planTitle}>
    <div class="approval-head"><strong>{current.title}</strong><span class="approval-subtitle">{statusLabel}</span></div>
    <p class="plan-summary" role="status">{completedCount}/{current.steps.length} · {current.progressSummary ?? statusLabel}</p>
    {#if !inInspector}<button type="button" class="secondary-button" onclick={openProgress}>{copy.planOpenProgress}</button>{/if}
    {#if current.summary}<p class="plan-summary">{current.summary}</p>{/if}
    <ol class="plan-steps plan-progress-steps">{#each current.steps as step (step.id)}<li class:completed={step.status === "completed"} class:blocked={step.status === "blocked"}><span class="plan-step-marker">{#if step.status === "completed"}<Check size={14} aria-hidden="true" />{:else if step.status === "in_progress"}<Loader size={14} aria-hidden="true" />{:else if step.status === "blocked"}<TriangleWarning size={14} aria-hidden="true" />{:else}<Record size={14} aria-hidden="true" />{/if}</span><span>{step.text}</span><small>{step.status === "completed" ? copy.planStatusCompleted : step.status === "in_progress" ? copy.planStatusExecuting : step.status === "blocked" ? copy.planStatusBlocked : copy.durableStatusPlanned}</small></li>{/each}</ol>
    {#if current.status === "waiting_review" && !current.durableExecutionId}<button type="button" class="secondary-button" disabled={disabled} onclick={() => onResolve("complete")}>{copy.planConfirmComplete}</button>{/if}
    <p class="plan-summary">{copy.planFeedbackHint}</p>
  </section>
{/if}
