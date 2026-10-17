<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import Button from "../components/ui/Button.svelte";
  import type { DesktopPlanDetail, DesktopPlanTaskInput } from "@molibot/desktop-contract";
  import type { Translation } from "../i18n";
  import { runDesktopPlanAction } from "../api";

  export let detail: DesktopPlanDetail;
  export let endpoint: string;
  export let copy: Translation;
  export let onSaved: (value: DesktopPlanDetail) => void;
  export let onClose: () => void;

  type Draft = { expectedVersion: number; title: string; summary: string; tasks: DesktopPlanTaskInput[]; acceptanceCriteria: Array<{ description: string; required?: boolean }> };
  let draft: Draft;
  let initialized = false;
  let busy = false;
  let preview = false;
  let error = "";
  let instruction = "";
  const cancel = new AbortController();
  $: key = `molibot-plan-draft:${detail.execution.id}`;
  $: completedIds = new Set(detail.tasks.flatMap(task => task.steps.filter(step => step.status === "completed").map(step => step.id)));
  $: valid = initialized && Boolean(draft.title.trim()) && draft.tasks.length > 0 && draft.tasks.every(task => task.title.trim() && task.steps.length > 0 && task.steps.every(step => step.title.trim())) && draft.acceptanceCriteria.length > 0 && draft.acceptanceCriteria.every(item => item.description.trim());
  $: conflict = initialized && draft.expectedVersion !== detail.execution.version;
  $: if (initialized && draft && key) localStorage.setItem(key, JSON.stringify(draft));
  onMount(() => {
    draft = { expectedVersion: detail.execution.version, title: detail.meta.title, summary: detail.meta.summary,
      tasks: detail.tasks.map(task => ({ id: task.id, title: task.title, description: task.description, steps: task.steps.map(step => ({ id: step.id, title: step.title, description: step.description })) })),
      acceptanceCriteria: detail.acceptanceCriteria.filter(item => item.planVersion === detail.execution.currentPlanVersion).map(item => ({ description: item.description, required: item.required })) };
    try {
      const saved = localStorage.getItem(key);
      if (saved) {
        const value = JSON.parse(saved);
        if (Array.isArray(value.tasks) && value.tasks.every((task: DesktopPlanTaskInput) => Array.isArray(task.steps)) && Array.isArray(value.acceptanceCriteria) && Number.isInteger(value.expectedVersion)) draft = value;
      }
    } catch { error = copy.planEditorDraftFailed; }
    initialized = true;
  });
  onDestroy(() => cancel.abort());

  function move<T>(items: T[], index: number, offset: number): T[] {
    const result = [...items];
    [result[index], result[index + offset]] = [result[index + offset], result[index]];
    return result;
  }
  function discard() { initialized = false; localStorage.removeItem(key); onClose(); }
  async function propose() {
    busy = true; error = "";
    try {
      const response = await runDesktopPlanAction(endpoint, { action: "propose", planId: detail.execution.id, expectedVersion: draft.expectedVersion, instruction });
      if (cancel.signal.aborted) return;
      if (!response.draft) throw new Error(copy.planEditorDraftFailed);
      draft = { ...response.draft, expectedVersion: response.expectedVersion! }; preview = true;
    } catch (cause) { if (!cancel.signal.aborted) error = String(cause instanceof Error ? cause.message : cause); }
    finally { busy = false; }
  }
  async function save() {
    busy = true; error = "";
    try {
      const response = await runDesktopPlanAction(endpoint, { action: "edit", executionId: detail.execution.id, ...draft });
      if (cancel.signal.aborted) return;
      if (!response.item) throw new Error(copy.planEditorDraftFailed);
      initialized = false; localStorage.removeItem(key); onSaved(response.item);
    } catch (cause) { error = String(cause instanceof Error ? cause.message : cause); }
    finally { busy = false; }
  }
</script>

