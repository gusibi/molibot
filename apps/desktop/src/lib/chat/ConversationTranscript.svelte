<script lang="ts">
  import BranchUp from "reicon-svelte/icons/BranchUp";
  import Check from "reicon-svelte/icons/Check";
  import CheckRead from "reicon-svelte/icons/CheckRead";
  import CheckCircle from "reicon-svelte/icons/CheckCircle";
  import Copy from "reicon-svelte/icons/Copy";
  import Cpu from "reicon-svelte/icons/Cpu";
  import Database from "reicon-svelte/icons/Database";
  import Loader from "reicon-svelte/icons/Loader";
  import More from "reicon-svelte/icons/More";
  import PenLine from "reicon-svelte/icons/PenLine";
  import StopCircle from "reicon-svelte/icons/StopCircle";
  import Timer from "reicon-svelte/icons/Timer";
  import TriangleWarning from "reicon-svelte/icons/TriangleWarning";
  import { contributionIcon, INVOCATION_ICONS } from "./activityIcons";
  import type { Translation } from "../i18n";
  import { renderMarkdown } from "../markdown";
  import { finalizeTranscriptActivities, transcriptCompletedTurnSections, transcriptDisplayContent, transcriptRenderBlocks, transcriptTurnSummary, type TranscriptAttachmentActions, type TranscriptContributionAction, type TranscriptMessage, type TranscriptMessageActions } from "./transcript";
  import TranscriptAttachments from "./TranscriptAttachments.svelte";
  import RunActivity from "./RunActivity.svelte";
  import ThinkingCard from "./ThinkingCard.svelte";
  import PlanCard from "./PlanCard.svelte";
  import TurnProcess from "./TurnProcess.svelte";
  import { classifyComposerInvocation } from "./composerSuggestions.svelte";
  import { formatCompactTokens, formatDuration, humanizeModelOption, modelShortLabel } from "../presentation";
  import { handleMarkdownBodyClick } from "../markdownInteractions";
  import OverflowMenu from "../components/ui/OverflowMenu.svelte";
  import FileContextMenu from "../projects/FileContextMenu.svelte";
  import ChatMarkdown from "./ChatMarkdown.svelte";
  import TurnFilesCard from "./TurnFilesCard.svelte";
  import { collectTurnFiles, type TurnFileItem } from "./turnFiles";

  function findPreviousUserMessage(list: TranscriptMessage[], currentIndex: number): TranscriptMessage | null {
    for (let i = currentIndex - 1; i >= 0; i -= 1) {
      if (list[i]?.role === "user") return list[i];
    }
    return null;
  }

  export let messages: TranscriptMessage[];
  export let copy: Translation;
  export let formatTime: (value: string) => string;
  export let assistantName: string = copy.appName;
  export let searchMatchIds: string[] = [];
  export let activeMatchId = "";
  export let showReadReceipt = false;
  export let attachmentActions: TranscriptAttachmentActions | null = null;
  export let messageActions: TranscriptMessageActions | null = null;
  /** Opens a path a tool touched in the Artifact Panel; injected by the host. */
  export let onOpenActivityPath: ((path: string, mutates: boolean) => void) | null = null;
  export let onOpenTurnFiles: ((files: TurnFileItem[], selectedKey?: string) => void) | null = null;
  export let endpoint = "";

  let expandedMessages = new Set<string>();
  let selectionMenu: { x: number; y: number; message: TranscriptMessage; selection: string } | null = null;

  // Controls the renderer emits into every code block. Declared once so the
  // cache key stays stable across renders of the same message.
  $: markdownOptions = { labels: { wrapLines: copy.wrapLines } };

  function messageKey(message: TranscriptMessage, index: number): string {
    return message.id ?? `${index}-${message.role}`;
  }

  function toggleMessage(key: string): void {
    const next = new Set(expandedMessages);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    expandedMessages = next;
  }

  // External links and code-block copy buttons behave identically wherever
  // `renderMarkdown` output is mounted; the Artifact Panel's Markdown viewer
  // shares this handler.
  async function handleMarkdownClick(event: MouseEvent): Promise<void> {
    await handleMarkdownBodyClick(event, copy);
  }

  function contributionKey(message: TranscriptMessage, action: TranscriptContributionAction): string {
    return `${message.id ?? message.content}:${action.id}`;
  }

  function selectedTextInMessage(event: MouseEvent): string | undefined {
    const article = (event.currentTarget as HTMLElement).closest<HTMLElement>(".message-row");
    const selection = window.getSelection();
    if (!article || !selection || selection.rangeCount === 0 || selection.isCollapsed) return undefined;
    const range = selection.getRangeAt(0);
    const container = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? range.commonAncestorContainer as Element
      : range.commonAncestorContainer.parentElement;
    if (!container || !article.contains(container)) return undefined;
    return selection.toString().trim() || undefined;
  }

  function runContribution(
    event: MouseEvent,
    action: TranscriptContributionAction,
    message: TranscriptMessage
  ): void {
    messageActions?.onRunContribution?.(action, message, selectedTextInMessage(event));
  }

  /**
   * Right-click inside a message with text selected: offer the same Mini App
   * actions, scoped to the selection.
   *
   * Deliberately not limited to one role. The interesting case is highlighting
   * a paragraph of an *assistant* reply and saving only that — a guard that let
   * this fire on user messages only made the common case dead. Falls through to
   * the browser's own context menu when nothing is selected or no app offers a
   * text action, so right-click never becomes a dead zone.
   */
  function openSelectionMenu(event: MouseEvent, message: TranscriptMessage): void {
    const selection = selectedTextInMessage(event);
    if (!selection || !messageActions?.contributions?.some((action) => action.accepts.includes("text"))) return;
    event.preventDefault();
    selectionMenu = { x: event.clientX, y: event.clientY, message, selection };
  }
