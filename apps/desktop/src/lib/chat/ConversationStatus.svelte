<script lang="ts">
  import TriangleWarning from "reicon-svelte/icons/TriangleWarning";
  import StopCircle from "reicon-svelte/icons/StopCircle";
  import CircleInfo from "reicon-svelte/icons/CircleInfo";
  import type { Translation } from "../i18n";
  import type { TurnStatus } from "./transcriptStatus";
  import { appModelErrorSummary } from "@molibot/shared/appModelError";
  import { momoExpressionSrc, type MomoExpression } from "./homePresence";
  import { session } from "../stores/session.svelte";
  let { status, copy, deskExpression }: { status: TurnStatus; copy: Translation; deskExpression?: MomoExpression } = $props();
  const label = $derived(status.state === "failed" ? copy.sessionStatusFailed
    : status.state === "stopped" ? copy.sessionStatusStopped
      : status.state === "waiting" ? copy.sessionStatusWaiting : copy.sessionStatusUnknown);
  const Icon = $derived(status.state === "failed" ? TriangleWarning : status.state === "stopped" ? StopCircle : CircleInfo);
</script>

<section class="conversation-system-status" data-status={status.state} role="status" aria-label={copy.sessionStatusTitle}>
  <div class="conversation-system-status-line">
    <span>
      {#if deskExpression}
        <img class="assistant-avatar desk-turn-avatar" data-desk-expression={deskExpression} src={momoExpressionSrc(deskExpression)} alt="" width="28" height="28" />
      {:else}
        <Icon size={14} aria-hidden="true" />
      {/if}
      {label}
    </span>
  </div>
  {#if status.error}
    <p class="conversation-system-status-error">{appModelErrorSummary(status.error, session.locale === "zh-CN")}</p>
    <details><summary>{copy.appErrorDetails}</summary><p class="conversation-system-status-error">{status.error}</p></details>
  {/if}
</section>