{#if initialized}
<section class="plans-editor settings-form" aria-label={copy.planEditorTitle}>
  <h3>{copy.planEditorTitle}</h3>
  <p class="settings-hint" role="status">{copy.planEditorDraftSaved}</p>
  {#if conflict}<div class="plans-alert" role="alert"><strong>{copy.planEditorConflict}</strong><p>{copy.planBoardVersion} {detail.execution.currentPlanVersion} · {detail.meta.title}</p><p>{detail.tasks.map(task => `${task.title}: ${task.steps.map(step => step.title).join(" / ")}`).join("\n")}</p><Button onclick={() => { draft = { ...draft, expectedVersion: detail.execution.version }; preview = true; }}>{copy.planEditorReapply}</Button></div>{/if}
  {#if error}<div class="plans-alert" role="alert">{error}</div>{/if}
  {#if preview}
    <div class="plans-diff" role="region" aria-label={copy.planEditorPreview}>
      <section><h4>{copy.planEditorBefore}</h4><p>{detail.meta.title}</p><p>{detail.meta.summary}</p><ul>{#each detail.tasks as task}<li><strong>{task.title}</strong><p>{task.description}</p><ol>{#each task.steps as step}<li>{step.title}<p>{step.description}</p></li>{/each}</ol></li>{/each}</ul><p>{detail.acceptanceCriteria.filter(item => item.planVersion === detail.execution.currentPlanVersion).map(item => `${item.required ? "[required]" : "[optional]"} ${item.description}`).join("\n")}</p></section>
      <section><h4>{copy.planEditorAfter}</h4><p>{draft.title}</p><p>{draft.summary}</p><ul>{#each draft.tasks as task}<li><strong>{task.title}</strong><p>{task.description}</p><ol>{#each task.steps as step}<li>{step.title}<p>{step.description}</p></li>{/each}</ol></li>{/each}</ul><p>{draft.acceptanceCriteria.map(item => `${item.required ? "[required]" : "[optional]"} ${item.description}`).join("\n")}</p></section>
    </div>
  {:else}
    <label class="settings-field"><span>{copy.planEditorName}</span><input bind:value={draft.title} disabled={busy} /></label>
    <label class="settings-field"><span>{copy.planEditorSummary}</span><textarea bind:value={draft.summary} disabled={busy} rows="2"></textarea></label>
    {#each draft.tasks as task, index}
      <section class="plans-rework-task">
        <label class="settings-field"><span>{copy.planBoardReworkTitle} {index + 1}</span><input bind:value={task.title} disabled={busy} /></label>
        <label class="settings-field"><span>{copy.planEditorSummary}</span><textarea bind:value={task.description} disabled={busy} rows="2"></textarea></label>
        <div class="plans-rework-actions">
          <Button disabled={busy || index === 0} onclick={() => draft.tasks = move(draft.tasks, index, -1)}>{copy.planEditorUp}</Button>
          <Button disabled={busy || index === draft.tasks.length - 1} onclick={() => draft.tasks = move(draft.tasks, index, 1)}>{copy.planEditorDown}</Button>
          <Button disabled={busy || task.steps.some(step => step.id && completedIds.has(step.id))} onclick={() => draft.tasks = draft.tasks.filter((_, at) => at !== index)}>{copy.planBoardReworkRemove}</Button>
        </div>
        {#each task.steps as step, position}
          <div class="plans-editor-step">
            <label class="settings-field"><span>{copy.planEditorStep} {position + 1}{step.id && completedIds.has(step.id) ? ` · ${copy.planStatusCompleted}` : ""}</span><input bind:value={step.title} disabled={busy || Boolean(step.id && completedIds.has(step.id))} /></label>
            <label class="settings-field"><span>{copy.planEditorSummary}</span><textarea bind:value={step.description} disabled={busy || Boolean(step.id && completedIds.has(step.id))} rows="2"></textarea></label>
            <div class="plans-rework-actions">
              <Button disabled={busy || position === 0} onclick={() => task.steps = move(task.steps, position, -1)}>{copy.planEditorUp}</Button>
              <Button disabled={busy || position === task.steps.length - 1} onclick={() => task.steps = move(task.steps, position, 1)}>{copy.planEditorDown}</Button>
              <Button disabled={busy || Boolean(step.id && completedIds.has(step.id))} onclick={() => task.steps = task.steps.filter((_, at) => at !== position)}>{copy.planBoardReworkRemove}</Button>
            </div>
          </div>
        {/each}
        <Button disabled={busy} onclick={() => task.steps = [...task.steps, { title: "" }]}>{copy.planEditorAddStep}</Button>
      </section>
    {/each}
    <Button disabled={busy || !valid} onclick={() => draft.tasks = [...draft.tasks, { title: "", steps: [{ title: "" }] }]}>{copy.planBoardReworkAdd}</Button>
    <label class="settings-field"><span>{copy.planEditorCriteria}</span><textarea rows="3" value={draft.acceptanceCriteria.map(item => item.description).join("\n")} oninput={(event) => draft.acceptanceCriteria = event.currentTarget.value.split("\n").map(description => ({ description, required: true }))}></textarea></label>
    <label class="settings-field"><span>{copy.planEditorInstruction}</span><textarea bind:value={instruction} rows="2" disabled={busy}></textarea></label>
    <Button disabled={busy || !instruction.trim()} onclick={() => void propose()}>{busy ? copy.loading : copy.planEditorPropose}</Button>
  {/if}
  <div class="plans-editor-footer">
    <Button disabled={busy} onclick={onClose}>{copy.planEditorKeepDraft}</Button>
    <Button disabled={busy} onclick={discard}>{copy.planEditorDiscard}</Button>
    {#if preview}<Button disabled={busy} onclick={() => preview = false}>{copy.planEditorTitle}</Button><Button variant="primary" disabled={busy || !valid || conflict || detail.execution.status === "running" || detail.execution.status === "queued" || detail.execution.status === "verifying" || detail.execution.status === "waiting_for_approval"} onclick={() => void save()}>{copy.save}</Button>
    {:else}<Button disabled={busy || !valid} onclick={() => preview = true}>{copy.planEditorPreview}</Button>{/if}
  </div>
</section>
{/if}
