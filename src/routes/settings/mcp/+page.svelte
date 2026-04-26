<script lang="ts">
  import { onMount } from "svelte";
  import PageShell from "$lib/ui/PageShell.svelte";
  import Button from "$lib/ui/Button.svelte";
  import Alert from "$lib/ui/Alert.svelte";

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

<PageShell widthClass="max-w-5xl" gapClass="space-y-6">
  <header class="wb-hero">
    <div class="wb-hero-copy">
      <p class="wb-eyebrow">Tooling Surface</p>
      <h1>MCP Servers</h1>
      <p class="wb-copy">
        Paste one JSON block. Supports <code>{`{ "mcpServers": { ... } }`}</code> or direct object map.
      </p>
    </div>
    <div class="wb-hero-actions">
      <Button variant="outline" size="md" on:click={loadSettings} disabled={loading || saving}>
        Refresh
      </Button>
      <Button variant="outline" size="md" on:click={parseRawJson} disabled={loading || saving}>
        Parse
      </Button>
      <Button variant="default" size="md" on:click={save} disabled={loading || saving}>
        {saving ? "Saving..." : "Save"}
      </Button>
    </div>
  </header>

  {#if message}
    <Alert>{message}</Alert>
  {/if}
  {#if error}
    <Alert variant="destructive">{error}</Alert>
  {/if}

  <label class="wb-config-panel block space-y-2">
    <span class="text-sm font-medium text-[var(--foreground)]">MCP JSON</span>
    <textarea
      class="min-h-[280px] w-full rounded-xl border border-[var(--border)] bg-[color-mix(in_oklab,var(--card)_88%,transparent)] px-4 py-3 font-mono text-xs outline-none focus:border-[var(--ring)]"
      bind:value={rawJson}
      placeholder={placeholderJson}
    ></textarea>
  </label>

  <section class="space-y-3">
    <h2 class="text-sm font-semibold text-[var(--foreground)]">Parsed Servers</h2>
    {#if servers.length === 0}
      <div class="wb-empty-state text-left">No parsed MCP servers.</div>
    {:else}
      {#each servers as item}
        <article class="wb-config-panel flex items-center justify-between text-sm">
          <div class="min-w-0">
            <p class="truncate font-semibold text-[var(--foreground)]">{item.id}</p>
            <p class="truncate text-xs text-[var(--muted-foreground)]">
              {item.type === "http" ? `http: ${item.url || "(missing url)"}` : `stdio: ${item.command || "(missing command)"}`}
            </p>
          </div>
          <label class="inline-flex items-center gap-2 text-xs text-[var(--foreground)]">
            <input
              type="checkbox"
              checked={item.enabled}
              on:change={(event) => {
                item.enabled = (event.target as HTMLInputElement).checked;
                servers = [...servers];
                syncToggleToRawJson();
              }}
            />
            <span>{item.enabled ? "Enabled" : "Disabled"}</span>
          </label>
        </article>
      {/each}
    {/if}
  </section>
</PageShell>
