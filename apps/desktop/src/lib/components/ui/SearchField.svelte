<script lang="ts">
  export let value: string;
  export let label: string;
  export let placeholder = "";
  export let onInput: (value: string) => void;
</script>

<label class="search-field">
  <span class="sr-only">{label}</span>
  <i class="ph ph-magnifying-glass" aria-hidden="true"></i>
  <input type="search" {value} {placeholder} aria-label={label} oninput={(event) => onInput(event.currentTarget.value)} />
</label>
