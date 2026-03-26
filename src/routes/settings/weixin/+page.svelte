<script lang="ts">
  import { onMount } from "svelte";
  import PageShell from "$lib/ui/PageShell.svelte";
  import Button from "$lib/ui/Button.svelte";
  import Alert from "$lib/ui/Alert.svelte";

  type QrModule = {
    toDataURL: (text: string, options?: Record<string, unknown>) => Promise<string>;
  };

  interface AgentItem {
    id: string;
    name: string;
    enabled: boolean;
  }

  interface WeixinBotForm {
    id: string;
    name: string;
    enabled: boolean;
    agentId: string;
    baseUrl: string;
    allowedChatIds: string;
    profileFiles: Record<string, string>;
    isNew: boolean;
  }

  const botFileNames = ["BOT.md", "SOUL.md", "IDENTITY.md", "SONG.md"];

  let loading = true;
  let saving = false;
  let message = "";
  let error = "";

  let bots: WeixinBotForm[] = [];
  let agents: AgentItem[] = [];
  let selectedBotId = "";
  let savedSnapshots: Record<string, string> = {};
  let qrLink = "";
  let qrImageUrl = "";
  let qrLoading = false;
  let qrError = "";
  let qrModulePromise: Promise<QrModule> | null = null;

  function createBotId(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return `weixin-${crypto.randomUUID().slice(0, 8)}`;
    }
    return `weixin-${Math.random().toString(36).slice(2, 10)}`;
  }

  function emptyBotFiles(): Record<string, string> {
    return Object.fromEntries(botFileNames.map((fileName) => [fileName, ""]));
  }

  function createEmptyBot(): WeixinBotForm {
    return {
      id: createBotId(),
      name: "",
      enabled: false,
      agentId: "",
      baseUrl: "",
      allowedChatIds: "",
      profileFiles: emptyBotFiles(),
      isNew: true
    };
  }

  function normalizeBot(bot: WeixinBotForm): WeixinBotForm {
    return {
      ...bot,
      id: bot.id.trim(),
      name: bot.name.trim(),
      enabled: Boolean(bot.enabled),
      agentId: bot.agentId.trim(),
      baseUrl: bot.baseUrl.trim(),
      allowedChatIds: bot.allowedChatIds
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
        .join(","),
      profileFiles: Object.fromEntries(
        botFileNames.map((fileName) => [fileName, String(bot.profileFiles[fileName] ?? "")])
      ),
      isNew: bot.isNew
    };
  }

  function botSnapshot(bot: WeixinBotForm): string {
    return JSON.stringify(normalizeBot(bot));
  }

  async function loadBotFiles(botId: string): Promise<Record<string, string>> {
    if (!botId) return emptyBotFiles();
    const res = await fetch(
      `/api/settings/profile-files?scope=bot&channel=weixin&botId=${encodeURIComponent(botId)}`
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
      const fromList = Array.isArray(data.settings?.channels?.weixin?.instances)
        ? data.settings.channels.weixin.instances
        : [];

      const mapped = fromList.length > 0
        ? fromList.map((bot: {
            id?: string;
            name?: string;
            enabled?: boolean;
            agentId?: string;
            credentials?: { baseUrl?: string };
            allowedChatIds?: string[];
          }) => ({
            id: bot.id ?? createBotId(),
            name: bot.name ?? "",
            enabled: bot.enabled ?? true,
            agentId: bot.agentId ?? "",
            baseUrl: bot.credentials?.baseUrl ?? "",
            allowedChatIds: (bot.allowedChatIds ?? []).join(","),
            profileFiles: emptyBotFiles(),
            isNew: false
          }))
        : [createEmptyBot()];

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
          channel: "weixin",
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

  async function save(): Promise<boolean> {
    const selected = bots.find((bot) => bot.id === selectedBotId) ?? bots[0];
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
          channel: "weixin",
          previousId: selected.isNew ? "" : selected.id,
          instance: {
            id: normalized.id,
            name: normalized.name,
            enabled: normalized.enabled,
            agentId: normalized.agentId,
            credentials: {
              baseUrl: normalized.baseUrl
            },
            allowedChatIds: normalized.allowedChatIds
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean)
          }
        })
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to save WeChat settings");

      const fileRes = await fetch("/api/settings/profile-files", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: "bot",
          channel: "weixin",
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

  function normalizeQrLink(value: string): string {
    return value.replace(/\s+/g, "").trim();
  }

  async function loadQrModule(): Promise<QrModule> {
    if (!qrModulePromise) {
      qrModulePromise = import("qrcode") as Promise<QrModule>;
    }
    return qrModulePromise;
  }

  async function generateQrCode(): Promise<void> {
    const link = normalizeQrLink(qrLink);
    qrLink = link;
    qrError = "";
    qrImageUrl = "";

    if (!link) {
      qrError = "先把登录链接贴进来。";
      return;
    }

    try {
      qrLoading = true;
      const qr = await loadQrModule();
      qrImageUrl = await qr.toDataURL(link, {
        width: 320,
        margin: 2,
        errorCorrectionLevel: "M"
      });
    } catch (e) {
      qrError = e instanceof Error ? e.message : String(e);
    } finally {
      qrLoading = false;
    }
  }

  function clearQrCode(): void {
    qrLink = "";
    qrImageUrl = "";
    qrError = "";
  }

  $: selectedBot = bots.find((bot) => bot.id === selectedBotId) ?? bots[0];
  $: selectedBotDirty = selectedBot
    ? botSnapshot(selectedBot) !== (savedSnapshots[selectedBot.id] ?? "")
    : false;

  onMount(loadSettings);
</script>

<PageShell widthClass="max-w-7xl" gapClass="space-y-6">
  <div>
    <h1 class="text-2xl font-semibold">WeChat Settings</h1>
    <p class="text-sm text-slate-400">
      Configure WeChat bots, bind agents, and manage bot-level Markdown overrides.
    </p>
  </div>

  <Alert variant="default">
    首次启用微信 Bot 时，服务日志里会输出登录链接。你可以把那条链接贴到下面的二维码工具里，用手机扫码确认登录。
  </Alert>

  <section class="space-y-4 rounded-xl border border-white/15 bg-[#2b2b2b] p-4">
    <div>
      <h2 class="text-sm font-semibold text-slate-200">Login QR Tool</h2>
      <p class="mt-1 text-xs text-slate-400">
        把日志里的微信登录链接贴进来，页面会生成二维码，方便直接拿手机扫码。
      </p>
    </div>

    <label class="grid gap-1.5 text-sm">
      <span class="text-slate-300">Login Link</span>
      <textarea
        class="min-h-[96px] rounded-lg border border-white/15 bg-[#1f1f1f] px-3 py-2 font-mono text-sm outline-none focus:border-emerald-400"
        bind:value={qrLink}
        placeholder="https://liteapp.weixin.qq.com/q/..."
      ></textarea>
    </label>

    <div class="flex flex-wrap items-center gap-2">
      <Button variant="default" size="sm" type="button" on:click={generateQrCode} disabled={qrLoading}>
        {qrLoading ? "Generating..." : "Generate QR Code"}
      </Button>
      <Button variant="outline" size="sm" type="button" on:click={clearQrCode}>
        Clear
      </Button>
      {#if qrLink}
        <a
          class="inline-flex items-center rounded-lg border border-white/15 px-3 py-1.5 text-xs text-slate-300 hover:border-white/30 hover:text-white"
          href={qrLink}
          target="_blank"
          rel="noreferrer"
        >
          Open Original Link
        </a>
      {/if}
    </div>

    {#if qrImageUrl}
      <div class="flex flex-col items-start gap-3 rounded-lg border border-white/10 bg-[#1f1f1f] p-4">
        <img
          src={qrImageUrl}
          alt="WeChat login QR code"
          class="h-64 w-64 rounded-lg bg-white p-3"
        />
        <p class="text-xs text-slate-400">
          用微信扫码后，在手机里确认登录。
        </p>
      </div>
    {/if}

    {#if qrError}
      <Alert variant="destructive">{qrError}</Alert>
    {/if}
  </section>

  {#if loading}
    <div class="rounded-xl border border-white/15 bg-[#2b2b2b] px-4 py-3 text-sm text-slate-300">
      Loading WeChat settings...
    </div>
  {:else}
    <div class="grid gap-6 lg:grid-cols-[280px_1fr]">
      <section class="space-y-3 rounded-xl border border-white/15 bg-[#2b2b2b] p-4">
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-semibold text-slate-200">Bots</h2>
          <Button variant="outline" size="sm" type="button" on:click={addBot}>
            Add Bot
          </Button>
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
              <Button variant="destructive" size="sm" type="button" on:click={() => removeBot(selectedBot.id)}>
                Remove Bot
              </Button>
            </div>

            <div class="grid gap-3 md:grid-cols-2">
              <label class="grid gap-1.5 text-sm">
                <span class="text-slate-300">Bot ID</span>
                <input
                  class="rounded-lg border border-white/15 bg-[#1f1f1f] px-3 py-2 text-sm outline-none focus:border-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
                  bind:value={selectedBot.id}
                  placeholder="weixin-agent"
                  disabled={!selectedBot.isNew}
                />
              </label>

              <label class="grid gap-1.5 text-sm">
                <span class="text-slate-300">Bot Name</span>
                <input
                  class="rounded-lg border border-white/15 bg-[#1f1f1f] px-3 py-2 text-sm outline-none focus:border-emerald-400"
                  bind:value={selectedBot.name}
                  placeholder="WeChat Bot"
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
              <span class="text-slate-300">API Base URL (optional)</span>
              <input
                class="rounded-lg border border-white/15 bg-[#1f1f1f] px-3 py-2 text-sm outline-none focus:border-emerald-400"
                bind:value={selectedBot.baseUrl}
                placeholder="https://ilinkai.weixin.qq.com"
              />
            </label>

            <label class="grid gap-1.5 text-sm">
              <span class="text-slate-300">Allowed user IDs (comma-separated)</span>
              <input
                class="rounded-lg border border-white/15 bg-[#1f1f1f] px-3 py-2 text-sm outline-none focus:border-emerald-400"
                bind:value={selectedBot.allowedChatIds}
                placeholder="wx_user_id_1,wx_user_id_2"
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

          <Button variant="default" size="md" type="submit" disabled={saving}>
            {saving ? "Saving..." : "Save This Bot"}
          </Button>
          {#if selectedBotDirty}
            <p class="text-xs text-amber-300">Current bot has unsaved changes.</p>
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
