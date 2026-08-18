<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import ApprovalsPage from "../approvals/+page.svelte";

  onMount(() => {
    goto("/settings/approvals", { replaceState: true });
  });
</script>

<ApprovalsPage />
