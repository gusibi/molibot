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

  const COPY = {
    "zh-CN": {
      eyebrow: "渠道运行环境",
      title: "微信设置",
      desc: "配置微信 Bot，关联 Agent，并管理 Bot 级别的 Markdown 覆盖文件。",
      alertDesc: "首次启用微信 Bot 时，服务日志里会输出登录链接。你可以把那条链接贴到下面的二维码工具里，用手机扫码确认登录。",
      qrTitle: "登录二维码工具",
      qrDesc: "把日志里的微信登录链接贴进来，页面会生成二维码，方便直接拿手机扫码。",
      qrLinkLabel: "登录链接",
      generateQrBtn: "生成二维码",
      generating: "生成中...",
      clearBtn: "清除",
      openOrigBtn: "打开原始链接",
      qrScanTip: "用微信扫码后，在手机里确认登录。",
      qrErrorLink: "先把登录链接贴进来。",
      loading: "正在加载微信设置...",
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
      linkedAgentLabel: "关联 Agent",
      noAgentFallback: "无 Agent（仅使用全局兜底）",
      sandboxLabel: "沙箱覆盖",
      sandboxDesc: "覆盖此 Bot 的全局沙箱设置。留空则继承全局设置。",
      forceOn: "强制开启",
      forceOff: "强制关闭",
      resetBtn: "重置",
      apiUrlLabel: "API 基准 URL（可选）",
      allowedChatIdsLabel: "允许的用户 ID（逗号分隔）",
      overridesTitle: "Bot Markdown 覆盖文件",
      overridesDesc: "文件将保存为包含元数据头部的真实 Markdown 文档。留空则删除覆盖文件。",
      editText: "在此编辑",
      saving: "保存中...",
      savingMsg: "正在保存变更...",
      saveBtn: "保存微信设置",
      confirmDelete: "确认删除微信 Bot 吗？此操作无法撤销。",
      unsavedConfirm: "当前 Bot 有未保存变更。点击“确定”先保存并切换，点击“取消”留在当前 Bot。",
      failedLoad: "加载配置失败",
      failedSave: "保存微信设置失败",
      failedSaveFiles: "保存配置文件失败",
      savedSuccess: "已保存 Bot："
    },
    "en-US": {
      eyebrow: "Channel Runtime",
      title: "WeChat Settings",
      desc: "Configure WeChat bots, bind agents, and manage bot-level Markdown overrides.",
      alertDesc: "When enabling WeChat bot for the first time, a login link will be output in the service logs. You can paste that link into the QR tool below and scan it with your phone to confirm login.",
      qrTitle: "Login QR Tool",
      qrDesc: "Paste the WeChat login link from the logs here to generate a QR code for easy scanning on your mobile phone.",
      qrLinkLabel: "Login Link",
      generateQrBtn: "Generate QR Code",
      generating: "Generating...",
      clearBtn: "Clear",
      openOrigBtn: "Open Original Link",
      qrScanTip: "Scan the QR code with WeChat, then confirm the login on your phone.",
      qrErrorLink: "Please paste the login link first.",
      loading: "Loading WeChat settings...",
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
      linkedAgentLabel: "Linked Agent",
      noAgentFallback: "No agent (global fallback only)",
      sandboxLabel: "Sandbox override",
      sandboxDesc: "Override the global sandbox setting for this bot. Leave unchecked to inherit.",
      forceOn: "Force ON",
      forceOff: "Force OFF",
      resetBtn: "Reset",
      apiUrlLabel: "API Base URL (optional)",
      allowedChatIdsLabel: "Allowed user IDs (comma-separated)",
      overridesTitle: "Bot Markdown Overrides",
      overridesDesc: "Files are saved as real Markdown documents with metadata headers. Leave empty to remove the override.",
      editText: "Edit",
      saving: "Saving...",
      savingMsg: "Saving changes...",
      saveBtn: "Save WeChat Settings",
      confirmDelete: "Delete bot? This cannot be undone.",
      unsavedConfirm: "Current Bot has unsaved changes. Click 'OK' to save and switch, or 'Cancel' to stay on this Bot.",
      failedLoad: "Failed to load settings",
      failedSave: "Failed to save WeChat settings",
      failedSaveFiles: "Failed to save bot files",
      savedSuccess: "Saved bot: "
    }
  } as const;

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

  $: copy = COPY[$locale] ?? COPY["en-US"];

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
      const [agentsRes, instancesRes] = await Promise.all([
        fetch("/api/settings/agent"),
        fetch("/api/settings/channel-instance?channel=weixin")
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
      if (!data.ok) throw new Error(data.error || copy.failedSave);

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
      qrError = copy.qrErrorLink;
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
    <span class="channel-badge">{copy.eyebrow}</span>
    <h1 class="channel-hero-title">{copy.title}</h1>
    <p class="channel-hero-desc">
      {copy.desc}
    </p>
  </header>

  <Alert variant="default">
    <AlertDescription>
      {copy.alertDesc}
    </AlertDescription>
  </Alert>

  <div class="channel-card">
    <div class="channel-card-header">
      <div>
        <h2 class="channel-card-title">{copy.qrTitle}</h2>
        <p class="channel-card-desc">
          {copy.qrDesc}
        </p>
      </div>
    </div>
    <div class="channel-card-body">
      <div class="channel-field">
        <Label for="qr-link">{copy.qrLinkLabel}</Label>
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
          {qrLoading ? copy.generating : copy.generateQrBtn}
        </Button>
        <Button variant="outline" size="sm" type="button" onclick={clearQrCode}>
          {copy.clearBtn}
        </Button>
        {#if qrLink}
          <a
            class="channel-info-box"
            style="display: inline-flex; align-items: center; padding: 0.375rem 0.75rem; font-size: 0.75rem; cursor: pointer; text-decoration: none; color: var(--foreground);"
            href={qrLink}
            target="_blank"
            rel="noreferrer"
          >
            {copy.openOrigBtn}
          </a>
        {/if}
      </div>

      {#if qrImageUrl}
        <div class="channel-qr-result">
          <img
            src={qrImageUrl}
            alt="WeChat login QR code"
          />
          <p>{copy.qrScanTip}</p>
        </div>
      {/if}

      {#if qrError}
        <Alert variant="destructive"><AlertDescription>{qrError}</AlertDescription></Alert>
      {/if}
    </div>
  </div>

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
                  <Label for="wx-bot-id">{copy.idLabel}</Label>
                  <Input id="wx-bot-id" bind:value={selectedBot.id} placeholder="weixin-agent" disabled={!selectedBot.isNew} />
                </div>
                <div class="channel-field">
                  <Label for="wx-bot-name">{copy.nameLabel}</Label>
                  <Input id="wx-bot-name" bind:value={selectedBot.name} placeholder="WeChat Bot" />
                </div>
              </div>
              {#if !selectedBot.isNew}
                <p class="channel-hint">
                  {copy.idLocked}
                </p>
              {/if}

              <div class="channel-toggle-row">
                <div class="channel-toggle-label">
                  <Label for="wx-enabled">{copy.enableLabel}</Label>
                  <p>{copy.enableDesc}</p>
                </div>
                <IosSwitch id="wx-enabled" bind:checked={selectedBot.enabled} />
              </div>

              <div class="channel-field">
                <Label for="wx-agent">{copy.linkedAgentLabel}</Label>
                <NativeSelect id="wx-agent" bind:value={selectedBot.agentId}>
                  <NativeSelectOption value="">{copy.noAgentFallback}</NativeSelectOption>
                  {#each agents.filter((agent) => agent.enabled) as agent (agent.id)}
                    <NativeSelectOption value={agent.id}>{agent.name || agent.id}</NativeSelectOption>
                  {/each}
                </NativeSelect>
              </div>

              <div class="channel-toggle-row">
                <div class="channel-toggle-label">
                  <Label for="wx-sandbox">{copy.sandboxLabel}</Label>
                  <p>{copy.sandboxDesc}</p>
                </div>
                <div class="channel-toggle-controls">
                  {#if selectedBot.sandboxEnabled !== undefined}
                    <Badge variant={selectedBot.sandboxEnabled ? "secondary" : "destructive"}>
                      {selectedBot.sandboxEnabled ? copy.forceOn : copy.forceOff}
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
                      {copy.resetBtn}
                    </Button>
                  {/if}
                </div>
              </div>

              <div class="channel-field">
                <Label for="wx-base-url">{copy.apiUrlLabel}</Label>
                <Input id="wx-base-url" bind:value={selectedBot.baseUrl} placeholder="https://ilinkai.weixin.qq.com" />
              </div>

              <div class="channel-field">
                <Label for="wx-chat-ids">{copy.allowedChatIdsLabel}</Label>
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
                      id="wx-{fileName}"
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
