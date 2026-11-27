<script lang="ts">
  import { untrack } from "svelte";
  import { loadDesktopPlans } from "../api";
  import type { HomeInbox } from "./homeInbox";
  import Check from "reicon-svelte/icons/Check";
  import { CHANNEL_LOGOS } from "./activityIcons";
  import type { HomeDeskPresence } from "./homePresence";
  import type { TurnFileItem } from "./turnFiles";
  import HomeTaskResult from "./HomeTaskResult.svelte";
  import Button from "../components/ui/Button.svelte";
  import Bell from "../icons/duotone/components/Bell.svelte";
  import Notebook from "../icons/duotone/components/Notebook.svelte";
  import ArrowRight from "reicon-svelte/icons/ArrowRight";
  import type {
    DesktopHandoverPending,
    DesktopHomeMemoryReview,
    DesktopHomeNotification,
    DesktopPlanListItem,
  } from "@molibot/desktop-contract";
  import {
    actionOpens,
    displayTime,
    executionId,
    failureText,
    notificationTitle,
    payloadList,
    payloadText,
    resolveActionOpenTarget,
  } from "./homeNotificationView";

  let {
    endpoint,
    inbox,
    locale,
    stale,
    revision,
    formatTime,
    copy,
    memoryReview,
    pending,
    busyId = "",
    onResolve,
    onAnswer,
    onPlan,
    onOpen,
    onHistory,
    onNotifications,
    onPlans,
    onTasks,
    onFiles,
    onResultFile,
    onOpenMemory,
    onPresenceChange = () => {},
  }: {
    endpoint: string;
    inbox: HomeInbox;
    locale: string;
    stale: boolean;
    revision: string;
    formatTime: (value: string) => string;
    copy: import("../i18n").Translation;
    memoryReview?: DesktopHomeMemoryReview;
    /** Live pending items: actions resolve through these, never the row snapshot. */
    pending: DesktopHandoverPending[];
    busyId?: string;
    onResolve?: (
      items: DesktopHandoverPending[],
      decision: "approve_once" | "reject",
    ) => void;
    onAnswer?: (item: DesktopHandoverPending, answer: string) => void;
    onPlan?: (
      item: DesktopHandoverPending,
      mode: "manual" | "accept_edits",
    ) => void;
    onOpen?: (input: {
      sessionId?: string;
      channel?: string;
      title?: string;
      agentId?: string;
      planId?: string;
      executionId?: string;
    }) => boolean | Promise<boolean>;
    onHistory?: () => void;
    onNotifications?: () => void;
    onPlans: (planId?: string) => void;
    onTasks: () => void;
    onFiles: () => void;
    onResultFile: (sessionId: string, file: TurnFileItem) => void;
    onOpenMemory: () => void;
    /** Reports what is on the desk so the greeting can count exactly that. */
    onPresenceChange?: (presence: HomeDeskPresence) => void;
  } = $props();

  let plans = $state<DesktopPlanListItem[]>([]);
  let plansError = $state(false);
  let expandedId = $state("");

  const zh = $derived(locale === "zh-CN");
  const livePending = $derived(new Map(pending.map((item) => [item.id, item])));
  const activeNotifications = $derived(
    $inbox.notifications.filter((item) => item.type !== "memory-review"),
  );

  // Group 1: Things genuinely waiting for user action.
  const actionItems = $derived(
    activeNotifications.filter((item) => {
      if (item.type !== "action-required") return false;
      const live = liveItem(item);
      return Boolean(live || actionOpens(item));
    }),
  );

  // Group 2: Fresh deliverables & updates ready to read or continue.
  const readyItems = $derived(
    activeNotifications.filter((item) => item.type !== "action-required"),
  );

  // Only finished work and produced material count as "done"; replies from
  // other channels and follow-ups are updates, not deliveries.
  const doneCount = $derived(
    readyItems.filter((item) => item.type === "task-result" || item.type === "plan-completed" || item.type === "materials").length,
  );
  const failedCount = $derived(readyItems.filter((item) => item.type === "task-failed").length);

  const memoryPendingCount = $derived(memoryReview?.pendingReviewCount ?? memoryReview?.items.length ?? 0);
  const skillDraftCount = $derived(memoryReview?.skillDraftCount ?? 0);
  const showMemoryEntry = $derived(
    memoryPendingCount > 0 || skillDraftCount > 0,
  );

  const visiblePlans = $derived.by(() => {
    const pendingPlanIds = new Set(
      pending
        .map((item) => item.planId)
        .filter((id): id is string => Boolean(id)),
    );
    return plans.filter(
      (plan) => !pendingPlanIds.has(plan.planId) && plan.status !== "completed",
    );
  });

  const hasReadySection = $derived(
    readyItems.length > 0 || showMemoryEntry || visiblePlans.length > 0,
  );
  const hasAnyContent = $derived(
    actionItems.length > 0 || hasReadySection || $inbox.undoItems.length > 0 || $inbox.loadError || $inbox.writeError || plansError,
  );

  // Untracked: the callback belongs to the parent, and reporting must not depend on its identity.
  $effect(() => {
    const presence = { hasContent: hasAnyContent, decisionCount: actionItems.length, doneCount, failedCount };
    untrack(() => onPresenceChange(presence));
  });

  function friendlyPlanStatus(status: string): string {
    switch (status) {
      case "running":
      case "verifying":
      case "queued":
      case "retry_wait":
        return zh ? "进行中" : "In progress";
      case "waiting_approval":
      case "waiting_for_approval":
      case "waiting_for_user":
      case "recovery_required":
        return zh ? "等你处理" : "Needs your input";
      case "paused":
      case "planned":
        return zh ? "已暂停" : "Paused";
      case "failed":
      case "aborted":
      case "interrupted":
      case "partial":
        return zh ? "遇到问题" : "Needs attention";
      default:
        return zh ? "进行中" : "In progress";
    }
  }

  function liveItem(
    item: DesktopHomeNotification,
  ): DesktopHandoverPending | undefined {
    return item.refId ? livePending.get(item.refId) : undefined;
  }

  function optionLabel(option: string): string {
    if (option === "confirm_completion")
      return copy.handoverOptionConfirmCompletion;
    if (option === "continue_work") return copy.handoverOptionContinueWork;
    return option;
  }

  function itemSessionId(item: DesktopHomeNotification): string {
    const live = liveItem(item);
    return live?.sessionId || payloadText(item, "sessionId");
  }

  async function refreshPlans(target: string, signal: AbortSignal) {
    try {
      const result = await loadDesktopPlans(target, { limit: 20 });
      if (signal.aborted) return;
      plans = result.items.filter(
        (plan) => !plan.projectId && !plan.archived && plan.status !== "cancelled",
      );
      plansError = false;
    } catch {
      if (!signal.aborted) plansError = true;
    }
  }

  let retry = $state(0);
  $effect(() => {
    endpoint;
    plans = [];
    plansError = false;
    expandedId = "";
  });

  $effect(() => {
    revision;
    retry;
    const target = endpoint;
    if (!target || stale) return;
    const request = new AbortController();
    void inbox.refresh(target);
    void refreshPlans(target, request.signal);
    return () => request.abort();
  });

  function failureLabel(item: DesktopHomeNotification): string {
    switch (item.payload.detailCode) {
      case "model_auth": return copy.handoverDetailModelAuth;
      case "model_missing": return copy.handoverDetailModelMissing;
      case "account_balance": return copy.handoverDetailAccountBalance;
      case "run_budget": return copy.handoverDetailRunBudget;
      default: return failureText(item);
    }
  }

  function togglePreview(item: DesktopHomeNotification): void {
    expandedId = expandedId === item.id ? "" : item.id;
  }

  function canPreview(item: DesktopHomeNotification): boolean {
    return (
      (item.type === "task-result" || item.type === "task-failed") &&
      Boolean(executionId(item))
    );
  }

  async function openConversation(item: DesktopHomeNotification, sessionId = itemSessionId(item)) {
    if (!sessionId || stale) return;
    const target = endpoint;
    const opened = await onOpen?.({
      sessionId,
      channel: payloadText(item, "channel") || undefined,
      title: notificationTitle(item, zh),
      agentId: item.botId || undefined,
    });
    if (opened) await inbox.commitRead(target, item);
  }

  function openAction(
    item: DesktopHomeNotification,
    live?: DesktopHandoverPending,
  ): void {
    void onOpen?.(resolveActionOpenTarget(item, live));
  }

  function openPlanAndRead(item: DesktopHomeNotification): void {
    void inbox.commitRead(endpoint, item);
    onPlans(payloadText(item, "planId") || item.refId || undefined);
  }

  function openFilesAndRead(item: DesktopHomeNotification): void {
    void inbox.commitRead(endpoint, item);
    onFiles();
  }

  async function openCrossChannel(
    item: DesktopHomeNotification,
  ): Promise<void> {
    if (!stale) await inbox.commitRead(endpoint, item);
    onHistory?.();
  }

  function memoryEntryLabel(): string {
    const parts: string[] = [];
    if (memoryPendingCount > 0) {
      const suffix = memoryReview?.hasMore && memoryReview.pendingReviewCount === undefined ? "+" : "";
      parts.push(
        zh
          ? `${memoryPendingCount}${suffix} 条新记忆等你确认`
          : `${memoryPendingCount}${suffix} new memories to review`,
      );
    }
    if (skillDraftCount > 0) {
      const suffix = memoryReview?.skillDraftHasMore ? "+" : "";
      parts.push(
        zh
          ? `${skillDraftCount}${suffix} 份技能草稿待审核`
          : `${skillDraftCount}${suffix} skill drafts to review`,
      );
    }
    return parts.join(" · ");
  }
