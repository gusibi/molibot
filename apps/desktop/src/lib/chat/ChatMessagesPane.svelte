<script lang="ts">
  import type { DesktopActivityEntry } from "../api";
  import type { Translation } from "../i18n";
  import type { TranscriptAttachmentActions, TranscriptMessage } from "./transcript";
  import ConversationLiveView from "./ConversationLiveView.svelte";
  import { stickToBottom } from "./stickToBottom";

  export let messages: TranscriptMessage[];
  export let copy: Translation;
  export let formatTime: (value: string) => string;
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
  export let messagesElement: HTMLDivElement | undefined = undefined;
</script>

<div class="messages" bind:this={messagesElement} use:stickToBottom={stickKey} aria-live="polite" aria-busy={loading}>
  {#if loading}
    <div class="project-transcript-loading" role="status">
      <i class="ph ph-spinner-gap" aria-hidden="true"></i>{loadingLabel}
    </div>
  {:else}
    <ConversationLiveView
      {messages}
      {copy}
      {formatTime}
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
    />
    <slot />
  {/if}
</div>
