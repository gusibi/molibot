<script lang="ts">
  import type { Translation } from "../i18n";
  import { renderMarkdown } from "../markdown";
  import { finalizeTranscriptActivities, transcriptDisplayContent, type TranscriptAttachmentActions, type TranscriptContributionAction, type TranscriptMessage, type TranscriptMessageActions } from "./transcript";
  import TranscriptAttachments from "./TranscriptAttachments.svelte";
  import RunActivity from "./RunActivity.svelte";
  import ThinkingCard from "./ThinkingCard.svelte";
  import { classifyComposerInvocation } from "./composerSuggestions.svelte";
  import { humanizeModelOption } from "../presentation";
  import { handleMarkdownBodyClick } from "../markdownInteractions";
  import OverflowMenu from "../components/ui/OverflowMenu.svelte";
  import FileContextMenu from "../projects/FileContextMenu.svelte";

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
  {@const canShowActions = Boolean(messageActions && (displayContent || message.attachments?.length))}
  {@const isCopied = Boolean(message.id && messageActions?.copiedId === message.id)}
  {@const isEditing = Boolean(message.id && messageActions?.editingId === message.id)}
  {@const isForking = Boolean(message.id && messageActions?.forkingId === message.id)}
  {@const key = messageKey(message, index)}
  {@const isLongUserMessage = message.role === "user" && (displayContent.split(/\r?\n/).length > 20 || displayContent.length > 1000)}
  {@const isExpanded = expandedMessages.has(key)}
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
          <div class="message-bubble invocation-message" data-kind={invocation.kind}>
            <div class="invocation-kicker"><i class={`ph ${invocation.kind === "command" ? "ph-terminal-window" : invocation.kind === "skill" ? "ph-sparkle" : "ph-squares-four"}`} aria-hidden="true"></i><span>{invocation.kind === "command" ? "COMMAND" : invocation.kind === "skill" ? "SKILL" : "MINI APP"}</span><code>{invocation.token}</code></div>
            {#if displayContent.slice(invocation.token.length).trim()}<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions --><div class="markdown-body" onclick={handleMarkdownClick}>{@html renderMarkdown(displayContent.slice(invocation.token.length).trim(), copy.copyCode, markdownOptions)}</div>{/if}
          </div>
        {:else}
          <div class="user-message-shell">
            <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
            <div class:collapsed={isLongUserMessage && !isExpanded} class="message-bubble markdown-body user-message-content" onclick={handleMarkdownClick} oncontextmenu={(event) => openSelectionMenu(event, message)}>{@html renderMarkdown(displayContent, copy.copyCode, markdownOptions)}</div>
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
              ><i class={`ph ${isCopied ? "ph-check" : "ph-copy"}`} aria-hidden="true"></i></button>
              {#if messageActions.onEditUser && !(message.id?.startsWith("pending-"))}
                <button
                  type="button"
                  class="message-action"
                  aria-label={copy.editMessage}
                  title={copy.editMessage}
                  aria-pressed={isEditing}
                  disabled={isEditing}
                  onclick={() => messageActions.onEditUser!(message)}
                ><i class="ph ph-pencil-simple-line" aria-hidden="true"></i></button>
              {/if}
              {#if messageActions.onForkUser && !(message.id?.startsWith("pending-"))}
                <button
                  type="button"
                  class="message-action"
                  aria-label={copy.forkMessage}
                  title={copy.forkMessage}
                  disabled={isForking}
                  onclick={() => messageActions.onForkUser!(message)}
                ><i class={`ph ${isForking ? "ph-circle-notch message-action-spin" : "ph-git-branch"}`} aria-hidden="true"></i></button>
              {/if}
              <!-- Same menu as the assistant row: a message worth saving is
                   worth saving whoever wrote it, and two different action rows
                   for one concept is the fork this component exists to avoid. -->
              {#if textContributions.length && messageActions.onRunContribution}
                {@const busy = textContributions.some((action) => messageActions?.pendingContributionKey === contributionKey(message, action))}
                {@const done = textContributions.some((action) => messageActions?.successfulContributionKey === contributionKey(message, action))}
                <OverflowMenu label={copy.miniAppMessageActionsMenu}>
                  <svelte:fragment slot="trigger">
                    <i
                      class={`ph ${busy ? "ph-circle-notch message-action-spin" : done ? "ph-check" : "ph-dots-three"}`}
                      aria-hidden="true"
                    ></i>
                  </svelte:fragment>
                  {#each textContributions as action (action.id)}
                    {@const actionKey = contributionKey(message, action)}
                    {@const pending = messageActions.pendingContributionKey === actionKey}
                    <button type="button" role="menuitem" disabled={pending} onclick={(event) => runContribution(event, action, message)}>
                      <i class={`ph ${pending ? "ph-circle-notch message-action-spin" : `ph-${action.icon || "paper-plane-tilt"}`}`} aria-hidden="true"></i>
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
              {#if showReadReceipt}<i class="ph ph-checks message-read" aria-hidden="true"></i>{/if}
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
        <img class="assistant-avatar" src="/molibot-icon.png" alt="" />
        <div class="message-stack">
        <div class="assistant-identity">
          <strong>{assistantName}</strong>
          <span>{copy.agentRole}</span>
          {#if assistantStatus}<span class={`assistant-status ${assistantStatus}`}><i class={`ph ${assistantStatus === "error" ? "ph-warning-circle" : assistantStatus === "aborted" ? "ph-stop-circle" : "ph-check-circle"}`} aria-hidden="true"></i>{assistantStatus === "error" ? copy.assistantStatusError : assistantStatus === "aborted" ? copy.assistantStatusAborted : copy.assistantStatusComplete}</span>{/if}
        </div>
        {#if message.thinking}
          <ThinkingCard text={message.thinking} label={copy.thinking} />
        {/if}
        {#if message.activities?.length}<RunActivity activities={finalizeTranscriptActivities(message.activities) ?? []} {copy} onOpenPath={onOpenActivityPath} />{/if}
        {#if displayContent}<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions --><div class="message-bubble markdown-body" onclick={handleMarkdownClick} oncontextmenu={(event) => openSelectionMenu(event, message)}>{@html renderMarkdown(displayContent, copy.copyCode, markdownOptions)}</div>{/if}
        {#if assistantError}
          <div class="assistant-error-note"><i class="ph ph-warning-circle" aria-hidden="true"></i><span class="assistant-error-label">{copy.assistantErrorLabel}</span><span class="assistant-error-text">{assistantError}</span></div>
        {/if}
        {#if (canShowActions && messageActions) || message.createdAt || message.model}
          <div class="message-meta assistant-meta">
            {#if message.createdAt}<time class="message-time">{formatTime(message.createdAt)}</time>{/if}
            {#if message.model}<details class="message-model technical-detail"><summary><i class="ph ph-cpu" aria-hidden="true"></i>{humanizeModelOption(message.model, message.model).label}</summary><code>{message.model}</code></details>{/if}
            <!-- Only truly-used memories earn a chip: referenced (cited or
                 tool-retrieved) and writes. Injected-but-unused memories stay
                 out of the message meta so every reply no longer carries the
                 same misleading association. -->
            {#if message.memoryTrace && messageActions?.onOpenMemoryTrace && ((message.memoryTrace.referencedCount ?? 0) > 0 || message.memoryTrace.writeCount > 0)}
              <button
                type="button"
                class="message-memory-trace"
                onclick={() => messageActions.onOpenMemoryTrace!(message.memoryTrace!.traceId)}
              >
                <i class="ph ph-brain" aria-hidden="true"></i>
                {#if (message.memoryTrace.referencedCount ?? 0) > 0}{copy.memoryTraceReferenced.replace("{count}", String(message.memoryTrace.referencedCount))}{/if}
                {#if (message.memoryTrace.referencedCount ?? 0) > 0 && message.memoryTrace.writeCount > 0}<span aria-hidden="true">·</span>{/if}
                {#if message.memoryTrace.writeCount > 0}{copy.memoryTraceStored.replace("{count}", String(message.memoryTrace.writeCount))}{/if}
              </button>
            {/if}
            {#if canShowActions && messageActions}
              <div class="message-actions">
                <button
                  type="button"
                  class="message-action"
                  aria-label={copy.copyMessage}
                  title={copy.copyMessage}
                  onclick={() => messageActions.onCopy(message)}
                ><i class={`ph ${isCopied ? "ph-check" : "ph-copy"}`} aria-hidden="true"></i></button>
                <!--
                  Always a menu, never loose icons. Two reasons: the action row
                  sits next to copy/edit/fork, and an unlabelled app glyph there
                  is unreadable — "what does the bookmark do?" — while the menu
                  affords a real label per app. And the row's width stops
                  depending on how many apps are installed, so it cannot grow
                  into the timestamp as the owner adds them.
                -->
                {#if textContributions.length && messageActions.onRunContribution}
                  {@const busy = textContributions.some((action) => messageActions?.pendingContributionKey === contributionKey(message, action))}
                  {@const done = textContributions.some((action) => messageActions?.successfulContributionKey === contributionKey(message, action))}
                  <OverflowMenu label={copy.miniAppMessageActionsMenu}>
                    <svelte:fragment slot="trigger">
                      <!-- The trigger carries the outcome, because the menu has
                           closed by the time the call settles. -->
                      <i
                        class={`ph ${busy ? "ph-circle-notch message-action-spin" : done ? "ph-check" : "ph-dots-three"}`}
                        aria-hidden="true"
                      ></i>
                    </svelte:fragment>
                    {#each textContributions as action (action.id)}
                      {@const actionKey = contributionKey(message, action)}
                      {@const pending = messageActions.pendingContributionKey === actionKey}
                      <button type="button" role="menuitem" disabled={pending} onclick={(event) => runContribution(event, action, message)}>
                        <i class={`ph ${pending ? "ph-circle-notch message-action-spin" : `ph-${action.icon || "paper-plane-tilt"}`}`} aria-hidden="true"></i>
                        <span>{action.label}</span>
                      </button>
                    {/each}
                  </OverflowMenu>
                {/if}
              </div>
            {/if}
          </div>
        {/if}
        {#if message.attachments?.length}
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
      .map((action) => ({ id: action.id, label: action.label, icon: `ph-${action.icon || "paper-plane-tilt"}` }))}
    onSelect={(id) => {
      const action = messageActions?.contributions?.find((candidate) => candidate.id === id);
      if (action && selectionMenu) messageActions?.onRunContribution?.(action, selectionMenu.message, selectionMenu.selection);
    }}
    onClose={() => (selectionMenu = null)}
  />
{/if}
