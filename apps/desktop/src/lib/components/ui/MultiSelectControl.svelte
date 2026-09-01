<script lang="ts">
  import AngleDown from "reicon-svelte/icons/AngleDown";
  import AngleUp from "reicon-svelte/icons/AngleUp";
  import Check from "reicon-svelte/icons/Check";
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
      <AngleDown class="select-control-chevron" size={14} aria-hidden="true" />
    </Select.Trigger>
    <Select.Portal>
      <Select.Content class="select-control-content" sideOffset={5} collisionPadding={12}>
        <Select.ScrollUpButton class="select-control-scroll"><AngleUp size={14} aria-hidden="true" /></Select.ScrollUpButton>
        <Select.Viewport class="select-control-viewport">
          {#each options as option (option.value)}
            <Select.Item class="select-control-item" value={option.value} label={option.label} disabled={option.disabled}>
              <span title={option.label}>{option.label}</span>
              {#if value.includes(option.value)}<Check class="select-control-check" size={14} weight="Filled" aria-hidden="true" />{/if}
            </Select.Item>
          {/each}
        </Select.Viewport>
        <Select.ScrollDownButton class="select-control-scroll"><AngleDown size={14} aria-hidden="true" /></Select.ScrollDownButton>
      </Select.Content>
    </Select.Portal>
  </Select.Root>
</div>
