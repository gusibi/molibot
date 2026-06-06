<script lang="ts">
  import { onMount } from "svelte";
  import { Alert, AlertDescription } from "$lib/components/ui/alert";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { NativeSelect, NativeSelectOption } from "$lib/components/ui/native-select";
  import { IosSwitch } from "$lib/components/ui/ios-switch";
  import { Textarea } from "$lib/components/ui/textarea";

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
    sandboxEnabled?: boolean;
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
      sandboxEnabled: undefined,
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
      sandboxEnabled: bot.sandboxEnabled,
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
            sandboxEnabled?: boolean;
          }) => ({
            id: bot.id ?? createBotId(),
            name: bot.name ?? "",
            enabled: bot.enabled ?? true,
            agentId: bot.agentId ?? "",
            baseUrl: bot.credentials?.baseUrl ?? "",
            allowedChatIds: (bot.allowedChatIds ?? []).join(","),
            sandboxEnabled: bot.sandboxEnabled,
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
    const shouldSave = window.confirm('当前 Bot 有未保存变更。点击“确定”先保存并切换，点击“取消”留在当前 Bot。');
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
            sandboxEnabled: selected.sandboxEnabled,
            credentials: { baseUrl: normalized.baseUrl },
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
        return { ...normalized, isNew: false };
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

<div class="channel-page">
  <header class="channel-hero">
    <span class="channel-badge">Channel Runtime</span>
    <h1 class="channel-hero-title">WeChat Settings</h1>
    <p class="channel-hero-desc">
      Configure WeChat bots, bind agents, and manage bot-level Markdown overrides.
    </p>
  </header>

  <Alert variant="default">
    <AlertDescription>
      首次启用微信 Bot 时，服务日志里会输出登录链接。你可以把那条链接贴到下面的二维码工具里，用手机扫码确认登录。
    </AlertDescription>
  </Alert>

  <div class="channel-card">
    <div class="channel-card-header">
      <div>
        <h2 class="channel-card-title">Login QR Tool</h2>
        <p class="channel-card-desc">
          把日志里的微信登录链接贴进来，页面会生成二维码，方便直接拿手机扫码。
        </p>
      </div>
    </div>
    <div class="channel-card-body">
      <div class="channel-field">
        <Label for="qr-link">Login Link</Label>
        <Textarea
          id="qr-link"
          class="channel-textarea"
          style="min-height: 96px"
          bind:value={qrLink}
          placeholder="https://liteapp.weixin.qq.com/q/..."
        />
      </div>

      <div class="channel-password-row">
        <Button variant="default" size="sm" type="button" onclick={generateQrCode} disabled={qrLoading}>
          {qrLoading ? "Generating..." : "Generate QR Code"}
        </Button>
        <Button variant="outline" size="sm" type="button" onclick={clearQrCode}>
          Clear
        </Button>
        {#if qrLink}
          <a
            class="channel-info-box"
            style="display: inline-flex; align-items: center; padding: 0.375rem 0.75rem; font-size: 0.75rem; cursor: pointer; text-decoration: none; color: var(--foreground);"
            href={qrLink}
            target="_blank"
            rel="noreferrer"
          >
            Open Original Link
          </a>
        {/if}
      </div>

      {#if qrImageUrl}
        <div class="channel-qr-result">
          <img
            src={qrImageUrl}
            alt="WeChat login QR code"
          />
          <p>用微信扫码后，在手机里确认登录。</p>
        </div>
      {/if}

      {#if qrError}
        <Alert variant="destructive"><AlertDescription>{qrError}</AlertDescription></Alert>
      {/if}
    </div>
  </div>

  {#if loading}
    <div class="channel-loading">Loading WeChat settings...</div>
  {:else}
    <div class="channel-master-detail">
      <div class="channel-card">
        <div class="channel-card-header">
          <div>
            <h2 class="channel-card-title">Bots</h2>
            <p class="channel-card-desc">{bots.length} configured</p>
          </div>
          <Button variant="outline" size="sm" type="button" onclick={addBot}>Add Bot</Button>
        </div>
        <div class="channel-card-body">
          {#each bots as bot (bot.id)}
            <button
              class="channel-sidebar-btn {selectedBot?.id === bot.id ? 'channel-sidebar-btn--active' : ''}"
              type="button"
              onclick={() => selectBot(bot.id)}
            >
              <span>
                <span class="channel-sidebar-btn-name">{bot.name || bot.id}</span>
                <span class="channel-sidebar-btn-id">{bot.id}</span>
              </span>
              <span class="channel-sidebar-badge {bot.enabled ? 'channel-sidebar-badge--on' : ''}">
                {bot.enabled ? "ON" : "OFF"}
              </span>
            </button>
          {/each}
        </div>
      </div>

      {#if selectedBot}
        <form id="channel-form" class="channel-form" onsubmit={(e) => { e.preventDefault(); save(); }}>
          <div class="channel-card">
            <div class="channel-card-header">
              <div>
                <h2 class="channel-card-title">Bot Configuration</h2>
                <p class="channel-card-desc">Basic connectivity and routing for this channel.</p>
              </div>
              <Button variant="destructive" size="sm" type="button" onclick={() => removeBot(selectedBot.id)}>
                Remove Bot
              </Button>
            </div>
            <div class="channel-card-body">
              <div class="channel-field-row">
                <div class="channel-field">
                  <Label for="wx-bot-id">Bot ID</Label>
                  <Input id="wx-bot-id" bind:value={selectedBot.id} placeholder="weixin-agent" disabled={!selectedBot.isNew} />
                </div>
                <div class="channel-field">
                  <Label for="wx-bot-name">Bot Name</Label>
                  <Input id="wx-bot-name" bind:value={selectedBot.name} placeholder="WeChat Bot" />
                </div>
              </div>
              {#if !selectedBot.isNew}
                <p class="channel-hint">
                  Bot ID is locked after creation to keep workspace paths and references stable.
                </p>
              {/if}

              <div class="channel-toggle-row">
                <div class="channel-toggle-label">
                  <Label for="wx-enabled">Enable this plugin instance</Label>
                  <p>Disabled bots stay saved but are not selectable at runtime.</p>
                </div>
                <IosSwitch id="wx-enabled" bind:checked={selectedBot.enabled} />
              </div>

              <div class="channel-field">
                <Label for="wx-agent">Linked Agent</Label>
                <NativeSelect id="wx-agent" bind:value={selectedBot.agentId}>
                  <NativeSelectOption value="">No agent (global fallback only)</NativeSelectOption>
                  {#each agents.filter((agent) => agent.enabled) as agent (agent.id)}
                    <NativeSelectOption value={agent.id}>{agent.name || agent.id}</NativeSelectOption>
                  {/each}
                </NativeSelect>
              </div>

              <div class="channel-toggle-row">
                <div class="channel-toggle-label">
                  <Label for="wx-sandbox">Sandbox override</Label>
                  <p>Override the global sandbox setting for this bot. Leave unchecked to inherit.</p>
                </div>
                <div class="channel-toggle-controls">
                  {#if selectedBot.sandboxEnabled !== undefined}
                    <Badge variant={selectedBot.sandboxEnabled ? "secondary" : "destructive"}>
                      {selectedBot.sandboxEnabled ? "Force ON" : "Force OFF"}
                    </Badge>
                  {/if}
                  <IosSwitch
                    id="wx-sandbox"
                    checked={selectedBot.sandboxEnabled === true}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        selectedBot.sandboxEnabled = true;
                      } else if (selectedBot.sandboxEnabled === true) {
                        selectedBot.sandboxEnabled = false;
                      } else {
                        selectedBot.sandboxEnabled = undefined;
                      }
                    }}
                  />
                  {#if selectedBot.sandboxEnabled !== undefined}
                    <Button variant="ghost" size="sm" type="button" onclick={() => { selectedBot.sandboxEnabled = undefined; }}>
                      Reset
                    </Button>
                  {/if}
                </div>
              </div>

              <div class="channel-field">
                <Label for="wx-base-url">API Base URL (optional)</Label>
                <Input id="wx-base-url" bind:value={selectedBot.baseUrl} placeholder="https://ilinkai.weixin.qq.com" />
              </div>

              <div class="channel-field">
                <Label for="wx-chat-ids">Allowed user IDs (comma-separated)</Label>
                <Input
                  id="wx-chat-ids"
                  bind:value={selectedBot.allowedChatIds}
                  placeholder="wx_user_id_1,wx_user_id_2"
                />
              </div>
            </div>
          </div>

          <div class="channel-card">
            <div class="channel-card-header">
              <div>
                <h2 class="channel-card-title">Bot Markdown Overrides</h2>
                <p class="channel-card-desc">
                  Files are saved as real Markdown documents with metadata headers. Leave empty to remove the override.
                </p>
              </div>
            </div>
            <div class="channel-accordion">
              {#each botFileNames as fileName}
                <details class="channel-accordion-item">
                  <summary>{fileName}</summary>
                  <div class="channel-accordion-body">
                    <Textarea
                      id="wx-{fileName}"
                      class="channel-textarea"
                      bind:value={selectedBot.profileFiles[fileName]}
                      placeholder={`Edit ${fileName} here`}
                    />
                  </div>
                </details>
              {/each}
            </div>
          </div>
        </form>
      {/if}
    </div>
  {/if}
</div>

<footer class="settings-footbar">
  <div class="settings-footbar-status">
    {#if saving}
      <span class="settings-footbar-saving">
        <span class="settings-footbar-pulse"></span>
        Saving changes...
      </span>
    {:else if message}
      <span class="settings-footbar-ok">{message}</span>
    {/if}
    {#if error}
      <span class="settings-footbar-error">{error}</span>
    {/if}
  </div>
  <div class="settings-footbar-actions">
    <Button variant="outline" size="sm" onclick={loadSettings} disabled={loading || saving}>
      Reset
    </Button>
    <button type="submit" form="channel-form" class="settings-footbar-btn" disabled={loading || saving}>
      {saving ? "Saving..." : "Save WeChat Settings"}
    </button>
  </div>
</footer>
