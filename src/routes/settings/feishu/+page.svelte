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

  interface AgentItem {
    id: string;
    name: string;
    enabled: boolean;
  }

  interface FeishuBotForm {
    id: string;
    name: string;
    enabled: boolean;
    agentId: string;
    appId: string;
    appSecret: string;
    verificationToken: string;
    encryptKey: string;
    allowedChatIds: string;
    streamOutput: boolean;
    sandboxEnabled?: boolean;
    profileFiles: Record<string, string>;
    isNew: boolean;
  }

  interface FeishuTestResult {
    ok: boolean;
    appId?: string;
    botName?: string;
    botOpenId?: string;
    code?: number;
    msg?: string;
    error?: string;
  }

  const botFileNames = ["BOT.md", "SOUL.md", "IDENTITY.md", "SONG.md"];

  let loading = true;
  let saving = false;
  let message = "";
  let error = "";

  let bots: FeishuBotForm[] = [];
  let agents: AgentItem[] = [];
  let selectedBotId = "";
  let savedSnapshots: Record<string, string> = {};
  let showAppSecret = false;
  let testingConnection = false;
  let testResult: FeishuTestResult | null = null;

  function createBotId(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return `feishu-${crypto.randomUUID().slice(0, 8)}`;
    }
    return `feishu-${Math.random().toString(36).slice(2, 10)}`;
  }

  function emptyBotFiles(): Record<string, string> {
    return Object.fromEntries(botFileNames.map((fileName) => [fileName, ""]));
  }

  function createEmptyBot(): FeishuBotForm {
    return {
      id: createBotId(),
      name: "",
      enabled: false,
      agentId: "",
      appId: "",
      appSecret: "",
      verificationToken: "",
      encryptKey: "",
      allowedChatIds: "",
      streamOutput: true,
      sandboxEnabled: undefined,
      profileFiles: emptyBotFiles(),
      isNew: true
    };
  }

  function normalizeBot(bot: FeishuBotForm): FeishuBotForm {
    return {
      ...bot,
      id: bot.id.trim(),
      name: bot.name.trim(),
      enabled: Boolean(bot.enabled),
      agentId: bot.agentId.trim(),
      appId: bot.appId.trim(),
      appSecret: bot.appSecret.trim(),
      verificationToken: bot.verificationToken.trim(),
      encryptKey: bot.encryptKey.trim(),
      allowedChatIds: bot.allowedChatIds
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean)
        .join(","),
      streamOutput: bot.streamOutput !== false,
      sandboxEnabled: bot.sandboxEnabled,
      profileFiles: Object.fromEntries(
        botFileNames.map((fileName) => [fileName, String(bot.profileFiles[fileName] ?? "")])
      ),
      isNew: bot.isNew
    };
  }

  function botSnapshot(bot: FeishuBotForm): string {
    return JSON.stringify(normalizeBot(bot));
  }

  async function loadBotFiles(botId: string): Promise<Record<string, string>> {
    if (!botId) return emptyBotFiles();
    const res = await fetch(
      `/api/settings/profile-files?scope=bot&channel=feishu&botId=${encodeURIComponent(botId)}`
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
      const fromList = Array.isArray(data.settings?.channels?.feishu?.instances)
        ? data.settings.channels.feishu.instances
        : [];

      const mapped = fromList.length > 0
        ? fromList.map((bot: {
            id?: string;
            name?: string;
            enabled?: boolean;
            agentId?: string;
            credentials?: { appId?: string; appSecret?: string; verificationToken?: string; encryptKey?: string; streamOutput?: string };
            allowedChatIds?: string[];
            sandboxEnabled?: boolean;
          }) => ({
            id: bot.id ?? createBotId(),
            name: bot.name ?? "",
            enabled: bot.enabled ?? true,
            agentId: bot.agentId ?? "",
            appId: bot.credentials?.appId ?? "",
            appSecret: bot.credentials?.appSecret ?? "",
            verificationToken: bot.credentials?.verificationToken ?? "",
            encryptKey: bot.credentials?.encryptKey ?? "",
            streamOutput: String(bot.credentials?.streamOutput ?? "").toLowerCase() !== "false",
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
          channel: "feishu",
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
          channel: "feishu",
          previousId: selected.isNew ? "" : selected.id,
          instance: {
            id: normalized.id,
            name: normalized.name,
            enabled: normalized.enabled,
            agentId: normalized.agentId,
            sandboxEnabled: selected.sandboxEnabled,
            credentials: {
              appId: normalized.appId,
              appSecret: normalized.appSecret,
              verificationToken: normalized.verificationToken,
              encryptKey: normalized.encryptKey,
              streamOutput: String(normalized.streamOutput)
            },
            allowedChatIds: normalized.allowedChatIds
              .split(",")
              .map((v) => v.trim())
              .filter(Boolean)
          }
        })
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to save Feishu settings");

      const fileRes = await fetch("/api/settings/profile-files", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: "bot",
          channel: "feishu",
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

  async function testConnection(): Promise<void> {
    const selected = bots.find((bot) => bot.id === selectedBotId) ?? bots[0];
    if (!selected) return;
    testingConnection = true;
    testResult = null;
    error = "";
    message = "";
    try {
      const res = await fetch("/api/settings/feishu/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appId: selected.appId,
          appSecret: selected.appSecret
        })
      });
      const data = await res.json() as FeishuTestResult;
      testResult = data;
      if (!res.ok || !data.ok) {
        error = data.error || data.msg || "Feishu connection test failed";
        return;
      }
      message = `Feishu bot verified: ${data.botName || data.botOpenId || data.appId}`;
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      testResult = { ok: false, error: reason };
      error = reason;
    } finally {
      testingConnection = false;
    }
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
    <h1 class="channel-hero-title">Feishu Settings</h1>
    <p class="channel-hero-desc">
      Configure Feishu bots, link them to agents, and edit bot-level Markdown overrides.
    </p>
  </header>

  {#if loading}
    <div class="channel-loading">Loading Feishu settings...</div>
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
                  <Label for="feishu-bot-id">Bot ID</Label>
                  <Input id="feishu-bot-id" bind:value={selectedBot.id} placeholder="feishu-bot" disabled={!selectedBot.isNew} />
                </div>
                <div class="channel-field">
                  <Label for="feishu-bot-name">Bot Name</Label>
                  <Input id="feishu-bot-name" bind:value={selectedBot.name} placeholder="Feishu Bot" />
                </div>
              </div>
              {#if !selectedBot.isNew}
                <p class="channel-hint">
                  Bot ID is locked after creation to keep workspace paths and references stable.
                </p>
              {/if}

              <div class="channel-toggle-row">
                <div class="channel-toggle-label">
                  <Label for="feishu-enabled">Enable this plugin instance</Label>
                  <p>Disabled bots stay saved but are not selectable at runtime.</p>
                </div>
                <IosSwitch id="feishu-enabled" bind:checked={selectedBot.enabled} />
              </div>

              <div class="channel-toggle-row">
                <div class="channel-toggle-label">
                  <Label for="feishu-stream-output">Stream agent output with CardKit</Label>
                  <p>Stream responses in real-time using Feishu CardKit.</p>
                </div>
                <IosSwitch id="feishu-stream-output" bind:checked={selectedBot.streamOutput} />
              </div>

              <div class="channel-field">
                <Label for="feishu-agent">Linked Agent</Label>
                <NativeSelect id="feishu-agent" bind:value={selectedBot.agentId}>
                  <NativeSelectOption value="">No agent (global fallback only)</NativeSelectOption>
                  {#each agents.filter((agent) => agent.enabled) as agent (agent.id)}
                    <NativeSelectOption value={agent.id}>{agent.name || agent.id}</NativeSelectOption>
                  {/each}
                </NativeSelect>
              </div>

              <div class="channel-toggle-row">
                <div class="channel-toggle-label">
                  <Label for="feishu-sandbox">Sandbox override</Label>
                  <p>Override the global sandbox setting for this bot. Leave unchecked to inherit.</p>
                </div>
                <div class="channel-toggle-controls">
                  {#if selectedBot.sandboxEnabled !== undefined}
                    <Badge variant={selectedBot.sandboxEnabled ? "secondary" : "destructive"}>
                      {selectedBot.sandboxEnabled ? "Force ON" : "Force OFF"}
                    </Badge>
                  {/if}
                  <IosSwitch
                    id="feishu-sandbox"
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

              <div class="channel-field-row">
                <div class="channel-field">
                  <Label for="feishu-app-id">App ID</Label>
                  <Input id="feishu-app-id" bind:value={selectedBot.appId} placeholder="cli_a72xxxxxxxxxxxxx" />
                </div>
                <div class="channel-field">
                  <Label for="feishu-secret">App Secret</Label>
                  <div class="channel-password-row">
                    <Input
                      id="feishu-secret"
                      bind:value={selectedBot.appSecret}
                      type={showAppSecret ? "text" : "password"}
                      placeholder="2Uxxxxxxxxxxxxx"
                    />
                    <Button variant="outline" size="sm" type="button" onclick={() => (showAppSecret = !showAppSecret)}>
                      {showAppSecret ? "Hide" : "Show"}
                    </Button>
                  </div>
                </div>
              </div>

              <div class="channel-field-row">
                <div class="channel-field">
                  <Label for="feishu-verification">Card Verification Token</Label>
                  <Input id="feishu-verification" bind:value={selectedBot.verificationToken} placeholder="Optional, for card callback security" />
                </div>
                <div class="channel-field">
                  <Label for="feishu-encrypt">Card Encrypt Key</Label>
                  <Input id="feishu-encrypt" bind:value={selectedBot.encryptKey} placeholder="Optional, for encrypted callbacks" />
                </div>
              </div>

              <div class="channel-info-box">
                Card callback path: <code>/api/feishu/card</code>
              </div>

              <div class="channel-info-box">
                <div class="channel-card-header">
                  <div>
                    <h3 class="channel-card-title">Connection Health</h3>
                    <p class="channel-card-desc">Validate the current App ID and App Secret without saving or sending messages.</p>
                  </div>
                  <Button variant="secondary" size="sm" type="button" onclick={testConnection} disabled={testingConnection || !selectedBot.appId || !selectedBot.appSecret}>
                    {testingConnection ? "Testing..." : "Test Connection"}
                  </Button>
                </div>
                {#if testResult}
                  <Alert variant={testResult.ok ? "default" : "destructive"}>
                    <AlertDescription>
                      {#if testResult.ok}
                        Bot verified. Name: {testResult.botName || "-"} · open_id: {testResult.botOpenId || "-"} · app_id: {testResult.appId || "-"}
                      {:else}
                        Test failed. {testResult.error || testResult.msg || "Unknown error"}
                        {#if testResult.code !== undefined}
                          · code: {testResult.code}
                        {/if}
                      {/if}
                    </AlertDescription>
                  </Alert>
                {/if}
              </div>

              <div class="channel-field">
                <Label for="feishu-chat-ids">Allowed chat IDs (comma-separated)</Label>
                <Input id="feishu-chat-ids" bind:value={selectedBot.allowedChatIds} placeholder="ou_xxxxxxxx" />
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
                      id="feishu-{fileName}"
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
      {saving ? "Saving..." : "Save Feishu Settings"}
    </button>
  </div>
</footer>
