<script lang="ts">
  import { afterUpdate } from "svelte";
  import type { DesktopActivityEntry } from "../api";
  import type { Translation } from "../i18n";
  import type { TranscriptAttachmentActions, TranscriptMessage, TranscriptMessageActions } from "./transcript";
  import ConversationLiveView from "./ConversationLiveView.svelte";
  import ConversationPromptNavigator from "./ConversationPromptNavigator.svelte";
  import { PROMPT_NAVIGATOR_MIN_TURNS } from "./conversationNavigation";
  import { resumeStickToBottom, stickToBottom } from "./stickToBottom";
  import { settleEntrances } from "./settleEntrances";

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
  export let emptyTitle: string;
  export let emptyHint: string;
  export let searchMatchIds: string[] = [];
  export let activeMatchId = "";
  export let showReadReceipt = false;
  export let attachmentActions: TranscriptAttachmentActions | null = null;
  export let messageActions: TranscriptMessageActions | null = null;
  export let messagesElement: HTMLDivElement | undefined = undefined;
  let appliedScrollFollowKey = "";

  $: userTurnCount = messages.filter((message) => message.role === "user" && Boolean(message.id?.trim())).length;
  $: showPromptNavigator = userTurnCount >= PROMPT_NAVIGATOR_MIN_TURNS;
  $: scrollFollowKey = `${stickKey}\u0000${userTurnCount}`;

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
      <ConversationLiveView
        {messages}
        {copy}
        {formatTime}
        {assistantName}
        {sending}
        {streamingText}
        {streamingThinking}
        {activity}
        {activities}
        {emptyTitle}
        {emptyHint}
        {searchMatchIds}
        {activeMatchId}
        {showReadReceipt}
        {attachmentActions}
        {messageActions}
      />
      <slot />
    {/if}
  </div>
  {#if !loading}<ConversationPromptNavigator {messages} {copy} {formatTime} scrollElement={messagesElement} />{/if}
</div>
