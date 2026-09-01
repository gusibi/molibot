<script lang="ts">
  import Magnifier from "reicon-svelte/icons/Magnifier";

  export let value: string;
  export let label: string;
  export let placeholder = "";
  export let onInput: (value: string) => void;
</script>

<label class="search-field">
  <span class="sr-only">{label}</span>
  <Magnifier class="search-field-icon" size={14} aria-hidden="true" />
  <input type="search" {value} {placeholder} autocomplete="off" spellcheck="false" aria-label={label} oninput={(event) => onInput(event.currentTarget.value)} />
</label>
