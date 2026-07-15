<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { onMount, tick } from "svelte";
  import { session } from "../stores/session.svelte";

  let content = "";
  let loading = false;
  let error = "";
  let opening = false;
  let logEl: HTMLPreElement | null = null;

  async function refresh(): Promise<void> {
    loading = true;
    error = "";
    try {
      content = await invoke<string>("desktop_logs");
      // Tail behaviour: keep the newest lines in view after each load.
      await tick();
      if (logEl) logEl.scrollTop = logEl.scrollHeight;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loading = false;
    }
  }

  async function openLogFile(): Promise<void> {
    opening = true;
    try {
      await invoke("open_desktop_log");
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      opening = false;
    }
  }

  onMount(() => { void refresh(); });
</script>

<div class="settings-section-head logs-section-head">
  <button class="tertiary-button" type="button" disabled={opening} onclick={openLogFile}>{session.text.openLogFile}</button>
  <button class="secondary-button" type="button" disabled={loading} onclick={refresh}>{loading ? session.text.loading : session.text.refreshLogs}</button>
</div>
{#if error}
  <div class="settings-card"><div class="settings-row"><p class="run-history-failed">{error}</p></div></div>
{:else if !content}
  <div class="settings-card"><div class="settings-row"><p>{loading ? session.text.loading : session.text.logsEmpty}</p></div></div>
{:else}
  <div class="settings-card logs-card"><pre bind:this={logEl}>{content}</pre></div>
{/if}
