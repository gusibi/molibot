<script lang="ts">
  import { onMount } from "svelte";
  import { Alert, AlertDescription } from "$lib/components/ui/alert";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Card, CardContent, CardHeader, CardTitle } from "$lib/components/ui/card";
  import { Checkbox } from "$lib/components/ui/checkbox";
  import { Label } from "$lib/components/ui/label";
  import { Textarea } from "$lib/components/ui/textarea";
  import SettingsSection from "$lib/components/ui/settings/SettingsSection.svelte";

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

<div class="wb-page">
  <SettingsSection
    title="MCP Servers"
    description="Paste one JSON block. Supports {`{ \"mcpServers\": { ... } }`} or direct object map."
    badge="Tooling Surface"
  >
  <div class="flex gap-2">
    <Button variant="outline" onclick={loadSettings} disabled={loading || saving} class="h-10 px-6 font-bold">Refresh</Button>
    <Button variant="outline" onclick={parseRawJson} disabled={loading || saving} class="h-10 px-6 font-bold">Parse</Button>
  </div>

  {#if message}
    <div class="wb-status-line rounded-lg" data-tone="success">
      <span class="flex items-center gap-2 text-sm font-medium">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
        {message}
      </span>
    </div>
  {/if}
  {#if error}
    <div class="wb-panel-danger">
      <span class="text-sm font-medium">{error}</span>
    </div>
  {/if}

  <div class="wb-panel">
    <div class="wb-field">
      <span class="font-serif text-lg">MCP JSON</span>
      <Textarea
        id="mcp-json"
        class="min-h-[320px] wb-mono text-[13px] leading-relaxed"
        bind:value={rawJson}
        placeholder={placeholderJson}
      />
    </div>
  </div>

  <section class="space-y-4">
    <h2 class="font-serif text-lg px-2">Parsed Servers <span class="wb-muted font-normal text-sm tabular-nums">({servers.length})</span></h2>
    {#if servers.length === 0}
      <div class="wb-empty-state">No parsed MCP servers.</div>
    {:else}
      <div class="wb-grid-2">
        {#each servers as item}
          <div class="wb-panel flex items-center justify-between gap-4">
            <div class="min-w-0 flex-1">
              <p class="truncate font-bold text-foreground">{item.id}</p>
              <div class="mt-1 flex items-center gap-2">
                <span class="wb-pill" data-tone="default">{item.type}</span>
                <p class="truncate wb-muted text-xs tabular-nums">
                  {item.type === "http" ? (item.url || "(missing url)") : (item.command || "(missing command)")}
                </p>
              </div>
            </div>
            <label class="flex items-center gap-3 cursor-pointer select-none">
              <span class="settings-item-label uppercase tracking-wider" data-tone={item.enabled ? 'success' : 'default'}>
                {item.enabled ? "Enabled" : "Disabled"}
              </span>
              <div class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background {item.enabled ? 'bg-primary' : 'bg-input'}"
                onclick={(e) => {
                  e.preventDefault();
                  item.enabled = !item.enabled;
                  servers = [...servers];
                  syncToggleToRawJson();
                }}>
                <span class="pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform {item.enabled ? 'translate-x-4' : 'translate-x-1'}"></span>
              </div>
            </label>
          </div>
        {/each}
      </div>
    {/if}
  </section>
  </SettingsSection>
</div>

<footer class="settings-footbar">
  <div class="settings-footbar-status">
    {#if saving}
      <span class="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <span class="h-2 w-2 animate-pulse rounded-full bg-[#A36A5E]"></span>
        Saving changes...
      </span>
    {:else if message}
      <span class="flex items-center gap-2 text-xs font-medium text-primary">
        <span class="h-2 w-2 rounded-full bg-primary"></span>
        Settings saved
      </span>
    {/if}
  </div>
  <div class="flex items-center gap-3">
    <Button variant="outline" size="sm" onclick={loadSettings} disabled={loading || saving} class="h-9 px-4 text-xs font-bold">
      Reset
    </Button>
    <Button variant="default" size="sm" onclick={save} disabled={loading || saving} class="h-9 px-6 text-xs font-bold">
      {saving ? "Saving..." : "Save MCP Settings"}
    </Button>
  </div>
</footer>