</script>

{#each messages as message, index (message.id ?? `${index}-${message.role}`)}
  {@const displayContent = transcriptDisplayContent(message, copy.chatAssistantError)}
  {@const invocation = message.role === "user" ? classifyComposerInvocation(displayContent) : null}
  {@const canForkAssistant = Boolean(message.role === "assistant" && message.id && messageActions?.onForkAssistant && !message.id.startsWith("pending-"))}
  {@const canShowActions = Boolean(messageActions && (displayContent || message.attachments?.length || canForkAssistant))}
  {@const isCopied = Boolean(message.id && messageActions?.copiedId === message.id)}
  {@const isEditing = Boolean(message.id && messageActions?.editingId === message.id)}
  {@const isForking = Boolean(message.id && messageActions?.forkingId === message.id)}
  {@const key = messageKey(message, index)}
  {@const isLongUserMessage = message.role === "user" && (displayContent.split(/\r?\n/).length > 20 || displayContent.length > 1000)}
  {@const isExpanded = expandedMessages.has(key)}
  {@const renderBlocks = message.role === "assistant" ? transcriptRenderBlocks(message) : []}
  {@const turnSections = message.role === "assistant" ? transcriptCompletedTurnSections(renderBlocks) : { process: [], response: [] }}
  {@const previousUserMessage = message.role === "assistant" ? findPreviousUserMessage(messages, index) : null}
  {@const turnSummary = message.role === "assistant" ? transcriptTurnSummary(message, previousUserMessage) : null}
  {@const hasTurnSummary = Boolean(turnSummary && (turnSummary.durationMs || turnSummary.toolCount || turnSummary.fileCount || turnSummary.totalTokens))}
  {@const hasMemoryMeta = Boolean(message.memoryTrace && messageActions?.onOpenMemoryTrace && ((message.memoryTrace.referencedCount ?? 0) > 0 || message.memoryTrace.writeCount > 0))}
  {@const hasTechnicalDetails = hasTurnSummary || Boolean(message.model) || hasMemoryMeta}
  {@const textContributions = messageActions?.contributions?.filter((action) => action.accepts.includes("text")) ?? []}
  {@const assistantStatus = message.role !== "assistant"
    ? ""
    : message.stopReason === "error"
      ? "error"
      : message.stopReason === "aborted"
        ? "aborted"
        : message.stopReason === "stop"
          ? "complete"
          : ""}
  <!-- The error is status, never the body: a turn that answered and was then
       interrupted keeps its answer above and carries the reason underneath.
       Suppressed when the projection already had to use it as the body (a turn
       that produced no text at all), so it is never printed twice. -->
  {@const assistantError = message.role === "assistant"
    && message.errorMessage
    && message.errorMessage.trim() !== displayContent.trim()
    ? message.errorMessage
    : ""}
  {@const turnFiles = message.role === "assistant" ? collectTurnFiles(message, attachmentActions?.filesByLocal) : []}
  <article
    class:mine={message.role === "user"}
    class:assistant={message.role !== "user"}
    class:search-match={Boolean(message.id && searchMatchIds.includes(message.id))}
    class:search-active={message.id === activeMatchId}
    class:editing={isEditing}
    class:message-error={assistantStatus === "error"}
    class="message-row"
    data-message-id={message.id}
    data-navigation-id={message.role === "user" && message.id ? message.id : undefined}
  >
    {#if message.role === "user"}
      {#if displayContent}
        {#if invocation}
          {@const KickerIcon = INVOCATION_ICONS[invocation.kind]}
          <div class="message-bubble invocation-message" data-kind={invocation.kind}>
            <div class="invocation-kicker"><KickerIcon size={14} aria-hidden="true" /><span>{invocation.kind === "command" ? "COMMAND" : invocation.kind === "skill" ? "SKILL" : "MINI APP"}</span><code>{invocation.token}</code></div>
            {#if displayContent.slice(invocation.consumedLength).trim()}<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions --><div class="markdown-body" onclick={handleMarkdownClick}>{@html renderMarkdown(displayContent.slice(invocation.consumedLength).trim(), copy.copyCode, markdownOptions)}</div>{/if}
          </div>
        {:else}
          <div class="user-message-shell">
            <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
            <ChatMarkdown source={displayContent} {copy} {endpoint} className={`message-bubble markdown-body user-message-content${isLongUserMessage && !isExpanded ? " collapsed" : ""}`} onContextMenu={(event) => openSelectionMenu(event, message)} />
            {#if isLongUserMessage}
              <button class="message-expand" type="button" aria-expanded={isExpanded} onclick={() => toggleMessage(key)}>{isExpanded ? copy.collapseMessage : copy.expandMessage}</button>
            {/if}
          </div>
        {/if}
      {/if}
      {#if (canShowActions && messageActions) || message.createdAt}
        <div class="message-meta">
          {#if canShowActions && messageActions}
            <div class="message-actions">
              <button
                type="button"
                class="message-action"
                aria-label={copy.copyMessage}
                title={copy.copyMessage}
                onclick={() => messageActions.onCopy(message)}
              >{#if isCopied}<Check size={14} aria-hidden="true" />{:else}<Copy size={14} aria-hidden="true" />{/if}</button>
              {#if messageActions.onEditUser && !(message.id?.startsWith("pending-"))}
                <button
                  type="button"
                  class="message-action"
                  aria-label={copy.editMessage}
                  title={copy.editMessage}
                  aria-pressed={isEditing}
                  disabled={isEditing}
                  onclick={() => messageActions.onEditUser!(message)}
                ><PenLine size={14} aria-hidden="true" /></button>
              {/if}
              <!-- Same menu as the assistant row: a message worth saving is
                   worth saving whoever wrote it, and two different action rows
                   for one concept is the fork this component exists to avoid. -->
              {#if textContributions.length && messageActions.onRunContribution}
                {@const busy = textContributions.some((action) => messageActions?.pendingContributionKey === contributionKey(message, action))}
                {@const done = textContributions.some((action) => messageActions?.successfulContributionKey === contributionKey(message, action))}
                <OverflowMenu label={copy.miniAppMessageActionsMenu}>
                  <svelte:fragment slot="trigger">
                    <span aria-hidden="true">
                      {#if busy}<Loader class="message-action-spin" size={14} />{:else if done}<Check size={14} />{:else}<More size={14} />{/if}
                    </span>
                  </svelte:fragment>
                  {#each textContributions as action (action.id)}
                    {@const actionKey = contributionKey(message, action)}
                    {@const pending = messageActions.pendingContributionKey === actionKey}
                    <button type="button" role="menuitem" disabled={pending} onclick={(event) => runContribution(event, action, message)}>
                      {#if pending}<Loader class="message-action-spin" size={14} aria-hidden="true" />{:else}{@const ActionIcon = contributionIcon(action.icon)}<ActionIcon size={14} aria-hidden="true" />{/if}
                      <span>{action.label}</span>
                    </button>
                  {/each}
                </OverflowMenu>
              {/if}
            </div>
          {/if}
          {#if message.createdAt}
            <time class="message-time">
              {formatTime(message.createdAt)}
              {#if showReadReceipt}<CheckRead class="message-read" size={12} aria-hidden="true" />{/if}
            </time>
          {/if}
        </div>
      {/if}
      {#if message.attachments?.length}
        <TranscriptAttachments attachments={message.attachments} {message} {copy} actions={attachmentActions} />
      {/if}
      {#if message.thinking}
        <ThinkingCard text={message.thinking} label={copy.thinking} />
      {/if}
    {:else}
      <div class="assistant-layout">
        <img class="assistant-avatar" src="/molibot-icon.png" alt="" width="24" height="24" />
        <div class="message-stack">
        <div class="assistant-identity">
          <strong>{assistantName}</strong>
          <span>{copy.agentRole}</span>
          {#if assistantStatus}<span class={`assistant-status ${assistantStatus}`}>{#if assistantStatus === "error"}<TriangleWarning size={12} aria-hidden="true" />{:else if assistantStatus === "aborted"}<StopCircle size={12} aria-hidden="true" />{:else}<CheckCircle size={12} aria-hidden="true" />{/if}{assistantStatus === "error" ? copy.assistantStatusError : assistantStatus === "aborted" ? copy.assistantStatusAborted : copy.assistantStatusComplete}</span>{/if}
        </div>
        {#if turnSections.process.length}
          <TurnProcess
            blocks={turnSections.process}
            {copy}
            stateKey={`${key}:process`}
            onOpenPath={onOpenActivityPath}
            failed={assistantStatus === "error" || assistantStatus === "aborted"}
            {endpoint}
          />
        {/if}
        {#each turnSections.response as block (block.id)}
          {#if block.kind === "plan"}
            <PlanCard plan={block.plan} {copy} disabled={!messageActions?.onResolvePlan} onResolve={(decision, edits) => messageActions?.onResolvePlan?.(message, block.plan, decision, edits)} />
          {:else if block.kind === "thinking"}
            <ThinkingCard text={block.content} label={copy.thinking} />
          {:else if block.kind === "activities"}
            <RunActivity activities={finalizeTranscriptActivities(block.activities) ?? []} {copy} onOpenPath={onOpenActivityPath} failed={assistantStatus === "error" || assistantStatus === "aborted"} stateKey={`${key}:${block.id}`} />
          {:else if block.content}
            <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
            <ChatMarkdown source={block.content} {copy} {endpoint} contentKey={`${key}-${block.id}`} onContextMenu={(event) => openSelectionMenu(event, message)} />
          {/if}
        {/each}
        {#if assistantError}
          <div class="assistant-error-note"><TriangleWarning size={14} aria-hidden="true" /><span class="assistant-error-label">{copy.assistantErrorLabel}</span><span class="assistant-error-text">{assistantError}</span></div>
        {/if}
        {#if turnFiles.length && onOpenTurnFiles}
          <TurnFilesCard files={turnFiles} {copy} onOpen={onOpenTurnFiles} />
        {/if}
        {#if (canShowActions && messageActions) || message.createdAt || hasTechnicalDetails}
          <div class="message-meta assistant-meta">
            {#if message.createdAt}<time class="message-time">{formatTime(message.createdAt)}</time>{/if}
            {#if hasTechnicalDetails}
              <div class="message-meta-inline">
                {#if hasTurnSummary && turnSummary}
                  <span class="turn-summary" aria-label={copy.turnSummaryLabel}>
                    {#if turnSummary.durationMs}<span><Timer size={12} aria-hidden="true" />{formatDuration(turnSummary.durationMs)}</span>{/if}
                    {#if turnSummary.toolCount}<span>{copy.turnSummaryTools.replace("{count}", String(turnSummary.toolCount))}</span>{/if}
                    {#if turnSummary.fileCount}<span>{copy.turnSummaryFiles.replace("{count}", String(turnSummary.fileCount))}</span>{/if}
                    {#if turnSummary.totalTokens}<span>{copy.turnSummaryTokens.replace("{count}", formatCompactTokens(turnSummary.totalTokens))}</span>{/if}
                  </span>
                {/if}
                {#if message.model}<span class="message-model-inline"><Cpu size={12} aria-hidden="true" />{modelShortLabel(message.model)}</span>{/if}
                {#if hasMemoryMeta && message.memoryTrace && messageActions?.onOpenMemoryTrace}
                  <button type="button" class="message-memory-trace" onclick={() => messageActions.onOpenMemoryTrace!(message.memoryTrace!.traceId)}>
                    <Database size={12} aria-hidden="true" />
                    {#if (message.memoryTrace.referencedCount ?? 0) > 0}{copy.memoryTraceReferenced.replace("{count}", String(message.memoryTrace.referencedCount))}{/if}
                    {#if (message.memoryTrace.referencedCount ?? 0) > 0 && message.memoryTrace.writeCount > 0}<span aria-hidden="true">·</span>{/if}
                    {#if message.memoryTrace.writeCount > 0}{copy.memoryTraceStored.replace("{count}", String(message.memoryTrace.writeCount))}{/if}
                  </button>
                {/if}
              </div>
            {/if}
            {#if canShowActions && messageActions}
              <div class="message-actions">
                <button
                  type="button"
                  class="message-action"
                  aria-label={copy.copyMessage}
                  title={copy.copyMessage}
                  onclick={() => messageActions.onCopy(message)}
                >{#if isCopied}<Check size={14} aria-hidden="true" />{:else}<Copy size={14} aria-hidden="true" />{/if}</button>
                {#if canForkAssistant}
                  <button
                    type="button"
                    class="message-action"
                    aria-label={copy.forkMessage}
                    title={copy.forkMessage}
                    disabled={isForking}
                    onclick={() => messageActions.onForkAssistant!(message)}
                  >{#if isForking}<Loader class="message-action-spin" size={14} aria-hidden="true" />{:else}<BranchUp size={14} aria-hidden="true" />{/if}</button>
                {/if}
              </div>
            {/if}
            {#if hasTechnicalDetails || (textContributions.length && messageActions?.onRunContribution)}
              {@const busy = textContributions.some((action) => messageActions?.pendingContributionKey === contributionKey(message, action))}
              {@const done = textContributions.some((action) => messageActions?.successfulContributionKey === contributionKey(message, action))}
              <div class:assistant-overflow-details-only={!textContributions.length || !messageActions?.onRunContribution} class="assistant-overflow">
                <OverflowMenu label={copy.conversationMenu} placement="up" popoverRole="dialog" closeOnPointerLeave={true}>
                  <svelte:fragment slot="trigger">
                    <span aria-hidden="true">
                      {#if busy}<Loader class="message-action-spin" size={14} />{:else if done}<Check size={14} />{:else}<More size={14} />{/if}
                    </span>
                  </svelte:fragment>
                  {#if hasTechnicalDetails}<div class="message-meta-details">
                  {#if hasTurnSummary && turnSummary}
                    <div class="turn-summary" aria-label={copy.turnSummaryLabel}>
                      {#if turnSummary.durationMs}<span><Timer size={12} aria-hidden="true" />{formatDuration(turnSummary.durationMs)}</span>{/if}
                      {#if turnSummary.toolCount}<span>{copy.turnSummaryTools.replace("{count}", String(turnSummary.toolCount))}</span>{/if}
                      {#if turnSummary.fileCount}<span>{copy.turnSummaryFiles.replace("{count}", String(turnSummary.fileCount))}</span>{/if}
                      {#if turnSummary.totalTokens}<span>{copy.turnSummaryTokens.replace("{count}", formatCompactTokens(turnSummary.totalTokens))}</span>{/if}
                    </div>
                  {/if}
                  {#if message.model}<div class="message-model"><Cpu size={12} aria-hidden="true" /><span>{humanizeModelOption(message.model, message.model).label}</span><code>{message.model}</code></div>{/if}
                  <!-- Only truly-used memories earn a row: referenced (cited or
                       tool-retrieved) and writes. Injected-but-unused memories
                       stay out so every reply does not imply an association. -->
                  {#if hasMemoryMeta && message.memoryTrace && messageActions?.onOpenMemoryTrace}
                    <button
                      type="button"
                      class="message-memory-trace"
                      onclick={() => messageActions.onOpenMemoryTrace!(message.memoryTrace!.traceId)}
                    >
                      <Database size={12} aria-hidden="true" />
                      {#if (message.memoryTrace.referencedCount ?? 0) > 0}{copy.memoryTraceReferenced.replace("{count}", String(message.memoryTrace.referencedCount))}{/if}
                      {#if (message.memoryTrace.referencedCount ?? 0) > 0 && message.memoryTrace.writeCount > 0}<span aria-hidden="true">·</span>{/if}
                      {#if message.memoryTrace.writeCount > 0}{copy.memoryTraceStored.replace("{count}", String(message.memoryTrace.writeCount))}{/if}
                    </button>
                  {/if}
                  </div>{/if}
                  {#if textContributions.length && messageActions?.onRunContribution}
                    <div class="assistant-overflow-actions" aria-label={copy.miniAppMessageActionsMenu}>
                      {#each textContributions as action (action.id)}
                        {@const actionKey = contributionKey(message, action)}
                        {@const pending = messageActions.pendingContributionKey === actionKey}
                        <button type="button" disabled={pending} onclick={(event) => runContribution(event, action, message)}>
                          {#if pending}<Loader class="message-action-spin" size={14} aria-hidden="true" />{:else}{@const ActionIcon = contributionIcon(action.icon)}<ActionIcon size={14} aria-hidden="true" />{/if}
                          <span>{action.label}</span>
                        </button>
                      {/each}
                    </div>
                  {/if}
                </OverflowMenu>
              </div>
            {/if}
          </div>
        {/if}
        {#if message.attachments?.length && (!turnFiles.length || !onOpenTurnFiles)}
          <TranscriptAttachments attachments={message.attachments} {message} {copy} actions={attachmentActions} />
        {/if}
        </div>
      </div>
    {/if}
  </article>
{/each}

{#if selectionMenu && messageActions?.contributions}
  <FileContextMenu
    x={selectionMenu.x}
    y={selectionMenu.y}
    items={messageActions.contributions
      .filter((action) => action.accepts.includes("text"))
      .map((action) => ({ id: action.id, label: action.label, icon: contributionIcon(action.icon) }))}
    onSelect={(id) => {
      const action = messageActions?.contributions?.find((candidate) => candidate.id === id);
      if (action && selectionMenu) messageActions?.onRunContribution?.(action, selectionMenu.message, selectionMenu.selection);
    }}
    onClose={() => (selectionMenu = null)}
  />
{/if}
