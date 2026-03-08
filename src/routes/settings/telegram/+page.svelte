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
    isNew: boolean;
  }

  const botFileNames = ["BOT.md", "SOUL.md", "IDENTITY.md", "SONG.md"];

  let loading = true;
  let saving = false;
  let message = "";
  let error = "";

  let bots: TelegramBotForm[] = [];
  let agents: AgentItem[] = [];
  let selectedBotId = "";
  let savedSnapshots: Record<string, string> = {};
  let showToken = false;

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
      profileFiles: emptyBotFiles(),
      isNew: true
    };
  }

  function normalizeBot(bot: TelegramBotForm): TelegramBotForm {
    return {
      ...bot,
      id: bot.id.trim(),
      name: bot.name.trim(),
      enabled: Boolean(bot.enabled),
      agentId: bot.agentId.trim(),
      token: bot.token.trim(),
      allowedChatIds: bot.allowedChatIds
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean)
        .join(","),
      profileFiles: Object.fromEntries(
        botFileNames.map((fileName) => [fileName, String(bot.profileFiles[fileName] ?? "")])
      ),
      isNew: bot.isNew
    };
  }

  function botSnapshot(bot: TelegramBotForm): string {
    return JSON.stringify(normalizeBot(bot));
  }

  async function loadBotFiles(botId: string): Promise<Record<string, string>> {
    if (!botId) return emptyBotFiles();
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
        ? fromList.map((bot: {
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
            profileFiles: emptyBotFiles(),
            isNew: false
          }))
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
                  profileFiles: emptyBotFiles(),
                  isNew: false
                }]
              : [createEmptyBot()];
          })();

      bots = await Promise.all(
        mapped.map(async (bot) => ({
          ...bot,
          profileFiles: await loadBotFiles(bot.id)
        }))
      );
      savedSnapshots = Object.fromEntries(bots.map((bot) => [bot.id, botSnapshot(bot)]));
      selectedBotId = bots[0]?.id ?? "";
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  async function ensureCurrentSavedBeforeSwitch(): Promise<boolean> {
    const current = bots.find((bot) => bot.id === selectedBotId);
    if (!current) return true;
    const baseline = savedSnapshots[current.id];
    const dirty = botSnapshot(current) !== baseline;
    if (!dirty) return true;
    if (typeof window === "undefined") return false;
    const shouldSave = window.confirm("当前 Bot 有未保存变更。点击“确定”先保存并切换，点击“取消”留在当前 Bot。");
    if (!shouldSave) return false;
    return save();
  }

  async function selectBot(botId: string): Promise<void> {
    if (botId === selectedBotId) return;
    const ok = await ensureCurrentSavedBeforeSwitch();
    if (!ok) return;
    selectedBotId = botId;
  }

  async function addBot(): Promise<void> {
    const ok = await ensureCurrentSavedBeforeSwitch();
    if (!ok) return;
    const next = createEmptyBot();
    bots = [...bots, next];
    savedSnapshots = {
      ...savedSnapshots,
      [next.id]: botSnapshot(next)
    };
    selectedBotId = next.id;
  }

  async function removeBot(botId: string): Promise<void> {
    const confirmed =
      typeof window === "undefined"
        ? true
        : window.confirm(`Delete bot "${botId}"? This cannot be undone.`);
    if (!confirmed) return;

    const target = bots.find((bot) => bot.id === botId);
    if (target && !target.isNew) {
      const res = await fetch("/api/settings/channel-instance", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: "telegram",
          id: botId
        })
      });
      const data = await res.json();
      if (!data.ok) {
        error = data.error || `Failed to delete bot ${botId}`;
        return;
      }
    }

    bots = bots.filter((bot) => bot.id !== botId);
    savedSnapshots = Object.fromEntries(Object.entries(savedSnapshots).filter(([id]) => id !== botId));
    if (bots.length === 0) {
      const next = createEmptyBot();
      bots = [next];
      savedSnapshots = {
        ...savedSnapshots,
        [next.id]: botSnapshot(next)
      };
    }
    selectedBotId = bots[0]?.id ?? "";
  }

  function resolveSelectedBot(): TelegramBotForm | undefined {
    const exact = bots.find((bot) => bot.id === selectedBotId);
    if (exact) return exact;
    const unsaved = bots.find((bot) => !(bot.id in savedSnapshots));
    if (unsaved) return unsaved;
    return bots[0];
  }

  async function save(): Promise<boolean> {
    const selected = resolveSelectedBot();
    if (!selected) return false;

    saving = true;
    error = "";
    message = "";
    try {
      const normalized = normalizeBot(selected);
      if (!normalized.id) throw new Error("Bot ID is required");

      const res = await fetch("/api/settings/channel-instance", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: "telegram",
          previousId: selected.isNew ? "" : selected.id,
          instance: {
            id: normalized.id,
            name: normalized.name,
            enabled: normalized.enabled,
            agentId: normalized.agentId,
            credentials: { token: normalized.token },
            allowedChatIds: normalized.allowedChatIds
              .split(",")
              .map((v) => v.trim())
              .filter(Boolean)
          }
        })
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to save Telegram settings");

      const fileRes = await fetch("/api/settings/profile-files", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: "bot",
          channel: "telegram",
          botId: normalized.id,
          files: normalized.profileFiles
        })
      });
      const fileData = await fileRes.json();
      if (!fileData.ok) throw new Error(fileData.error || `Failed to save bot files for ${normalized.id}`);

      bots = bots.map((bot) => {
        if (bot.id !== selected.id) return bot;
        return {
          ...normalized,
          isNew: false
        };
      });
      if (selected.id !== normalized.id) {
        bots = bots.map((bot) => (bot.id === selected.id ? { ...bot, id: normalized.id } : bot));
        selectedBotId = normalized.id;
      }
      savedSnapshots = {
        ...savedSnapshots,
        [normalized.id]: botSnapshot({ ...normalized, isNew: false })
      };

      message = `Saved bot: ${normalized.name || normalized.id}`;
      return true;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      return false;
    } finally {
      saving = false;
    }
  }

  $: selectedBot = bots.find((bot) => bot.id === selectedBotId) ?? bots[0];
  $: if (selectedBotId && !bots.some((bot) => bot.id === selectedBotId)) {
    const resolved = resolveSelectedBot();
    if (resolved) {
      selectedBotId = resolved.id;
    }
  }
  $: selectedBotDirty = selectedBot
    ? botSnapshot(selectedBot) !== (savedSnapshots[selectedBot.id] ?? "")
    : false;

  onMount(loadSettings);
