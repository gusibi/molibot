<script lang="ts">
  import { DropdownMenu } from "bits-ui";
  import More from "reicon-svelte/icons/More";
  import MessageSearch from "reicon-svelte/icons/MessageSearch";
  import Copy from "reicon-svelte/icons/Copy";
  import FolderOpen from "reicon-svelte/icons/FolderOpen";
  import Trash from "reicon-svelte/icons/Trash";

  let { locale, onSearch, onCopyPath, onOpenDirectory, onDelete }: {
    locale: string;
    onSearch: (trigger?: HTMLButtonElement) => void;
    onCopyPath: () => void;
    onOpenDirectory: () => void;
    onDelete: () => void | Promise<void>;
  } = $props();
  let trigger = $state<HTMLButtonElement | null>(null);
  let searching = false;
  const zh = $derived(locale === "zh-CN");
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger bind:ref={trigger} class="icon-button" aria-label={zh ? "更多会话操作" : "More conversation actions"} title={zh ? "更多会话操作" : "More conversation actions"}>
    <More size={16} weight="Outline" aria-hidden="true" />
  </DropdownMenu.Trigger>
  <DropdownMenu.Portal>
    <DropdownMenu.Content class="list-context-menu session-actions-menu" align="end" sideOffset={6}
      onCloseAutoFocus={(event) => { event.preventDefault(); if (!searching) trigger?.focus(); searching = false; }}>
      <DropdownMenu.Item class="list-context-item" onSelect={() => { searching = true; onSearch(trigger ?? undefined); }}><MessageSearch size={16} aria-hidden="true" />{zh ? "搜索当前对话" : "Search this conversation"}</DropdownMenu.Item>
      <DropdownMenu.Separator class="session-actions-separator" />
      <DropdownMenu.Item class="list-context-item" onSelect={onCopyPath}><Copy size={16} aria-hidden="true" />{zh ? "复制会话目录路径" : "Copy session directory path"}</DropdownMenu.Item>
      <DropdownMenu.Item class="list-context-item" onSelect={onOpenDirectory}><FolderOpen size={16} aria-hidden="true" />{zh ? "在 Finder 中打开目录" : "Open directory in Finder"}</DropdownMenu.Item>
      <DropdownMenu.Separator class="session-actions-separator" />
      <DropdownMenu.Item class="list-context-item danger" onSelect={() => void onDelete()}><Trash size={16} aria-hidden="true" />{zh ? "删除对话" : "Delete conversation"}</DropdownMenu.Item>
    </DropdownMenu.Content>
  </DropdownMenu.Portal>
</DropdownMenu.Root>

