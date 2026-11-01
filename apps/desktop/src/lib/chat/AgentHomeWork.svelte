<script lang="ts">
  import { loadDesktopTasks, loadDesktopPlans, loadDesktopTaskSession } from '../api';
  import { collectTurnFiles, type TurnFileItem } from './turnFiles';
  import Button from '../components/ui/Button.svelte';
  import type { DesktopTaskItem, DesktopPlanListItem, DesktopTaskSession } from '@molibot/desktop-contract';
  let { endpoint, locale, stale, revision, formatTime, onPlans, onTasks, onFiles, onResultFile, agentLabel } : {
    agentLabel: (id: string) => string;
    endpoint: string; locale: string; stale: boolean; revision: string;
    formatTime: (value: string) => string; onPlans: () => void; onTasks: () => void; onFiles: () => void; onResultFile: (sessionId: string, file: TurnFileItem) => void;
  } = $props();
  let tasks = $state<DesktopTaskItem[]>([]);
  let plans = $state<DesktopPlanListItem[]>([]);
  let loading = $state(true);
  let error = $state(false);
  let expanded = $state(false);
  let selected = $state('');
  let detail = $state<DesktopTaskSession | null>(null);
  let detailError = $state(false);
  let detailLoading = $state(false);
  let summaries = $state<Record<string, string>>({});
  let generation = 0;
  let detailGeneration = 0;
  const zh = $derived(locale === 'zh-CN');
  const visible = $derived(tasks.filter(t => t.active || t.executions.length > 0 || t.reminderUnread));
  const labels = $derived<Record<string,string>>(zh ? { running:'执行中', retry_wait:'等待重试', completed:'已完成', failed:'执行失败', aborted:'已停止', interrupted:'已中断', skipped:'已跳过', waiting_approval:'待审批', queued:'排队中', verifying:'验证中', paused:'已暂停', partial:'部分完成', cancelled:'已取消', planned:'待启动', waiting_for_user:'需要你处理', waiting_for_approval:'待审批', recovery_required:'需要恢复' } : { running:'Running', retry_wait:'Retry pending', completed:'Completed', failed:'Failed', aborted:'Stopped', interrupted:'Interrupted', skipped:'Skipped', waiting_approval:'Approval required', queued:'Queued', verifying:'Verifying', paused:'Paused', partial:'Partially complete', cancelled:'Cancelled', planned:'Planned', waiting_for_user:'Your input needed', waiting_for_approval:'Approval required', recovery_required:'Recovery required' });
  async function refresh(target = endpoint) {
    const request = ++generation;
    error = false;
    try {
      const result = await Promise.allSettled([loadDesktopTasks(target), loadDesktopPlans(target, { limit: 20 })]);
      if (request !== generation || endpoint !== target) return;
      error = result.some(item => item.status === "rejected");
      if (result[0].status === "fulfilled") tasks = result[0].value.items.filter(t => !t.projectId).sort((a,b) => Number(b.active)-Number(a.active) || Date.parse(b.executions[0]?.finishedAt || b.updatedAt)-Date.parse(a.executions[0]?.finishedAt || a.updatedAt));
      if (result[1].status === "fulfilled") plans = result[1].value.items.filter(p => !p.projectId && !p.archived);
      summaries = {};
      const system = tasks.filter(t => t.systemKind && t.executions[0]).slice(0, 10);
      await Promise.allSettled(system.map(async task => {
        const session = await loadDesktopTaskSession(target, task.id, task.executions[0].id);
        if (request !== generation || endpoint !== target) return;
        const outcome = session.execution?.result;
        if (outcome?.kind === 'memory-reflection') summaries[task.id] = zh
          ? `整理 ${outcome.scannedConversations} 段对话 · ${outcome.createdCandidates} 条候选${outcome.committedMemories === undefined ? '' : ` · 保存 ${outcome.committedMemories} 条记忆`}`
          : `${outcome.scannedConversations} conversations · ${outcome.createdCandidates} candidates${outcome.committedMemories === undefined ? '' : ` · ${outcome.committedMemories} memories saved`}`;
        else if (outcome?.kind === 'daily-materials') summaries[task.id] = zh ? `生成 ${outcome.createdFiles.length} 份素材` : `${outcome.createdFiles.length} materials created`;
      }));
    } catch { if (request === generation) error = true; }
    finally { if (request === generation) loading = false; }
  }
  $effect(() => {
    const target = endpoint;
    tasks = []; plans = []; summaries = {}; selected = ''; detail = null; loading = true;
    if (!target) loading = false;
    return () => { generation++; detailGeneration++; };
  });
  $effect(() => { revision; if (endpoint && !stale) void refresh(endpoint); });
  async function read(task: DesktopTaskItem) {
    const execution = task.executions[0];
    if (!execution || stale) return;
    const request = ++detailGeneration;
    const target = endpoint;
    selected = task.id; detail = null; detailError = false; detailLoading = true;
    try {
      const result = await loadDesktopTaskSession(target, task.id, execution.id);
      if (request === detailGeneration && endpoint === target) detail = result;
    } catch { if (request === detailGeneration) detailError = true; }
    finally { if (request === detailGeneration) detailLoading = false; }
  }
</script>

