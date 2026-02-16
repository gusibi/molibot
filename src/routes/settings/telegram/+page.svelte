<script lang="ts">
  import { onMount } from "svelte";

  interface TelegramForm {
    telegramBotToken: string;
    telegramAllowedChatIds: string;
  }

  let loading = true;
  let saving = false;
  let message = "";
  let error = "";

  let form: TelegramForm = {
    telegramBotToken: "",
    telegramAllowedChatIds: ""
  };

  async function loadSettings(): Promise<void> {
    loading = true;
    error = "";
    message = "";
    try {
      const res = await fetch("/api/settings");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load settings");

      form = {
        telegramBotToken: data.settings.telegramBotToken ?? "",
        telegramAllowedChatIds: (data.settings.telegramAllowedChatIds ?? []).join(",")
      };
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  async function save(): Promise<void> {
    saving = true;
    error = "";
    message = "";
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to save Telegram settings");
      message = "Telegram settings saved and reloaded.";
      await loadSettings();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      saving = false;
    }
  }

  onMount(loadSettings);
</script>

<div class="page">
  <header class="header">
    <h1>Settings / Telegram Bot</h1>
    <div class="links">
      <a href="/settings">Back</a>
      <a href="/">Chat</a>
    </div>
  </header>

  {#if loading}
    <p>Loading Telegram settings...</p>
  {:else}
    <form class="form" on:submit|preventDefault={save}>
      <section>
        <label>
          Bot token
          <input bind:value={form.telegramBotToken} type="password" placeholder="123456:ABCDEF..." />
        </label>

        <label>
          Allowed chat IDs (comma-separated)
          <input bind:value={form.telegramAllowedChatIds} placeholder="123456789,-1001234567890" />
        </label>
      </section>

      <button type="submit" disabled={saving}>{saving ? "Saving..." : "Save Telegram Settings"}</button>

      {#if message}
        <p class="ok">{message}</p>
      {/if}
      {#if error}
        <p class="err">{error}</p>
      {/if}
    </form>
  {/if}
</div>

<style>
  :global(html, body, #svelte) {
    margin: 0;
    background: #0b1020;
    color: #e5e7eb;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }

  .page {
    max-width: 900px;
    margin: 0 auto;
    padding: 20px;
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 20px;
  }

  .links {
    display: flex;
    gap: 12px;
  }

  a {
    color: #93c5fd;
    text-decoration: none;
  }

  .form {
    display: grid;
    gap: 14px;
  }

  section {
    border: 1px solid #334155;
    border-radius: 10px;
    padding: 14px;
    display: grid;
    gap: 10px;
    background: #111827;
  }

  label {
    display: grid;
    gap: 6px;
    font-size: 13px;
  }

  input,
  button {
    background: #0f172a;
    color: #e5e7eb;
    border: 1px solid #334155;
    border-radius: 8px;
    padding: 8px 10px;
    font: inherit;
  }

  button {
    width: fit-content;
    cursor: pointer;
  }

  .ok {
    color: #34d399;
    margin: 0;
  }

  .err {
    color: #f87171;
    margin: 0;
  }
</style>
