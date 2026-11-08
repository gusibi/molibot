<script lang="ts">
  import Dialog from "../components/ui/Dialog.svelte";
  import Button from "../components/ui/Button.svelte";
  import SelectControl from "../components/ui/SelectControl.svelte";
  import X from "reicon-svelte/icons/X";
  import type { DesktopAgentItem, DesktopKanbanCreateRequest } from "@molibot/desktop-contract";
  import type { DesktopProject } from "../api";
  import type { Translation } from "../i18n";

  interface Props {
    open: boolean;
    busy: boolean;
    copy: Translation;
    projects: DesktopProject[];
    initialProjectId?: string;
    agents: DesktopAgentItem[];
    onCreate: (payload: DesktopKanbanCreateRequest) => void;
    onClose: () => void;
  }
  let { open, busy, copy, projects, initialProjectId = "", agents, onCreate, onClose }: Props = $props();

  let form = $state<"single" | "team">("single");
  let title = $state("");
  let goal = $state("");
  let agentId = $state("");
  let coordinatorAgentId = $state("");
  let selectedMembers = $state<string[]>([]);
  let projectId = $state("");
  let workDir = $state("");
  let conditionsText = $state("");
  let budget = $state(2_000_000);
  let handoffLimit = $state(8);
  let approvalPolicy = $state<"suspend" | "deny">("suspend");
  let humanAcceptance = $state(false);
  let autoStart = $state(true);
  let validationError = $state("");

  const enabledAgents = $derived(agents.filter(agent => agent.enabled));
  const agentOptions = $derived(enabledAgents.map(agent => ({ value: agent.id, label: agentLabel(agent.id) })));
  const canSubmit = $derived(title.trim().length > 0 && (form === "single" ? agentId.trim().length > 0 : coordinatorAgentId.trim().length > 0));
  // Opening from a filtered board should keep the task in that project.
  $effect(() => { if (open) projectId = initialProjectId; });

  function agentLabel(id: string): string {
    const agent = agents.find(item => item.id === id);
    return agent?.name && agent.name !== id ? `${agent.name} (${id})` : id;
  }
  function selectCoordinator(id: string): void {
    coordinatorAgentId = id;
    // 负责人必须属于成员；选择负责人时自动加入，避免选了负责人却提交失败。
    if (id && !selectedMembers.includes(id)) selectedMembers = [...selectedMembers, id];
  }
  function reset(): void {
    form = "single"; title = ""; goal = ""; agentId = ""; coordinatorAgentId = ""; selectedMembers = [];
    projectId = ""; workDir = ""; conditionsText = ""; budget = 2_000_000; handoffLimit = 8;
    approvalPolicy = "suspend"; humanAcceptance = false; autoStart = true;
    validationError = "";
  }
  function close(): void {
    reset();
    onClose();
  }
  function toggleMember(id: string, checked: boolean): void {
    selectedMembers = checked
      ? [...selectedMembers, id]
      : selectedMembers.filter(member => member !== id);
    if (coordinatorAgentId && !selectedMembers.includes(coordinatorAgentId)) coordinatorAgentId = "";
  }
  function submit(): void {
    if (form === "team") {
      const coordinator = coordinatorAgentId.trim();
      if (!selectedMembers.includes(coordinator)) {
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
        : { coordinatorAgentId: coordinatorAgentId.trim(), members: selectedMembers.map(id => ({ agentId: id, name: agentLabel(id) })) }),
      ...(projectId.trim() ? { projectId: projectId.trim() } : {}),
      ...(workDir.trim() ? { workDir: workDir.trim() } : {}),
      ...(conditionsText.trim() ? {
        completionConditions: conditionsText.split("\n").map(line => line.trim()).filter(Boolean).map(description => ({ description }))
      } : {}),
      ...(conditionsText.trim() ? { completionSource: "user" as const } : {}),
      ...(Number.isFinite(budget) && budget > 0 ? { budgetTokenLimit: Math.round(budget) } : {}),
      ...(Number.isFinite(handoffLimit) && handoffLimit > 0 ? { handoffLimit: Math.round(handoffLimit) } : {}),
      approvalPolicy,
      ...(humanAcceptance ? { humanAcceptance: true } : {}),
      autoStart
    });
  }
