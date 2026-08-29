<script lang="ts">
  interface Props {
    value?: string;
    disabled?: boolean;
    ariaLabel?: string;
    name?: string;
    id?: string;
    onchange?: (event: Event) => void;
  }

  let {
    value = $bindable(""),
    disabled = false,
    ariaLabel,
    name,
    id,
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

<input type="time" bind:value {disabled} autocomplete="off" aria-label={ariaLabel} {name} {id} onpointerdown={openNativePicker} {onchange} />
