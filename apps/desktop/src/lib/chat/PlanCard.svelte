<script lang="ts">
  import Check from "reicon-svelte/icons/Check";
  import Record from "reicon-svelte/icons/Record";
  import TriangleWarning from "reicon-svelte/icons/TriangleWarning";
  import type { DesktopConversationPlan } from "@molibot/desktop-contract";
  import type { Translation } from "../i18n";
  import DecisionCard from "./DecisionCard.svelte";

  export let plan: DesktopConversationPlan;
  export let copy: Translation;
  export let disabled = false;
  export let onResolve: (
    decision: "accept" | "reject" | "modify",
    edits?: { title: string; summary: string; steps: string[]; mode?: "manual" | "accept_edits" }
  ) => void;

  let editing = false;
  let title = plan.title;
  let summary = plan.summary;
  let steps = plan.steps.map((step) => step.text).join("\n");

  $: statusLabel = {
    proposed: copy.planStatusProposed,
    accepted: copy.planStatusAccepted,
    rejected: copy.planStatusRejected,
    executing: copy.planStatusExecuting,
    completed: copy.planStatusCompleted,
    blocked: copy.planStatusBlocked
  }[plan.status];

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

{#if plan.status === "proposed"}
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
      {#if plan.summary}<p class="plan-summary">{plan.summary}</p>{/if}
      <ol class="plan-steps">
        {#each plan.steps as step (step.id)}
          <li class:completed={step.status === "completed"}><span class="plan-step-marker">{#if step.status === "completed"}<Check size={12} aria-hidden="true" />{:else if step.status === "blocked"}<TriangleWarning size={12} aria-hidden="true" />{:else}<Record size={12} aria-hidden="true" />{/if}</span><span>{step.text}</span></li>
        {/each}
      </ol>
    {/if}
  </DecisionCard>
{:else}
  <section class={`plan-card plan-card-${plan.status}`} aria-label={copy.planTitle}>
    <div class="approval-head"><strong>{plan.title}</strong><span class="approval-subtitle">{statusLabel}</span></div>
    {#if plan.summary}<p class="plan-summary">{plan.summary}</p>{/if}
    <ol class="plan-steps">{#each plan.steps as step (step.id)}<li class:completed={step.status === "completed"} class:blocked={step.status === "blocked"}>{step.text}</li>{/each}</ol>
  </section>
{/if}
