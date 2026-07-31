<script lang="ts">
  import { onMount } from "svelte";
  import { Alert, AlertDescription } from "$lib/components/ui/alert";
  import { Button } from "$lib/components/ui/button";
  import { Label } from "$lib/components/ui/label";
  import { Textarea } from "$lib/components/ui/textarea";
  import { IosSwitch } from "$lib/components/ui/ios-switch";
  import { locale } from "$lib/ui/i18n";

  type McpServerDraft = {
    id: string;
    name: string;
    enabled: boolean;
    type: "stdio" | "http";
    url?: string;
    command?: string;
    connectionState: "disabled" | "connecting" | "connected" | "disconnected" | "error";
    toolCount: number;
    lastError: string;
  };

  type McpStatus = Pick<McpServerDraft, "connectionState" | "toolCount" | "lastError"> & { serverId: string };

  const COPY = {
    "zh-CN": {
      eyebrow: "Tooling Surface",
      title: "MCP 服务",
      desc: "配置您的 Model Context Protocol (MCP) 服务。在下方输入包含服务定义的 JSON 块，支持嵌套的 mcpServers 结构或扁平的对象映射。",
      loadingText: "正在加载 MCP 设置...",
      configTitle: "MCP 配置",
      configDesc: "以 JSON 格式定义标准的 stdio 或 http MCP 服务",
      btnReset: "重置",
      btnParse: "格式化并解析",
      jsonSchemaLabel: "MCP JSON 配置内容",
      activeTitle: "活动服务",
      activeDesc: "已解析并配置的工具概要",
      parsedCount: "{count} 已解析",
      emptyState: "尚未配置解析的 MCP 服务。",
      statusActive: "启用",
      statusOff: "禁用",
      missingUrl: "(缺失 URL)",
      missingCommand: "(缺失 command)",
      savingText: "正在保存修改...",
      saveBtn: "保存 MCP 设置",
      savingBtn: "正在保存...",
      loadedMsg: "已加载 {count} 个 MCP 服务。",
      parsedMsg: "已解析 {count} 个 MCP 服务。",
      savedMsg: "MCP 设置保存成功。",
      connected: "已连接",
      connecting: "正在连接…",
      disconnected: "已断开",
      connectionError: "连接失败",
      loadedTools: "{count} 个工具",
      reconnect: "重新连接",
      delete: "删除",
      deleteConfirm: "确认删除这个 MCP 服务吗？",
      enabledMsg: "MCP 服务已启用。",
      disabledMsg: "MCP 服务已关闭。",
      reconnectedMsg: "MCP 已重新连接。",
      deletedMsg: "MCP 服务已删除。",
      saveBeforeAction: "先保存 JSON 修改，再管理连接。"
    },
    "en-US": {
      eyebrow: "Tooling Surface",
      title: "MCP Servers",
      desc: "Configure your Model Context Protocol (MCP) servers. Paste one JSON block containing your server definitions; we support both nested mcpServers layout or a flat object map.",
      loadingText: "Loading MCP settings...",
      configTitle: "MCP Configuration",
      configDesc: "Define standard stdio or http MCP servers in JSON format",
      btnReset: "Reset",
      btnParse: "Format & Parse",
      jsonSchemaLabel: "MCP JSON Schema",
      activeTitle: "Active Servers",
      activeDesc: "Summary of parsed and configured tools",
      parsedCount: "{count} parsed",
      emptyState: "No parsed MCP servers configured yet.",
      statusActive: "Active",
      statusOff: "Off",
      missingUrl: "(missing url)",
      missingCommand: "(missing command)",
      savingText: "Saving changes...",
      saveBtn: "Save MCP Settings",
      savingBtn: "Saving...",
      loadedMsg: "Loaded {count} MCP server(s).",
      parsedMsg: "Parsed {count} MCP server(s).",
      savedMsg: "MCP settings saved.",
      connected: "Connected",
      connecting: "Connecting…",
      disconnected: "Disconnected",
      connectionError: "Connection failed",
      loadedTools: "{count} tools",
      reconnect: "Reconnect",
      delete: "Delete",
      deleteConfirm: "Delete this MCP server?",
      enabledMsg: "MCP server enabled.",
      disabledMsg: "MCP server disabled.",
      reconnectedMsg: "MCP reconnected.",
      deletedMsg: "MCP server deleted.",
      saveBeforeAction: "Save the JSON changes before managing connections."
    }
  };

  let loading = true;
  let saving = false;
  let error = "";
  let message = "";
  let rawJson = "";
  let savedRawJson = "";
  let servers: McpServerDraft[] = [];
  let statuses: McpStatus[] = [];
  let busyId = "";
  const placeholderJson = `{
  "mcpServers": {
    "browserwing": {
      "type": "http",
      "url": "http://127.0.0.1:9222/api/v1/mcp/message"
    }
  }
}`;

  $: copy = COPY[$locale] ?? COPY["en-US"];
  $: hasUnsavedJson = rawJson !== savedRawJson;

  function toMap(input: unknown): Record<string, unknown> {
    if (!input || typeof input !== "object") return {};
    if (Array.isArray(input)) {
      const out: Record<string, unknown> = {};
      for (const row of input) {
        if (!row || typeof row !== "object") continue;
        const id = String((row as Record<string, unknown>).id ?? "").trim();
        if (!id) continue;
        out[id] = row;
      }
      return out;
    }
    return input as Record<string, unknown>;
  }

  function normalizePayload(input: unknown): Record<string, unknown> {
    if (!input || typeof input !== "object") return {};
    const obj = input as Record<string, unknown>;
    if (obj.mcpServers && typeof obj.mcpServers === "object") {
      return toMap(obj.mcpServers);
    }
    return toMap(obj);
  }

  function extractServers(payload: Record<string, unknown>, liveStatuses: McpStatus[] = statuses): McpServerDraft[] {
    const out: McpServerDraft[] = [];
    for (const [id, value] of Object.entries(payload)) {
      if (!value || typeof value !== "object") continue;
      const row = value as Record<string, unknown>;
      const url = String((row.http as Record<string, unknown> | undefined)?.url ?? row.url ?? "").trim();
      const command = String((row.stdio as Record<string, unknown> | undefined)?.command ?? row.command ?? "").trim();
      const typeRaw = String(row.type ?? row.transport ?? (url ? "http" : "stdio")).trim().toLowerCase();
      const type = typeRaw === "http" ? "http" : "stdio";
      const name = String(row.name ?? id).trim() || id;
      const status = liveStatuses.find((item) => item.serverId === id);
      out.push({
        id,
        name,
        enabled: row.enabled === undefined ? true : Boolean(row.enabled),
        type,
        url,
        command,
        connectionState: status?.connectionState ?? (row.enabled === false ? "disabled" : "disconnected"),
        toolCount: status?.toolCount ?? 0,
        lastError: status?.lastError ?? ""
      });
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
  }

  function normalizeStatuses(input: unknown): McpStatus[] {
    if (!Array.isArray(input)) return [];
    return input.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      const serverId = String(row.serverId ?? "").trim();
      const state = String(row.state ?? "disconnected") as McpServerDraft["connectionState"];
      if (!serverId || !["disabled", "connecting", "connected", "disconnected", "error"].includes(state)) return [];
      return [{ serverId, connectionState: state, toolCount: Number(row.toolCount ?? 0), lastError: String(row.lastError ?? "") }];
    });
  }

  function statusLabel(state: McpServerDraft["connectionState"]): string {
    if (state === "connected") return copy.connected;
    if (state === "connecting") return copy.connecting;
    if (state === "error") return copy.connectionError;
    if (state === "disabled") return copy.statusOff;
    return copy.disconnected;
  }

  function applyServerResponse(data: { mcpServers?: unknown; statuses?: unknown }): void {
    statuses = normalizeStatuses(data.statuses);
    const map = normalizePayload(data.mcpServers ?? {});
    servers = extractServers(map, statuses);
    rawJson = formatMcpJson(map);
    savedRawJson = rawJson;
  }

  function formatMcpJson(payload: Record<string, unknown>): string {
    return JSON.stringify({ mcpServers: payload }, null, 2);
  }

  function syncToggleToRawJson(): void {
    try {
      const parsed = JSON.parse(rawJson) as unknown;
      const map = normalizePayload(parsed);
      for (const server of servers) {
        const row = map[server.id];
        if (!row || typeof row !== "object") continue;
        (row as Record<string, unknown>).enabled = server.enabled;
      }
      rawJson = formatMcpJson(map);
    } catch {
      // keep raw as-is when invalid
    }
  }

  function parseRawJson(): void {
    error = "";
    message = "";
    try {
      const parsed = JSON.parse(rawJson) as unknown;
      const map = normalizePayload(parsed);
      servers = extractServers(map);
      message = copy.parsedMsg.replace("{count}", String(servers.length));
      rawJson = formatMcpJson(map);
    } catch (e) {
      servers = [];
      error = e instanceof Error ? e.message : String(e);
    }
  }

  async function loadSettings(): Promise<void> {
    loading = true;
    error = "";
    message = "";
    try {
      const res = await fetch("/api/settings/mcp");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load settings");
      applyServerResponse(data);
      message = copy.loadedMsg.replace("{count}", String(servers.length));
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      rawJson = "{\n  \"mcpServers\": {}\n}";
      servers = [];
    } finally {
      loading = false;
    }
  }

  async function save(): Promise<void> {
    saving = true;
    error = "";
    message = "";
    try {
      parseRawJson();
      if (error) throw new Error(error);
      syncToggleToRawJson();
      const parsed = JSON.parse(rawJson) as { mcpServers?: unknown };
      const payload = parsed.mcpServers ?? {};

      const res = await fetch("/api/settings/mcp", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mcpServers: payload })
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to save MCP settings");

      applyServerResponse({ ...data, mcpServers: data.mcpServers ?? payload });
      message = copy.savedMsg;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      saving = false;
    }
  }

  async function toggleServer(item: McpServerDraft, enabled: boolean): Promise<void> {
    if (busyId) return;
    busyId = item.id;
    error = "";
    message = "";
    try {
      const res = await fetch("/api/settings/mcp", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, enabled })
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to update MCP server");
      applyServerResponse(data);
      message = enabled ? copy.enabledMsg : copy.disabledMsg;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busyId = "";
    }
  }

  async function reconnectServer(id: string): Promise<void> {
    if (busyId) return;
    busyId = id;
    error = "";
    message = "";
    try {
      const res = await fetch("/api/settings/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: "reconnect" })
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to reconnect MCP server");
      applyServerResponse(data);
      message = copy.reconnectedMsg;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busyId = "";
    }
  }

  async function deleteServer(id: string): Promise<void> {
    if (busyId || !window.confirm(copy.deleteConfirm)) return;
    busyId = id;
    error = "";
    message = "";
    try {
      const res = await fetch(`/api/settings/mcp?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to delete MCP server");
      applyServerResponse(data);
      message = copy.deletedMsg;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busyId = "";
    }
  }

  onMount(loadSettings);
</script>

<div class="mcp-page">
  <!-- Hero Header -->
  <header class="mcp-hero">
    <span class="mcp-badge">{copy.eyebrow}</span>
    <h1 class="mcp-hero-title">{copy.title}</h1>
    <p class="mcp-hero-desc">
      {copy.desc}
    </p>
  </header>

  {#if error}
    <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
  {/if}

  {#if loading}
    <div class="mcp-empty-state">
      <span class="animate-pulse">{copy.loadingText}</span>
    </div>
  {:else}
    <form id="mcp-form" class="mcp-form" onsubmit={(e) => { e.preventDefault(); save(); }}>
      <!-- Editor Card -->
      <section class="mcp-card">
        <div class="mcp-card-header">
          <div>
            <h2 class="mcp-card-title">{copy.configTitle}</h2>
            <p class="mcp-card-desc">{copy.configDesc}</p>
          </div>
          <div class="mcp-card-header-actions">
            <Button type="button" variant="outline" size="sm" onclick={loadSettings} disabled={loading || saving}>{copy.btnReset}</Button>
            <Button type="button" variant="outline" size="sm" onclick={parseRawJson} disabled={loading || saving}>{copy.btnParse}</Button>
          </div>
        </div>

        <div class="mcp-textarea-wrapper">
          <Label for="mcp-json" class="mcp-textarea-label">{copy.jsonSchemaLabel}</Label>
          <Textarea
            id="mcp-json"
            class="mcp-prompt-editor"
            bind:value={rawJson}
            placeholder={placeholderJson}
          />
        </div>
      </section>

      <!-- Parsed Servers list -->
      <section class="mcp-card">
        <div class="mcp-card-header">
          <div>
            <h2 class="mcp-card-title">{copy.activeTitle}</h2>
            <p class="mcp-card-desc">{copy.activeDesc}</p>
          </div>
          <span class="mcp-pill">{copy.parsedCount.replace("{count}", String(servers.length))}</span>
        </div>

        {#if servers.length === 0}
          <div class="mcp-empty-state">{copy.emptyState}</div>
        {:else}
          <div class="mcp-grid">
            {#each servers as item}
              <div class="mcp-server-card">
                <div class="mcp-server-info">
                  <p class="mcp-server-name">{item.name}</p>
                  <div class="mcp-server-meta">
                    <span class="mcp-pill">{item.type}</span>
                    <span class="mcp-server-detail">
                      {item.type === "http" ? (item.url || copy.missingUrl) : (item.command || copy.missingCommand)}
                    </span>
                    <span class="mcp-server-detail">{statusLabel(item.connectionState)}{item.connectionState === "connected" ? ` · ${copy.loadedTools.replace("{count}", String(item.toolCount))}` : ""}</span>
                  </div>
                  {#if item.lastError}<p class="mcp-server-error">{item.lastError}</p>{/if}
                </div>
                <div class="mcp-server-actions">
                  {#if hasUnsavedJson}<span class="mcp-server-action-hint">{copy.saveBeforeAction}</span>{/if}
                  <span class="mcp-connection-status" data-state={item.connectionState}>{statusLabel(item.connectionState)}</span>
                  <IosSwitch
                    checked={item.enabled}
                    disabled={Boolean(busyId) || hasUnsavedJson}
                    onCheckedChange={(enabled) => void toggleServer(item, enabled)}
                  />
                  {#if item.enabled && item.connectionState !== "connected"}<Button type="button" variant="outline" size="sm" disabled={Boolean(busyId) || hasUnsavedJson} onclick={() => void reconnectServer(item.id)}>{busyId === item.id ? copy.connecting : copy.reconnect}</Button>{/if}
                  <Button type="button" variant="destructive" size="sm" disabled={Boolean(busyId) || hasUnsavedJson} onclick={() => void deleteServer(item.id)}>{copy.delete}</Button>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </section>
    </form>
  {/if}
</div>

<!-- Fixed Footer Bar -->
<footer class="settings-footbar">
  <div class="settings-footbar-status">
    {#if saving}
      <span class="settings-footbar-saving">
        <span class="settings-footbar-pulse"></span>
        {copy.savingText}
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
      {copy.btnReset}
    </Button>
    <button type="submit" form="mcp-form" class="settings-footbar-btn" disabled={loading || saving}>
      {saving ? copy.savingText : copy.saveBtn}
    </button>
  </div>
</footer>
