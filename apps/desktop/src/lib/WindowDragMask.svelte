<script lang="ts">
  import { getCurrentWindow } from "@tauri-apps/api/window";

  function startWindowDrag(event: MouseEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    // A denied `core:window:allow-start-dragging` capability rejects here and would
    // otherwise leave the title bar silently inert, so never swallow the rejection.
    void getCurrentWindow().startDragging().catch((error) => console.error("window drag failed", error));
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="window-drag-mask"
  data-tauri-drag-region
  aria-hidden="true"
  onmousedown={startWindowDrag}
></div>
