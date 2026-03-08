<script lang="ts">
  import { onMount } from "svelte";

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

<div class="mx-auto max-w-5xl space-y-6 px-6 py-8 sm:px-10 sm:py-12">
  <div class="flex items-center justify-between gap-3">
    <div>
      <h1 class="text-2xl font-semibold">MCP Servers</h1>
      <p class="text-sm text-slate-400">
        Paste one JSON block. Supports <code>{`{ "mcpServers": { ... } }`}</code> or direct object map.
      </p>
    </div>
    <div class="flex gap-2">
      <button
        class="cursor-pointer rounded-lg border border-white/20 bg-[#2b2b2b] px-3 py-2 text-sm hover:bg-[#343434]"
        on:click={loadSettings}
        disabled={loading || saving}
      >
        Refresh
      </button>
      <button
        class="cursor-pointer rounded-lg border border-sky-500/40 bg-sky-500/15 px-3 py-2 text-sm text-sky-200 hover:bg-sky-500/25 disabled:cursor-not-allowed disabled:opacity-60"
        on:click={parseRawJson}
        disabled={loading || saving}
      >
        Parse
      </button>
      <button
        class="cursor-pointer rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-2 text-sm text-emerald-200 hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-60"
        on:click={save}
        disabled={loading || saving}
      >
        {saving ? "Saving..." : "Save"}
      </button>
    </div>
  </div>

  {#if message}
    <p class="rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-sm text-sky-300">{message}</p>
  {/if}
  {#if error}
    <p class="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</p>
  {/if}

  <label class="block space-y-2">
    <span class="text-sm font-medium text-slate-200">MCP JSON</span>
    <textarea
      class="min-h-[280px] w-full rounded-xl border border-white/15 bg-[#1f1f1f] px-4 py-3 font-mono text-xs outline-none focus:border-emerald-400"
      bind:value={rawJson}
      placeholder={placeholderJson}
    ></textarea>
  </label>

  <section class="space-y-3">
    <h2 class="text-sm font-semibold text-slate-200">Parsed Servers</h2>
    {#if servers.length === 0}
      <div class="rounded-xl border border-white/15 bg-[#2b2b2b] px-4 py-3 text-sm text-slate-300">No parsed MCP servers.</div>
    {:else}
      {#each servers as item}
        <article class="flex items-center justify-between rounded-xl border border-white/15 bg-[#2b2b2b] px-4 py-3 text-sm">
          <div class="min-w-0">
            <p class="truncate font-semibold text-white">{item.id}</p>
            <p class="truncate text-xs text-slate-400">
              {item.type === "http" ? `http: ${item.url || "(missing url)"}` : `stdio: ${item.command || "(missing command)"}`}
            </p>
          </div>
          <label class="inline-flex items-center gap-2 text-xs text-slate-200">
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
</div>
