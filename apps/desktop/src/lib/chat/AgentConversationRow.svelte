<script lang="ts">
  import { Checkbox } from "bits-ui";
  import RowContextMenu from "../components/ui/RowContextMenu.svelte";
  import { CHANNEL_LOGOS, CONVERSATION_SOURCE_ICONS } from "./activityIcons";
  import type { DesktopConversationItem, DesktopConversationSearchItem, DesktopConversationSearchSource } from "@molibot/desktop-contract";

  let { item, source, sourceLabel, locale, formatTime, onSelect, onDelete, onCopyPath, onRevealInFinder, selectable = false, selected = false, onToggle }: {
    onDelete?: () => void | Promise<void>;
    onCopyPath?: () => void | Promise<void>;
    onRevealInFinder?: () => void | Promise<void>;
    selectable?: boolean;
    selected?: boolean;
    onToggle?: () => void;
    item: DesktopConversationItem | DesktopConversationSearchItem;
    source: DesktopConversationSearchSource;
    sourceLabel: string;
    locale: string;
    formatTime: (value: string) => string;
    onSelect: () => void | Promise<void>;
  } = $props();
  const SourceIcon = $derived(CONVERSATION_SOURCE_ICONS[source]);
  const sourceDescription = $derived(`${sourceLabel}${item.readOnly ? ` · ${locale === "zh-CN" ? "只读" : "Read only"}` : ""}`);
  const preview = $derived(item.latestMessagePreview || ("contextName" in item ? item.contextName : item.botName));
  const contextItems = $derived.by(() => {
    const items: Array<{ label: string; danger?: boolean; onSelect: () => void | Promise<void> }> = [];
    if (onCopyPath) items.push({ label: locale === "zh-CN" ? "复制 session 路径" : "Copy Session Path", onSelect: () => void onCopyPath?.() });
    if (onRevealInFinder) items.push({ label: locale === "zh-CN" ? "从 Finder 打开" : "Open in Finder", onSelect: () => void onRevealInFinder?.() });
    if (onDelete) items.push({ label: locale === "zh-CN" ? "删除对话" : "Delete conversation", danger: true, onSelect: () => void onDelete?.() });
    return items;
  });
</script>

{#snippet row()}
  <div class="agent-history-selectable">
    {#if selectable}<label class="agent-history-select"><Checkbox.Root class="list-selection-checkbox" checked={selected} aria-label={`${locale === "zh-CN" ? "选择" : "Select"} ${item.title}`} onCheckedChange={() => onToggle?.()}><span aria-hidden="true">✓</span></Checkbox.Root></label>{/if}
<button type="button" class="agent-history-row" onclick={onSelect}>
  <span class="agent-history-conversation"><span class="agent-history-conversation-icon" title={sourceDescription} role="img" aria-label={sourceDescription}>{#if CHANNEL_LOGOS[source]}<img class="channel-logo" src={CHANNEL_LOGOS[source]} alt="" width="20" height="20" aria-hidden="true" />{:else}<SourceIcon size={20} aria-hidden="true" />{/if}</span><span class="agent-history-conversation-copy"><strong>{item.title}</strong><small>{preview}</small></span></span>
  <time datetime={item.updatedAt}>{formatTime(item.updatedAt)}</time>
</button>

  </div>
{/snippet}
{#if contextItems.length}
  <RowContextMenu items={contextItems}>{@render row()}</RowContextMenu>
{:else}{@render row()}{/if}
