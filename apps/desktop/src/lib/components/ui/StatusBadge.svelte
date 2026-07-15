<script lang="ts">
  export let label: string;
  export let state: "ready" | "warning" | "error" | "incompatible" | "disconnected" = "disconnected";
</script>

<span class="status-badge" data-state={state}><span class="status-symbol" aria-hidden="true"></span>{label}</span>
