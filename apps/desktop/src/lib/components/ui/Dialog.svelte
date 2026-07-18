<script lang="ts">
  import { Dialog as BitsDialog } from "bits-ui";
  import type { Snippet } from "svelte";

  let {
    open = false,
    busy = false,
    closeOnOutside = true,
    overlayClass = "",
    contentClass = "",
    labelledBy = undefined,
    describedBy = undefined,
    onOpenChange = () => {},
    onOpenAutoFocus = undefined,
    onCloseAutoFocus = undefined,
    children
  }: {
    open?: boolean;
    busy?: boolean;
    closeOnOutside?: boolean;
    overlayClass?: string;
    contentClass?: string;
    labelledBy?: string;
    describedBy?: string;
    onOpenChange?: (next: boolean) => void;
    onOpenAutoFocus?: (event: Event) => void;
    onCloseAutoFocus?: (event: Event) => void;
    children: Snippet;
  } = $props();

  let completing = $state(false);

  function getOpen(): boolean {
    return open;
  }

  function setOpen(next: boolean): void {
    if (next) {
      completing = false;
      onOpenChange(true);
      return;
    }
    if (busy || completing) return;
    completing = true;
    onOpenChange(false);
  }

  function preventCloseWhenLocked(event: Event): void {
    if (busy || !closeOnOutside) event.preventDefault();
  }

  function handleEscape(event: KeyboardEvent): void {
    if (busy) event.preventDefault();
  }
</script>

<BitsDialog.Root bind:open={getOpen, setOpen}>
  <BitsDialog.Portal>
    <BitsDialog.Overlay class={`desktop-dialog-overlay ${overlayClass}`} />
    <BitsDialog.Content
      class={`desktop-dialog-content ${contentClass}`}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      onEscapeKeydown={handleEscape}
      onInteractOutside={preventCloseWhenLocked}
      interactOutsideBehavior={closeOnOutside && !busy ? "close" : "ignore"}
      {onOpenAutoFocus}
      {onCloseAutoFocus}
    >
      {@render children()}
    </BitsDialog.Content>
  </BitsDialog.Portal>
</BitsDialog.Root>
