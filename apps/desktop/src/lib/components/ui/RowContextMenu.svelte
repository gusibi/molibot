<script lang="ts">
  import { ContextMenu } from "bits-ui";
  import type { Snippet } from "svelte";
  let { children, items }: { children: Snippet; items: {label: string; danger?: boolean; disabled?: boolean; onSelect: () => void}[] } = $props();
</script>
<ContextMenu.Root>
  <ContextMenu.Trigger>{@render children()}</ContextMenu.Trigger>
  <ContextMenu.Portal>
    <ContextMenu.Content class="list-context-menu" sideOffset={4}>
      {#each items as item (item.label)}
        <ContextMenu.Item class={item.danger ? "list-context-item danger" : "list-context-item"} disabled={item.disabled} onSelect={item.onSelect}>{item.label}</ContextMenu.Item>
      {/each}
    </ContextMenu.Content>
  </ContextMenu.Portal>
</ContextMenu.Root>
