<script lang="ts">
  import { untrack } from "svelte";
  import type {
    DesktopHandoverPending,
    DesktopHomeNotification,
    DesktopHomeNotificationType,
  } from "@molibot/desktop-contract";
  import {
    loadDesktopNotifications,
    markDesktopNotificationsRead,
  } from "../api";
  import type { Translation } from "../i18n";
  import Button from "../components/ui/Button.svelte";
  import EmptyState from "../components/ui/EmptyState.svelte";
  import SkeletonRows from "../components/ui/SkeletonRows.svelte";
  import { CHANNEL_LOGOS } from "./activityIcons";
  import HomeTaskResult from "./HomeTaskResult.svelte";
  import type { TurnFileItem } from "./turnFiles";
  import ArrowLeft from "reicon-svelte/icons/ArrowLeft";
  import ArrowUpRight from "reicon-svelte/icons/ArrowUpRight";
  import Check from "reicon-svelte/icons/Check";
  import Refresh from "reicon-svelte/icons/Refresh";
  import Bell from "../icons/duotone/components/Bell.svelte";
  import ChatRoundLine from "../icons/duotone/components/ChatRoundLine.svelte";
  import CheckCircle from "../icons/duotone/components/CheckCircle.svelte";
  import CircleArrowsDown from "../icons/duotone/components/CircleArrowsDown.svelte";
  import Database from "../icons/duotone/components/Database.svelte";
  import Dialog from "../icons/duotone/components/Dialog.svelte";
  import Eye from "../icons/duotone/components/Eye.svelte";
  import Files from "../icons/duotone/components/Files.svelte";
  import Handshake from "../icons/duotone/components/Handshake.svelte";
  import Stopwatch from "../icons/duotone/components/Stopwatch.svelte";
  import TriangleWarning from "../icons/duotone/components/TriangleWarning.svelte";
  import {
    actionOpens,
    displayTime,
    executionId,
    failureText,
    matchesNotificationCategory,
    memoryReviewSummary,
    notificationTitle,
    notificationTypeLabel,
    openActionLabel,
    payloadList,
    payloadText,
    planProgressText,
    reflectionFailureCount,
    resolveActionOpenTarget,
    resolveSessionCompletedTarget,
    type NotificationCategoryFilter,
    type NotificationOpenTarget,
    type NotificationStatusFilter,
  } from "./homeNotificationView";

  let {
    endpoint,
    locale,
    stale = false,
    revision = "",
    formatTime,
    copy,
    pending = [],
    busyId = "",
    onClose,
    onCountChange,
    onResolve,
    onAnswer,
    onPlan,
    onOpen,
    onHistory,
    onPlans,
    onTasks,
    onFiles,
    onResultFile,
    onOpenMemory,
  }: {
    endpoint: string;
    locale: string;
    stale?: boolean;
    revision?: string;
    formatTime: (value: string) => string;
    copy: Translation;
    pending?: DesktopHandoverPending[];
    busyId?: string;
    onClose: () => void;
    onCountChange?: (unreadCount: number) => void;
    onResolve?: (
      items: DesktopHandoverPending[],
      decision: "approve_once" | "reject",
    ) => void;
    onAnswer?: (item: DesktopHandoverPending, answer: string) => void;
    onPlan?: (
      item: DesktopHandoverPending,
      mode: "manual" | "accept_edits",
    ) => void;
    onOpen?: (input: NotificationOpenTarget) => void | Promise<void>;
    onHistory?: () => void;
    onPlans: (planId?: string) => void;
    onTasks: () => void;
    onFiles: () => void;
    onResultFile: (sessionId: string, file: TurnFileItem) => void;
    onOpenMemory: () => void;
  } = $props();

  let notifications = $state<DesktopHomeNotification[]>([]);
  let loading = $state(true);
  let error = $state(false);
  let markingAll = $state(false);
  let expandedId = $state("");
  let statusFilter = $state<NotificationStatusFilter>("all");
  let categoryFilter = $state<NotificationCategoryFilter>("all");
  let generation = 0;

  const QUERY_OPTIONS = { status: "all", limit: 200 } as const;
  const zh = $derived(locale === "zh-CN");
  const livePending = $derived(new Map(pending.map((item) => [item.id, item])));
  const unreadCount = $derived(
    notifications.filter((item) => item.status === "unread").length,
  );
  const readCount = $derived(notifications.length - unreadCount);

  const TYPE_ICONS = {
    "session-completed": ChatRoundLine,
    "plan-completed": CheckCircle,
    "memory-review": Database,
    materials: Files,
    "task-result": Stopwatch,
    "task-failed": TriangleWarning,
    "action-required": Handshake,
    "cross-channel": Dialog,
    "follow-up": Bell,
  } as const;

  const CATEGORY_ICONS = {
    all: Bell,
    session: ChatRoundLine,
    plan: CircleArrowsDown,
    task: Stopwatch,
    memory: Database,
    action: Handshake,
    channel: Dialog,
  } as const;

  const statusOptions = $derived<
    Array<{ value: NotificationStatusFilter; label: string; count: number }>
  >([
    { value: "all", label: zh ? "全部" : "All", count: notifications.length },
    { value: "unread", label: zh ? "未读" : "Unread", count: unreadCount },
    { value: "read", label: zh ? "已读" : "Read", count: readCount },
  ]);

  const categoryOptions = $derived<
    Array<{ value: NotificationCategoryFilter; label: string }>
  >([
    { value: "all", label: zh ? "全部" : "All" },
    { value: "session", label: zh ? "对话" : "Chats" },
    { value: "plan", label: zh ? "计划" : "Plans" },
    { value: "task", label: zh ? "任务" : "Tasks" },
    { value: "memory", label: zh ? "记忆" : "Memory" },
    { value: "action", label: zh ? "待处理" : "Actions" },
    { value: "channel", label: zh ? "渠道" : "Channels" },
  ]);

  const filteredNotifications = $derived(
    notifications.filter((item) => {
      if (statusFilter === "unread" && item.status !== "unread") return false;
      if (statusFilter === "read" && item.status === "unread") return false;
      return matchesNotificationCategory(item, categoryFilter);
    }),
  );

  function liveItem(
    item: DesktopHomeNotification,
  ): DesktopHandoverPending | undefined {
    return item.refId ? livePending.get(item.refId) : undefined;
  }

  function typeIconFor(type: DesktopHomeNotificationType) {
    return TYPE_ICONS[type] ?? Bell;
  }

  function optionLabel(option: string): string {
    if (option === "confirm_completion")
      return copy.handoverOptionConfirmCompletion;
    if (option === "continue_work") return copy.handoverOptionContinueWork;
    return option;
  }

  async function refresh(target = endpoint): Promise<void> {
    if (!target) {
      loading = false;
      return;
    }
    const request = ++generation;
    error = false;
    try {
      const items = await loadDesktopNotifications(target, QUERY_OPTIONS);
      if (request !== generation || endpoint !== target) return;
      notifications = items;
    } catch {
      if (request === generation) error = true;
    } finally {
      if (request === generation) loading = false;
    }
  }

  $effect(() => {
    const target = endpoint;
    notifications = [];
    expandedId = "";
    statusFilter = "all";
    categoryFilter = "all";
    error = false;
    loading = Boolean(target);
    if (target) {
      void refresh(target);
    }
    return () => {
      generation += 1;
    };
  });

  $effect(() => {
    revision;
    const target = endpoint;
    const isStale = stale;
    if (target && !isStale) {
      void untrack(() => refresh(target));
    }
  });

  $effect(() => {
    if (!loading && !error) {
      onCountChange?.(unreadCount);
    }
  });

  function toggle(item: DesktopHomeNotification): void {
    expandedId = expandedId === item.id ? "" : item.id;
  }

  async function read(item: DesktopHomeNotification): Promise<void> {
    if (stale || item.status !== "unread") return;
    const target = endpoint;
    try {
      notifications = await markDesktopNotificationsRead(
        target,
        [item.id],
        QUERY_OPTIONS,
      );
    } catch {
      error = true;
    }
  }

  async function readAll(): Promise<void> {
    if (stale || markingAll || unreadCount === 0) return;
    markingAll = true;
    const target = endpoint;
    try {
      notifications = await markDesktopNotificationsRead(
        target,
        undefined,
        QUERY_OPTIONS,
      );
    } catch {
      error = true;
    } finally {
      markingAll = false;
    }
  }

  function canOpenNotification(item: DesktopHomeNotification): boolean {
    if (item.type === "session-completed")
      return Boolean(payloadText(item, "sessionId") || item.refId);
    if (
      item.type === "plan-completed" ||
      item.type === "memory-review" ||
      item.type === "materials"
    )
      return true;
    if (item.type === "cross-channel") return Boolean(onHistory);
    if (item.type === "action-required")
      return Boolean(liveItem(item) || actionOpens(item));
    return true;
  }

  function openNotification(item: DesktopHomeNotification): void {
    if (item.status === "unread" && !stale) {
      void read(item);
    }
    if (item.type === "session-completed") {
      void onOpen?.(resolveSessionCompletedTarget(item));
      return;
    }
    if (item.type === "plan-completed") {
      onPlans(payloadText(item, "planId") || item.refId || undefined);
      return;
    }
    if (item.type === "memory-review") {
      onOpenMemory();
      return;
    }
    if (item.type === "materials") {
      onFiles();
      return;
    }
    if (item.type === "cross-channel") {
      onHistory?.();
      return;
    }
    if (item.type === "action-required") {
      const live = liveItem(item);
      if (live || actionOpens(item)) {
        void onOpen?.(resolveActionOpenTarget(item, live));
      }
      return;
    }
    if (executionId(item)) {
      toggle(item);
      return;
    }
    onTasks();
  }
