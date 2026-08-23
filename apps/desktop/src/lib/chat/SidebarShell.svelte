<script lang="ts">
  import { getCurrentWindow } from "@tauri-apps/api/window";

  function startWindowDrag(event: MouseEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    void getCurrentWindow().startDragging().catch((error) => console.error("window drag failed", error));
  }
</script>

<aside class="chat-sidebar">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="sidebar-titlebar-drag" data-tauri-drag-region aria-hidden="true" onmousedown={startWindowDrag}></div>
  <slot />
</aside>
