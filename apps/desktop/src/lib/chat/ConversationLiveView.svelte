<script lang="ts">
  import type { Translation } from "../i18n";
  import type { DesktopActivityEntry } from "../api";
  import type { TranscriptAttachmentActions, TranscriptMessage } from "./transcript";
  import { renderMarkdown } from "../markdown";
  import ConversationTranscript from "./ConversationTranscript.svelte";
  import RunActivity from "./RunActivity.svelte";

  export let messages: TranscriptMessage[];
  export let copy: Translation;
  export let formatTime: (value: string) => string;
  export let sending = false;
  export let streamingText = "";
  export let streamingThinking = "";
  export let activity = "";
  export let activities: DesktopActivityEntry[] = [];
  export let emptyTitle: string;
  export let emptyHint: string;
  export let searchMatchIds: string[] = [];
  export let activeMatchId = "";
  export let showReadReceipt = false;
  export let attachmentActions: TranscriptAttachmentActions | null = null;
</script>

{#if messages.length === 0 && !streamingText && !sending}
  <div class="conversation-empty">
    <div class="empty-icon" aria-hidden="true"><img src="/molibot-icon.png" alt="" /></div>
    <h2>{emptyTitle}</h2>
    <p>{emptyHint}</p>
  </div>
{/if}
<ConversationTranscript {messages} {copy} {formatTime} {searchMatchIds} {activeMatchId} {showReadReceipt} {attachmentActions} />
{#if sending}
  <article class="message-row assistant streaming-message">
    <div class="message-avatar" aria-hidden="true">M</div>
    <div class="message-stack">
      <div class="message-status"><span>{activity || copy.working}</span></div>
      {#if activities.length > 0}<RunActivity {activities} {copy} live={true} />{/if}
      {#if streamingThinking}<details class="thinking-card" open><summary>{copy.thinking}</summary><pre>{streamingThinking}</pre></details>{/if}
      <div class="message-bubble markdown-body">{@html renderMarkdown(streamingText || activity || copy.working)}</div>
    </div>
  </article>
{/if}
