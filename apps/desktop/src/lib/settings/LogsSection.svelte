<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { onMount } from "svelte";
  import { session } from "../stores/session.svelte";

  let content = "";
  let loading = false;
  let error = "";

  async function refresh(): Promise<void> {
    loading = true;
    error = "";
    try {
      content = await invoke<string>("desktop_logs");
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loading = false;
    }
  }

  onMount(() => { void refresh(); });
</script>

<div class="settings-section-head logs-section-head">
  <p class="settings-section-hint">{session.text.logsHint}</p>
  <button class="secondary-button" type="button" disabled={loading} onclick={refresh}>{loading ? session.text.loading : session.text.refreshLogs}</button>
</div>
{#if error}
  <div class="settings-card"><div class="settings-row"><p class="run-history-failed">{error}</p></div></div>
{:else if !content}
  <div class="settings-card"><div class="settings-row"><p>{loading ? session.text.loading : session.text.logsEmpty}</p></div></div>
{:else}
  <div class="settings-card logs-card"><pre>{content}</pre></div>
{/if}
