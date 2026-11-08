<script lang="ts">
  import { loadDesktopNotifications, markDesktopNotificationsRead, loadDesktopPlans } from '../api';
  import { CHANNEL_LOGOS } from './activityIcons';
  import type { TurnFileItem } from './turnFiles';
  import HomeTaskResult from './HomeTaskResult.svelte';
  import AgentHomeMemory from './AgentHomeMemory.svelte';
  import Button from '../components/ui/Button.svelte';
  import type { DesktopHandoverPending, DesktopHomeNotification, DesktopPlanListItem } from '@molibot/desktop-contract';
  let {
    endpoint, locale, stale, revision, formatTime, copy, memoryReview,
    pending, busyId = '', onResolve, onAnswer, onPlan, onOpen, onHistory,
    onPlans, onTasks, onFiles, onResultFile, onMemoryChanged, onOpenMemory
  } : {
    endpoint: string; locale: string; stale: boolean; revision: string;
    formatTime: (value: string) => string;
    copy: import('../i18n').Translation;
    memoryReview?: import('@molibot/desktop-contract').DesktopHomeMemoryReview;
    /** Live pending items: actions resolve through these, never the row snapshot. */
    pending: DesktopHandoverPending[];
    busyId?: string;
    onResolve?: (items: DesktopHandoverPending[], decision: 'approve_once' | 'reject') => void;
    onAnswer?: (item: DesktopHandoverPending, answer: string) => void;
    onPlan?: (item: DesktopHandoverPending, mode: 'manual' | 'accept_edits') => void;
    onOpen?: (input: { sessionId?: string; channel?: string; title?: string; agentId?: string; planId?: string; executionId?: string }) => void | Promise<void>;
    onHistory?: () => void;
    onPlans: (planId?: string) => void; onTasks: () => void; onFiles: () => void; onResultFile: (sessionId: string, file: TurnFileItem) => void;
    onMemoryChanged: () => Promise<void>; onOpenMemory: () => void;
  } = $props();
  let notifications = $state<DesktopHomeNotification[]>([]);
  let plans = $state<DesktopPlanListItem[]>([]);
  let loading = $state(true);
  let error = $state(false);
  let markingAll = $state(false);
  let expandedId = $state('');
  let generation = 0;
  const zh = $derived(locale === 'zh-CN');
  const livePending = $derived(new Map(pending.map(item => [item.id, item])));
  const visiblePlans = $derived.by(() => {
    // A plan with its own action-required row would appear twice; the delegated
    // band keeps only the rest. Completed plans surface as plan-completed
    // notification rows, never here.
    const pendingPlanIds = new Set(pending.map(item => item.planId).filter((id): id is string => Boolean(id)));
    return plans.filter(plan => !pendingPlanIds.has(plan.planId) && plan.status !== 'completed');
  });
  const planLabels = $derived<Record<string,string>>(zh ? { running:'执行中', retry_wait:'等待重试', completed:'已完成', failed:'执行失败', aborted:'已停止', interrupted:'已中断', skipped:'已跳过', waiting_approval:'待审批', queued:'排队中', verifying:'验证中', paused:'已暂停', partial:'部分完成', cancelled:'已取消', planned:'待启动', waiting_for_user:'需要你处理', waiting_for_approval:'待审批', recovery_required:'需要恢复' } : { running:'Running', retry_wait:'Retry pending', completed:'Completed', failed:'Failed', aborted:'Stopped', interrupted:'Interrupted', skipped:'Skipped', waiting_approval:'Approval required', queued:'Queued', verifying:'Verifying', paused:'Paused', partial:'Partially complete', cancelled:'Cancelled', planned:'Planned', waiting_for_user:'Your input needed', waiting_for_approval:'Approval required', recovery_required:'Recovery required' });
  function liveItem(item: DesktopHomeNotification): DesktopHandoverPending | undefined {
    return item.refId ? livePending.get(item.refId) : undefined;
  }
  function notificationTitle(item: DesktopHomeNotification): string {
    const text = item.payload.text;
    if (typeof text === 'string' && text.trim()) return text.trim();
    if (item.type === 'memory-review') return zh ? '每日记忆反思' : 'Daily memory reflection';
    if (item.type === 'materials') return zh ? '今日素材已生成' : 'Daily materials are ready';
    if (item.type === 'action-required') {
      const title = typeof item.payload.title === 'string' ? item.payload.title.trim() : '';
      return title || (zh ? '有待处理事项' : 'Needs your attention');
    }
    if (item.type === 'plan-completed') {
      const title = typeof item.payload.title === 'string' ? item.payload.title.trim() : '';
      return title || (zh ? '计划已完成' : 'Plan completed');
    }
    if (item.type === 'cross-channel') {
      const count = numberField(item.payload.count) ?? 0;
      return zh ? `渠道有 ${count} 条新回复` : `Replied to ${count} messages`;
    }
    return zh ? '后台任务' : 'Background task';
  }
  function optionLabel(option: string): string {
    if (option === 'confirm_completion') return copy.handoverOptionConfirmCompletion;
    if (option === 'continue_work') return copy.handoverOptionContinueWork;
    return option;
  }
  function payloadText(item: DesktopHomeNotification, key: string): string {
    const value = item.payload[key];
    return typeof value === 'string' ? value.trim() : '';
  }
  function payloadList(item: DesktopHomeNotification, key: string): string[] {
    return stringList(item.payload[key]);
  }
  /** Reconciled rows show the underlying event's time, not when the row landed. */
  function displayTime(item: DesktopHomeNotification): string {
    if (item.type === 'action-required') return payloadText(item, 'createdAt') || item.createdAt;
    if (item.type === 'plan-completed') return payloadText(item, 'updatedAt') || item.createdAt;
    if (item.type === 'cross-channel') return payloadText(item, 'latestAt') || item.createdAt;
    return item.createdAt;
  }
  function numberField(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  }
  function stringList(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0) : [];
  }
  function failureText(item: DesktopHomeNotification): string {
    const text = item.payload.error;
    return typeof text === 'string' ? text : '';
  }
  function executionId(item: DesktopHomeNotification): string {
    return typeof item.payload.executionId === 'string' ? item.payload.executionId : (item.refId ?? '');
  }
  async function refresh(target = endpoint) {
    const request = ++generation;
    error = false;
    try {
      const result = await Promise.allSettled([loadDesktopNotifications(target), loadDesktopPlans(target, { limit: 20 })]);
      if (request !== generation || endpoint !== target) return;
      error = result.some(item => item.status === 'rejected');
      if (result[0].status === 'fulfilled') notifications = result[0].value;
      if (result[1].status === 'fulfilled') plans = result[1].value.items.filter(p => !p.projectId && !p.archived && p.status !== 'cancelled');
    } catch { if (request === generation) error = true; }
    finally { if (request === generation) loading = false; }
  }
  $effect(() => {
    const target = endpoint;
    notifications = []; plans = []; expandedId = ''; loading = true;
    if (!target) loading = false;
    return () => { generation++; };
  });
  $effect(() => { revision; if (endpoint && !stale) void refresh(endpoint); });
  function toggle(item: DesktopHomeNotification): void {
    expandedId = expandedId === item.id ? '' : item.id;
  }
  async function read(item: DesktopHomeNotification): Promise<void> {
    if (stale) return;
    const target = endpoint;
    try {
      notifications = await markDesktopNotificationsRead(target, [item.id]);
      if (expandedId === item.id) expandedId = '';
    } catch { error = true; }
  }
  async function readAll(): Promise<void> {
    if (stale || markingAll) return;
    markingAll = true;
    const target = endpoint;
    try {
      notifications = await markDesktopNotificationsRead(target);
      expandedId = '';
    } catch { error = true; }
    finally { markingAll = false; }
  }
  /** Multiple unread memory-review rows must not stack identical panels; only the newest expands inline. */
  const newestMemoryReviewId = $derived(notifications.find(item => item.type === 'memory-review')?.id ?? '');
  function reflectionFailureCount(item: DesktopHomeNotification): number {
    return numberField(item.payload.failedTargets) ?? 0;
  }
  function canExpand(item: DesktopHomeNotification): boolean {
    if (item.type === 'memory-review') return item.id === newestMemoryReviewId && Boolean(memoryReview);
    if (item.type === 'materials' || item.type === 'action-required' || item.type === 'plan-completed' || item.type === 'cross-channel') return false;
    return Boolean(executionId(item));
  }
  /** A pending item with a source (session, plan or run) opens it from its title. */
  function actionOpens(item: DesktopHomeNotification): boolean {
    return Boolean(payloadText(item, 'sessionId') || payloadText(item, 'planId') || payloadText(item, 'executionId'));
  }
  function openAction(item: DesktopHomeNotification, live: DesktopHandoverPending): void {
    void onOpen?.({ sessionId: live.sessionId, channel: live.channel, title: live.title, agentId: live.agentId, planId: live.planId, executionId: live.executionId });
  }
  async function openCrossChannel(item: DesktopHomeNotification): Promise<void> {
    if (!stale) await read(item);
    onHistory?.();
  }
