<script lang="ts">
  import { onMount } from "svelte";

  interface AgentItem {
    id: string;
    name: string;
    enabled: boolean;
  }

  interface TelegramBotForm {
    id: string;
    name: string;
    enabled: boolean;
    agentId: string;
    token: string;
    allowedChatIds: string;
    profileFiles: Record<string, string>;
  }

  const botFileNames = ["BOT.md", "SOUL.md", "IDENTITY.md", "SONG.md"];

  let loading = true;
  let saving = false;
  let message = "";
  let error = "";

  let bots: TelegramBotForm[] = [];
  let agents: AgentItem[] = [];

  function createBotId(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return `bot-${crypto.randomUUID().slice(0, 8)}`;
    }
    return `bot-${Math.random().toString(36).slice(2, 10)}`;
  }

  function emptyBotFiles(): Record<string, string> {
    return Object.fromEntries(botFileNames.map((fileName) => [fileName, ""]));
  }

  function createEmptyBot(): TelegramBotForm {
    return {
      id: createBotId(),
      name: "",
      enabled: false,
      agentId: "",
      token: "",
      allowedChatIds: "",
      profileFiles: emptyBotFiles()
    };
  }

  async function loadBotFiles(botId: string): Promise<Record<string, string>> {
    const res = await fetch(
      `/api/settings/profile-files?scope=bot&channel=telegram&botId=${encodeURIComponent(botId)}`
    );
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || `Failed to load bot files for ${botId}`);
    return Object.assign(emptyBotFiles(), data.files ?? {});
  }

  async function loadSettings(): Promise<void> {
    loading = true;
    error = "";
    message = "";
    try {
      const res = await fetch("/api/settings");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load settings");

      agents = Array.isArray(data.settings?.agents) ? data.settings.agents : [];

      const fromList = Array.isArray(data.settings?.channels?.telegram?.instances)
        ? data.settings.channels.telegram.instances
        : [];
      const mapped = fromList.length > 0
        ? fromList.map(
          (bot: {
            id?: string;
            name?: string;
            enabled?: boolean;
            agentId?: string;
            credentials?: { token?: string };
            allowedChatIds?: string[];
          }) => ({
            id: bot.id ?? createBotId(),
            name: bot.name ?? "",
            enabled: bot.enabled ?? true,
            agentId: bot.agentId ?? "",
            token: bot.credentials?.token ?? "",
            allowedChatIds: (bot.allowedChatIds ?? []).join(","),
            profileFiles: emptyBotFiles()
          }),
        )
        : (() => {
            const token = data.settings.telegramBotToken ?? "";
            return token
              ? [{
                  id: "default",
                  name: "Default Bot",
                  enabled: true,
                  agentId: "",
                  token,
                  allowedChatIds: (data.settings.telegramAllowedChatIds ?? []).join(","),
                  profileFiles: emptyBotFiles()
                }]
              : [createEmptyBot()];
          })();

      bots = await Promise.all(
        mapped.map(async (bot) => ({
          ...bot,
          profileFiles: await loadBotFiles(bot.id)
        }))
      );
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
      const normalizedBots = bots
        .map((bot) => ({
          id: bot.id.trim(),
          name: bot.name.trim(),
          enabled: Boolean(bot.enabled),
          agentId: bot.agentId.trim(),
          credentials: {
            token: bot.token.trim()
          },
          allowedChatIds: bot.allowedChatIds
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean)
        }))
        .filter((bot) => bot.id);

      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channels: {
            telegram: {
              instances: normalizedBots
            }
          }
        })
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to save Telegram settings");

      for (const bot of bots) {
        if (!bot.id.trim()) continue;
        const fileRes = await fetch("/api/settings/profile-files", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scope: "bot",
            channel: "telegram",
            botId: bot.id.trim(),
            files: bot.profileFiles
          })
        });
        const fileData = await fileRes.json();
        if (!fileData.ok) throw new Error(fileData.error || `Failed to save bot files for ${bot.id}`);
      }

      message = "Telegram settings, agent links, and bot Markdown files saved.";
      await loadSettings();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      saving = false;
    }
  }

  function addBot(): void {
    bots = [...bots, createEmptyBot()];
  }

  function removeBot(index: number): void {
    bots = bots.filter((_, idx) => idx !== index);
    if (bots.length === 0) {
      bots = [createEmptyBot()];
    }
  }

  onMount(loadSettings);
</script>

