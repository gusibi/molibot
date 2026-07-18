<script lang="ts">
  import { AlertDialog as BitsAlertDialog } from "bits-ui";
  import type { Snippet } from "svelte";

  let {
    open = false,
    busy = false,
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

  function preventClose(event: Event): void {
    event.preventDefault();
  }

  function handleEscape(event: KeyboardEvent): void {
    event.preventDefault();
  }
</script>

<BitsAlertDialog.Root bind:open={getOpen, setOpen}>
  <BitsAlertDialog.Portal>
    <BitsAlertDialog.Overlay class="desktop-dialog-overlay" />
    <BitsAlertDialog.Content
      class={`desktop-dialog-content ${contentClass}`}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      onEscapeKeydown={handleEscape}
      onInteractOutside={preventClose}
      interactOutsideBehavior="ignore"
      {onOpenAutoFocus}
      {onCloseAutoFocus}
    >
      {@render children()}
    </BitsAlertDialog.Content>
  </BitsAlertDialog.Portal>
</BitsAlertDialog.Root>
