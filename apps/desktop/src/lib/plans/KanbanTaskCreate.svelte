<script lang="ts">
  import Dialog from "../components/ui/Dialog.svelte";
  import Button from "../components/ui/Button.svelte";
  import SelectControl from "../components/ui/SelectControl.svelte";
  import type { DesktopKanbanCreateRequest } from "@molibot/desktop-contract";
  import type { Translation } from "../i18n";

  interface Props {
    open: boolean;
    busy: boolean;
    copy: Translation;
    onCreate: (payload: DesktopKanbanCreateRequest) => void;
    onClose: () => void;
  }
  let { open, busy, copy, onCreate, onClose }: Props = $props();

  let form = $state<"single" | "team">("single");
  let title = $state("");
  let goal = $state("");
  let agentId = $state("");
  let coordinatorAgentId = $state("");
  let membersText = $state("");
  let projectId = $state("");
  let conditionsText = $state("");
  let budget = $state(2_000_000);
  let approvalPolicy = $state<"suspend" | "deny">("suspend");
  let autoStart = $state(true);
  let validationError = $state("");

  const canSubmit = $derived(title.trim().length > 0 && (form === "single" ? agentId.trim().length > 0 : coordinatorAgentId.trim().length > 0));

  function reset(): void {
    form = "single"; title = ""; goal = ""; agentId = ""; coordinatorAgentId = ""; membersText = "";
    projectId = ""; conditionsText = ""; budget = 2_000_000; approvalPolicy = "suspend"; autoStart = true;
    validationError = "";
  }
  function close(): void {
    reset();
    onClose();
  }
  function parseMembers(): Array<{ agentId: string; name: string }> {
    return membersText.split("\n")
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        const [id, ...rest] = line.split(",");
        const agentId = id.trim();
        return { agentId, name: rest.join(",").trim() || agentId };
      })
      .filter(member => member.agentId.length > 0);
  }
  function submit(): void {
    if (form === "team") {
      const members = parseMembers();
      const coordinator = coordinatorAgentId.trim();
      if (!members.some(member => member.agentId === coordinator)) {
        validationError = copy.kanbanFieldMembersPlaceholder;
        return;
      }
    }
    validationError = "";
    onCreate({
      action: "kanban_create",
      form,
      title: title.trim(),
      goal: goal.trim() || title.trim(),
      ...(form === "single"
        ? { agentId: agentId.trim() }
        : { coordinatorAgentId: coordinatorAgentId.trim(), members: parseMembers() }),
      ...(projectId.trim() ? { projectId: projectId.trim() } : {}),
      ...(conditionsText.trim() ? {
        completionConditions: conditionsText.split("\n").map(line => line.trim()).filter(Boolean).map(description => ({ description }))
      } : {}),
      ...(conditionsText.trim() ? { completionSource: "user" as const } : {}),
      ...(Number.isFinite(budget) && budget > 0 ? { budgetTokenLimit: Math.round(budget) } : {}),
      approvalPolicy,
      autoStart
    });
  }
</script>

<Dialog {open} {busy} labelledBy="kanban-create-title" onOpenChange={next => { if (!next) close(); }}>
  <div class="kanban-create">
    <header class="kanban-create-head">
      <h2 id="kanban-create-title">{copy.kanbanCreateTitle}</h2>
      <div class="segmented" role="group" aria-label={copy.kanbanFieldCoordinator}>
        <Button class={`segmented-item${form === "single" ? " active" : ""}`} aria-pressed={form === "single"} onclick={() => form = "single"}>{copy.kanbanFormSingle}</Button>
        <Button class={`segmented-item${form === "team" ? " active" : ""}`} aria-pressed={form === "team"} onclick={() => form = "team"}>{copy.kanbanFormTeam}</Button>
      </div>
    </header>
    <div class="kanban-create-body">
      <label class="settings-field"><span>{copy.kanbanFieldTitle}</span>
        <input type="text" bind:value={title} placeholder={copy.kanbanFieldTitlePlaceholder} />
      </label>
      <label class="settings-field"><span>{copy.kanbanFieldGoal}</span>
        <textarea rows={2} bind:value={goal} placeholder={copy.kanbanFieldGoalPlaceholder}></textarea>
      </label>
      {#if form === "single"}
        <label class="settings-field"><span>{copy.kanbanFieldAgent}</span>
          <input type="text" bind:value={agentId} placeholder="default" />
        </label>
      {:else}
        <label class="settings-field"><span>{copy.kanbanFieldCoordinator}</span>
          <input type="text" bind:value={coordinatorAgentId} placeholder="default" />
        </label>
        <label class="settings-field"><span>{copy.kanbanFieldMembers}</span>
          <textarea rows={3} bind:value={membersText} placeholder={copy.kanbanFieldMembersPlaceholder}></textarea>
        </label>
      {/if}
      <label class="settings-field"><span>{copy.kanbanFieldProject}</span>
        <input type="text" bind:value={projectId} />
      </label>
      <label class="settings-field"><span>{copy.kanbanFieldConditions}</span>
        <textarea rows={3} bind:value={conditionsText}></textarea>
      </label>
      <div class="kanban-create-row">
        <label class="settings-field"><span>{copy.kanbanFieldBudget}</span>
          <input type="number" min={1} step={100_000} bind:value={budget} />
        </label>
        <div class="settings-field"><span>{copy.kanbanFieldApproval}</span>
          <SelectControl value={approvalPolicy} ariaLabel={copy.kanbanFieldApproval} options={[{ value: "suspend", label: copy.kanbanApprovalSuspend }, { value: "deny", label: copy.kanbanApprovalDeny }]} onChange={value => approvalPolicy = value as typeof approvalPolicy} />
        </div>
      </div>
      <label class="kanban-create-autostart">
        <input type="checkbox" bind:checked={autoStart} />
        <span>{copy.kanbanFieldAutoStart}</span>
      </label>
      {#if validationError}<p class="kanban-create-error" role="alert">{validationError}</p>{/if}
    </div>
    <footer class="kanban-create-foot">
      <Button disabled={busy} onclick={close}>{copy.cancel}</Button>
      <Button variant="primary" disabled={busy || !canSubmit} onclick={submit}>{copy.kanbanCreateSubmit}</Button>
    </footer>
  </div>
</Dialog>
