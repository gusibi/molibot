<script lang="ts">
  import { Avatar } from "bits-ui";
  let { name, src = "" }: { name: string; src?: string } = $props();
</script>
<Avatar.Root class="agent-avatar">
  {#if src}<Avatar.Image {src} alt={name} class="agent-avatar-image" />{/if}
  <Avatar.Fallback class="agent-avatar-fallback">{name.slice(0, 1).toUpperCase()}</Avatar.Fallback>
</Avatar.Root>
