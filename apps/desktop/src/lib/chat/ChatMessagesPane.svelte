<script lang="ts">
  import { afterUpdate } from "svelte";
  import type { DesktopActivityEntry } from "../api";
  import type { DesktopConversationStep } from "@molibot/desktop-contract";
  import type { Translation } from "../i18n";
  import type { TranscriptAttachmentActions, TranscriptMessage, TranscriptMessageActions } from "./transcript";
  import ConversationLiveView from "./ConversationLiveView.svelte";
  import ConversationPromptNavigator from "./ConversationPromptNavigator.svelte";
  import TranscriptDock from "./TranscriptDock.svelte";
  import { PROMPT_NAVIGATOR_MIN_TURNS } from "./conversationNavigation";
  import { resumeStickToBottom, stickToBottom } from "./stickToBottom";
  import { settleEntrances } from "./settleEntrances";
  import MarkdownArtifactOverlay from "./MarkdownArtifactOverlay.svelte";

  export let messages: TranscriptMessage[];
  export let copy: Translation;
  export let formatTime: (value: string) => string;
  export let assistantName: string = copy.appName;
  export let stickKey = "";
  export let loading = false;
  export let loadingLabel = "";
  export let sending = false;
  export let streamingText = "";
  export let streamingThinking = "";
  export let activity = "";
  export let activities: DesktopActivityEntry[] = [];
  export let liveSteps: DesktopConversationStep[] = [];
  export let emptyTitle: string;
  export let emptyHint: string;
  export let searchMatchIds: string[] = [];
  export let activeMatchId = "";
  export let showReadReceipt = false;
  export let attachmentActions: TranscriptAttachmentActions | null = null;
  export let messageActions: TranscriptMessageActions | null = null;
  export let onOpenActivityPath: ((path: string, mutates: boolean) => void) | null = null;
  export let messagesElement: HTMLDivElement | undefined = undefined;
  /**
   * A card rendered into the slot that the turn is blocked on. When it scrolls
   * out of view the dock raises a pill pointing at it; the pane itself has no
   * idea what kind of card it is (pitfall #7).
   */
  export let attentionElement: HTMLElement | null = null;
  export let attentionLabel = "";
  export let attentionAction = "";
  export let endpoint = "";
  let appliedScrollFollowKey = "";
  const PAGE_SIZE = 80;
  let visibleCount = PAGE_SIZE;
  let paginationSession = "";

  $: userTurnCount = messages.filter((message) => message.role === "user" && Boolean(message.id?.trim())).length;
  $: showPromptNavigator = userTurnCount >= PROMPT_NAVIGATOR_MIN_TURNS;
  $: scrollFollowKey = `${stickKey}\u0000${userTurnCount}`;
  $: if (stickKey !== paginationSession) {
    paginationSession = stickKey;
    visibleCount = PAGE_SIZE;
  }
  $: hiddenCount = Math.max(0, messages.length - visibleCount);
  $: visibleMessages = hiddenCount > 0 ? messages.slice(hiddenCount) : messages;

  afterUpdate(() => {
    if (!messagesElement || scrollFollowKey === appliedScrollFollowKey) return;
    appliedScrollFollowKey = scrollFollowKey;
    resumeStickToBottom(messagesElement);
  });
</script>

<div class:has-prompt-navigator={showPromptNavigator && !loading} class="chat-messages-frame">
  <div class="messages" bind:this={messagesElement} use:stickToBottom={stickKey} use:settleEntrances={`${stickKey}:${loading}`} aria-live="polite" aria-busy={loading}>
    {#if loading}
      <div class="project-transcript-loading" role="status">
        <i class="ph ph-spinner-gap" aria-hidden="true"></i>{loadingLabel}
      </div>
    {:else}
      {#if hiddenCount > 0}
        <button class="load-earlier-messages" type="button" onclick={() => (visibleCount += PAGE_SIZE)}>{copy.loadEarlierMessages.replace("{count}", String(Math.min(PAGE_SIZE, hiddenCount)))}</button>
      {/if}
      <ConversationLiveView
        messages={visibleMessages}
        {copy}
        {formatTime}
        {assistantName}
        {sending}
        {streamingText}
        {streamingThinking}
        {activity}
        {activities}
        {liveSteps}
        {emptyTitle}
        {emptyHint}
        {searchMatchIds}
        {activeMatchId}
        {showReadReceipt}
        {attachmentActions}
        {messageActions}
        {onOpenActivityPath}
        {endpoint}
      />
      <slot />
    {/if}
  </div>
  {#if !loading}
    <ConversationPromptNavigator messages={visibleMessages} {copy} {formatTime} scrollElement={messagesElement} />
    <TranscriptDock
      scrollElement={messagesElement ?? null}
      label={copy.scrollToLatest}
      {attentionElement}
      {attentionLabel}
      {attentionAction}
    />
  {/if}
</div>
<MarkdownArtifactOverlay {copy} />
