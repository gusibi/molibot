<script lang="ts">
  import { formatMemoryReflectionSummary } from "@molibot/shared/memoryReflection";
  import { loadDesktopTasks, loadDesktopPlans, loadDesktopTaskSession, runDesktopTaskAction } from '../api';
  import { untrack } from 'svelte';
  import { shouldShowHomeTask, readHomeReceipts, markHomeReceipt, type HomeReceipts } from './homeWork';
  import type { TurnFileItem } from './turnFiles';
  import HomeTaskResult from './HomeTaskResult.svelte';
  import Button from '../components/ui/Button.svelte';
  import type { DesktopSystemTaskExecutionResult, DesktopTaskItem, DesktopPlanListItem } from '@molibot/desktop-contract';
  let { endpoint, locale, stale, revision, formatTime, onPlans, onTasks, onFiles, onResultFile, agentLabel } : {
    agentLabel: (id: string) => string;
    endpoint: string; locale: string; stale: boolean; revision: string;
    formatTime: (value: string) => string; onPlans: (planId?: string) => void; onTasks: () => void; onFiles: () => void; onResultFile: (sessionId: string, file: TurnFileItem) => void;
  } = $props();
  let tasks = $state<DesktopTaskItem[]>([]);
  let plans = $state<DesktopPlanListItem[]>([]);
  let loading = $state(true);
  let error = $state(false);
  let expanded = $state(false);
  let selected = $state('');
  let selectedExecutionId = $state('');

  let outcomes = $state<Record<string, DesktopSystemTaskExecutionResult>>({});
  let summaries = $state<Record<string, string>>({});
  let receipts = $state<HomeReceipts>({});
  let storageError = $state(false);
  let dismissing = $state(false);
  const receiptKey = $derived(`molibot-home-read:${endpoint}`);
  let generation = 0;
  let detailGeneration = 0;
  const zh = $derived(locale === 'zh-CN');
  const visible = $derived(tasks.filter(t => selected === t.id || shouldShowHomeTask(t, receipts, outcomes[t.executions[0]?.id])));
  const visiblePlans = $derived(plans.filter(plan => plan.status !== 'completed' || receipts[`plan:${plan.planId}`] !== `${plan.version}:${plan.updatedAt}`));
  const labels = $derived<Record<string,string>>(zh ? { running:'执行中', retry_wait:'等待重试', completed:'已完成', failed:'执行失败', aborted:'已停止', interrupted:'已中断', skipped:'已跳过', waiting_approval:'待审批', queued:'排队中', verifying:'验证中', paused:'已暂停', partial:'部分完成', cancelled:'已取消', planned:'待启动', waiting_for_user:'需要你处理', waiting_for_approval:'待审批', recovery_required:'需要恢复' } : { running:'Running', retry_wait:'Retry pending', completed:'Completed', failed:'Failed', aborted:'Stopped', interrupted:'Interrupted', skipped:'Skipped', waiting_approval:'Approval required', queued:'Queued', verifying:'Verifying', paused:'Paused', partial:'Partially complete', cancelled:'Cancelled', planned:'Planned', waiting_for_user:'Your input needed', waiting_for_approval:'Approval required', recovery_required:'Recovery required' });
  async function refresh(target = endpoint) {
    const request = ++generation;
    error = false;
    try {
      const result = await Promise.allSettled([loadDesktopTasks(target), loadDesktopPlans(target, { limit: 20 })]);
      if (request !== generation || endpoint !== target) return;
      error = result.some(item => item.status === "rejected");
      if (result[0].status === "fulfilled") tasks = result[0].value.items.filter(t => !t.projectId).sort((a,b) => Number(b.active)-Number(a.active) || Date.parse(b.executions[0]?.finishedAt || b.updatedAt)-Date.parse(a.executions[0]?.finishedAt || a.updatedAt));
      if (result[1].status === "fulfilled") plans = result[1].value.items.filter(p => !p.projectId && !p.archived && p.status !== "cancelled");
      summaries = {};
      const system = tasks.filter(t => t.systemKind && t.executions[0]).slice(0, 10);
      await Promise.allSettled(system.map(async task => {
        const session = await loadDesktopTaskSession(target, task.id, task.executions[0].id);
        if (request !== generation || endpoint !== target) return;
        const outcome = session.execution?.result;
        if (outcome) outcomes[task.executions[0].id] = outcome;
        if (outcome?.kind === 'memory-reflection') summaries[task.id] = formatMemoryReflectionSummary(outcome, zh);
        else if (outcome?.kind === 'daily-materials') summaries[task.id] = zh ? `生成 ${outcome.createdFiles.length} 份素材` : `${outcome.createdFiles.length} materials created`;
      }));
    } catch { if (request === generation) error = true; }
    finally { if (request === generation) loading = false; }
  }
  $effect(() => {
    const target = endpoint;
    untrack(() => {
      try { receipts = readHomeReceipts(localStorage.getItem(receiptKey)); } catch { receipts = {}; }
    });
    const sync = (event: StorageEvent) => { if (event.key === `molibot-home-read:${target}`) receipts = readHomeReceipts(event.newValue); };
    window.addEventListener('storage', sync);
    tasks = []; plans = []; summaries = {}; outcomes = {}; selected = ''; selectedExecutionId = ''; loading = true;
    if (!target) loading = false;
    return () => { window.removeEventListener('storage', sync); generation++; detailGeneration++; };
  });
  $effect(() => { revision; if (endpoint && !stale) void refresh(endpoint); });
  function remember(task: DesktopTaskItem): void {
    const execution = task.executions[0];
    if (execution) saveReceipt(task.taskId, execution.id);
  }
  function saveReceipt(id: string, version: string): void {
    try {
      const next = markHomeReceipt(readHomeReceipts(localStorage.getItem(receiptKey)), id, version);
      localStorage.setItem(receiptKey, JSON.stringify(next));
      receipts = next;
    } catch { storageError = true; }
  }
  async function dismiss(task: DesktopTaskItem): Promise<void> {
    if (stale || task.active) return;
    dismissing = true;
    const target = endpoint;
    try {
      if (task.reminderUnread) await runDesktopTaskAction(target, { action: 'mark_one_shot_read', ids: [task.id] });
      if (endpoint !== target) return;
      remember(task);
      if (selected === task.id) { selected = ''; detailGeneration++; }
    } catch { storageError = true; }
    finally { dismissing = false; }
  }
  function read(task: DesktopTaskItem): void {
    if (!task.executions[0] || stale) return;
    selected = task.id;
    selectedExecutionId = task.executions[0].id;
  }

