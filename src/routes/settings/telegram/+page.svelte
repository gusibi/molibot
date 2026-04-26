<script lang="ts">
  import { onMount } from "svelte";
  import PageShell from "$lib/ui/PageShell.svelte";
  import Button from "$lib/ui/Button.svelte";
  import Alert from "$lib/ui/Alert.svelte";

  interface AgentItem {
    id: string;
    name: string;
    enabled: boolean;
  }

  interface TelegramBotForm {
    id: string;
    name: string;
    enabled: boolean;
    streamOutput: boolean;
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
      streamOutput: true,
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
      streamOutput: bot.streamOutput !== false,
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
            credentials?: { token?: string; streamOutput?: string };
            allowedChatIds?: string[];
          }) => ({
            id: bot.id ?? createBotId(),
            name: bot.name ?? "",
            enabled: bot.enabled ?? true,
            streamOutput: String(bot.credentials?.streamOutput ?? "").toLowerCase() !== "false",
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
                  streamOutput: true,
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
            credentials: { token: normalized.token, streamOutput: String(normalized.streamOutput) },
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

<PageShell widthClass="max-w-7xl" gapClass="space-y-6">
  <header class="wb-hero">
    <div class="wb-hero-copy">
    <p class="wb-eyebrow">Channel Runtime</p>
    <h1>Telegram Settings</h1>
    <p class="wb-copy">
      Configure Telegram bots, link them to agents, and edit bot-level Markdown overrides.
    </p>
    </div>
  </header>

  {#if loading}
    <div class="wb-empty-state text-left">
      Loading Telegram settings...
    </div>
  {:else}
    <div class="wb-config-grid">
      <section class="wb-config-nav space-y-3">
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-semibold text-[var(--foreground)]">Bots</h2>
          <Button variant="outline" size="sm" type="button" on:click={addBot}>
            Add Bot
          </Button>
        </div>

        <div class="wb-config-nav-list">
          {#each bots as bot (bot.id)}
            <button
              class={`wb-config-item ${selectedBot?.id === bot.id ? "active" : ""}`}
              type="button"
              on:click={() => selectBot(bot.id)}
            >
              <span class="min-w-0">
                <span class="wb-config-item-title truncate">{bot.name || bot.id}</span>
                <span class="wb-config-item-subtitle truncate">{bot.id}</span>
              </span>
              <span class="wb-config-state" data-enabled={bot.enabled}>
                {bot.enabled ? "ON" : "OFF"}
              </span>
            </button>
          {/each}
        </div>
      </section>

      {#if selectedBot}
        <form class="space-y-4" on:submit|preventDefault={save}>
          <section class="wb-config-panel space-y-4">
            <div class="flex items-center justify-between">
              <h2 class="text-sm font-semibold text-[var(--foreground)]">Bot Configuration</h2>
              <Button variant="destructive" size="sm" type="button" on:click={() => removeBot(selectedBot.id)}>
                Remove Bot
              </Button>
            </div>

            <div class="grid gap-3 md:grid-cols-2">
              <label class="grid gap-1.5 text-sm">
                <span class="text-[var(--foreground)]">Bot ID</span>
                <input
                  class="rounded-lg border border-[var(--border)] bg-[color-mix(in_oklab,var(--card)_88%,transparent)] px-3 py-2 text-sm outline-none focus:border-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-60"
                  bind:value={selectedBot.id}
                  placeholder="marketing-bot"
                  disabled={!selectedBot.isNew}
                />
              </label>

              <label class="grid gap-1.5 text-sm">
                <span class="text-[var(--foreground)]">Bot Name</span>
                <input
                  class="rounded-lg border border-[var(--border)] bg-[color-mix(in_oklab,var(--card)_88%,transparent)] px-3 py-2 text-sm outline-none focus:border-[var(--ring)]"
                  bind:value={selectedBot.name}
                  placeholder="Marketing Bot"
                />
              </label>
            </div>
            {#if !selectedBot.isNew}
              <p class="wb-note text-xs">
                Bot ID is locked after creation to keep workspace paths and references stable.
              </p>
            {/if}

            <label class="flex items-center gap-3 text-sm text-[var(--foreground)]">
              <input bind:checked={selectedBot.enabled} type="checkbox" />
              Enable this plugin instance
            </label>

            <label class="flex items-center gap-3 text-sm text-[var(--foreground)]">
              <input bind:checked={selectedBot.streamOutput} type="checkbox" />
              Enable streaming output (default on)
            </label>

            <label class="grid gap-1.5 text-sm">
              <span class="text-[var(--foreground)]">Linked Agent</span>
              <select
                class="rounded-lg border border-[var(--border)] bg-[color-mix(in_oklab,var(--card)_88%,transparent)] px-3 py-2 text-sm outline-none focus:border-[var(--ring)]"
                bind:value={selectedBot.agentId}
              >
                <option value="">No agent (global fallback only)</option>
                {#each agents.filter((agent) => agent.enabled) as agent (agent.id)}
                  <option value={agent.id}>{agent.name || agent.id}</option>
                {/each}
              </select>
            </label>

            <label class="grid gap-1.5 text-sm">
              <span class="text-[var(--foreground)]">Bot token</span>
              <div class="flex items-center gap-2">
                <input
                  class="flex-1 rounded-lg border border-[var(--border)] bg-[color-mix(in_oklab,var(--card)_88%,transparent)] px-3 py-2 text-sm outline-none focus:border-[var(--ring)]"
                  bind:value={selectedBot.token}
                  type={showToken ? "text" : "password"}
                  placeholder="123456:ABCDEF..."
                />
                <Button variant="outline" size="sm" type="button" on:click={() => (showToken = !showToken)}>
                  {showToken ? "Hide" : "Show"}
                </Button>
              </div>
            </label>

            <label class="grid gap-1.5 text-sm">
              <span class="text-[var(--foreground)]">Allowed chat IDs (comma-separated)</span>
              <input
                class="rounded-lg border border-[var(--border)] bg-[color-mix(in_oklab,var(--card)_88%,transparent)] px-3 py-2 text-sm outline-none focus:border-[var(--ring)]"
                bind:value={selectedBot.allowedChatIds}
                placeholder="123456789,-1001234567890"
              />
            </label>
          </section>

          <section class="wb-config-panel space-y-3">
            <div>
              <h3 class="text-sm font-semibold text-[var(--foreground)]">Bot Markdown Overrides</h3>
              <p class="mt-1 text-xs text-[var(--muted-foreground)]">
                Files are saved as real Markdown documents with metadata headers. Leave empty to remove the override.
              </p>
            </div>

            {#each botFileNames as fileName}
              <label class="grid gap-1.5 text-sm">
                <span class="text-[var(--foreground)]">{fileName}</span>
                <textarea
                  class="min-h-[160px] rounded-lg border border-[var(--border)] bg-[color-mix(in_oklab,var(--card)_88%,transparent)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--ring)]"
                  bind:value={selectedBot.profileFiles[fileName]}
                  placeholder={`Edit ${fileName} here`}
                ></textarea>
              </label>
            {/each}
          </section>

          <Button variant="default" size="md" type="submit" disabled={saving}>
            {saving ? "Saving..." : "Save This Bot"}
          </Button>
          {#if selectedBotDirty}
            <p class="wb-warning-note text-xs">Current bot has unsaved changes.</p>
          {/if}

          {#if message}
            <Alert variant="success">{message}</Alert>
          {/if}
          {#if error}
            <Alert variant="destructive">{error}</Alert>
          {/if}
        </form>
      {/if}
    </div>
  {/if}
</PageShell>
