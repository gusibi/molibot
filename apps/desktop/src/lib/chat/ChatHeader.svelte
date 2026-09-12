<script lang="ts">
  import Sidebar from "../icons/duotone/components/Sidebar.svelte";
  export let sourceLabel = "";
  export let title: string;
  export let subtitle = "";
  export let searching = false;
  export let sidebarCollapsed = false;
  export let onToggleSidebar: () => void = () => {};
  export let expandLabel = "";
</script>

<header class:searching class="chat-header" data-tauri-drag-region>
  {#if sidebarCollapsed}
    <button
      type="button"
      class="icon-button sidebar-expand-btn"
      aria-label={expandLabel || "展开侧边栏"}
      title={expandLabel || "展开侧边栏"}
      onclick={onToggleSidebar}
    >
      <Sidebar size={16} aria-hidden="true" />
    </button>
  {/if}
  <div class="chat-title-block" data-tauri-drag-region>
    <div class="chat-title-text" data-tauri-drag-region>
      <div class="chat-title-name" data-tauri-drag-region>{title}</div>
      {#if subtitle || $$slots.subtitle}
        <div class="chat-title-sub" data-tauri-drag-region title={subtitle}>
          <slot name="subtitle">{subtitle}</slot>
        </div>
      {/if}
    </div>
    {#if sourceLabel}
      <span class="chat-source-label" data-tauri-drag-region title={sourceLabel}>{sourceLabel}</span>
    {/if}
  </div>
  <div class="header-actions">
    <slot name="actions" />
  </div>
</header>