</script>

<Dialog {open} {busy} labelledBy="kanban-create-title" onOpenChange={next => { if (!next) close(); }}>
  <div class="kanban-create">
    <header class="kanban-create-head">
      <h2 id="kanban-create-title">{copy.kanbanCreateTitle}</h2>
      <div class="kanban-create-head-tools">
        <div class="segmented" role="group" aria-label={copy.kanbanFieldCoordinator}>
          <Button class={`segmented-item${form === "single" ? " active" : ""}`} aria-pressed={form === "single"} onclick={() => form = "single"}>{copy.kanbanFormSingle}</Button>
          <Button class={`segmented-item${form === "team" ? " active" : ""}`} aria-pressed={form === "team"} onclick={() => form = "team"}>{copy.kanbanFormTeam}</Button>
        </div>
        <Button variant="icon" title={copy.dialogClose} disabled={busy} onclick={close}><X size={16} aria-hidden="true" /></Button>
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
        <div class="settings-field"><span>{copy.kanbanFieldAgent}</span>
          <SelectControl value={agentId} ariaLabel={copy.kanbanFieldAgent} options={agentOptions} onChange={value => agentId = value} />
        </div>
      {:else}
        <div class="settings-field"><span>{copy.kanbanFieldCoordinator}</span>
          <SelectControl value={coordinatorAgentId} ariaLabel={copy.kanbanFieldCoordinator} options={agentOptions} onChange={selectCoordinator} />
        </div>
        <div class="settings-field"><span>{copy.kanbanFieldMembers}</span>
          {#if enabledAgents.length > 0}
            <div class="kanban-create-members" role="group" aria-label={copy.kanbanFieldMembers}>
              {#each enabledAgents as agent (agent.id)}
                <label class="kanban-create-member">
                  <input type="checkbox" checked={selectedMembers.includes(agent.id)} onchange={event => toggleMember(agent.id, event.currentTarget.checked)} />
                  <span>{agent.name || agent.id}</span>
                </label>
              {/each}
            </div>
          {:else}
            <p class="kanban-create-hint">{copy.kanbanMembersEmpty}</p>
          {/if}
        </div>
      {/if}
      <div class="kanban-create-row">
        <div class="settings-field"><span>{copy.kanbanFieldProject}</span>
          <SelectControl value={projectId} ariaLabel={copy.kanbanFieldProject} options={[{ value: "", label: copy.kanbanFieldNoProject }, ...projects.map(project => ({ value: project.id, label: project.name }))]} onChange={value => projectId = value} />
        </div>
        <label class="settings-field"><span>{copy.kanbanFieldWorkDir}</span>
          <input type="text" bind:value={workDir} placeholder={copy.kanbanFieldWorkDirPlaceholder} />
        </label>
      </div>
      <label class="settings-field"><span>{copy.kanbanFieldConditions}</span>
        <textarea rows={3} bind:value={conditionsText}></textarea>
      </label>
      <div class="kanban-create-row">
        <label class="settings-field"><span>{copy.kanbanFieldBudget}</span>
          <input type="number" min={1} step={100_000} bind:value={budget} />
        </label>
        <label class="settings-field"><span>{copy.kanbanFieldHandoffLimit}</span>
          <input type="number" min={1} step={1} bind:value={handoffLimit} />
        </label>
        <div class="settings-field"><span>{copy.kanbanFieldApproval}</span>
          <SelectControl value={approvalPolicy} ariaLabel={copy.kanbanFieldApproval} options={[{ value: "suspend", label: copy.kanbanApprovalSuspend }, { value: "deny", label: copy.kanbanApprovalDeny }]} onChange={value => approvalPolicy = value as typeof approvalPolicy} />
        </div>
      </div>
      <label class="kanban-create-autostart">
        <input type="checkbox" bind:checked={humanAcceptance} />
        <span>{copy.kanbanFieldHumanAcceptance}</span>
      </label>
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
