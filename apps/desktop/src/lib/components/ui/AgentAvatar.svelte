<script lang="ts">
  import { session } from "../../stores/session.svelte";
  import { Avatar } from "bits-ui";
  let { name, src = "" }: { name: string; src?: string } = $props();
  const avatarSrc = $derived(src.startsWith("/api/desktop/agent-avatar?") ? `${(session.endpoint ?? "").replace(/\/$/, "")}${src}` : src.trim() || "/molibot-icon.png");
</script>
<Avatar.Root class="agent-avatar">
  <Avatar.Image src={avatarSrc} alt={name} class="agent-avatar-image" />
  <Avatar.Fallback class="agent-avatar-fallback"><img src="/molibot-icon.png" alt={name} class="agent-avatar-image" /></Avatar.Fallback>
</Avatar.Root>
