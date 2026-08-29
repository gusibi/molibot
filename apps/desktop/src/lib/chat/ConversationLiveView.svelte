<script lang="ts">
  import type { Translation } from "../i18n";
  import type { DesktopActivityEntry } from "../api";
  import type { DesktopConversationStep } from "@molibot/desktop-contract";
  import type { TranscriptAttachmentActions, TranscriptMessage, TranscriptMessageActions, TurnFileItem } from "./transcript";
  import { handleMarkdownBodyClick } from "../markdownInteractions";
  import ConversationTranscript from "./ConversationTranscript.svelte";
  import { renderMarkdown } from "../markdown";
  import PlanCard from "./PlanCard.svelte";
  import { transcriptCompletedTurnSections, transcriptRenderBlocks } from "./transcript";
  import StreamingChatMarkdown from "./StreamingChatMarkdown.svelte";
  import TurnProcess from "./TurnProcess.svelte";

  export let messages: TranscriptMessage[];
  export let copy: Translation;
  export let formatTime: (value: string) => string;
  export let assistantName: string = copy.appName;
  export let sending = false;
  export let streamingText = "";
  export let streamingThinking = "";
  export let activity = "";
  export let activities: DesktopActivityEntry[] = [];
  export let liveSteps: DesktopConversationStep[] = [];
  export let emptyTitle: string;
  export let emptyHint: string;
  export let emptyActionLabel = "";
  export let emptyActionHint = "";
  export let emptyActions: ReadonlyArray<{ icon: string; label: string; prompt: string }> = [];
  export let onEmptyAction: ((prompt: string) => void) | null = null;
  export let searchMatchIds: string[] = [];
  export let activeMatchId = "";
  export let showReadReceipt = false;
  export let attachmentActions: TranscriptAttachmentActions | null = null;
  export let messageActions: TranscriptMessageActions | null = null;
  export let onOpenActivityPath: ((path: string, mutates: boolean) => void) | null = null;
  export let onOpenTurnFiles: ((files: TurnFileItem[], selectedKey?: string) => void) | null = null;
  export let endpoint = "";

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
  $: orderedBlocks = liveSteps.length
    ? transcriptRenderBlocks({ role: "assistant", content: streamingText, steps: liveSteps })
    : transcriptRenderBlocks({ role: "assistant", content: streamingText, thinking: streamingThinking, activities });
  $: liveSections = transcriptCompletedTurnSections(orderedBlocks);
</script>

{#if messages.length === 0 && !streamingText && !sending}
  <div class="conversation-empty">
    <div class="empty-icon" aria-hidden="true"><img src="/molibot-icon.png" alt="" width="32" height="32" /></div>
    <h2>{emptyTitle}</h2>
    <p>{emptyHint}</p>
    {#if emptyActions.length > 0 && onEmptyAction}
      <div class="conversation-empty-actions" role="group" aria-label={emptyActionLabel}>
        {#each emptyActions as action (action.label)}
          <button type="button" onclick={() => onEmptyAction?.(action.prompt)}>
            <i class={`ph ph-${action.icon}`} aria-hidden="true"></i>
            <span>{action.label}</span>
          </button>
        {/each}
      </div>
      {#if emptyActionHint}<small class="conversation-empty-action-hint">{emptyActionHint}</small>{/if}
    {/if}
  </div>
{/if}
<ConversationTranscript {messages} {copy} {formatTime} {assistantName} {searchMatchIds} {activeMatchId} {showReadReceipt} {attachmentActions} {messageActions} {onOpenActivityPath} {onOpenTurnFiles} {endpoint} />
{#if sending}
  <article class="message-row assistant streaming-message">
    <div class="assistant-layout">
      <img class="assistant-avatar" src="/molibot-icon.png" alt="" width="24" height="24" />
      <div class="message-stack">
        <div class="assistant-identity"><strong>{assistantName}</strong><span>{copy.agents}</span></div>
        <div class="message-status" role="status"><span class="message-status-pulse" aria-hidden="true"></span><span>{activity || copy.working}</span></div>
        {#if liveSections.process.length}
          <!-- Force-open only until the answer exists: reasoning streams with
               the process card open, and the moment the first response block
               (text or plan) appears the card folds so the answer leads - not
               only when the whole turn ends. -->
          <TurnProcess blocks={liveSections.process} {copy} stateKey="live-process" forceOpen={!liveSections.response.length} live onOpenPath={onOpenActivityPath} {endpoint} />
        {/if}
        {#each liveSections.response as block (block.id)}
          {#if block.kind === "plan"}
            <PlanCard plan={block.plan} {copy} disabled={!messageActions?.onResolvePlan} onResolve={(decision, edits) => messageActions?.onResolvePlan?.({ role: "assistant", content: "", steps: liveSteps }, block.plan, decision, edits)} />
          {:else if block.kind === "text" && block.content}
            <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
            <StreamingChatMarkdown source={block.content} {copy} />
          {/if}
        {/each}
      </div>
    </div>
  </article>
{/if}
