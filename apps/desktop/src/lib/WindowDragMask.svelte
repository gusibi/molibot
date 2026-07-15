<script lang="ts">
  import { getCurrentWindow } from "@tauri-apps/api/window";

  function startWindowDrag(event: MouseEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    void getCurrentWindow().startDragging();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="window-drag-mask"
  data-tauri-drag-region
  aria-hidden="true"
  onmousedown={startWindowDrag}
></div>
