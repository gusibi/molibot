<script lang="ts">
  import type { Translation } from "../i18n";
  import type { DesktopActivityEntry } from "../api";
  import type { TranscriptAttachmentActions, TranscriptMessage, TranscriptMessageActions } from "./transcript";
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
  export let messageActions: TranscriptMessageActions | null = null;

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
</script>

{#if messages.length === 0 && !streamingText && !sending}
  <div class="conversation-empty">
    <div class="empty-icon" aria-hidden="true"><img src="/molibot-icon.png" alt="" /></div>
    <h2>{emptyTitle}</h2>
    <p>{emptyHint}</p>
  </div>
{/if}
<ConversationTranscript {messages} {copy} {formatTime} {searchMatchIds} {activeMatchId} {showReadReceipt} {attachmentActions} {messageActions} />
{#if sending}
  <article class="message-row assistant streaming-message">
    <div class="message-stack">
      <div class="message-status"><span>{activity || copy.working}</span></div>
      {#if streamingThinking}<details class="thinking-card" open><summary>{copy.thinking}</summary><pre>{streamingThinking}</pre></details>{/if}
      {#if activities.length > 0}<RunActivity {activities} {copy} />{/if}
      <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
      <div class="message-bubble markdown-body" onclick={copyCode}>{@html renderMarkdown(streamingText || activity || copy.working, copy.copyCode)}</div>
    </div>
  </article>
{/if}