</script>

{#if visible.length || visiblePlans.length || error}
<section class="agent-home-band agent-home-work" aria-label={zh ? '后台工作与成果' : 'Work and results'}>
  <div class="agent-home-band-head"><h2 class="agent-home-band-label">{zh ? '为你准备的成果' : 'Ready for you'}</h2><Button variant="text" onclick={onTasks}>{zh ? '全部任务' : 'All tasks'}</Button></div>
  <p class="agent-home-work-hint">{zh ? '看过的成果收起后退出首页；新一期完成时会再次出现。' : 'Read results leave the home when collapsed. New editions appear automatically.'}</p>
  {#if storageError}<p role="alert" class="agent-home-handover-stale">{zh ? '已阅状态保存失败，请重试。' : 'Could not save read status. Please retry.'}</p>{/if}
  {#if loading}<p class="agent-home-meta" role="status">{zh ? '正在读取任务与计划…' : 'Loading tasks and plans…'}</p>
  {:else if error}<p class="agent-home-handover-stale" role="alert">{zh ? '工作记录读取失败，当前结果可能过期。' : 'Could not refresh work. Results may be out of date.'}<Button variant="text" disabled={stale} onclick={() => void refresh()}>{zh ? '重试' : 'Retry'}</Button></p>
  {:else if !visible.length && !visiblePlans.length}<p class="agent-home-meta">{zh ? '还没有执行结果；任务完成后会保留在这里。' : 'Completed task results will appear here.'}</p>{/if}
  <div class="agent-home-work-grid">
  {#each (expanded ? visible : visible.slice(0,4)) as task (task.id)}
    {@const execution = task.executions[0]}
    <article class="agent-home-work-card" data-state={execution?.status} data-expanded={selected === task.id}>
      <span class="agent-home-work-kind">{task.systemKind === 'memory-reflection' ? (zh ? '记忆整理' : 'Memory review') : task.systemKind === 'daily-materials' ? (zh ? '每日素材' : 'Daily materials') : (zh ? '自动任务' : 'Scheduled task')}</span>
      <button class="agent-home-work-title" type="button" disabled={!execution || stale} onclick={() => void read(task)}>{task.text}</button>
      <div class="agent-home-work-summary">
      <span class="agent-home-meta">{task.active ? labels.running : labels[execution?.status ?? ''] ?? task.statusReason} · {task.botId ? agentLabel(task.botId) : (zh ? '系统任务' : 'System task')}{#if execution}<time datetime={execution.finishedAt || execution.startedAt}> · {formatTime(execution.finishedAt || execution.startedAt)}</time>{/if}</span>
      {#if summaries[task.id]}<p class="agent-home-meta">{summaries[task.id]}</p>{/if}
      {#if execution?.lastError}<p class="agent-home-handover-stale">{execution.lastError}</p>{/if}
      </div>
      <div class="agent-home-work-actions"><Button variant="text" disabled={!execution || stale} onclick={() => void read(task)}>{zh ? '查看结果' : 'Read result'}</Button>
        {#if execution && !task.active && !['waiting_approval', 'retry_wait', 'running'].includes(execution.status)}<Button variant="text" disabled={stale || dismissing} onclick={() => void dismiss(task)}>{zh ? '已阅收起' : 'Mark read'}</Button>{/if}
      </div>
      {#if selected === task.id}
        {#key `${endpoint}:${task.taskId}:${selectedExecutionId}`}
          <HomeTaskResult {endpoint} taskId={task.taskId} executionId={selectedExecutionId} {locale} {stale} {onFiles} {onResultFile}
            onRead={(id) => { if (!task.active && !task.reminderUnread && !["waiting_approval", "retry_wait", "running"].includes(task.executions[0]?.status) && task.executions[0]?.id === id) remember(task); }}
            onClose={() => { if (task.reminderUnread) void dismiss(task); else selected = ''; }} />
        {/key}
      {/if}
    </article>
  {/each}
  </div>
  {#if visible.length > 4}<Button variant="text" onclick={() => expanded = !expanded}>{expanded ? (zh ? '收起' : 'Collapse') : (zh ? `查看其余 ${visible.length-4} 项` : `Show ${visible.length-4} more`)}</Button>{/if}
  {#if visiblePlans.length}
    <div class="agent-home-band-head"><h2 class="agent-home-band-label">{zh ? '委托进展' : 'Delegated work'}</h2><Button variant="text" onclick={() => onPlans()}>{zh ? '查看与验收' : 'Review plans'}</Button></div>
    <div class="agent-home-work-grid">
    {#each visiblePlans.slice(0,5) as plan (plan.planId)}<article class="agent-home-work-card" data-state={plan.status}><span class="agent-home-work-kind">{zh ? "委托计划" : "Plan"}</span><button class="agent-home-work-title" type="button" onclick={() => onPlans(plan.planId)}>{plan.title}</button><div class="agent-home-work-summary"><span class="agent-home-meta">{labels[plan.status] ?? plan.status} · {plan.progress.completed}/{plan.progress.total}{#if plan.progress.currentStepTitle} · {plan.progress.currentStepTitle}{/if}</span>{#if plan.waitingReason}<p>{plan.waitingReason}</p>{/if}</div><div class="agent-home-work-actions"><Button variant="text" onclick={() => onPlans(plan.planId)}>{zh ? "查看计划" : "View plan"}</Button>{#if plan.status === 'completed'}<Button variant="text" disabled={stale} onclick={() => saveReceipt(`plan:${plan.planId}`, `${plan.version}:${plan.updatedAt}`)}>{zh ? '已阅收起' : 'Mark read'}</Button>{/if}</div></article>{/each}
    </div>
    {#if visiblePlans.length > 5}<Button variant="text" onclick={() => onPlans()}>{zh ? '查看全部计划' : 'View all plans'}</Button>{/if}
  {/if}
</section>

{/if}
