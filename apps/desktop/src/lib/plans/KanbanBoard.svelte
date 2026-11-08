<script lang="ts">
  import BoxAdd from "reicon-svelte/icons/BoxAdd";
  import ChevronDown from "reicon-svelte/icons/ChevronDown";
  import ChevronUp from "reicon-svelte/icons/ChevronUp";
  import Button from "../components/ui/Button.svelte";
  import type { DesktopKanbanBoardItem, DesktopKanbanBoardPage, DesktopKanbanStage } from "@molibot/desktop-contract";
  import type { Translation } from "../i18n";

  interface Props {
    page: DesktopKanbanBoardPage | null;
    loading: boolean;
    error: string;
    copy: Translation;
    /** Card click. */
    onOpen: (item: DesktopKanbanBoardItem) => void;
    /** Drag-and-drop move; the parent owns confirmation and action mapping. */
    onMove: (item: DesktopKanbanBoardItem, stage: DesktopKanbanStage) => void;
    /** Empty-state primary action. */
    onCreate: () => void;
    /** Retry a failed first load in place. */
    onRetry: () => void;
  }
  let { page, loading, error, copy, onOpen, onMove, onCreate, onRetry }: Props = $props();

  let cancelledOpen = $state(false);
  let dragId = $state("");
  let dropStage = $state<DesktopKanbanStage | null>(null);

  const stages: DesktopKanbanStage[] = ["todo", "doing", "done"];
  const columnKeys: Record<DesktopKanbanStage, keyof Translation> = {
    todo: "kanbanColumnTodo", doing: "kanbanColumnDoing", done: "kanbanColumnDone", cancelled: "kanbanColumnCancelled"
  };

  const columns = $derived.by(() => {
    const map: Record<DesktopKanbanStage, DesktopKanbanBoardItem[]> = { todo: [], doing: [], done: [], cancelled: [] };
    for (const item of page?.items ?? []) map[item.stage].push(item);
    return map;
  });
  function columnCount(stage: DesktopKanbanStage): number {
    return page?.counts[stage] ?? columns[stage].length;
  }
  function cardMeta(item: DesktopKanbanBoardItem): string {
    if (item.kind === "kanban" && item.checklist) return copy.kanbanCardChecklist.replace("{done}", String(item.checklist.doneChecked)).replace("{total}", String(item.checklist.checkedTotal));
    if (item.progress) return copy.kanbanCardSteps.replace("{done}", String(item.progress.completed)).replace("{total}", String(item.progress.total));
    return "";
  }
  function hasMeta(item: DesktopKanbanBoardItem): boolean {
    return Boolean(item.executorLabel || cardMeta(item));
  }
  function handleDragStart(item: DesktopKanbanBoardItem, event: DragEvent): void {
    dragId = item.executionId;
    event.dataTransfer?.setData("text/plain", item.executionId);
    event.dataTransfer!.effectAllowed = "move";
  }
  function allowMove(item: DesktopKanbanBoardItem, target: DesktopKanbanStage): boolean {
    if (item.stage === target || !dragId) return false;
    // Done is only reached through explicit completion acceptance in the
    // detail view (spec: 人工验收); dragging never completes a task.
    if (target === "done") return false;
    return true;
  }
  function handleDrop(target: DesktopKanbanStage): void {
    const item = page?.items.find(candidate => candidate.executionId === dragId);
    dropStage = null;
    dragId = "";
    if (item && allowMove(item, target)) onMove(item, target);
  }
</script>

