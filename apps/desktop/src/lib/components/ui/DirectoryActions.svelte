<script lang="ts">
  import { DropdownMenu } from "bits-ui";
  import More from "reicon-svelte/icons/More";

  let { label, disabled = false, items }: {
    label: string;
    disabled?: boolean;
    items: { label: string; danger?: boolean; disabled?: boolean; onSelect: () => void }[];
  } = $props();
  let trigger = $state<HTMLButtonElement | null>(null);
  let pending: (() => void) | null = null;
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger bind:ref={trigger} class="icon-button" {disabled} aria-label={label} title={label}><More size={16} aria-hidden="true" /></DropdownMenu.Trigger>
  <DropdownMenu.Portal>
    <DropdownMenu.Content class="list-context-menu" align="end" sideOffset={4} onCloseAutoFocus={event => {
      if (!pending) return;
      event.preventDefault();
      const action = pending;
      pending = null;
      // A dialog opened by an action must restore focus to the persistent trigger.
      trigger?.focus();
      queueMicrotask(action);
    }}>
      {#each items as item (item.label)}
        <DropdownMenu.Item class={item.danger ? "list-context-item danger" : "list-context-item"} disabled={item.disabled} onSelect={() => pending = item.onSelect}>{item.label}</DropdownMenu.Item>
      {/each}
    </DropdownMenu.Content>
  </DropdownMenu.Portal>
</DropdownMenu.Root>
