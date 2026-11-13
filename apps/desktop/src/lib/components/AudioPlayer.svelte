<script lang="ts">
  /**
   * One audio player for every Desktop surface that plays a file: transcript
   * voice notes, file previews, pending attachments, the media viewer and the
   * TTS test panel. The native <audio controls> widget looks different on every
   * WebView and cannot be themed, which is why these surfaces used to disagree.
   *
   * The waveform is decoded from the real bytes. If decoding is unavailable
   * (CSP, an unsupported codec, a stream without a length) the track degrades
   * to a flat progress line — never a fabricated waveform.
   */
  import { fetchDesktopAudioBytes } from "../api";
  import Download from "../icons/duotone/components/Download.svelte";

  /** A subset of Translation, so callers can pass `copy` straight through. */
  export interface AudioPlayerLabels {
    play?: string;
    audioPause?: string;
    audioSpeed?: string;
    audioSeek?: string;
    audioError?: string;
    download?: string;
  }

  interface Props {
    src: string;
    title?: string;
    labels?: AudioPlayerLabels;
    onDownload?: () => void;
    onError?: () => void;
  }

  // The player owns its layout only; the card surface comes from the caller
  // (a transcript media card, a preview dialog, a pending-file chip). That
  // keeps one implementation while each host keeps its own visual grammar.
  let { src, title = "", labels = {}, onDownload, onError }: Props = $props();

  const BAR_COUNT = 56;
  const SPEEDS = [1, 1.25, 1.5, 2];

  let audio = $state<HTMLAudioElement | undefined>();
  let peaks = $state<number[]>([]);
  let current = $state(0);
  let duration = $state(0);
  let playing = $state(false);
  let speedIndex = $state(0);
  let failed = $state(false);

  let bars = $derived(peaks);
  let progress = $derived(duration > 0 ? Math.min(1, current / duration) : 0);
  let speed = $derived(SPEEDS[speedIndex]);
  let playLabel = $derived(playing ? (labels.audioPause ?? "Pause") : (labels.play ?? "Play"));

  function formatTime(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
    const total = Math.floor(seconds);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
  }

  async function decodePeaks(url: string): Promise<number[]> {
    try {
      const bytes = await fetchDesktopAudioBytes(url);
      if (!bytes) return [];
      const Ctor = window.AudioContext
        ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return [];
      const context = new Ctor();
      try {
        const buffer = await context.decodeAudioData(bytes);
        const channel = buffer.getChannelData(0);
        const step = Math.max(1, Math.floor(channel.length / BAR_COUNT));
        const stride = Math.max(1, Math.floor(step / 96));
        const values: number[] = [];
        for (let bar = 0; bar < BAR_COUNT; bar += 1) {
          let peak = 0;
          const start = bar * step;
          for (let i = 0; i < step && start + i < channel.length; i += stride) {
            const value = Math.abs(channel[start + i]);
            if (value > peak) peak = value;
          }
          values.push(peak);
        }
        const max = Math.max(...values, 0.001);
        return values.map((value) => Math.max(0.14, Math.min(1, value / max)));
      } finally {
        void context.close();
      }
    } catch {
      return [];
    }
  }

  // Re-decode when the source changes and cancel an in-flight decode on
  // unmount, so a stale blob cannot paint another file's waveform.
  $effect(() => {
    const url = src;
    let alive = true;
    peaks = [];
    current = 0;
    duration = 0;
    playing = false;
    failed = false;
    if (url) void decodePeaks(url).then((values) => { if (alive) peaks = values; });
    return () => { alive = false; };
  });

  function toggle(): void {
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => { failed = true; onError?.(); });
    else audio.pause();
  }

  function seek(event: Event): void {
    const value = Number((event.currentTarget as HTMLInputElement).value);
    if (!audio) return;
    audio.currentTime = value;
    current = value;
  }

  function cycleSpeed(): void {
    speedIndex = (speedIndex + 1) % SPEEDS.length;
    if (audio) audio.playbackRate = SPEEDS[speedIndex];
  }
</script>

<div class="md-audio-player" data-wave={bars.length > 0 ? "true" : "false"}>
  <!-- svelte-ignore a11y_media_has_caption -->
  <audio
    bind:this={audio}
    {src}
    preload="metadata"
    onplay={() => (playing = true)}
    onpause={() => (playing = false)}
    ontimeupdate={() => { if (audio) current = audio.currentTime; }}
    onloadedmetadata={() => { if (audio) duration = Number.isFinite(audio.duration) ? audio.duration : 0; }}
    onended={() => { playing = false; current = 0; }}
    onerror={() => { failed = true; onError?.(); }}
  ></audio>

  {#if title}
    <div class="md-audio-heading">
      <svg class="md-audio-glyph" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
        <rect x="2.5" y="9" width="2.5" height="6" rx="1.25" opacity=".5" />
        <rect x="7" y="5" width="2.5" height="14" rx="1.25" />
        <rect x="11.5" y="8" width="2.5" height="8" rx="1.25" opacity=".75" />
        <rect x="16" y="3" width="2.5" height="18" rx="1.25" />
        <rect x="20.5" y="9" width="1.5" height="6" rx=".75" opacity=".5" />
      </svg>
      <span title={title}>{title}</span>
    </div>
  {/if}

  <div class="md-audio-body">
    <button class="md-audio-play" type="button" onclick={toggle} aria-label={playLabel} title={playLabel}>
      {#if playing}
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
      {:else}
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M8 5.2a1 1 0 0 1 1.52-.85l9.1 6.8a1 1 0 0 1 0 1.7l-9.1 6.8A1 1 0 0 1 8 18.8V5.2Z" /></svg>
      {/if}
    </button>

    <div class="md-audio-track">
      <div class="md-audio-wave" aria-hidden="true">
        {#if bars.length}
          {#each bars as peak, index (index)}
            <span class:played={index / bars.length <= progress} style:height={`${Math.round(peak * 100)}%`}></span>
          {/each}
        {:else}
          <span class="md-audio-flat"></span>
          <span class="md-audio-flat-played" style:width={`${Math.round(progress * 100)}%`}></span>
        {/if}
      </div>
      <input
        class="md-audio-seek"
        type="range"
        min="0"
        max={duration > 0 ? duration : 1}
        step="0.01"
        value={current}
        oninput={seek}
        disabled={duration === 0}
        aria-label={labels.audioSeek ?? "Playback position"}
      />
    </div>

    <span class="md-audio-time">{formatTime(current)} / {formatTime(duration)}</span>
    <button class="md-audio-speed" type="button" onclick={cycleSpeed} aria-label={labels.audioSpeed ?? "Playback speed"} title={labels.audioSpeed ?? "Playback speed"}>{speed}×</button>
    {#if onDownload}
      <button class="md-audio-download" type="button" onclick={onDownload} aria-label={labels.download ?? "Download"} title={labels.download ?? "Download"}><Download size={14} aria-hidden="true" /></button>
    {/if}
  </div>

  {#if failed}
    <p class="md-audio-error" role="status">{labels.audioError ?? "Audio unavailable"}</p>
  {/if}
</div>
