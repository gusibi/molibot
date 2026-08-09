<script lang="ts">
  import type { Translation } from "../i18n";
  import type { DesktopActivityEntry } from "../api";
  import type { TranscriptAttachmentActions, TranscriptMessage, TranscriptMessageActions } from "./transcript";
  import { handleMarkdownBodyClick } from "../markdownInteractions";
  import ConversationTranscript from "./ConversationTranscript.svelte";
  import RunActivity from "./RunActivity.svelte";
  import { createStreamingRenderer } from "./streamingMarkdown";

  export let messages: TranscriptMessage[];
  export let copy: Translation;
  export let formatTime: (value: string) => string;
  export let assistantName: string = copy.appName;
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
  export let onOpenActivityPath: ((path: string, mutates: boolean) => void) | null = null;

  // The streaming bubble is the same rendered Markdown as a committed message,
  // so it goes through the same delegated handler (pitfall #7). It used to carry
  // a private copy-code implementation, which is why the wrap toggle and the
  // image lightbox would have been dead for exactly the reply being generated.
  async function onMarkdownClick(event: MouseEvent): Promise<void> {
    await handleMarkdownBodyClick(event, copy);
  }

  // One renderer (and its sealed-block cache) for the life of this view. The
  // streaming reply is split into top-level blocks and rendered as a keyed
  // `{#each}` below: sealed blocks keep a stable html value so Svelte skips
  // the innerHTML write and a selection in them survives, while only the
  // still-growing last block is re-parsed per frame. See `streamingMarkdown.ts`
  // for the split / cache / unclosed-fence logic.
  const streamingRenderer = createStreamingRenderer();
  $: streamBlocks = streamingText
    ? streamingRenderer.derive(streamingText, { copyCode: copy.copyCode, wrapLinesLabel: copy.wrapLines })
    : [];
</script>

{#if messages.length === 0 && !streamingText && !sending}
  <div class="conversation-empty">
    <div class="empty-icon" aria-hidden="true"><img src="/molibot-icon.png" alt="" /></div>
    <h2>{emptyTitle}</h2>
    <p>{emptyHint}</p>
  </div>
{/if}
<ConversationTranscript {messages} {copy} {formatTime} {assistantName} {searchMatchIds} {activeMatchId} {showReadReceipt} {attachmentActions} {messageActions} {onOpenActivityPath} />
{#if sending}
  <article class="message-row assistant streaming-message">
    <div class="assistant-layout">
      <img class="assistant-avatar" src="/molibot-icon.png" alt="" />
      <div class="message-stack">
        <div class="assistant-identity"><strong>{assistantName}</strong><span>{copy.agents}</span></div>
        <div class="message-status" role="status"><span class="message-status-pulse" aria-hidden="true"></span><span>{activity || copy.working}</span></div>
        {#if streamingThinking}<details class="thinking-card"><summary>{copy.thinking}</summary><pre>{streamingThinking}</pre></details>{/if}
        {#if activities.length > 0}<RunActivity {activities} {copy} onOpenPath={onOpenActivityPath} />{/if}
        {#if streamingText}
          <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
          <div class="message-bubble markdown-body" onclick={onMarkdownClick}>
            {#each streamBlocks as block, i (i)}
              <!--
                Keyed by index: the list is append-only (streaming only
                appends), so an index key is correct and lets Svelte keep each
                sealed block's DOM node untouched as the active tail grows -
                which is what preserves a selection in an earlier paragraph.
                The wrapper is layout-transparent: `.message-bubble` is a block
                box and the wrapper carries no padding/border, so the block's
                own margins collapse straight through it and the vertical
                rhythm stays byte-identical to a single {@html}.
              -->
              <div class="md-stream-block">{@html block.html}</div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  </article>
{/if}
