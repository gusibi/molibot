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
  import { locale } from "$lib/ui/i18n";

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

  const COPY = {
    "zh-CN": {
      eyebrow: "渠道运行环境",
      title: "飞书设置",
      desc: "配置飞书 Bot，将其关联到 Agent，并编辑 Bot 级别的 Markdown 覆盖文件。",
      loading: "正在加载飞书设置...",
      botsTitle: "Bots",
      listDesc: "个已配置",
      addBtn: "添加 Bot",
      statusOn: "启用",
      statusOff: "禁用",
      configTitle: "Bot 配置",
      configDesc: "此渠道的基本连接与路由设置。",
      removeBtn: "删除 Bot",
      idLabel: "Bot ID",
      nameLabel: "Bot 名称",
      idLocked: "创建后 Bot ID 将被锁定，以保持工作区路径和引用稳定。",
      enableLabel: "启用该插件实例",
      enableDesc: "禁用的 Bot 将保留但无法在运行时选择。",
      streamLabel: "使用 CardKit 启用流式输出",
      streamDesc: "使用飞书 CardKit 实时流式传输响应。",
      linkedAgentLabel: "关联 Agent",
      noAgentFallback: "无 Agent（仅使用全局兜底）",
      sandboxLabel: "沙箱覆盖",
      sandboxDesc: "覆盖此 Bot 的全局沙箱设置。留空则继承全局设置。",
      forceOn: "强制开启",
      forceOff: "强制关闭",
      resetBtn: "重置",
      appIdLabel: "App ID",
      appSecretLabel: "App Secret",
      show: "显示",
      hide: "隐藏",
      verifyTokenLabel: "卡片验证 Token",
      verifyTokenPlaceholder: "可选，用于卡片回调安全",
      encryptKeyLabel: "卡片加密 Key",
      encryptKeyPlaceholder: "可选，用于加密回调",
      callbackPathLabel: "卡片回调路径：",
      healthTitle: "连接健康度",
      healthDesc: "验证当前的 App ID 和 App Secret，无需保存或发送消息。",
      testBtn: "测试连接",
      testing: "测试中...",
      testSuccess: "Bot 验证成功。名称：",
      testFailed: "测试失败。",
      unknownError: "未知错误",
      allowedChatIdsLabel: "允许的聊天 ID（逗号分隔）",
      overridesTitle: "Bot Markdown 覆盖文件",
      overridesDesc: "文件将保存为包含元数据头部的真实 Markdown 文档。留空则删除覆盖文件。",
      editText: "在此编辑",
      saving: "保存中...",
      savingMsg: "正在保存变更...",
      saveBtn: "保存飞书设置",
      confirmDelete: "确认删除飞书 Bot 吗？此操作无法撤销。",
      unsavedConfirm: "当前 Bot 有未保存变更。点击“确定”先保存并切换，点击“取消”留在当前 Bot。",
      failedLoad: "加载配置失败",
      failedSave: "保存飞书设置失败",
      failedSaveFiles: "保存配置文件失败",
      savedSuccess: "已保存 Bot："
    },
    "en-US": {
      eyebrow: "Channel Runtime",
      title: "Feishu Settings",
      desc: "Configure Feishu bots, link them to agents, and edit bot-level Markdown overrides.",
      loading: "Loading Feishu settings...",
      botsTitle: "Bots",
      listDesc: "configured",
      addBtn: "Add Bot",
      statusOn: "ON",
      statusOff: "OFF",
      configTitle: "Bot Configuration",
      configDesc: "Basic connectivity and routing for this channel.",
      removeBtn: "Remove Bot",
      idLabel: "Bot ID",
      nameLabel: "Bot Name",
      idLocked: "Bot ID is locked after creation to keep workspace paths and references stable.",
      enableLabel: "Enable this plugin instance",
      enableDesc: "Disabled bots stay saved but are not selectable at runtime.",
      streamLabel: "Stream agent output with CardKit",
      streamDesc: "Stream responses in real-time using Feishu CardKit.",
      linkedAgentLabel: "Linked Agent",
      noAgentFallback: "No agent (global fallback only)",
      sandboxLabel: "Sandbox override",
      sandboxDesc: "Override the global sandbox setting for this bot. Leave unchecked to inherit.",
      forceOn: "Force ON",
      forceOff: "Force OFF",
      resetBtn: "Reset",
      appIdLabel: "App ID",
      appSecretLabel: "App Secret",
      show: "Show",
      hide: "Hide",
      verifyTokenLabel: "Card Verification Token",
      verifyTokenPlaceholder: "Optional, for card callback security",
      encryptKeyLabel: "Card Encrypt Key",
      encryptKeyPlaceholder: "Optional, for encrypted callbacks",
      callbackPathLabel: "Card callback path: ",
      healthTitle: "Connection Health",
      healthDesc: "Validate the current App ID and App Secret without saving or sending messages.",
      testBtn: "Test Connection",
      testing: "Testing...",
      testSuccess: "Bot verified. Name: ",
      testFailed: "Test failed. ",
      unknownError: "Unknown error",
      allowedChatIdsLabel: "Allowed chat IDs (comma-separated)",
      overridesTitle: "Bot Markdown Overrides",
      overridesDesc: "Files are saved as real Markdown documents with metadata headers. Leave empty to remove the override.",
      editText: "Edit",
      saving: "Saving...",
      savingMsg: "Saving changes...",
      saveBtn: "Save Feishu Settings",
      confirmDelete: "Delete bot? This cannot be undone.",
      unsavedConfirm: "Current Bot has unsaved changes. Click 'OK' to save and switch, or 'Cancel' to stay on this Bot.",
      failedLoad: "Failed to load settings",
      failedSave: "Failed to save Feishu settings",
      failedSaveFiles: "Failed to save bot files",
      savedSuccess: "Saved bot: "
    }
  } as const;

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

  $: copy = COPY[$locale] ?? COPY["en-US"];

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
      const [agentsRes, instancesRes] = await Promise.all([
        fetch("/api/settings/agent"),
        fetch("/api/settings/channel-instance?channel=feishu")
      ]);
      const agentsData = await agentsRes.json();
      const instancesData = await instancesRes.json();
      if (!agentsData.ok) throw new Error(agentsData.error || copy.failedLoad);
      if (!instancesData.ok) throw new Error(instancesData.error || copy.failedLoad);

      agents = Array.isArray(agentsData.agents) ? agentsData.agents : [];
      const fromList = Array.isArray(instancesData.instances)
        ? instancesData.instances
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
    const shouldSave = window.confirm(copy.unsavedConfirm);
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
        : window.confirm(copy.confirmDelete.replace("{botId}", botId));
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
      if (!data.ok) throw new Error(data.error || copy.failedSave);

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
      if (!fileData.ok) throw new Error(fileData.error || copy.failedSaveFiles);

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

      message = `${copy.savedSuccess}${normalized.name || normalized.id}`;
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
        error = data.error || data.msg || copy.testFailed;
        return;
      }
      message = `${copy.testSuccess}${data.botName || data.botOpenId || data.appId}`;
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
    <span class="channel-badge">{copy.eyebrow}</span>
    <h1 class="channel-hero-title">{copy.title}</h1>
    <p class="channel-hero-desc">
      {copy.desc}
    </p>
  </header>

  {#if loading}
    <div class="channel-loading">{copy.loading}</div>
  {:else}
    <div class="channel-master-detail">
      <div class="channel-card">
        <div class="channel-card-header">
          <div>
            <h2 class="channel-card-title">{copy.botsTitle}</h2>
            <p class="channel-card-desc">{bots.length} {copy.listDesc}</p>
          </div>
          <Button variant="outline" size="sm" type="button" onclick={addBot}>{copy.addBtn}</Button>
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
                {bot.enabled ? copy.statusOn : copy.statusOff}
              </span>
            </button>
          {/each}
        </div>
      </div>

      {#if selectedBot}
        <form id="channel-form" class="channel-form" onsubmit={(e) => { e.preventDefault(); void save(); }}>
          <div class="channel-card">
            <div class="channel-card-header">
              <div>
                <h2 class="channel-card-title">{copy.configTitle}</h2>
                <p class="channel-card-desc">{copy.configDesc}</p>
              </div>
              <Button variant="destructive" size="sm" type="button" onclick={() => removeBot(selectedBot.id)}>
                {copy.removeBtn}
              </Button>
            </div>
            <div class="channel-card-body">
              <div class="channel-field-row">
                <div class="channel-field">
                  <Label for="feishu-bot-id">{copy.idLabel}</Label>
                  <Input id="feishu-bot-id" bind:value={selectedBot.id} placeholder="feishu-bot" disabled={!selectedBot.isNew} />
                </div>
                <div class="channel-field">
                  <Label for="feishu-bot-name">{copy.nameLabel}</Label>
                  <Input id="feishu-bot-name" bind:value={selectedBot.name} placeholder="Feishu Bot" />
                </div>
              </div>
              {#if !selectedBot.isNew}
                <p class="channel-hint">
                  {copy.idLocked}
                </p>
              {/if}

              <div class="channel-toggle-row">
                <div class="channel-toggle-label">
                  <Label for="feishu-enabled">{copy.enableLabel}</Label>
                  <p>{copy.enableDesc}</p>
                </div>
                <IosSwitch id="feishu-enabled" bind:checked={selectedBot.enabled} />
              </div>

              <div class="channel-toggle-row">
                <div class="channel-toggle-label">
                  <Label for="feishu-stream-output">{copy.streamLabel}</Label>
                  <p>{copy.streamDesc}</p>
                </div>
                <IosSwitch id="feishu-stream-output" bind:checked={selectedBot.streamOutput} />
              </div>

              <div class="channel-field">
                <Label for="feishu-agent">{copy.linkedAgentLabel}</Label>
                <NativeSelect id="feishu-agent" bind:value={selectedBot.agentId}>
                  <NativeSelectOption value="">{copy.noAgentFallback}</NativeSelectOption>
                  {#each agents.filter((agent) => agent.enabled) as agent (agent.id)}
                    <NativeSelectOption value={agent.id}>{agent.name || agent.id}</NativeSelectOption>
                  {/each}
                </NativeSelect>
              </div>

              <div class="channel-toggle-row">
                <div class="channel-toggle-label">
                  <Label for="feishu-sandbox">{copy.sandboxLabel}</Label>
                  <p>{copy.sandboxDesc}</p>
                </div>
                <div class="channel-toggle-controls">
                  {#if selectedBot.sandboxEnabled !== undefined}
                    <Badge variant={selectedBot.sandboxEnabled ? "secondary" : "destructive"}>
                      {selectedBot.sandboxEnabled ? copy.forceOn : copy.forceOff}
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
                      {copy.resetBtn}
                    </Button>
                  {/if}
                </div>
              </div>

              <div class="channel-field-row">
                <div class="channel-field">
                  <Label for="feishu-app-id">{copy.appIdLabel}</Label>
                  <Input id="feishu-app-id" bind:value={selectedBot.appId} placeholder="cli_a72xxxxxxxxxxxxx" />
                </div>
                <div class="channel-field">
                  <Label for="feishu-secret">{copy.appSecretLabel}</Label>
                  <div class="channel-password-row">
                    <Input
                      id="feishu-secret"
                      bind:value={selectedBot.appSecret}
                      type={showAppSecret ? "text" : "password"}
                      placeholder="2Uxxxxxxxxxxxxx"
                    />
                    <Button variant="outline" size="sm" type="button" onclick={() => (showAppSecret = !showAppSecret)}>
                      {showAppSecret ? copy.hide : copy.show}
                    </Button>
                  </div>
                </div>
              </div>

              <div class="channel-field-row">
                <div class="channel-field">
                  <Label for="feishu-verification">{copy.verifyTokenLabel}</Label>
                  <Input id="feishu-verification" bind:value={selectedBot.verificationToken} placeholder={copy.verifyTokenPlaceholder} />
                </div>
                <div class="channel-field">
                  <Label for="feishu-encrypt">{copy.encryptKeyLabel}</Label>
                  <Input id="feishu-encrypt" bind:value={selectedBot.encryptKey} placeholder={copy.encryptKeyPlaceholder} />
                </div>
              </div>

              <div class="channel-info-box">
                {copy.callbackPathLabel} <code>/api/feishu/card</code>
              </div>

              <div class="channel-info-box">
                <div class="channel-card-header">
                  <div>
                    <h3 class="channel-card-title">{copy.healthTitle}</h3>
                    <p class="channel-card-desc">{copy.healthDesc}</p>
                  </div>
                  <Button variant="secondary" size="sm" type="button" onclick={testConnection} disabled={testingConnection || !selectedBot.appId || !selectedBot.appSecret}>
                    {testingConnection ? copy.testing : copy.testBtn}
                  </Button>
                </div>
                {#if testResult}
                  <Alert variant={testResult.ok ? "default" : "destructive"}>
                    <AlertDescription>
                      {#if testResult.ok}
                        {copy.testSuccess} {testResult.botName || "-"} · open_id: {testResult.botOpenId || "-"} · app_id: {testResult.appId || "-"}
                      {:else}
                        {copy.testFailed} {testResult.error || testResult.msg || copy.unknownError}
                        {#if testResult.code !== undefined}
                          · code: {testResult.code}
                        {/if}
                      {/if}
                    </AlertDescription>
                  </Alert>
                {/if}
              </div>

              <div class="channel-field">
                <Label for="feishu-chat-ids">{copy.allowedChatIdsLabel}</Label>
                <Input id="feishu-chat-ids" bind:value={selectedBot.allowedChatIds} placeholder="ou_xxxxxxxx" />
              </div>
            </div>
          </div>

          <div class="channel-card">
            <div class="channel-card-header">
              <div>
                <h2 class="channel-card-title">{copy.overridesTitle}</h2>
                <p class="channel-card-desc">
                  {copy.overridesDesc}
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
                      placeholder={`${copy.editText} ${fileName}`}
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
        {copy.saving}
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
      {copy.resetBtn}
    </Button>
    <button type="submit" form="channel-form" class="settings-footbar-btn" disabled={loading || saving}>
      {saving ? copy.saving : copy.saveBtn}
    </button>
  </div>
</footer>
