<script lang="ts">
  import { onMount } from "svelte";
  import { Alert, AlertDescription } from "$lib/components/ui/alert";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "$lib/components/ui/card";
  import { Checkbox } from "$lib/components/ui/checkbox";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { NativeSelect, NativeSelectOption } from "$lib/components/ui/native-select";
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

<div class="mx-auto flex max-w-7xl flex-col gap-6 px-6 py-8 sm:px-10 sm:py-10">
  <header class="flex flex-col gap-3">
    <Badge variant="secondary" class="w-fit">Channel Runtime</Badge>
    <div class="flex max-w-3xl flex-col gap-2">
      <h1 class="text-3xl font-semibold tracking-tight text-foreground">WeChat Settings</h1>
      <p class="text-sm leading-6 text-muted-foreground">
        Configure WeChat bots, bind agents, and manage bot-level Markdown overrides.
      </p>
    </div>
  </header>

  <Alert variant="default">
    <AlertDescription>
      首次启用微信 Bot 时，服务日志里会输出登录链接。你可以把那条链接贴到下面的二维码工具里，用手机扫码确认登录。
    </AlertDescription>
  </Alert>

  <Card>
    <CardHeader>
      <CardTitle class="text-sm">Login QR Tool</CardTitle>
      <CardDescription>
        把日志里的微信登录链接贴进来，页面会生成二维码，方便直接拿手机扫码。
      </CardDescription>
    </CardHeader>
    <CardContent class="space-y-4">
      <div class="grid gap-1.5">
        <Label for="qr-link">Login Link</Label>
        <Textarea
          id="qr-link"
          class="min-h-[96px] font-mono text-sm"
          bind:value={qrLink}
          placeholder="https://liteapp.weixin.qq.com/q/..."
        />
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <Button variant="default" size="sm" type="button" onclick={generateQrCode} disabled={qrLoading}>
          {qrLoading ? "Generating..." : "Generate QR Code"}
        </Button>
        <Button variant="outline" size="sm" type="button" onclick={clearQrCode}>
          Clear
        </Button>
        {#if qrLink}
          <a
            class="inline-flex items-center rounded-lg border border-border px-3 py-1.5 text-xs text-foreground hover:border-primary hover:text-foreground"
            href={qrLink}
            target="_blank"
            rel="noreferrer"
          >
            Open Original Link
          </a>
        {/if}
      </div>

      {#if qrImageUrl}
        <div class="flex flex-col items-start gap-3 rounded-lg border bg-muted/40 p-4">
          <img
            src={qrImageUrl}
            alt="WeChat login QR code"
            class="h-64 w-64 rounded-lg bg-white p-3"
          />
          <p class="text-xs text-muted-foreground">
            用微信扫码后，在手机里确认登录。
          </p>
        </div>
      {/if}

      {#if qrError}
        <Alert variant="destructive"><AlertDescription>{qrError}</AlertDescription></Alert>
      {/if}
    </CardContent>
  </Card>

  {#if loading}
    <p class="py-8 text-sm text-muted-foreground">Loading WeChat settings...</p>
  {:else}
    <div class="grid gap-6 lg:grid-cols-[280px_1fr]">
      <Card>
        <CardHeader class="pb-3">
          <div class="flex items-center justify-between">
            <CardTitle class="text-sm">Bots</CardTitle>
            <Button variant="outline" size="sm" type="button" onclick={addBot}>Add Bot</Button>
          </div>
        </CardHeader>
        <CardContent class="space-y-1">
          {#each bots as bot (bot.id)}
            <button
              class="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition hover:bg-muted/60 {selectedBot?.id === bot.id ? 'bg-muted' : ''}"
              type="button"
              onclick={() => selectBot(bot.id)}
            >
              <span class="min-w-0">
                <span class="block truncate font-medium text-foreground">{bot.name || bot.id}</span>
                <span class="block truncate text-xs text-muted-foreground">{bot.id}</span>
              </span>
              <Badge variant={bot.enabled ? "default" : "outline"} class="shrink-0 text-[10px]">
                {bot.enabled ? "ON" : "OFF"}
              </Badge>
            </button>
          {/each}
        </CardContent>
      </Card>

      {#if selectedBot}
        <form class="space-y-4" onsubmit={(e) => { e.preventDefault(); save(); }}>
          <Card>
            <CardHeader>
              <div class="flex items-center justify-between">
                <CardTitle class="text-sm">Bot Configuration</CardTitle>
                <Button variant="destructive" size="sm" type="button" onclick={() => removeBot(selectedBot.id)}>
                  Remove Bot
                </Button>
              </div>
            </CardHeader>
            <CardContent class="space-y-4">
              <div class="grid gap-3 md:grid-cols-2">
                <div class="grid gap-1.5">
                  <Label for="wx-bot-id">Bot ID</Label>
                  <Input id="wx-bot-id" bind:value={selectedBot.id} placeholder="weixin-agent" disabled={!selectedBot.isNew} />
                </div>
                <div class="grid gap-1.5">
                  <Label for="wx-bot-name">Bot Name</Label>
                  <Input id="wx-bot-name" bind:value={selectedBot.name} placeholder="WeChat Bot" />
                </div>
              </div>
              {#if !selectedBot.isNew}
                <p class="text-xs text-muted-foreground">
                  Bot ID is locked after creation to keep workspace paths and references stable.
                </p>
              {/if}

              <div class="flex items-center gap-3">
                <Checkbox id="wx-enabled" bind:checked={selectedBot.enabled} />
                <Label for="wx-enabled" class="text-sm">Enable this plugin instance</Label>
              </div>

              <div class="grid gap-1.5">
                <Label for="wx-agent">Linked Agent</Label>
                <NativeSelect id="wx-agent" bind:value={selectedBot.agentId}>
                  <NativeSelectOption value="">No agent (global fallback only)</NativeSelectOption>
                  {#each agents.filter((agent) => agent.enabled) as agent (agent.id)}
                    <NativeSelectOption value={agent.id}>{agent.name || agent.id}</NativeSelectOption>
                  {/each}
                </NativeSelect>
              </div>

              <div class="grid gap-1.5">
                <Label for="wx-base-url">API Base URL (optional)</Label>
                <Input id="wx-base-url" bind:value={selectedBot.baseUrl} placeholder="https://ilinkai.weixin.qq.com" />
              </div>

              <div class="grid gap-1.5">
                <Label for="wx-chat-ids">Allowed user IDs (comma-separated)</Label>
                <Input
                  id="wx-chat-ids"
                  bind:value={selectedBot.allowedChatIds}
                  placeholder="wx_user_id_1,wx_user_id_2"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle class="text-sm">Bot Markdown Overrides</CardTitle>
              <CardDescription>
                Files are saved as real Markdown documents with metadata headers. Leave empty to remove the override.
              </CardDescription>
            </CardHeader>
            <CardContent class="space-y-3">
              {#each botFileNames as fileName}
                <div class="grid gap-1.5">
                  <Label for="wx-{fileName}">{fileName}</Label>
                  <Textarea
                    id="wx-{fileName}"
                    class="min-h-[160px] font-mono text-sm"
                    bind:value={selectedBot.profileFiles[fileName]}
                    placeholder={`Edit ${fileName} here`}
                  />
                </div>
              {/each}
            </CardContent>
          </Card>

          <div class="flex items-center gap-3">
            <Button variant="default" type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save This Bot"}
            </Button>
            {#if selectedBotDirty}
              <span class="text-xs text-muted-foreground">Current bot has unsaved changes.</span>
            {/if}
          </div>

          {#if message}
            <Alert variant="default"><AlertDescription>{message}</AlertDescription></Alert>
          {/if}
          {#if error}
            <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
          {/if}
        </form>
      {/if}
    </div>
  {/if}
</div>
