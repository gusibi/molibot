<script lang="ts">
  import { Select } from "bits-ui";

  interface SelectOption {
    value: string;
    label: string;
    disabled?: boolean;
    group?: string;
  }

  interface SelectSection {
    group?: string;
    options: SelectOption[];
  }

  export let value: string;
  export let options: SelectOption[];
  export let ariaLabel: string;
  export let disabled = false;
  export let technicalId = "";
  export let technicalLabel = "Technical ID";
  export let onChange: (value: string) => void;

  function sectionOptions(items: SelectOption[]): SelectSection[] {
    const sections: SelectSection[] = [];
    const grouped = new Map<string, SelectSection>();
    for (const option of items) {
      if (!option.group) {
        sections.push({ options: [option] });
        continue;
      }
      let section = grouped.get(option.group);
      if (!section) {
        section = { group: option.group, options: [] };
        grouped.set(option.group, section);
        sections.push(section);
      }
      section.options.push(option);
    }
    return sections;
  }

  $: selectedLabel = options.find((option) => option.value === value)?.label ?? value;
  $: sections = sectionOptions(options);
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
          {#each sections as section, index (`${section.group ?? "ungrouped"}-${index}`)}
            {#if section.group}
              <Select.Group class="select-control-group">
                <Select.GroupHeading class="select-control-group-label">{section.group}</Select.GroupHeading>
                {#each section.options as option (option.value)}
                  <Select.Item class="select-control-item" value={option.value} label={option.label} disabled={option.disabled}>
                    <span title={option.label}>{option.label}</span>
                    {#if option.value === value}<i class="ph-bold ph-check" aria-hidden="true"></i>{/if}
                  </Select.Item>
                {/each}
              </Select.Group>
            {:else}
              {@const option = section.options[0]}
              <Select.Item class="select-control-item" value={option.value} label={option.label} disabled={option.disabled}>
                <span title={option.label}>{option.label}</span>
                {#if option.value === value}<i class="ph-bold ph-check" aria-hidden="true"></i>{/if}
              </Select.Item>
            {/if}
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
