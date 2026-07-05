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

  interface TelegramBotForm {
    id: string;
    name: string;
    enabled: boolean;
    streamOutput: boolean;
    agentId: string;
    token: string;
    allowedChatIds: string;
    sandboxEnabled?: boolean;
    profileFiles: Record<string, string>;
    isNew: boolean;
  }

  const botFileNames = ["BOT.md", "SOUL.md", "IDENTITY.md", "SONG.md"];

  const COPY = {
    "zh-CN": {
      eyebrow: "渠道运行环境",
      title: "Telegram 设置",
      desc: "配置 Telegram Bot，将其关联 to Agent，并直接编辑 Bot 级别的 Markdown 覆盖文件。",
      loading: "正在加载 Telegram 设置...",
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
      streamLabel: "启用流式输出",
      streamDesc: "实时流式传输 Agent 响应。默认开启。",
      linkedAgentLabel: "关联 Agent",
      noAgentFallback: "无 Agent（仅使用全局兜底）",
      sandboxLabel: "沙箱覆盖",
      sandboxDesc: "覆盖此 Bot 的全局沙箱设置。留空则继承全局设置。",
      forceOn: "强制开启",
      forceOff: "强制关闭",
      resetBtn: "重置",
      tokenLabel: "Bot Token",
      show: "显示",
      hide: "隐藏",
      allowedChatIdsLabel: "允许的聊天 ID（逗号分隔）",
      overridesTitle: "Bot Markdown 覆盖文件",
      overridesDesc: "文件将保存为包含元数据头部的真实 Markdown 文档。留空则删除覆盖文件。",
      editText: "在此编辑",
      saving: "保存中...",
      savingMsg: "正在保存变更...",
      saveBtn: "保存 Telegram 设置",
      confirmDelete: "确认删除 Telegram Bot 吗？此操作无法撤销。",
      unsavedConfirm: "当前 Bot 有未保存变更。点击“确定”先保存并切换，点击“取消”留在当前 Bot。",
      failedLoad: "加载配置失败",
      failedSave: "保存 Telegram 设置失败",
      failedSaveFiles: "保存配置文件失败",
      savedSuccess: "已保存 Bot："
    },
    "en-US": {
      eyebrow: "Channel Runtime",
      title: "Telegram Settings",
      desc: "Configure Telegram bots, link them to agents, and edit bot-level Markdown overrides.",
      loading: "Loading Telegram settings...",
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
      streamLabel: "Enable streaming output",
      streamDesc: "Stream agent responses in real-time. Default on.",
      linkedAgentLabel: "Linked Agent",
      noAgentFallback: "No agent (global fallback only)",
      sandboxLabel: "Sandbox override",
      sandboxDesc: "Override the global sandbox setting for this bot. Leave unchecked to inherit.",
      forceOn: "Force ON",
      forceOff: "Force OFF",
      resetBtn: "Reset",
      tokenLabel: "Bot token",
      show: "Show",
      hide: "Hide",
      allowedChatIdsLabel: "Allowed chat IDs (comma-separated)",
      overridesTitle: "Bot Markdown Overrides",
      overridesDesc: "Files are saved as real Markdown documents with metadata headers. Leave empty to remove the override.",
      editText: "Edit",
      saving: "Saving...",
      savingMsg: "Saving changes...",
      saveBtn: "Save Telegram Settings",
      confirmDelete: "Delete bot? This cannot be undone.",
      unsavedConfirm: "Current Bot has unsaved changes. Click 'OK' to save and switch, or 'Cancel' to stay on this Bot.",
      failedLoad: "Failed to load settings",
      failedSave: "Failed to save Telegram settings",
      failedSaveFiles: "Failed to save bot files",
      savedSuccess: "Saved bot: "
    }
  } as const;

  let loading = true;
  let saving = false;
  let message = "";
  let error = "";

  let bots: TelegramBotForm[] = [];
  let agents: AgentItem[] = [];
  let selectedBotId = "";
  let savedSnapshots: Record<string, string> = {};
  let showToken = false;

  $: copy = COPY[$locale] ?? COPY["en-US"];

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
      sandboxEnabled: undefined,
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
      sandboxEnabled: bot.sandboxEnabled,
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
      const [agentsRes, instancesRes] = await Promise.all([
        fetch("/api/settings/agent"),
        fetch("/api/settings/channel-instance?channel=telegram")
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
            credentials?: { token?: string; streamOutput?: string };
            allowedChatIds?: string[];
            sandboxEnabled?: boolean;
          }) => ({
            id: bot.id ?? createBotId(),
            name: bot.name ?? "",
            enabled: bot.enabled ?? true,
            streamOutput: String(bot.credentials?.streamOutput ?? "").toLowerCase() !== "false",
            agentId: bot.agentId ?? "",
            token: bot.credentials?.token ?? "",
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
            sandboxEnabled: selected.sandboxEnabled,
            credentials: { token: normalized.token, streamOutput: String(normalized.streamOutput) },
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
          channel: "telegram",
          botId: normalized.id,
          files: normalized.profileFiles
        })
      });
      const fileData = await fileRes.json();
      if (!fileData.ok) throw new Error(fileData.error || copy.failedSaveFiles);

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

      message = `${copy.savedSuccess}${normalized.name || normalized.id}`;
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
                  <Label for="tg-bot-id">{copy.idLabel}</Label>
                  <Input id="tg-bot-id" bind:value={selectedBot.id} placeholder="marketing-bot" disabled={!selectedBot.isNew} />
                </div>
                <div class="channel-field">
                  <Label for="tg-bot-name">{copy.nameLabel}</Label>
                  <Input id="tg-bot-name" bind:value={selectedBot.name} placeholder="Marketing Bot" />
                </div>
              </div>
              {#if !selectedBot.isNew}
                <p class="channel-hint">
                  {copy.idLocked}
                </p>
              {/if}

              <div class="channel-toggle-row">
                <div class="channel-toggle-label">
                  <Label for="tg-enabled">{copy.enableLabel}</Label>
                  <p>{copy.enableDesc}</p>
                </div>
                <IosSwitch id="tg-enabled" bind:checked={selectedBot.enabled} />
              </div>

              <div class="channel-toggle-row">
                <div class="channel-toggle-label">
                  <Label for="tg-stream">{copy.streamLabel}</Label>
                  <p>{copy.streamDesc}</p>
                </div>
                <IosSwitch id="tg-stream" bind:checked={selectedBot.streamOutput} />
              </div>

              <div class="channel-field">
                <Label for="tg-agent">{copy.linkedAgentLabel}</Label>
                <NativeSelect id="tg-agent" bind:value={selectedBot.agentId}>
                  <NativeSelectOption value="">{copy.noAgentFallback}</NativeSelectOption>
                  {#each agents.filter((agent) => agent.enabled) as agent (agent.id)}
                    <NativeSelectOption value={agent.id}>{agent.name || agent.id}</NativeSelectOption>
                  {/each}
                </NativeSelect>
              </div>

              <div class="channel-toggle-row">
                <div class="channel-toggle-label">
                  <Label for="tg-sandbox">{copy.sandboxLabel}</Label>
                  <p>{copy.sandboxDesc}</p>
                </div>
                <div class="channel-toggle-controls">
                  {#if selectedBot.sandboxEnabled !== undefined}
                    <Badge variant={selectedBot.sandboxEnabled ? "secondary" : "destructive"}>
                      {selectedBot.sandboxEnabled ? copy.forceOn : copy.forceOff}
                    </Badge>
                  {/if}
                  <IosSwitch
                    id="tg-sandbox"
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

              <div class="channel-field">
                <Label for="tg-token">{copy.tokenLabel}</Label>
                <div class="channel-password-row">
                  <Input
                    id="tg-token"
                    bind:value={selectedBot.token}
                    type={showToken ? "text" : "password"}
                    placeholder="123456:ABCDEF..."
                  />
                  <Button variant="outline" size="sm" type="button" onclick={() => (showToken = !showToken)}>
                    {showToken ? copy.hide : copy.show}
                  </Button>
                </div>
              </div>

              <div class="channel-field">
                <Label for="tg-chat-ids">{copy.allowedChatIdsLabel}</Label>
                <Input
                  id="tg-chat-ids"
                  bind:value={selectedBot.allowedChatIds}
                  placeholder="123456789,-1001234567890"
                />
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
                      id="tg-{fileName}"
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
