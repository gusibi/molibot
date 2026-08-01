<script lang="ts">
  export let sourceInitial = "";
  export let sourceLabel = "";
  export let title: string;
  export let subtitle = "";
  export let searching = false;
</script>

<header class:searching class="chat-header" data-tauri-drag-region>
  <div class="chat-title-block" data-tauri-drag-region>
    {#if sourceInitial}<span class="chat-source-tag" data-tauri-drag-region aria-label={sourceLabel} title={sourceLabel}><span aria-hidden="true">#</span><b aria-hidden="true">{sourceInitial}</b></span>{/if}
    {#if sourceInitial}<span class="chat-title-separator" data-tauri-drag-region aria-hidden="true">/</span>{/if}
    <div class="chat-title-text" data-tauri-drag-region>
      <div class="chat-title-name" data-tauri-drag-region>{title}</div>
      {#if subtitle || $$slots.subtitle}
        <div class="chat-title-sub" data-tauri-drag-region title={subtitle}>
          <slot name="subtitle">{subtitle}</slot>
        </div>
      {/if}
    </div>
  </div>
  <div class="header-actions">
    <slot name="actions" />
  </div>
</header>