<div class="mx-auto max-w-5xl space-y-6 px-6 py-8 sm:px-10 sm:py-12">
  <h1 class="text-2xl font-semibold">Telegram Settings</h1>
  <p class="text-sm text-slate-400">
    Configure Telegram bots, link them to agents, and edit bot-level Markdown overrides.
  </p>

  {#if loading}
    <div class="rounded-xl border border-white/15 bg-[#2b2b2b] px-4 py-3 text-sm text-slate-300">
      Loading Telegram settings...
    </div>
  {:else}
    <form class="space-y-4" on:submit|preventDefault={save}>
      {#each bots as bot, idx (bot.id)}
        <section class="space-y-4 rounded-xl border border-white/15 bg-[#2b2b2b] p-4">
          <div class="flex items-center justify-between">
            <h2 class="text-sm font-semibold text-slate-200">Bot #{idx + 1}</h2>
            <button
              class="cursor-pointer rounded-md border border-rose-500/50 bg-rose-500/10 px-2 py-1 text-xs text-rose-300 hover:bg-rose-500/20"
              type="button"
              on:click={() => removeBot(idx)}
            >
              Remove
            </button>
          </div>

          <div class="grid gap-3 md:grid-cols-2">
            <label class="grid gap-1.5 text-sm">
              <span class="text-slate-300">Bot ID</span>
              <input
                class="rounded-lg border border-white/15 bg-[#1f1f1f] px-3 py-2 text-sm outline-none focus:border-emerald-400"
                bind:value={bot.id}
                placeholder="marketing-bot"
              />
            </label>

            <label class="grid gap-1.5 text-sm">
              <span class="text-slate-300">Bot Name</span>
              <input
                class="rounded-lg border border-white/15 bg-[#1f1f1f] px-3 py-2 text-sm outline-none focus:border-emerald-400"
                bind:value={bot.name}
                placeholder="Marketing Bot"
              />
            </label>
          </div>

          <label class="flex items-center gap-3 text-sm text-slate-300">
            <input bind:checked={bot.enabled} type="checkbox" />
            Enable this plugin instance
          </label>

          <label class="grid gap-1.5 text-sm">
            <span class="text-slate-300">Linked Agent</span>
            <select
              class="rounded-lg border border-white/15 bg-[#1f1f1f] px-3 py-2 text-sm outline-none focus:border-emerald-400"
              bind:value={bot.agentId}
            >
              <option value="">No agent (global fallback only)</option>
              {#each agents.filter((agent) => agent.enabled) as agent (agent.id)}
                <option value={agent.id}>{agent.name || agent.id}</option>
              {/each}
            </select>
          </label>

          <label class="grid gap-1.5 text-sm">
            <span class="text-slate-300">Bot token</span>
            <input
              class="rounded-lg border border-white/15 bg-[#1f1f1f] px-3 py-2 text-sm outline-none focus:border-emerald-400"
              bind:value={bot.token}
              type="password"
              placeholder="123456:ABCDEF..."
            />
          </label>

          <label class="grid gap-1.5 text-sm">
            <span class="text-slate-300">Allowed chat IDs (comma-separated)</span>
            <input
              class="rounded-lg border border-white/15 bg-[#1f1f1f] px-3 py-2 text-sm outline-none focus:border-emerald-400"
              bind:value={bot.allowedChatIds}
              placeholder="123456789,-1001234567890"
            />
          </label>

          <div class="space-y-3">
            <div>
              <h3 class="text-sm font-semibold text-slate-200">Bot Markdown Overrides</h3>
              <p class="mt-1 text-xs text-slate-400">
                These files apply after global and linked-agent files. Leave empty to remove the override.
              </p>
            </div>

            {#each botFileNames as fileName}
              <label class="grid gap-1.5 text-sm">
                <span class="text-slate-300">{fileName}</span>
                <textarea
                  class="min-h-[160px] rounded-lg border border-white/15 bg-[#1f1f1f] px-3 py-2 font-mono text-sm outline-none focus:border-emerald-400"
                  bind:value={bot.profileFiles[fileName]}
                  placeholder={`Edit ${fileName} here`}
                ></textarea>
              </label>
            {/each}
          </div>
        </section>
      {/each}

      <button
        class="cursor-pointer rounded-lg border border-white/20 bg-[#2b2b2b] px-4 py-2 text-sm font-semibold text-slate-100 transition-colors duration-200 hover:bg-[#343434]"
        type="button"
        on:click={addBot}
      >
        Add Bot
      </button>

      <button
        class="cursor-pointer rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black transition-colors duration-200 hover:bg-slate-200 disabled:cursor-not-allowed disabled:bg-slate-600 disabled:text-slate-300"
        type="submit"
        disabled={saving}
      >
        {saving ? "Saving..." : "Save Telegram Settings"}
      </button>

      {#if message}
        <p class="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
          {message}
        </p>
      {/if}
      {#if error}
        <p class="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
          {error}
        </p>
      {/if}
    </form>
  {/if}
</div>
