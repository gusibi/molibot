<script lang="ts">
  export let sourceLabel = "";
  export let title: string;
  export let subtitle = "";
  export let searching = false;
</script>

<!-- The project dimension reuses this header instead of ChatView's inline one, so
     it must carry the same region hook or every family's header adaptation
     (accent chips, header rule, canvas seam) silently stops at the project pane.
     `.chat-header` is the element the DESIGN.md `header` hook names. -->
<header class:searching class="chat-header" data-theme-region="header" data-tauri-drag-region>
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
