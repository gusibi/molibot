<script lang="ts">
  import TriangleWarning from "reicon-svelte/icons/TriangleWarning";
  import StopCircle from "reicon-svelte/icons/StopCircle";
  import CircleInfo from "reicon-svelte/icons/CircleInfo";
  import type { Translation } from "../i18n";
  import type { TurnStatus } from "./transcriptStatus";
  let { status, copy }: { status: TurnStatus; copy: Translation } = $props();
  const label = $derived(status.state === "failed" ? copy.sessionStatusFailed
    : status.state === "stopped" ? copy.sessionStatusStopped
      : status.state === "waiting" ? copy.sessionStatusWaiting : copy.sessionStatusUnknown);
  const Icon = $derived(status.state === "failed" ? TriangleWarning : status.state === "stopped" ? StopCircle : CircleInfo);
</script>

<section class="conversation-system-status" data-status={status.state} role="status" aria-label={copy.sessionStatusTitle}>
  <div class="conversation-system-status-line"><span><Icon size={14} aria-hidden="true" />{label}</span></div>
  {#if status.error}<p class="conversation-system-status-error">{status.error}</p>{/if}
</section>