{#if visible.length || plans.length || error}
<section class="agent-home-band agent-home-work" aria-label={zh ? '后台工作与成果' : 'Work and results'}>
  <div class="agent-home-band-head"><h2 class="agent-home-band-label">{zh ? '后台为你做的事' : 'Work done for you'}</h2><Button variant="text" onclick={onTasks}>{zh ? '全部任务' : 'All tasks'}</Button></div>
  {#if loading}<p class="agent-home-meta" role="status">{zh ? '正在读取任务与计划…' : 'Loading tasks and plans…'}</p>
  {:else if error}<p class="agent-home-handover-stale" role="alert">{zh ? '工作记录读取失败，当前结果可能过期。' : 'Could not refresh work. Results may be out of date.'}<Button variant="text" disabled={stale} onclick={() => void refresh()}>{zh ? '重试' : 'Retry'}</Button></p>
  {:else if !visible.length && !plans.length}<p class="agent-home-meta">{zh ? '还没有执行结果；任务完成后会保留在这里。' : 'Completed task results will appear here.'}</p>{/if}
  {#each (expanded ? visible : visible.slice(0,4)) as task (task.id)}
    {@const execution = task.executions[0]}
    <article class="agent-home-work-row">
      <button class="agent-home-work-title" type="button" disabled={!execution || stale} onclick={() => void read(task)}>{task.text}</button>
      <span class="agent-home-meta">{task.active ? labels.running : labels[execution?.status ?? ''] ?? task.statusReason} · {task.botId ? agentLabel(task.botId) : (zh ? '系统任务' : 'System task')}{#if execution}<time datetime={execution.finishedAt || execution.startedAt}> · {formatTime(execution.finishedAt || execution.startedAt)}</time>{/if}</span>
      {#if summaries[task.id]}<p class="agent-home-meta">{summaries[task.id]}</p>{/if}
      {#if execution?.lastError}<p class="agent-home-handover-stale">{execution.lastError}</p>{/if}
      {#if selected === task.id}
        <div class="agent-home-work-detail" aria-live="polite">
          {#if detailLoading}<p>{zh ? '读取这次执行…' : 'Loading this execution…'}</p>
          {:else if detailError}<p role="alert">{zh ? '结果读取失败。' : 'Could not load this result.'}<Button variant="text" disabled={stale} onclick={() => void read(task)}>{zh ? '重试' : 'Retry'}</Button></p>
          {:else if detail}
            {#if detail.execution?.result?.kind === 'memory-reflection'}
              {@const result = detail.execution.result}
              <p>{zh ? `整理了 ${result.scannedConversations} 段对话、${result.scannedMessages} 条消息，产生 ${result.createdCandidates} 条记忆候选。` : `Reviewed ${result.scannedConversations} conversations and ${result.scannedMessages} messages; created ${result.createdCandidates} memory candidates.`}</p>
            {:else if detail.execution?.result?.kind === 'daily-materials'}
              <p>{zh ? '本次生成的素材' : 'Materials from this execution'}</p>
              {#each detail.execution.result.createdFiles as file}<p class="agent-home-work-text">{file}</p>{/each}
              <Button variant="text" onclick={onFiles}>{zh ? '打开文件与附件' : 'Open files and attachments'}</Button>
            {:else}
              {#each detail.messages.flatMap(message => collectTurnFiles(message)) as file (file.key)}<Button variant="text" disabled={stale} onclick={() => onResultFile(detail!.sessionId, file)}>{zh ? '打开成果' : 'Open result'} · {file.name}</Button>{/each}
              {#each detail.messages.filter(m => m.role === 'assistant' && m.content.trim()).slice(-3) as message}<p class="agent-home-work-text">{message.content}</p>{/each}
              {#if !detail.messages.some(m => m.role === 'assistant' && m.content.trim())}<p>{zh ? '这次执行没有可展示的正文。' : 'No result text is available for this execution.'}</p>{/if}
            {/if}
          {/if}
          <Button variant="text" onclick={() => { selected = ''; detailGeneration++; }}>{zh ? '收起' : 'Collapse'}</Button>
        </div>
      {/if}
    </article>
  {/each}
  {#if visible.length > 4}<Button variant="text" onclick={() => expanded = !expanded}>{expanded ? (zh ? '收起' : 'Collapse') : (zh ? `查看其余 ${visible.length-4} 项` : `Show ${visible.length-4} more`)}</Button>{/if}
  {#if plans.length}
    <div class="agent-home-band-head"><h2 class="agent-home-band-label">{zh ? '委托进展' : 'Delegated work'}</h2><Button variant="text" onclick={onPlans}>{zh ? '查看与验收' : 'Review plans'}</Button></div>
    {#each plans.slice(0,5) as plan (plan.planId)}<article class="agent-home-work-row"><button class="agent-home-work-title" type="button" onclick={onPlans}>{plan.title}</button><span class="agent-home-meta">{labels[plan.status] ?? plan.status} · {plan.progress.completed}/{plan.progress.total}{#if plan.progress.currentStepTitle} · {plan.progress.currentStepTitle}{/if}</span>{#if plan.waitingReason}<p>{plan.waitingReason}</p>{/if}</article>{/each}
    {#if plans.length > 5}<Button variant="text" onclick={onPlans}>{zh ? '查看全部计划' : 'View all plans'}</Button>{/if}
  {/if}
</section>

{/if}
