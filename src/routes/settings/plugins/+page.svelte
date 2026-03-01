<script lang="ts">
  import { onMount } from "svelte";

  interface PluginForm {
    memoryEnabled: boolean;
    memoryCore: string;
  }

  interface CatalogEntry {
    kind: "channel" | "provider";
    key: string;
    name: string;
    version: string;
    description?: string;
    source: "built-in" | "external";
    status: "active" | "error" | "discovered";
    manifestPath?: string;
    entryPath?: string;
    error?: string;
  }

  let loading = true;
  let saving = false;
  let message = "";
  let error = "";
  let channelPlugins: CatalogEntry[] = [];
  let providerPlugins: CatalogEntry[] = [];

  let form: PluginForm = {
    memoryEnabled: false,
    memoryCore: "json-file",
  };

  async function loadSettings(): Promise<void> {
    loading = true;
    message = "";
    error = "";
    try {
      const res = await fetch("/api/settings");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load settings");
      form.memoryEnabled = Boolean(data.settings?.plugins?.memory?.enabled);
      form.memoryCore = String(
        data.settings?.plugins?.memory?.core ?? "json-file",
      );

      const pluginRes = await fetch("/api/settings/plugins");
      const pluginData = await pluginRes.json();
      if (!pluginData.ok)
        throw new Error(pluginData.error || "Failed to load plugin catalog");
      channelPlugins = Array.isArray(pluginData.catalog?.channels)
        ? pluginData.catalog.channels
        : [];
      providerPlugins = Array.isArray(pluginData.catalog?.providers)
        ? pluginData.catalog.providers
        : [];
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  async function save(): Promise<void> {
    saving = true;
    message = "";
    error = "";
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plugins: {
            memory: {
              enabled: form.memoryEnabled,
              core: form.memoryCore || "json-file",
            },
          },
        }),
      });
      const data = await res.json();
      if (!data.ok)
        throw new Error(data.error || "Failed to save plugin settings");
      message = "Plugin settings saved.";
      await loadSettings();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      saving = false;
    }
  }

  onMount(loadSettings);
</script>

