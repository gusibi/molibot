<script lang="ts">
  import type { Translation } from "../i18n";
  import { renderMarkdown } from "../markdown";
  import { transcriptDisplayContent, type TranscriptAttachmentActions, type TranscriptMessage } from "./transcript";
  import TranscriptAttachments from "./TranscriptAttachments.svelte";
  import RunActivity from "./RunActivity.svelte";

  export let messages: TranscriptMessage[];
  export let copy: Translation;
  export let formatTime: (value: string) => string;
  export let searchMatchIds: string[] = [];
  export let activeMatchId = "";
  export let showReadReceipt = false;
  export let attachmentActions: TranscriptAttachmentActions | null = null;
</script>

{#each messages as message, index (message.id ?? `${index}-${message.role}`)}
  {@const displayContent = transcriptDisplayContent(message, copy.chatAssistantError)}
  <article
    class:mine={message.role === "user"}
    class:assistant={message.role !== "user"}
    class:search-match={Boolean(message.id && searchMatchIds.includes(message.id))}
    class:search-active={message.id === activeMatchId}
    class="message-row"
    data-message-id={message.id}
  >
    {#if message.role === "user"}
      {#if displayContent}<div class="message-bubble markdown-body">{@html renderMarkdown(displayContent)}</div>{/if}
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
        <details class="thinking-card"><summary>{copy.thinking}</summary><pre>{message.thinking}</pre></details>
      {/if}
    {:else}
      <div class="message-avatar" aria-hidden="true">M</div>
      <div class="message-stack">
        {#if message.activities?.length}<RunActivity activities={message.activities} {copy} />{/if}
        {#if displayContent}<div class="message-bubble markdown-body">{@html renderMarkdown(displayContent)}</div>{/if}
        {#if message.createdAt}<time class="message-time">{formatTime(message.createdAt)}</time>{/if}
        {#if message.attachments?.length}
          <TranscriptAttachments attachments={message.attachments} {copy} actions={attachmentActions} />
        {/if}
        {#if message.thinking}
          <details class="thinking-card"><summary>{copy.thinking}</summary><pre>{message.thinking}</pre></details>
        {/if}
      </div>
    {/if}
  </article>
{/each}
