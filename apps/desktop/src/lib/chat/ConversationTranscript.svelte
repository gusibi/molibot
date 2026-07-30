<script lang="ts">
  import type { Translation } from "../i18n";
  import { renderMarkdown } from "../markdown";
  import { finalizeTranscriptActivities, transcriptDisplayContent, type TranscriptAttachmentActions, type TranscriptMessage, type TranscriptMessageActions } from "./transcript";
  import TranscriptAttachments from "./TranscriptAttachments.svelte";
  import RunActivity from "./RunActivity.svelte";
  import ThinkingCard from "./ThinkingCard.svelte";
  import { classifyComposerInvocation } from "./composerSuggestions.svelte";
  import { humanizeModelOption } from "../presentation";
  import { invoke } from "@tauri-apps/api/core";
  import { externalHttpUrlFromClick } from "./markdownLinks";

  export let messages: TranscriptMessage[];
  export let copy: Translation;
  export let formatTime: (value: string) => string;
  export let assistantName: string = copy.appName;
  export let searchMatchIds: string[] = [];
  export let activeMatchId = "";
  export let showReadReceipt = false;
  export let attachmentActions: TranscriptAttachmentActions | null = null;
  export let messageActions: TranscriptMessageActions | null = null;

  let expandedMessages = new Set<string>();

  function messageKey(message: TranscriptMessage, index: number): string {
    return message.id ?? `${index}-${message.role}`;
  }

  function toggleMessage(key: string): void {
    const next = new Set(expandedMessages);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    expandedMessages = next;
  }

  async function copyCode(event: MouseEvent): Promise<void> {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-copy-code]");
    if (!button) return;
    const code = button.closest(".code-block")?.querySelector("code")?.textContent ?? "";
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      button.textContent = copy.copied;
      window.setTimeout(() => { if (button.isConnected) button.textContent = copy.copyCode; }, 1200);
    } catch { /* clipboard unavailable */ }
  }

  async function handleMarkdownClick(event: MouseEvent): Promise<void> {
    const url = externalHttpUrlFromClick(event);
    if (url) {
      if ("__TAURI_INTERNALS__" in window) await invoke("open_external_url", { url });
      else window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    await copyCode(event);
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
  {@const assistantStatus = message.role === "assistant" && message.stopReason === "error"
    ? "error"
    : message.role === "assistant" && message.stopReason === "stop"
      ? "complete"
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
            <div class="invocation-kicker"><i class={`ph ${invocation.kind === "command" ? "ph-terminal-window" : "ph-sparkle"}`} aria-hidden="true"></i><span>{invocation.kind === "command" ? "COMMAND" : "SKILL"}</span><code>{invocation.token}</code></div>
            {#if displayContent.slice(invocation.token.length).trim()}<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions --><div class="markdown-body" onclick={handleMarkdownClick}>{@html renderMarkdown(displayContent.slice(invocation.token.length).trim(), copy.copyCode)}</div>{/if}
          </div>
        {:else}
          <div class="user-message-shell">
            <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
            <div class:collapsed={isLongUserMessage && !isExpanded} class="message-bubble markdown-body user-message-content" onclick={handleMarkdownClick}>{@html renderMarkdown(displayContent, copy.copyCode)}</div>
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
        <TranscriptAttachments attachments={message.attachments} {copy} actions={attachmentActions} />
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
          {#if assistantStatus}<span class={`assistant-status ${assistantStatus}`}><i class={`ph ${assistantStatus === "error" ? "ph-warning-circle" : "ph-check-circle"}`} aria-hidden="true"></i>{assistantStatus === "error" ? copy.assistantStatusError : copy.assistantStatusComplete}</span>{/if}
        </div>
        {#if message.thinking}
          <ThinkingCard text={message.thinking} label={copy.thinking} />
        {/if}
        {#if message.activities?.length}<RunActivity activities={finalizeTranscriptActivities(message.activities) ?? []} {copy} />{/if}
        {#if displayContent}<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions --><div class="message-bubble markdown-body" onclick={handleMarkdownClick}>{@html renderMarkdown(displayContent, copy.copyCode)}</div>{/if}
        {#if (canShowActions && messageActions) || message.createdAt || message.model}
          <div class="message-meta assistant-meta">
            {#if message.createdAt}<time class="message-time">{formatTime(message.createdAt)}</time>{/if}
            {#if message.model}<details class="message-model technical-detail"><summary><i class="ph ph-cpu" aria-hidden="true"></i>{humanizeModelOption(message.model, message.model).label}</summary><code>{message.model}</code></details>{/if}
            {#if message.memoryTrace && messageActions?.onOpenMemoryTrace}
              <button
                type="button"
                class="message-memory-trace"
                onclick={() => messageActions.onOpenMemoryTrace!(message.memoryTrace!.traceId)}
              >
                <i class="ph ph-brain" aria-hidden="true"></i>
                {#if message.memoryTrace.injectedCount > 0}{copy.memoryTraceReferenced.replace("{count}", String(message.memoryTrace.injectedCount))}{/if}
                {#if message.memoryTrace.injectedCount > 0 && message.memoryTrace.writeCount > 0}<span aria-hidden="true">·</span>{/if}
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
              </div>
            {/if}
          </div>
        {/if}
        {#if message.attachments?.length}
          <TranscriptAttachments attachments={message.attachments} {copy} actions={attachmentActions} />
        {/if}
        </div>
      </div>
    {/if}
  </article>
{/each}
