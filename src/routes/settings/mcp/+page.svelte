<script lang="ts">
  import { onMount } from "svelte";
  import { Alert, AlertDescription } from "$lib/components/ui/alert";
  import { Button } from "$lib/components/ui/button";
  import { Label } from "$lib/components/ui/label";
  import { Textarea } from "$lib/components/ui/textarea";
  import { Switch } from "$lib/components/ui/switch";

  type McpServerDraft = {
    id: string;
    name: string;
    enabled: boolean;
    type: "stdio" | "http";
    url?: string;
    command?: string;
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
      const typeRaw = String(row.type ?? row.transport ?? "stdio").trim().toLowerCase();
      const type = typeRaw === "http" ? "http" : "stdio";
      const name = String(row.name ?? id).trim() || id;
      out.push({
        id,
        name,
        enabled: row.enabled === undefined ? true : Boolean(row.enabled),
        type,
        url: String((row.http as Record<string, unknown> | undefined)?.url ?? row.url ?? "").trim(),
        command: String((row.stdio as Record<string, unknown> | undefined)?.command ?? row.command ?? "").trim()
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
      message = `Parsed ${servers.length} MCP server(s).`;
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
      message = `Loaded ${servers.length} MCP server(s).`;
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
      message = "MCP settings saved.";
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
    <span class="mcp-badge">Tooling Surface</span>
    <h1 class="mcp-hero-title">MCP Servers</h1>
    <p class="mcp-hero-desc">
      Configure your Model Context Protocol (MCP) servers. Paste one JSON block containing your server definitions; we support both nested <code>mcpServers</code> layout or a flat object map.
    </p>
  </header>

  {#if error}
    <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
  {/if}

  {#if loading}
    <div class="mcp-empty-state">
      <span class="animate-pulse">Loading MCP settings...</span>
    </div>
  {:else}
    <form id="mcp-form" class="mcp-form" onsubmit={(e) => { e.preventDefault(); save(); }}>
      <!-- Editor Card -->
      <section class="mcp-card">
        <div class="mcp-card-header">
          <div>
            <h2 class="mcp-card-title">MCP Configuration</h2>
            <p class="mcp-card-desc">Define standard stdio or http MCP servers in JSON format</p>
          </div>
          <div class="mcp-card-header-actions">
            <Button type="button" variant="outline" size="sm" onclick={loadSettings} disabled={loading || saving}>Reset</Button>
            <Button type="button" variant="outline" size="sm" onclick={parseRawJson} disabled={loading || saving}>Format & Parse</Button>
          </div>
        </div>

        <div class="mcp-textarea-wrapper">
          <Label for="mcp-json" class="mcp-textarea-label">MCP JSON Schema</Label>
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
            <h2 class="mcp-card-title">Active Servers</h2>
            <p class="mcp-card-desc">Summary of parsed and configured tools</p>
          </div>
          <span class="mcp-pill">{servers.length} parsed</span>
        </div>

        {#if servers.length === 0}
          <div class="mcp-empty-state">No parsed MCP servers configured yet.</div>
        {:else}
          <div class="mcp-grid">
            {#each servers as item}
              <div class="mcp-server-card">
                <div class="mcp-server-info">
                  <p class="mcp-server-name">{item.id}</p>
                  <div class="mcp-server-meta">
                    <span class="mcp-pill">{item.type}</span>
                    <span class="mcp-server-detail">
                      {item.type === "http" ? (item.url || "(missing url)") : (item.command || "(missing command)")}
                    </span>
                  </div>
                </div>
                <div class="mcp-server-toggle">
                  <span class="mcp-toggle-label" data-tone={item.enabled ? 'success' : 'default'}>
                    {item.enabled ? "Active" : "Off"}
                  </span>
                  <Switch
                    bind:checked={item.enabled}
                    onchange={syncToggleToRawJson}
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
    <button type="submit" form="mcp-form" class="settings-footbar-btn" disabled={loading || saving}>
      {saving ? "Saving..." : "Save MCP Settings"}
    </button>
  </div>
</footer>