</script>

<div class="mx-auto max-w-7xl space-y-6 px-6 py-8 sm:px-10 sm:py-12">
  <div>
    <h1 class="text-2xl font-semibold">Telegram Settings</h1>
    <p class="text-sm text-slate-400">
      Configure Telegram bots, link them to agents, and edit bot-level Markdown overrides.
    </p>
  </div>

  {#if loading}
    <div class="rounded-xl border border-white/15 bg-[#2b2b2b] px-4 py-3 text-sm text-slate-300">
      Loading Telegram settings...
    </div>
  {:else}
    <div class="grid gap-6 lg:grid-cols-[280px_1fr]">
      <section class="space-y-3 rounded-xl border border-white/15 bg-[#2b2b2b] p-4">
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-semibold text-slate-200">Bots</h2>
          <button
            class="cursor-pointer rounded-md border border-white/20 bg-white/5 px-2 py-1 text-xs text-slate-200 hover:bg-white/10"
            type="button"
            on:click={addBot}
          >
            Add Bot
          </button>
        </div>

        <div class="space-y-2">
          {#each bots as bot (bot.id)}
            <button
              class={`flex w-full items-start justify-between rounded-lg border px-3 py-2 text-left text-sm ${
                selectedBot?.id === bot.id
                  ? "border-emerald-400/60 bg-emerald-500/10 text-emerald-200"
                  : "border-white/10 bg-[#1f1f1f] text-slate-300 hover:border-white/20"
              }`}
              type="button"
              on:click={() => selectBot(bot.id)}
            >
              <span>
                <span class="block font-medium">{bot.name || bot.id}</span>
                <span class="block text-xs text-slate-400">{bot.id}</span>
              </span>
              <span class={`text-[10px] ${bot.enabled ? "text-emerald-300" : "text-slate-500"}`}>
                {bot.enabled ? "ON" : "OFF"}
              </span>
            </button>
          {/each}
        </div>
      </section>

      {#if selectedBot}
        <form class="space-y-4" on:submit|preventDefault={save}>
          <section class="space-y-4 rounded-xl border border-white/15 bg-[#2b2b2b] p-4">
            <div class="flex items-center justify-between">
              <h2 class="text-sm font-semibold text-slate-200">Bot Configuration</h2>
              <button
                class="cursor-pointer rounded-md border border-rose-500/50 bg-rose-500/10 px-2 py-1 text-xs text-rose-300 hover:bg-rose-500/20"
                type="button"
                on:click={() => removeBot(selectedBot.id)}
              >
                Remove Bot
              </button>
            </div>

            <div class="grid gap-3 md:grid-cols-2">
              <label class="grid gap-1.5 text-sm">
                <span class="text-slate-300">Bot ID</span>
                <input
                  class="rounded-lg border border-white/15 bg-[#1f1f1f] px-3 py-2 text-sm outline-none focus:border-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
                  bind:value={selectedBot.id}
                  placeholder="marketing-bot"
                  disabled={!selectedBot.isNew}
                />
              </label>

              <label class="grid gap-1.5 text-sm">
                <span class="text-slate-300">Bot Name</span>
                <input
                  class="rounded-lg border border-white/15 bg-[#1f1f1f] px-3 py-2 text-sm outline-none focus:border-emerald-400"
                  bind:value={selectedBot.name}
                  placeholder="Marketing Bot"
                />
              </label>
            </div>
            {#if !selectedBot.isNew}
              <p class="text-xs text-slate-500">
                Bot ID is locked after creation to keep workspace paths and references stable.
              </p>
            {/if}

            <label class="flex items-center gap-3 text-sm text-slate-300">
              <input bind:checked={selectedBot.enabled} type="checkbox" />
              Enable this plugin instance
            </label>

            <label class="grid gap-1.5 text-sm">
              <span class="text-slate-300">Linked Agent</span>
              <select
                class="rounded-lg border border-white/15 bg-[#1f1f1f] px-3 py-2 text-sm outline-none focus:border-emerald-400"
                bind:value={selectedBot.agentId}
              >
                <option value="">No agent (global fallback only)</option>
                {#each agents.filter((agent) => agent.enabled) as agent (agent.id)}
                  <option value={agent.id}>{agent.name || agent.id}</option>
                {/each}
              </select>
            </label>

            <label class="grid gap-1.5 text-sm">
              <span class="text-slate-300">Bot token</span>
              <div class="flex items-center gap-2">
                <input
                  class="flex-1 rounded-lg border border-white/15 bg-[#1f1f1f] px-3 py-2 text-sm outline-none focus:border-emerald-400"
                  bind:value={selectedBot.token}
                  type={showToken ? "text" : "password"}
                  placeholder="123456:ABCDEF..."
                />
                <button
                  class="rounded-md border border-white/20 bg-white/5 px-2 py-2 text-xs text-slate-200 hover:bg-white/10"
                  type="button"
                  on:click={() => (showToken = !showToken)}
                >
                  {showToken ? "Hide" : "Show"}
                </button>
              </div>
            </label>

            <label class="grid gap-1.5 text-sm">
              <span class="text-slate-300">Allowed chat IDs (comma-separated)</span>
              <input
                class="rounded-lg border border-white/15 bg-[#1f1f1f] px-3 py-2 text-sm outline-none focus:border-emerald-400"
                bind:value={selectedBot.allowedChatIds}
                placeholder="123456789,-1001234567890"
              />
            </label>
          </section>

          <section class="space-y-3 rounded-xl border border-white/15 bg-[#2b2b2b] p-4">
            <div>
              <h3 class="text-sm font-semibold text-slate-200">Bot Markdown Overrides</h3>
              <p class="mt-1 text-xs text-slate-400">
                Files are saved as real Markdown documents with metadata headers. Leave empty to remove the override.
              </p>
            </div>

            {#each botFileNames as fileName}
              <label class="grid gap-1.5 text-sm">
                <span class="text-slate-300">{fileName}</span>
                <textarea
                  class="min-h-[160px] rounded-lg border border-white/15 bg-[#1f1f1f] px-3 py-2 font-mono text-sm outline-none focus:border-emerald-400"
                  bind:value={selectedBot.profileFiles[fileName]}
                  placeholder={`Edit ${fileName} here`}
                ></textarea>
              </label>
            {/each}
          </section>

          <button
            class="cursor-pointer rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black transition-colors duration-200 hover:bg-slate-200 disabled:cursor-not-allowed disabled:bg-slate-600 disabled:text-slate-300"
            type="submit"
            disabled={saving}
          >
            {saving ? "Saving..." : "Save This Bot"}
          </button>
          {#if selectedBotDirty}
            <p class="text-xs text-amber-300">Current bot has unsaved changes.</p>
          {/if}

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
  {/if}
</div>
