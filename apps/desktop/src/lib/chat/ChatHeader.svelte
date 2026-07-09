<script lang="ts">
  export let avatar = "M";
  export let title: string;
  export let subtitle = "";
</script>

<header class="chat-header" data-tauri-drag-region>
  <div class="chat-title-block" data-tauri-drag-region>
    <div class="chat-header-avatar" data-tauri-drag-region aria-hidden="true">{avatar}</div>
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
