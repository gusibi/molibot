<script lang="ts">
  import { Select } from "bits-ui";

  interface SelectOption {
    value: string;
    label: string;
    disabled?: boolean;
  }

  export let value: string[];
  export let options: SelectOption[];
  export let ariaLabel: string;
  export let emptyLabel: string;
  export let selectedLabel: (count: number) => string;
  export let disabled = false;
  export let onChange: (value: string[]) => void;

  $: triggerLabel = value.length === 0 ? emptyLabel : selectedLabel(value.length);
</script>

<div class="select-control multi-select-control">
  <Select.Root type="multiple" {value} {disabled} items={options} loop onValueChange={onChange}>
    <Select.Trigger class="select-control-trigger" aria-label={ariaLabel}>
      <span>{triggerLabel}</span>
      <i class="ph ph-caret-down" aria-hidden="true"></i>
    </Select.Trigger>
    <Select.Portal>
      <Select.Content class="select-control-content" sideOffset={5} collisionPadding={12}>
        <Select.ScrollUpButton class="select-control-scroll"><i class="ph ph-caret-up" aria-hidden="true"></i></Select.ScrollUpButton>
        <Select.Viewport class="select-control-viewport">
          {#each options as option (option.value)}
            <Select.Item class="select-control-item" value={option.value} label={option.label} disabled={option.disabled}>
              <span title={option.label}>{option.label}</span>
              {#if value.includes(option.value)}<i class="ph-bold ph-check" aria-hidden="true"></i>{/if}
            </Select.Item>
          {/each}
        </Select.Viewport>
        <Select.ScrollDownButton class="select-control-scroll"><i class="ph ph-caret-down" aria-hidden="true"></i></Select.ScrollDownButton>
      </Select.Content>
    </Select.Portal>
  </Select.Root>
</div>
