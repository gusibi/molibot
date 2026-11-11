<script lang="ts">
  import { untrack } from "svelte";
  import type { DesktopActivityEntry } from "../api";
  import type { Translation } from "../i18n";
  import { activityPresentation } from "./processPresentation";
  import {
    createRunStatusMeter,
    formatRunRate,
    formatRunTokens,
    type RunStatusPhase
  } from "./runStatus";
  import { formatDuration } from "../presentation";

  /**
   * The pinned "what is the turn doing" row inside the composer card.
   *
   * It used to live at the end of the streaming transcript, which meant the
   * one thing the owner watches during a long run scrolled away with the
   * reply — and a queued follow-up above the composer pushed it out of sight
   * exactly when the queue grew. Inside the card it never moves: the card is
   * anchored to the pane's bottom edge, so neither transcript growth, the
   * queue nor attachments can displace this row.
   *
   * Numbers are estimates: stream deltas carry no token counts, so the meter
   * derives tokens from the visible character mix and the rate from its growth
   * over a short window. `≈` is part of the copy, not decoration.
   */
  let {
    copy,
    sending,
    activity = "",
    activities = [],
    streamingText = "",
    streamingThinking = ""
  }: {
    copy: Translation;
    sending: boolean;
    /** Host activity hint shown before the first streamed byte (uploading…). */
    activity?: string;
    activities?: DesktopActivityEntry[];
    streamingText?: string;
    streamingThinking?: string;
  } = $props();

  const meter = createRunStatusMeter();
  /** Non-reactive: only the rendered `elapsedMs` needs to drive updates. */
  let startedAt = 0;
  let elapsedMs = $state(0);
  let tokens = $state(0);
  let tokensPerSecond = $state(0);
  let idleTicks = $state(0);
  let phase = $state<RunStatusPhase>("starting");

  const runningActivity = $derived(activities.some((item) => item.state === "running"));
  const presentation = $derived(activityPresentation(activities, copy));

  function tick(): void {
    const now = Date.now();
    elapsedMs = Math.max(0, now - startedAt);
    const snapshot = meter.tick({
      now,
      text: streamingText,
      thinking: streamingThinking,
      hasRunningActivity: runningActivity
    });
    phase = snapshot.phase;
    tokens = snapshot.tokens;
    tokensPerSecond = snapshot.tokensPerSecond;
    idleTicks = snapshot.idleTicks;
  }

  // Restart on the rising edge only. `untrack` keeps the props read by `tick`
  // out of the effect's dependencies: otherwise every streamed token would
  // tear down and rebuild the interval, and the meter would never see growth
  // across two samples.
  $effect(() => {
    if (!sending) {
      startedAt = 0;
      elapsedMs = 0;
      tokens = 0;
      tokensPerSecond = 0;
      idleTicks = 0;
      phase = "starting";
      meter.reset();
      return;
    }
    startedAt = Date.now();
    meter.reset();
    untrack(tick);
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  });

  const label = $derived.by(() => {
    if (phase === "tool") return presentation.status;
    if (phase === "answering") return copy.progressResponding;
    if (phase === "thinking") return copy.progressThinking;
    if (phase === "waiting") {
      // Alternating reassurance: the user should learn "not stuck" without
      // having to watch the clock, so the two lines share the row.
      return idleTicks % 12 >= 6 ? copy.stillWorking : copy.progressWaiting;
    }
    return activity || copy.working;
  });

  const elapsedLabel = $derived(elapsedMs < 1000 ? "<1s" : formatDuration(elapsedMs));
  const rateLabel = $derived(copy.tokensPerSecondRate.replace("{rate}", formatRunRate(tokensPerSecond)));
  const tokensLabel = $derived(copy.runStatusTokens.replace("{count}", formatRunTokens(tokens)));
  const title = $derived(
    [
      label,
      presentation.detail,
      elapsedLabel,
      tokens > 0 ? tokensLabel : "",
      tokensPerSecond > 0 ? rateLabel : ""
    ].filter(Boolean).join(" · ")
  );
</script>

{#if sending}
  <div class="run-status" data-phase={phase} title={title}>
    {#if phase === "answering"}
      <span class="run-status-caret" aria-hidden="true"></span>
    {:else}
      <span class="run-status-wave" aria-hidden="true">
        <span class="timeline-wave-bar"></span>
        <span class="timeline-wave-bar"></span>
        <span class="timeline-wave-bar"></span>
      </span>
    {/if}
    <span class="run-status-label" role="status">{label}</span>
    <span class="run-status-meta" aria-hidden="true">
      <span class="run-status-elapsed">{elapsedLabel}</span>
      {#if tokens > 0}<span class="run-status-tokens">{tokensLabel}</span>{/if}
      {#if tokensPerSecond > 0}<span class="run-status-rate">{rateLabel}</span>{/if}
    </span>
  </div>
{/if}
