<script lang="ts">
  interface Props {
    value?: string;
    disabled?: boolean;
    onchange?: (event: Event) => void;
  }

  let {
    value = $bindable(""),
    disabled = false,
    onchange
  }: Props = $props();

  function openNativePicker(event: PointerEvent): void {
    if (event.button !== 0) return;
    const input = event.currentTarget as HTMLInputElement;
    if (typeof input.showPicker !== "function") return;
    try {
      input.showPicker();
    } catch {
      // The native control still supports keyboard/manual entry when a WebView
      // declines a programmatic picker request.
    }
  }
</script>

<input type="time" bind:value {disabled} onpointerdown={openNativePicker} {onchange} />