</script>

<section class="agent-home-band agent-home-work" aria-label={zh ? '通知中心' : 'Notifications'}>
  <div class="agent-home-band-head"><h2 class="agent-home-band-label">{zh ? '为你准备的成果' : 'Ready for you'}</h2>
    <div class="agent-home-band-actions">
      {#if notifications.length > 1}<Button variant="text" disabled={stale || markingAll} onclick={() => void readAll()}>{zh ? '全部已阅' : 'Mark all read'}</Button>{/if}
      <Button variant="text" onclick={onTasks}>{zh ? '全部任务' : 'All tasks'}</Button>
    </div>
  </div>
  {#if loading}<p class="agent-home-meta" role="status">{zh ? '正在读取…' : 'Loading…'}</p>
  {:else if error}<p class="agent-home-handover-stale" role="alert">{zh ? '通知读取失败' : 'Could not load notifications.'}<Button variant="text" disabled={stale} onclick={() => void refresh()}>{zh ? '重试' : 'Retry'}</Button></p>
  {:else if !notifications.length && !visiblePlans.length}<p class="agent-home-meta">{zh ? '没有未读' : 'Nothing unread.'}</p>{/if}
  <div class="agent-home-work-grid">
  {#each notifications as item (item.id)}
    <article class="agent-home-work-card" data-type={item.type} data-expanded={expandedId === item.id} data-testid={item.type === 'action-required' ? 'handover-pending-card' : item.type === 'cross-channel' ? 'handover-cross-channel' : undefined}>
      <div class="agent-home-work-head">
        {#if item.type === 'action-required' && actionOpens(item)}
          <button class="agent-home-work-title" type="button" disabled={stale} onclick={() => { const live = liveItem(item); if (live) openAction(item, live); }}>{notificationTitle(item)}</button>
        {:else if canExpand(item)}
          <button class="agent-home-work-title" type="button" disabled={stale} onclick={() => toggle(item)}>{notificationTitle(item)}</button>
        {:else}
          <span class="agent-home-work-title">{notificationTitle(item)}</span>
        {/if}
        <time datetime={displayTime(item)}>{formatTime(displayTime(item))}</time>
      </div>
      {#if item.type === 'materials' && payloadList(item, 'createdFiles').length}
        <div class="agent-home-work-summary">
          {#each payloadList(item, 'createdFiles') as file}<p class="agent-home-work-text">{file}</p>{/each}
        </div>
      {/if}
      {#if item.type === 'task-failed' && failureText(item)}<p class="agent-home-handover-stale">{failureText(item)}</p>{/if}
      {#if item.type === 'memory-review' && reflectionFailureCount(item) > 0}
        <p class="agent-home-handover-stale">{zh ? `${reflectionFailureCount(item)} 个反思目标失败，详情见日志` : `${reflectionFailureCount(item)} reflection target(s) failed`}</p>
      {/if}
      {#if item.type === 'action-required' && payloadText(item, 'detail')}
        {#if item.payload.kind === 'approval'}
          <details class="agent-home-command"><summary>{copy.handoverCommandDetails}</summary><pre class="agent-home-cmd">{payloadText(item, 'detail')}</pre></details>
        {:else}
          <p class="agent-home-work-text">{payloadText(item, 'detail')}</p>
        {/if}
      {/if}
      <div class="agent-home-work-actions">
        {#if item.type === 'action-required'}
          {@const live = liveItem(item)}
          {#if live?.kind === 'approval' && live.actionable && live.requestId}
            <Button variant="primary" disabled={stale || busyId === live.id} onclick={() => onResolve?.([live], 'approve_once')}>{copy.handoverApproveOnce}</Button>
            <Button disabled={stale || busyId === live.id} onclick={() => onResolve?.([live], 'reject')}>{copy.handoverReject}</Button>
          {:else if live?.kind === 'decision'}
            {#each live.options ?? [] as option (option)}
              <Button disabled={stale || busyId === live.id} onclick={() => onAnswer?.(live, option)}>{optionLabel(option)}</Button>
            {/each}
          {:else if live?.kind === 'plan'}
            <Button disabled={stale || busyId === live.id} onclick={() => onPlan?.(live, 'manual')}>{copy.handoverManualMode}</Button>
            <Button disabled={stale || busyId === live.id} onclick={() => onPlan?.(live, 'accept_edits')}>{copy.handoverAcceptEditsMode}</Button>
          {:else if live}
            <Button variant="text" disabled={stale} onclick={() => openAction(item, live)}>{zh ? '打开' : 'Open'}</Button>
          {:else}
            <span class="agent-home-meta">{zh ? '已处理' : 'Handled'}</span>
          {/if}
          <Button variant="text" disabled={stale} onclick={() => void read(item)}>{zh ? '已阅' : 'Mark read'}</Button>
        {:else if item.type === 'plan-completed'}
          <Button variant="text" disabled={stale} onclick={() => onPlans(typeof item.payload.planId === 'string' ? item.payload.planId : undefined)}>{zh ? '查看计划' : 'View plan'}</Button>
          <Button variant="text" disabled={stale} onclick={() => void read(item)}>{zh ? '已阅' : 'Mark read'}</Button>
        {:else if item.type === 'cross-channel'}
          {#if payloadList(item, 'channels').length}<span class="agent-home-signal-platforms" aria-hidden="true">{#each payloadList(item, 'channels') as channel}{#if CHANNEL_LOGOS[channel]}<img src={CHANNEL_LOGOS[channel]} alt="" width="16" height="16" />{/if}{/each}</span>{/if}
          <Button variant="text" disabled={stale} onclick={() => void openCrossChannel(item)}>{zh ? '打开历史' : 'View history'}</Button>
        {:else}
          {#if item.type === 'memory-review' && memoryReview}{:else if canExpand(item)}<Button variant="text" disabled={stale} onclick={() => toggle(item)}>{expandedId === item.id ? (zh ? '收起' : 'Collapse') : (zh ? '查看' : 'Read result')}</Button>{/if}
          {#if item.type === 'materials' && payloadList(item, 'createdFiles').length}<Button variant="text" disabled={stale} onclick={onFiles}>{zh ? '打开文件与附件' : 'Open files and attachments'}</Button>{/if}
          <Button variant="text" disabled={stale} onclick={() => void read(item)}>{zh ? '已阅' : 'Mark read'}</Button>
        {/if}
      </div>
      {#if item.type === 'memory-review' && memoryReview && item.id === newestMemoryReviewId}
        <AgentHomeMemory {locale} review={memoryReview} {endpoint} stale={stale} {copy} {formatTime} onChanged={onMemoryChanged} {onOpenMemory} />
      {:else if expandedId === item.id && (item.type === 'task-result' || item.type === 'task-failed') && executionId(item)}
        {#key `${endpoint}:${item.id}:${executionId(item)}`}
          <HomeTaskResult {endpoint} taskId={typeof item.payload.taskId === 'string' ? item.payload.taskId : ''} executionId={executionId(item)} {locale} {stale} {onFiles} {onResultFile} onClose={() => { expandedId = ''; }} />
        {/key}
      {/if}
    </article>
  {/each}
  </div>
  {#if visiblePlans.length}
    <div class="agent-home-band-head"><h2 class="agent-home-band-label">{zh ? '委托进展' : 'Delegated work'}</h2><Button variant="text" onclick={() => onPlans()}>{zh ? '查看与验收' : 'Review plans'}</Button></div>
    <div class="agent-home-work-grid">
    {#each visiblePlans.slice(0,5) as plan (plan.planId)}<article class="agent-home-work-card" data-state={plan.status}><div class="agent-home-work-head"><button class="agent-home-work-title" type="button" onclick={() => onPlans(plan.planId)}>{plan.title}</button></div><div class="agent-home-work-summary"><span class="agent-home-meta">{planLabels[plan.status] ?? plan.status} · {plan.progress.completed}/{plan.progress.total}{#if plan.progress.currentStepTitle} · {plan.progress.currentStepTitle}{/if}</span></div><div class="agent-home-work-actions"><Button variant="text" onclick={() => onPlans(plan.planId)}>{zh ? "查看计划" : "View plan"}</Button></div></article>{/each}
    </div>
    {#if visiblePlans.length > 5}<Button variant="text" onclick={() => onPlans()}>{zh ? '查看全部计划' : 'View all plans'}</Button>{/if}
  {/if}
</section>