{#if loading && !page}
  <div class="kanban-state" role="status">{copy.loading}</div>
{:else if error && !page}
  <div class="kanban-state" role="alert">
    <p>{copy.kanbanLoadFailed}</p>
    <small>{error}</small>
    <Button onclick={onRetry}>{copy.retryLoading}</Button>
  </div>
{:else if page}
  <div class="kanban-surface">
    <div class="kanban-board" role="list" aria-label={copy.planBoardTitle}>
      {#each stages as stage (stage)}
        <section
          class="kanban-column"
          role="listitem"
          class:drop-target={dropStage === stage}
          aria-label={copy[columnKeys[stage]]}
          ondragover={(event) => { event.preventDefault(); dropStage = stage; }}
          ondragleave={() => { if (dropStage === stage) dropStage = null; }}
          ondrop={(event) => { event.preventDefault(); handleDrop(stage); }}
        >
          <header class="kanban-column-head">
            <h3>{copy[columnKeys[stage]]}</h3>
            <span class="kanban-column-count">{columnCount(stage)}</span>
          </header>
          <div class="kanban-column-body">
            {#each columns[stage] as item (item.executionId)}
              <button
                type="button"
                class="kanban-card"
                data-kanban-id={item.executionId}
                draggable="true"
                onclick={() => onOpen(item)}
                ondragstart={(event) => handleDragStart(item, event)}
                ondragend={() => { dragId = ""; dropStage = null; }}
              >
                <span class="kanban-card-top">
                  <strong title={item.title}>{item.title}</strong>
                  {#if item.form === "team"}<span class="kanban-card-tag" data-form="team">{copy.kanbanFormTeam}</span>{/if}
                </span>
                {#if item.goal}<span class="kanban-card-goal" title={item.goal}>{item.goal}</span>{/if}
                {#if hasMeta(item)}
                  <span class="kanban-card-meta">
                    {#if item.executorLabel}<span class="kanban-card-executor" title={copy.kanbanExecutorLabel}>{item.executorLabel}</span>{/if}
                    {#if cardMeta(item)}<span class="kanban-card-progress">{cardMeta(item)}</span>{/if}
                  </span>
                {/if}
                {#if item.stage === "doing" && (item.doingSubState === "waiting_user" || item.doingSubState === "waiting_approval") && item.waitingReason}
                  <span class="kanban-card-waiting" title={item.waitingReason}>{item.waitingReason}</span>
                {/if}
              </button>
            {/each}
            {#if stage === "todo"}
              <button type="button" class="kanban-add-card" title={copy.kanbanNewTask} aria-label={copy.kanbanNewTask} onclick={onCreate}><BoxAdd size={18} aria-hidden="true" /></button>
            {/if}
          </div>
        </section>
      {/each}
    </div>
    {#if columns.cancelled.length > 0}
      <section class="kanban-cancelled" class:open={cancelledOpen}>
        <button type="button" class="kanban-cancelled-toggle" aria-expanded={cancelledOpen} onclick={() => cancelledOpen = !cancelledOpen}>
          {#if cancelledOpen}<ChevronUp size={14} aria-hidden="true" />{:else}<ChevronDown size={14} aria-hidden="true" />{/if}
          <span>{copy[columnKeys.cancelled]}</span>
          <span class="kanban-column-count">{columnCount("cancelled")}</span>
        </button>
        {#if cancelledOpen}
          <div
            class="kanban-cancelled-body"
            class:drop-target={dropStage === "cancelled"}
            role="listitem"
            ondragover={(event) => { event.preventDefault(); dropStage = "cancelled"; }}
            ondragleave={() => { if (dropStage === "cancelled") dropStage = null; }}
            ondrop={(event) => { event.preventDefault(); handleDrop("cancelled"); }}
          >
            {#each columns.cancelled as item (item.executionId)}
              <button
                type="button"
                class="kanban-card kanban-card-cancelled"
                data-kanban-id={item.executionId}
                draggable="true"
                onclick={() => onOpen(item)}
                ondragstart={(event) => handleDragStart(item, event)}
                ondragend={() => { dragId = ""; dropStage = null; }}
              >
                <span class="kanban-card-top"><strong title={item.title}>{item.title}</strong></span>
                {#if item.goal}<span class="kanban-card-goal" title={item.goal}>{item.goal}</span>{/if}
              </button>
            {/each}
          </div>
        {/if}
      </section>
    {/if}
  </div>
{/if}
