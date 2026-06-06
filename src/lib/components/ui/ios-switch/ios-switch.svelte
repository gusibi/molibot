<script lang="ts">
  interface Props {
    checked?: boolean;
    id?: string;
    disabled?: boolean;
    onCheckedChange?: (checked: boolean) => void;
  }

  let {
    checked = $bindable(false),
    id,
    disabled = false,
    onCheckedChange,
  }: Props = $props();

  function handleChange(e: Event) {
    const input = e.target as HTMLInputElement;
    onCheckedChange?.(input.checked);
  }
</script>

<label class="ios-switch" {id}>
  <input
    type="checkbox"
    bind:checked
    {disabled}
    onchange={handleChange}
  />
  <span class="ios-switch-track"></span>
</label>
