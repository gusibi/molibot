<script lang="ts">
  import type { Translation } from "../i18n";
  import { renderMarkdown } from "../markdown";
  import { finalizeTranscriptActivities, transcriptDisplayContent, type TranscriptAttachmentActions, type TranscriptMessage, type TranscriptMessageActions } from "./transcript";
  import TranscriptAttachments from "./TranscriptAttachments.svelte";
  import RunActivity from "./RunActivity.svelte";
  import { classifyComposerInvocation } from "./composerSuggestions.svelte";

  export let messages: TranscriptMessage[];
  export let copy: Translation;
  export let formatTime: (value: string) => string;
  export let searchMatchIds: string[] = [];
  export let activeMatchId = "";
  export let showReadReceipt = false;
  export let attachmentActions: TranscriptAttachmentActions | null = null;
  export let messageActions: TranscriptMessageActions | null = null;
</script>

{#each messages as message, index (message.id ?? `${index}-${message.role}`)}
  {@const displayContent = transcriptDisplayContent(message, copy.chatAssistantError)}
  {@const invocation = message.role === "user" ? classifyComposerInvocation(displayContent) : null}
  {@const canShowActions = Boolean(messageActions && (displayContent || message.attachments?.length))}
  {@const isCopied = Boolean(message.id && messageActions?.copiedId === message.id)}
  {@const isEditing = Boolean(message.id && messageActions?.editingId === message.id)}
  <article
    class:mine={message.role === "user"}
    class:assistant={message.role !== "user"}
    class:search-match={Boolean(message.id && searchMatchIds.includes(message.id))}
    class:search-active={message.id === activeMatchId}
    class:editing={isEditing}
    class="message-row"
    data-message-id={message.id}
  >
    {#if message.role === "user"}
      {#if displayContent}
        {#if invocation}
          <div class="message-bubble invocation-message" data-kind={invocation.kind}>
            <div class="invocation-kicker"><i class={`ph ${invocation.kind === "command" ? "ph-terminal-window" : "ph-sparkle"}`} aria-hidden="true"></i><span>{invocation.kind === "command" ? "COMMAND" : "SKILL"}</span><code>{invocation.token}</code></div>
            {#if displayContent.slice(invocation.token.length).trim()}<div class="markdown-body">{@html renderMarkdown(displayContent.slice(invocation.token.length).trim())}</div>{/if}
          </div>
        {:else}
          <div class="message-bubble markdown-body">{@html renderMarkdown(displayContent)}</div>
        {/if}
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
        </div>
      {/if}
      {#if message.createdAt}
        <time class="message-time">
          {formatTime(message.createdAt)}
          {#if showReadReceipt}<i class="ph ph-checks message-read" aria-hidden="true"></i>{/if}
        </time>
      {/if}
      {#if message.attachments?.length}
        <TranscriptAttachments attachments={message.attachments} {copy} actions={attachmentActions} />
      {/if}
      {#if message.thinking}
        <details class="thinking-card" open><summary>{copy.thinking}</summary><pre>{message.thinking}</pre></details>
      {/if}
    {:else}
      <div class="message-stack">
        {#if message.thinking}
          <details class="thinking-card" open><summary>{copy.thinking}</summary><pre>{message.thinking}</pre></details>
        {/if}
        {#if message.activities?.length}<RunActivity activities={finalizeTranscriptActivities(message.activities) ?? []} {copy} />{/if}
        {#if displayContent}<div class="message-bubble markdown-body">{@html renderMarkdown(displayContent)}</div>{/if}
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
        {#if message.createdAt}<time class="message-time">{formatTime(message.createdAt)}</time>{/if}
        {#if message.attachments?.length}
          <TranscriptAttachments attachments={message.attachments} {copy} actions={attachmentActions} />
        {/if}
      </div>
    {/if}
  </article>
{/each}
