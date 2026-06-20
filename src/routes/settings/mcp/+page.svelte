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
  };

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
      savedMsg: "MCP 设置保存成功。"
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
      savedMsg: "MCP settings saved."
    }
  };

  let loading = true;
  let saving = false;
  let error = "";
  let message = "";
  let rawJson = "";
  let servers: McpServerDraft[] = [];
  const placeholderJson = `{
  "mcpServers": {
    "browserwing": {
      "type": "http",
      "url": "http://127.0.0.1:9222/api/v1/mcp/message"
    }
  }
}`;

  $: copy = COPY[$locale] ?? COPY["en-US"];

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

  function extractServers(payload: Record<string, unknown>): McpServerDraft[] {
    const out: McpServerDraft[] = [];
    for (const [id, value] of Object.entries(payload)) {
      if (!value || typeof value !== "object") continue;
      const row = value as Record<string, unknown>;
      const url = String((row.http as Record<string, unknown> | undefined)?.url ?? row.url ?? "").trim();
      const command = String((row.stdio as Record<string, unknown> | undefined)?.command ?? row.command ?? "").trim();
      const typeRaw = String(row.type ?? row.transport ?? (url ? "http" : "stdio")).trim().toLowerCase();
      const type = typeRaw === "http" ? "http" : "stdio";
      const name = String(row.name ?? id).trim() || id;
      out.push({
        id,
        name,
        enabled: row.enabled === undefined ? true : Boolean(row.enabled),
        type,
        url,
        command
      });
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
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
      const res = await fetch("/api/settings");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load settings");
      const map = normalizePayload(data.settings?.mcpServers ?? {});
      servers = extractServers(map);
      rawJson = formatMcpJson(map);
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

      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mcpServers: payload })
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to save MCP settings");

      const map = normalizePayload(data.settings?.mcpServers ?? payload);
      servers = extractServers(map);
      rawJson = formatMcpJson(map);
      message = copy.savedMsg;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      saving = false;
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
                  <p class="mcp-server-name">{item.id}</p>
                  <div class="mcp-server-meta">
                    <span class="mcp-pill">{item.type}</span>
                    <span class="mcp-server-detail">
                      {item.type === "http" ? (item.url || copy.missingUrl) : (item.command || copy.missingCommand)}
                    </span>
                  </div>
                </div>
                <div class="mcp-server-toggle">
                  <span class="mcp-toggle-label" data-tone={item.enabled ? 'success' : 'default'}>
                    {item.enabled ? copy.statusActive : copy.statusOff}
                  </span>
                  <IosSwitch
                    bind:checked={item.enabled}
                    onCheckedChange={syncToggleToRawJson}
                  />
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