</script>

{#if !$inbox.loading && hasAnyContent}
  <section
    class="agent-home-feed"
    aria-label={zh ? "待处理与新成果" : "Updates"}
  >
    {#if $inbox.loadError || plansError}
      <p class="agent-home-handover-stale" role="alert">
        {zh ? "动态读取失败" : "Could not load updates."}
        <Button variant="text" disabled={stale} onclick={() => retry++}
          >{zh ? "重试" : "Retry"}</Button
        >
      </p>
    {/if}

    {#if $inbox.writeError}
      <p class="agent-home-handover-stale" role="alert">
        {zh ? "未能标为已读，请重试。" : "Could not mark the update as read. Try again."}
      </p>
    {/if}

    {#if actionItems.length}
      <div class="agent-home-band agent-home-band--action">
        <div class="agent-home-band-head">
          <h2 class="agent-home-band-label">
            {zh ? "需要你拍板" : "Needs your decision"}
          </h2>
          <span class="agent-home-band-count">{actionItems.length}</span>
        </div>

        <div class="agent-home-work-grid">
          {#each actionItems as item (item.id)}
            {@const live = liveItem(item)}
            {@const isBusy = Boolean(live && busyId === live.id)}
            <article
              class="agent-home-work-card agent-home-work-card--action"
              data-type={item.type}
              data-testid="handover-pending-card"
            >
              <div class="agent-home-work-head">
                {#if actionOpens(item)}
                  <button
                    class="agent-home-work-title"
                    type="button"
                    disabled={stale}
                    onclick={() => openAction(item, live)}
                    >{notificationTitle(item, zh)}</button
                  >
                {:else}
                  <span class="agent-home-work-title-static"
                    >{notificationTitle(item, zh)}</span
                  >
                {/if}
                <time datetime={displayTime(item)}
                  >{formatTime(displayTime(item))}</time
                >
              </div>

              {#if payloadText(item, "detail")}
                {#if item.payload.kind === "approval"}
                  <pre class="agent-home-cmd agent-home-cmd--visible">{payloadText(item, "detail")}</pre>
                {:else}
                  <p class="agent-home-work-summary-line">
                    {payloadText(item, "detail")}
                  </p>
                {/if}
              {/if}

              <div class="agent-home-work-actions">
                {#if live?.kind === "approval" && live.actionable && live.requestId}
                  <Button
                    variant="primary"
                    disabled={stale || Boolean(busyId)}
                    onclick={() => onResolve?.([live], "approve_once")}
                    >{isBusy
                      ? zh
                        ? "处理中…"
                        : "Working…"
                      : copy.handoverApproveOnce}</Button
                  >
                  <Button
                    disabled={stale || Boolean(busyId)}
                    onclick={() => onResolve?.([live], "reject")}
                    >{copy.handoverReject}</Button
                  >
                {:else if live?.kind === "decision"}
                  {#each live.options ?? [] as option (option)}
                    <Button
                      disabled={stale || Boolean(busyId)}
                      onclick={() => onAnswer?.(live, option)}
                      >{isBusy
                        ? zh
                          ? "处理中…"
                          : "Working…"
                        : optionLabel(option)}</Button
                    >
                  {/each}
                {:else if live?.kind === "plan"}
                  <Button
                    variant="primary"
                    disabled={stale || Boolean(busyId)}
                    onclick={() => onPlan?.(live, "accept_edits")}
                    >{isBusy
                      ? zh
                        ? "启动中…"
                        : "Starting…"
                      : copy.handoverAcceptEditsMode}</Button
                  >
                  <Button
                    disabled={stale || Boolean(busyId)}
                    onclick={() => onPlan?.(live, "manual")}
                    >{copy.handoverManualMode}</Button
                  >
                  {#if actionOpens(item)}
                    <Button
                      variant="text"
                      disabled={stale}
                      onclick={() => openAction(item, live)}
                      >{zh ? "先看计划" : "Review plan"}</Button
                    >
                  {/if}
                {:else if live || actionOpens(item)}
                  <Button
                    variant="text"
                    disabled={stale}
                    onclick={() => openAction(item, live)}
                    >{zh ? "去处理" : "Open"}</Button
                  >
                {/if}
              </div>
            </article>
          {/each}
        </div>
      </div>
    {/if}

    {#if hasReadySection}
      <div class="agent-home-band agent-home-work">
        <div class="agent-home-band-head">
          <h2 class="agent-home-band-label">
            {zh ? "刚为你准备好" : "Ready for you"}
          </h2>
          <div class="agent-home-band-actions">
            {#if onNotifications}
              <Button
                variant="icon"
                title={zh ? "通知中心" : "Notifications"}
                ariaLabel={zh ? "通知中心" : "Notifications"}
                onclick={onNotifications}
                ><Bell size={15} aria-hidden="true" /></Button
              >
            {/if}
            <Button variant="text" onclick={onTasks}
              >{zh ? "全部任务" : "All tasks"}</Button
            >
          </div>
        </div>

        <div class="agent-home-work-grid">
          {#if showMemoryEntry}
            <article class="agent-home-work-card agent-home-work-card--memory">
              <div class="agent-home-work-head">
                <button
                  type="button"
                  class="agent-home-work-title agent-home-memory-link"
                  onclick={onOpenMemory}
                >
                  <Notebook size={15} aria-hidden="true" />
                  <span>{memoryEntryLabel()}</span>
                </button>
                <Button variant="text" onclick={onOpenMemory}
                  >{zh ? "去记忆中心" : "Open Memory Center"}<ArrowRight
                    size={13}
                    aria-hidden="true"
                  /></Button
                >
              </div>
            </article>
          {/if}

          {#each readyItems as item (item.id)}
            {@const sessionId = itemSessionId(item)}
            {@const previewable = canPreview(item)}
            <article
              class="agent-home-work-card"
              data-type={item.type}
              data-expanded={expandedId === item.id}
              data-testid={item.type === "cross-channel"
                ? "handover-cross-channel"
                : undefined}
            >
              <div class="agent-home-work-head">
                {#if item.type === "plan-completed"}
                  <button
                    class="agent-home-work-title"
                    type="button"
                    disabled={stale}
                    onclick={() => openPlanAndRead(item)}
                    >{notificationTitle(item, zh)}</button
                  >
                {:else if item.type === "materials"}
                  <button
                    class="agent-home-work-title"
                    type="button"
                    disabled={stale}
                    onclick={() => openFilesAndRead(item)}
                    >{notificationTitle(item, zh)}</button
                  >
                {:else if item.type === "cross-channel"}
                  <button
                    class="agent-home-work-title"
                    type="button"
                    disabled={stale}
                    onclick={() => void openCrossChannel(item)}
                    >{notificationTitle(item, zh)}</button
                  >
                {:else if sessionId}
                  <button
                    class="agent-home-work-title"
                    type="button"
                    disabled={stale}
                    onclick={() => openConversation(item)}
                    >{notificationTitle(item, zh)}</button
                  >
                {:else if previewable}
                  <button
                    class="agent-home-work-title"
                    type="button"
                    disabled={stale}
                    onclick={() => togglePreview(item)}
                    >{notificationTitle(item, zh)}</button
                  >
                {:else}
                  <span class="agent-home-work-title-static"
                    >{notificationTitle(item, zh)}</span
                  >
                {/if}
                <time datetime={displayTime(item)}
                  >{formatTime(displayTime(item))}</time
                >
              </div>

              {#if item.type === "materials" && payloadList(item, "createdFiles").length}
                <div class="agent-home-work-summary">
                  {#each payloadList(item, "createdFiles").slice(0, 3) as file}
                    <p class="agent-home-work-summary-line">{file}</p>
                  {/each}
                </div>
              {/if}

              {#if item.type === "task-failed" && failureLabel(item)}
                <p class="agent-home-handover-stale">{failureLabel(item)}</p>
              {/if}

              <div class="agent-home-work-actions">
                {#if item.type === "task-result" || item.type === "plan-completed"}
                  <span class="agent-home-stamp" data-testid="home-stamp"><Check size={12} aria-hidden="true" />{copy.homeStampDone}</span>
                {/if}
                {#if item.type === "plan-completed"}
                  <Button
                    variant="text"
                    disabled={stale}
                    onclick={() => openPlanAndRead(item)}
                    >{zh ? "查看计划" : "View plan"}</Button
                  >
                {:else if item.type === "materials"}
                  <Button
                    variant="text"
                    disabled={stale}
                    onclick={() => openFilesAndRead(item)}
                    >{zh ? "打开文件" : "Open files"}</Button
                  >
                {:else if item.type === "cross-channel"}
                  {#if payloadList(item, "channels").length}
                    <span
                      class="agent-home-signal-platforms"
                      aria-hidden="true"
                      >{#each payloadList(item, "channels") as channel}{#if CHANNEL_LOGOS[channel]}<img
                            src={CHANNEL_LOGOS[channel]}
                            alt=""
                            width="16"
                            height="16"
                          />{/if}{/each}</span
                    >
                  {/if}
                  <Button
                    variant="text"
                    disabled={stale}
                    onclick={() => void openCrossChannel(item)}
                    >{zh ? "查看对话" : "Open history"}</Button
                  >
                {:else}
                  {#if previewable}
                    <Button
                      variant="text"
                      disabled={stale}
                      aria-expanded={expandedId === item.id}
                      onclick={() => togglePreview(item)}
                      >{expandedId === item.id
                        ? zh
                          ? "收起预览"
                          : "Hide preview"
                        : zh
                          ? "快速预览"
                          : "Quick preview"}</Button
                    >
                  {/if}
                  {#if sessionId}
                    <Button
                      variant="text"
                      disabled={stale}
                      onclick={() => openConversation(item)}
                      >{zh ? "接着聊" : "Continue chat"}</Button
                    >
                  {/if}
                {/if}
                <Button
                  variant="text"
                  disabled={stale}
                  onclick={() => {
                    if (expandedId === item.id) expandedId = "";
                    inbox.dismiss(endpoint, item);
                  }}
                  >{zh ? "收起" : "Dismiss"}</Button
                >
              </div>

              {#if expandedId === item.id && previewable}
                {#key `${endpoint}:${item.id}:${executionId(item)}`}
                  <HomeTaskResult
                    {endpoint}
                    taskId={typeof item.payload.taskId === "string"
                      ? item.payload.taskId
                      : ""}
                    executionId={executionId(item)}
                    {locale}
                    {stale}
                    {copy}
                    {onFiles}
                    {onResultFile}
                    onContinueChat={(sid) => void openConversation(item, sid)}
                    onClose={() => {
                      expandedId = "";
                    }}
                  />
                {/key}
              {/if}
            </article>
          {/each}

          {#each visiblePlans.slice(0, 3) as plan (plan.planId)}
            <article class="agent-home-work-card" data-state={plan.status}>
              <div class="agent-home-work-head">
                <button
                  class="agent-home-work-title"
                  type="button"
                  onclick={() => onPlans(plan.planId)}>{plan.title}</button
                >
                <span class="agent-home-meta"
                  >{friendlyPlanStatus(plan.status)} · {plan.progress
                    .completed}/{plan.progress.total}</span
                >
              </div>
              {#if plan.progress.currentStepTitle}
                <p class="agent-home-work-summary-line">
                  {plan.progress.currentStepTitle}
                </p>
              {/if}
            </article>
          {/each}
        </div>

        {#if visiblePlans.length > 3}
          <Button variant="text" onclick={() => onPlans()}
            >{zh ? "查看全部计划" : "View all plans"}</Button
          >
        {/if}
      </div>
    {/if}

    {#if $inbox.undoItems.length}
      <div class="agent-home-undo-stack">
        {#each $inbox.undoItems as item (item.id)}
          <div class="agent-home-undo-bar">
            <span role="status">{zh ? "已收起" : "Dismissed"} · {notificationTitle(item, zh)}</span>
            <Button variant="text" onclick={() => inbox.undo(item.id)}
              >{zh ? "撤销" : "Undo"}</Button
            >
          </div>
        {/each}
      </div>
    {/if}
  </section>
{/if}