</script>

<section
  class="agent-notifications-page"
  aria-label={zh ? "通知中心" : "Notification center"}
>
  <header class="agent-notifications-toolbar">
    <div class="agent-notifications-toolbar-start">
      <Button
        variant="icon"
        title={zh ? "返回" : "Back"}
        ariaLabel={zh ? "返回" : "Back"}
        onclick={onClose}
      >
        <ArrowLeft size={16} aria-hidden="true" />
      </Button>
      <div
        class="segmented"
        role="group"
        aria-label={zh ? "通知状态" : "Notification status"}
      >
        {#each statusOptions as option (option.value)}
          <Button
            class={`segmented-item${statusFilter === option.value ? " active" : ""}`}
            aria-pressed={statusFilter === option.value}
            onclick={() => (statusFilter = option.value)}
          >
            <span>{option.label}</span>
            <small class="tnum">{option.count}</small>
          </Button>
        {/each}
      </div>
    </div>

    <div class="agent-notifications-toolbar-end">
      <div
        class="segmented agent-notifications-categories"
        role="group"
        aria-label={zh ? "通知类型" : "Notification type"}
      >
        {#each categoryOptions as option (option.value)}
          {@const CategoryIcon = CATEGORY_ICONS[option.value]}
          <Button
            class={`segmented-item${categoryFilter === option.value ? " active" : ""}`}
            aria-pressed={categoryFilter === option.value}
            title={option.label}
            onclick={() => (categoryFilter = option.value)}
          >
            <CategoryIcon size={14} aria-hidden="true" />
            <span>{option.label}</span>
          </Button>
        {/each}
      </div>
      <div class="agent-notifications-toolbar-actions">
        <Button
          variant="icon"
          disabled={stale || markingAll || unreadCount === 0}
          title={zh ? "全部标为已读" : "Mark all read"}
          ariaLabel={zh ? "全部标为已读" : "Mark all read"}
          onclick={() => void readAll()}
        >
          <Check size={16} aria-hidden="true" />
        </Button>
        <Button
          variant="icon"
          disabled={loading || stale || !endpoint}
          title={zh ? "刷新" : "Refresh"}
          ariaLabel={zh ? "刷新" : "Refresh"}
          onclick={() => void refresh(endpoint)}
        >
          <Refresh size={16} aria-hidden="true" />
        </Button>
      </div>
    </div>
  </header>

  {#if stale && notifications.length > 0}
    <p class="agent-home-handover-stale" role="status">{copy.handoverStale}</p>
  {/if}

  <div class="agent-notifications-list">
    {#if loading && notifications.length === 0}
      <SkeletonRows count={5} label={copy.loading} />
    {:else if error && notifications.length === 0}
      <p class="agent-home-handover-stale" role="alert">
        {zh ? "通知读取失败" : "Could not load notifications."}
        <Button
          variant="icon"
          disabled={stale}
          title={zh ? "重试" : "Retry"}
          ariaLabel={zh ? "重试" : "Retry"}
          onclick={() => void refresh(endpoint)}
        >
          <Refresh size={15} aria-hidden="true" />
        </Button>
      </p>
    {:else if notifications.length === 0}
      <EmptyState
        icon="bell"
        title={zh ? "暂无通知" : "All caught up"}
        description={zh
          ? "对话完成、计划进度、记忆反思、后台任务与待处理通知会汇聚在这里。"
          : "Completed conversations, plan updates, memory reflections, task outcomes, and action requests appear here."}
      />
    {:else if filteredNotifications.length === 0}
      <EmptyState
        icon="bell"
        title={zh ? "没有符合筛选条件的通知" : "No matching notifications"}
      >
        <Button
          onclick={() => {
            statusFilter = "all";
            categoryFilter = "all";
          }}
        >
          {zh ? "重置筛选" : "Reset filters"}
        </Button>
      </EmptyState>
    {:else}
      {#if error}
        <p class="agent-home-handover-stale" role="alert">
          {zh ? "通知刷新失败" : "Could not refresh notifications."}
          <Button
            variant="icon"
            disabled={stale}
            title={zh ? "重试" : "Retry"}
            ariaLabel={zh ? "重试" : "Retry"}
            onclick={() => void refresh(endpoint)}
          >
            <Refresh size={15} aria-hidden="true" />
          </Button>
        </p>
      {/if}

      <div class="agent-notifications-stream">
        {#each filteredNotifications as item (item.id)}
          {@const execId = executionId(item)}
          {@const live =
            item.type === "action-required" ? liveItem(item) : undefined}
          {@const TypeIcon = typeIconFor(item.type)}
          {@const isProjectSession =
            item.type === "session-completed" &&
            Boolean(payloadText(item, "projectId") || item.projectId)}
          <article
            class="notification-card"
            class:is-unread={item.status === "unread"}
            data-type={item.type}
            data-status={item.status}
            data-expanded={expandedId === item.id}
            data-testid="notification-history-card"
          >
            <div
              class="notification-icon-tile"
              data-type={item.type}
              class:is-danger={item.type === "task-failed"}
            >
              <TypeIcon size={18} aria-hidden="true" />
              {#if item.status === "unread"}
                <span class="notification-unread-pip" aria-hidden="true"></span>
              {/if}
            </div>

            <div class="notification-body">
              <div class="notification-head">
                {#if canOpenNotification(item)}
                  <button
                    class="notification-title-btn"
                    type="button"
                    onclick={() => openNotification(item)}
                  >
                    {notificationTitle(item, zh)}
                  </button>
                {:else}
                  <span class="notification-title-text"
                    >{notificationTitle(item, zh)}</span
                  >
                {/if}
                <div class="notification-meta">
                  {#if item.type === "cross-channel" && payloadList(item, "channels").length}
                    <span
                      class="agent-home-signal-platforms"
                      aria-hidden="true"
                    >
                      {#each payloadList(item, "channels") as channel}
                        {#if CHANNEL_LOGOS[channel]}<img
                            src={CHANNEL_LOGOS[channel]}
                            alt=""
                            width="14"
                            height="14"
                          />{/if}
                      {/each}
                    </span>
                  {/if}
                  <span
                    class="notification-type-tag"
                    class:danger={item.type === "task-failed"}
                  >
                    {isProjectSession
                      ? zh
                        ? "项目对话"
                        : "Project"
                      : notificationTypeLabel(item.type, zh)}
                  </span>
                  <time
                    class="notification-time tnum"
                    datetime={displayTime(item)}
                    >{formatTime(displayTime(item))}</time
                  >
                </div>
              </div>

              {#if item.type === "session-completed"}
                {#if payloadText(item, "preview")}
                  <p class="notification-preview">
                    {payloadText(item, "preview")}
                  </p>
                {/if}
              {:else if item.type === "memory-review"}
                {@const summary = memoryReviewSummary(item, zh)}
                {#if summary}
                  <p class="notification-preview">{summary}</p>
                {/if}
                {#if reflectionFailureCount(item) > 0}
                  <p class="notification-error">
                    {zh
                      ? `${reflectionFailureCount(item)} 个反思目标失败，详情见日志`
                      : `${reflectionFailureCount(item)} reflection target(s) failed`}
                  </p>
                {/if}
              {:else if item.type === "plan-completed"}
                {@const progress = planProgressText(item, zh)}
                {#if progress}
                  <p class="notification-preview">{progress}</p>
                {/if}
              {:else if item.type === "materials" && payloadList(item, "createdFiles").length}
                <p class="notification-preview">
                  {payloadList(item, "createdFiles").join(" · ")}
                </p>
              {:else if item.type === "task-failed" && failureText(item)}
                <p class="notification-error">{failureText(item)}</p>
              {:else if item.type === "action-required"}
                {#if payloadText(item, "detail")}
                  {#if item.payload.kind === "approval"}
                    <details class="agent-home-command">
                      <summary>{copy.handoverCommandDetails}</summary>
                      <pre class="agent-home-cmd">{payloadText(
                          item,
                          "detail",
                        )}</pre>
                    </details>
                  {:else}
                    <p class="notification-preview">
                      {payloadText(item, "detail")}
                    </p>
                  {/if}
                {/if}
                {#if live}
                  <div class="notification-inline-decisions">
                    {#if live.kind === "approval" && live.actionable && live.requestId}
                      <Button
                        variant="primary"
                        disabled={stale || busyId === live.id}
                        onclick={() => onResolve?.([live], "approve_once")}
                        >{copy.handoverApproveOnce}</Button
                      >
                      <Button
                        disabled={stale || busyId === live.id}
                        onclick={() => onResolve?.([live], "reject")}
                        >{copy.handoverReject}</Button
                      >
                    {:else if live.kind === "decision"}
                      {#each live.options ?? [] as option (option)}
                        <Button
                          disabled={stale || busyId === live.id}
                          onclick={() => onAnswer?.(live, option)}
                          >{optionLabel(option)}</Button
                        >
                      {/each}
                    {:else if live.kind === "plan"}
                      <Button
                        disabled={stale || busyId === live.id}
                        onclick={() => onPlan?.(live, "manual")}
                        >{copy.handoverManualMode}</Button
                      >
                      <Button
                        disabled={stale || busyId === live.id}
                        onclick={() => onPlan?.(live, "accept_edits")}
                        >{copy.handoverAcceptEditsMode}</Button
                      >
                    {/if}
                  </div>
                {/if}
              {/if}
            </div>

            <div class="notification-actions">
              {#if (item.type === "task-result" || item.type === "task-failed") && execId}
                <Button
                  variant="icon"
                  disabled={stale && expandedId !== item.id}
                  title={expandedId === item.id
                    ? zh
                      ? "收起成果"
                      : "Hide result"
                    : zh
                      ? "查看成果"
                      : "Preview result"}
                  ariaLabel={expandedId === item.id
                    ? zh
                      ? "收起成果"
                      : "Hide result"
                    : zh
                      ? "查看成果"
                      : "Preview result"}
                  aria-pressed={expandedId === item.id}
                  onclick={() => toggle(item)}
                >
                  <Eye size={16} aria-hidden="true" />
                </Button>
              {/if}
              {#if canOpenNotification(item)}
                <Button
                  variant="icon"
                  title={openActionLabel(item, zh)}
                  ariaLabel={openActionLabel(item, zh)}
                  onclick={() => openNotification(item)}
                >
                  <ArrowUpRight size={16} aria-hidden="true" />
                </Button>
              {/if}
              {#if item.status === "unread"}
                <Button
                  variant="icon"
                  disabled={stale}
                  title={zh ? "标为已读" : "Mark read"}
                  ariaLabel={zh ? "标为已读" : "Mark read"}
                  onclick={() => void read(item)}
                >
                  <Check size={16} aria-hidden="true" />
                </Button>
              {/if}
            </div>

            {#if expandedId === item.id && (item.type === "task-result" || item.type === "task-failed") && execId}
              <div class="notification-expanded-result">
                {#key `${endpoint}:${item.id}:${execId}`}
                  <HomeTaskResult
                    {endpoint}
                    taskId={payloadText(item, "taskId")}
                    executionId={execId}
                    {locale}
                    {stale}
                    {copy}
                    {onFiles}
                    {onResultFile}
                    onContinueChat={(sid) => {
                      void onOpen?.({
                        sessionId: sid,
                        channel: payloadText(item, "channel") || undefined,
                        title: notificationTitle(item, zh),
                        agentId: item.botId || undefined,
                      });
                    }}
                    onClose={() => {
                      expandedId = "";
                    }}
                  />
                {/key}
              </div>
            {/if}
          </article>
        {/each}
      </div>
    {/if}
  </div>
</section>