<main class="h-screen bg-[#212121] text-slate-100">
  <div class="grid h-full grid-cols-1 lg:grid-cols-[260px_1fr]">
    <aside class="hidden border-r border-white/10 bg-[#171717] p-3 lg:block">
      <nav class="space-y-1 text-sm">
        <a
          class="block rounded-lg px-3 py-2 text-slate-300 transition-colors duration-200 hover:bg-white/10"
          href="/">Chat</a
        >
        <a
          class="block rounded-lg px-3 py-2 text-slate-300 transition-colors duration-200 hover:bg-white/10"
          href="/settings">Settings</a
        >
        <a
          class="block rounded-lg px-3 py-2 text-slate-300 transition-colors duration-200 hover:bg-white/10"
          href="/settings/ai">AI</a
        >
        <a
          class="block rounded-lg px-3 py-2 text-slate-300 transition-colors duration-200 hover:bg-white/10"
          href="/settings/telegram">Telegram</a
        >
        <a
          class="block rounded-lg px-3 py-2 text-slate-300 transition-colors duration-200 hover:bg-white/10"
          href="/settings/feishu">Feishu</a
        >
        <a
          class="block rounded-lg px-3 py-2 text-slate-300 transition-colors duration-200 hover:bg-white/10"
          href="/settings/tasks">Tasks</a
        >
        <a
          class="block rounded-lg px-3 py-2 text-slate-300 transition-colors duration-200 hover:bg-white/10"
          href="/settings/skills">Skills</a
        >
        <a
          class="block rounded-lg bg-white/15 px-3 py-2 font-medium text-white"
          href="/settings/plugins">Plugins</a
        >
        <a
          class="block rounded-lg px-3 py-2 text-slate-300 transition-colors duration-200 hover:bg-white/10"
          href="/settings/memory">Memory</a
        >
      </nav>
    </aside>

    <section class="min-h-0 overflow-y-auto px-4 py-6 sm:px-8">
      <div class="mx-auto max-w-3xl space-y-4">
        <h1 class="text-2xl font-semibold">Plugin Settings</h1>
        <p class="text-sm text-slate-400">
          Enable or disable optional runtime plugins.
        </p>

        {#if loading}
          <div
            class="rounded-xl border border-white/15 bg-[#2b2b2b] px-4 py-3 text-sm text-slate-300"
          >
            Loading plugin settings...
          </div>
        {:else}
          <form class="space-y-4" on:submit|preventDefault={save}>
            <section
              class="space-y-3 rounded-xl border border-white/15 bg-[#2b2b2b] p-4"
            >
              <h2 class="text-sm font-semibold text-slate-200">
                Memory Plugin
              </h2>

              <label class="flex items-center gap-3 text-sm text-slate-300">
                <input bind:checked={form.memoryEnabled} type="checkbox" />
                Enable memory
              </label>

              <label class="grid gap-1.5 text-sm">
                <span class="text-slate-300">Memory core</span>
                <select
                  class="rounded-lg border border-white/15 bg-[#1f1f1f] px-3 py-2 text-sm outline-none focus:border-emerald-400"
                  bind:value={form.memoryCore}
                >
                  <option value="json-file">json-file (built-in)</option>
                  <option value="mory">mory (SDK-backed)</option>
                </select>
              </label>

              <p class="text-xs leading-5 text-slate-400">
                json-file keeps the current flat-file memory behavior. mory
                switches the gateway to the SDK-backed SQLite memory engine
                without changing the agent-facing API.
              </p>
            </section>

            <section
              class="space-y-3 rounded-xl border border-white/15 bg-[#2b2b2b] p-4"
            >
              <div class="space-y-1">
                <h2 class="text-sm font-semibold text-slate-200">
                  Channel Plugins
                </h2>
                <p class="text-xs leading-5 text-slate-400">
                  Built-in channel plugins live in the codebase. External
                  channel plugins are discovered from
                  <code>${"{DATA_DIR}"}/plugins/channels/*/plugin.json</code>.
                </p>
              </div>

              <div class="space-y-2">
                {#each channelPlugins as plugin}
                  <div
                    class="rounded-lg border border-white/10 bg-[#1f1f1f] px-3 py-3 text-sm"
                  >
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="font-semibold text-slate-100"
                        >{plugin.name}</span
                      >
                      <span class="rounded bg-white/10 px-2 py-0.5 text-xs text-slate-300"
                        >{plugin.key}</span
                      >
                      <span class="rounded bg-white/10 px-2 py-0.5 text-xs text-slate-300"
                        >{plugin.source}</span
                      >
                      <span
                        class={`rounded px-2 py-0.5 text-xs ${
                          plugin.status === "error"
                            ? "bg-rose-500/15 text-rose-300"
                            : plugin.status === "active"
                              ? "bg-emerald-500/15 text-emerald-300"
                              : "bg-amber-500/15 text-amber-300"
                        }`}
                      >
                        {plugin.status}
                      </span>
                      <span class="text-xs text-slate-500"
                        >v{plugin.version}</span
                      >
                    </div>

                    {#if plugin.description}
                      <p class="mt-2 text-xs text-slate-400">
                        {plugin.description}
                      </p>
                    {/if}
                    {#if plugin.manifestPath}
                      <p class="mt-2 text-xs text-slate-500">
                        manifest: {plugin.manifestPath}
                      </p>
                    {/if}
                    {#if plugin.entryPath}
                      <p class="mt-1 text-xs text-slate-500">
                        entry: {plugin.entryPath}
                      </p>
                    {/if}
                    {#if plugin.error}
                      <p class="mt-2 text-xs text-rose-300">{plugin.error}</p>
                    {/if}
                  </div>
                {/each}
              </div>
            </section>

            <section
              class="space-y-3 rounded-xl border border-white/15 bg-[#2b2b2b] p-4"
            >
              <div class="space-y-1">
                <h2 class="text-sm font-semibold text-slate-200">
                  Provider Plugins
                </h2>
                <p class="text-xs leading-5 text-slate-400">
                  Built-in providers come from the current codebase. External
                  provider manifests are discovered from
                  <code>${"{DATA_DIR}"}/plugins/providers/*/plugin.json</code>.
                </p>
              </div>

              <div class="space-y-2">
                {#each providerPlugins as plugin}
                  <div
                    class="rounded-lg border border-white/10 bg-[#1f1f1f] px-3 py-3 text-sm"
                  >
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="font-semibold text-slate-100"
                        >{plugin.name}</span
                      >
                      <span class="rounded bg-white/10 px-2 py-0.5 text-xs text-slate-300"
                        >{plugin.key}</span
                      >
                      <span class="rounded bg-white/10 px-2 py-0.5 text-xs text-slate-300"
                        >{plugin.source}</span
                      >
                      <span
                        class={`rounded px-2 py-0.5 text-xs ${
                          plugin.status === "error"
                            ? "bg-rose-500/15 text-rose-300"
                            : plugin.status === "active"
                              ? "bg-emerald-500/15 text-emerald-300"
                              : "bg-amber-500/15 text-amber-300"
                        }`}
                      >
                        {plugin.status}
                      </span>
                      <span class="text-xs text-slate-500"
                        >v{plugin.version}</span
                      >
                    </div>

                    {#if plugin.description}
                      <p class="mt-2 text-xs text-slate-400">
                        {plugin.description}
                      </p>
                    {/if}
                    {#if plugin.manifestPath}
                      <p class="mt-2 text-xs text-slate-500">
                        manifest: {plugin.manifestPath}
                      </p>
                    {/if}
                    {#if plugin.entryPath}
                      <p class="mt-1 text-xs text-slate-500">
                        entry: {plugin.entryPath}
                      </p>
                    {/if}
                    {#if plugin.error}
                      <p class="mt-2 text-xs text-rose-300">{plugin.error}</p>
                    {/if}
                  </div>
                {/each}
              </div>
            </section>

            <button
              class="cursor-pointer rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black transition-colors duration-200 hover:bg-slate-200 disabled:cursor-not-allowed disabled:bg-slate-600 disabled:text-slate-300"
              type="submit"
              disabled={saving}
            >
              {saving ? "Saving..." : "Save Plugin Settings"}
            </button>

            {#if message}
              <p
                class="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300"
              >
                {message}
              </p>
            {/if}
            {#if error}
              <p
                class="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300"
              >
                {error}
              </p>
            {/if}
          </form>
        {/if}
      </div>
    </section>
  </div>
</main>
