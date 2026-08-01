<script lang="ts">
  import { Select } from "bits-ui";

  interface SelectOption {
    value: string;
    label: string;
    disabled?: boolean;
  }

  export let value: string;
  export let options: SelectOption[];
  export let ariaLabel: string;
  export let disabled = false;
  export let technicalId = "";
  export let technicalLabel = "Technical ID";
  export let onChange: (value: string) => void;

  $: selectedLabel = options.find((option) => option.value === value)?.label ?? value;
</script>

<div class="select-control">
  <Select.Root type="single" {value} {disabled} items={options} loop onValueChange={onChange}>
    <Select.Trigger class="select-control-trigger" aria-label={ariaLabel}>
      <span>{selectedLabel}</span>
      <i class="ph ph-caret-down" aria-hidden="true"></i>
    </Select.Trigger>
    <Select.Portal>
      <Select.Content class="select-control-content" sideOffset={5} collisionPadding={12}>
        <Select.ScrollUpButton class="select-control-scroll"><i class="ph ph-caret-up" aria-hidden="true"></i></Select.ScrollUpButton>
        <Select.Viewport class="select-control-viewport">
          {#each options as option (option.value)}
            <Select.Item class="select-control-item" value={option.value} label={option.label} disabled={option.disabled}>
              {#snippet child({ selected })}
                <span title={option.label}>{option.label}</span>
                {#if selected}<i class="ph-bold ph-check" aria-hidden="true"></i>{/if}
              {/snippet}
            </Select.Item>
          {/each}
        </Select.Viewport>
        <Select.ScrollDownButton class="select-control-scroll"><i class="ph ph-caret-down" aria-hidden="true"></i></Select.ScrollDownButton>
      </Select.Content>
    </Select.Portal>
  </Select.Root>
  {#if technicalId}
    <details class="technical-detail">
      <summary>{technicalLabel}</summary>
      <code>{technicalId}</code>
    </details>
  {/if}
</div>
