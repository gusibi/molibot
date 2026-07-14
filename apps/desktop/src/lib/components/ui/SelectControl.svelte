<script lang="ts">
  interface SelectOption {
    value: string;
    label: string;
  }

  export let value: string;
  export let options: SelectOption[];
  export let ariaLabel: string;
  export let disabled = false;
  export let technicalId = "";
  export let technicalLabel = "Technical ID";
  export let onChange: (value: string) => void;
</script>

<div class="select-control">
  <select {value} {disabled} aria-label={ariaLabel} onchange={(event) => onChange(event.currentTarget.value)}>
    {#each options as option (option.value)}<option value={option.value}>{option.label}</option>{/each}
  </select>
  {#if technicalId}
    <details class="technical-detail">
      <summary>{technicalLabel}</summary>
      <code>{technicalId}</code>
    </details>
  {/if}
</div>
