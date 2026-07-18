<script lang="ts">
  interface Props {
    checked?: boolean;
    ariaLabel: string;
    disabled?: boolean;
    onCheckedChange?: (checked: boolean) => void;
  }

  let {
    checked = $bindable(false),
    ariaLabel,
    disabled = false,
    onCheckedChange
  }: Props = $props();

  function handleChange(event: Event): void {
    onCheckedChange?.((event.currentTarget as HTMLInputElement).checked);
  }
</script>

<label class="ios-switch">
  <input type="checkbox" bind:checked aria-label={ariaLabel} {disabled} onchange={handleChange} />
  <span class="ios-switch-track"></span>
</label>
