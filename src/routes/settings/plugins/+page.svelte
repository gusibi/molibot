<script lang="ts">
  import { onMount } from "svelte";
  import PageShell from "$lib/ui/PageShell.svelte";
  import Button from "$lib/ui/Button.svelte";
  import Alert from "$lib/ui/Alert.svelte";

  type PluginFieldValue = string | boolean;

  interface PluginSettingField {
    key: string;
    label: string;
    type: "boolean" | "text" | "password" | "select";
    description?: string;
    placeholder?: string;
    required?: boolean;
    defaultValue?: PluginFieldValue;
    options?: Array<{ value: string; label: string }>;
  }

  interface CatalogEntry {
    kind: "channel" | "provider" | "feature" | "memory-backend";
    key: string;
    name: string;
    version: string;
    description?: string;
    source: "built-in" | "external";
    status: "active" | "error" | "discovered";
    enabled?: boolean;
    manifestPath?: string;
    entryPath?: string;
    error?: string;
    settingsKey?: string;
    settingsFields?: PluginSettingField[];
  }

  let loading = true;
  let saving = false;
  let message = "";
  let error = "";
  let channelPlugins: CatalogEntry[] = [];
  let providerPlugins: CatalogEntry[] = [];
  let featurePlugins: CatalogEntry[] = [];
  let memoryBackendCatalog: CatalogEntry[] = [];
  let memoryEnabled = false;
  let memoryBackend = "json-file";
  let featurePluginValues: Record<string, Record<string, PluginFieldValue>> = {};

  function readFeatureFieldValue(
    settings: any,
    plugin: CatalogEntry,
    field: PluginSettingField,
  ): PluginFieldValue {
    const pluginSettings = plugin.settingsKey ? settings?.plugins?.[plugin.settingsKey] ?? {} : {};
    if (plugin.key === "cloudflare-html-publish" && field.key === "workerBaseHost") {
      const legacy = pluginSettings?.workerBaseHost ?? pluginSettings?.publicBaseUrl;
      if (legacy !== undefined && legacy !== null && String(legacy).trim()) {
        return String(legacy);
      }
    }
    const raw = pluginSettings?.[field.key];
    if (field.type === "boolean") {
      return raw === undefined ? Boolean(field.defaultValue ?? false) : Boolean(raw);
    }
    if (raw === undefined || raw === null) {
      return typeof field.defaultValue === "string" ? field.defaultValue : "";
    }
    return String(raw);
  }

  function setFeaturePluginDefaults(settings: any): void {
    featurePluginValues = Object.fromEntries(
      featurePlugins.map((plugin) => [
        plugin.key,
        Object.fromEntries(
          (plugin.settingsFields ?? []).map((field) => [
            field.key,
            readFeatureFieldValue(settings, plugin, field),
          ]),
        ),
      ]),
    );
  }

  function getFeatureValue(pluginKey: string, fieldKey: string): PluginFieldValue {
    return featurePluginValues[pluginKey]?.[fieldKey] ?? "";
  }

  function setFeatureValue(pluginKey: string, fieldKey: string, value: PluginFieldValue): void {
    featurePluginValues = {
      ...featurePluginValues,
      [pluginKey]: {
        ...(featurePluginValues[pluginKey] ?? {}),
        [fieldKey]: value,
      },
    };
  }

  async function loadSettings(): Promise<void> {
    loading = true;
    message = "";
    error = "";
    try {
      const res = await fetch("/api/settings");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load settings");
      memoryEnabled = Boolean(data.settings?.plugins?.memory?.enabled);
      memoryBackend = String(
        (data.settings?.plugins?.memory as any)?.backend ?? (data.settings?.plugins?.memory as any)?.core ?? "json-file",
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
      featurePlugins = Array.isArray(pluginData.catalog?.features)
        ? pluginData.catalog.features
        : [];
      memoryBackendCatalog = Array.isArray(pluginData.catalog?.memoryBackends)
        ? pluginData.catalog.memoryBackends
        : [];
      setFeaturePluginDefaults(data.settings);
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
      const featurePluginPatch = Object.fromEntries(
        featurePlugins
          .filter((plugin) => plugin.settingsKey)
          .map((plugin) => [
            plugin.settingsKey as string,
            Object.fromEntries(
              (plugin.settingsFields ?? []).map((field) => {
                const value = getFeatureValue(plugin.key, field.key);
                if (field.type === "boolean") {
                  return [field.key, Boolean(value)];
                }
                return [field.key, String(value ?? "").trim()];
              }),
            ),
          ]),
      );
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plugins: {
            memory: {
              enabled: memoryEnabled,
              backend: memoryBackend || "json-file",
            },
            ...featurePluginPatch,
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

<PageShell widthClass="max-w-3xl" gapClass="space-y-6">
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
                Memory Backend
              </h2>

              <label class="flex items-center gap-3 text-sm text-slate-300">
                <input bind:checked={memoryEnabled} type="checkbox" />
                Enable memory
              </label>

              <label class="grid gap-1.5 text-sm">
                <span class="text-slate-300">Memory backend</span>
                <select
                  class="rounded-lg border border-white/15 bg-[#1f1f1f] px-3 py-2 text-sm outline-none focus:border-emerald-400"
                  bind:value={memoryBackend}
                >
                  <option value="json-file">json-file (built-in backend)</option>
                  <option value="mory">mory (SDK-backed backend)</option>
                </select>
              </label>

              <p class="text-xs leading-5 text-slate-400">
                This is a memory backend switch, not a channel plugin. `json-file`
                keeps the current flat-file behavior. `mory` switches the gateway
                to the SDK-backed SQLite engine without changing the agent-facing API.
              </p>

              <div class="space-y-2 pt-2">
                {#each memoryBackendCatalog as backend}
                  <div
                    class="rounded-lg border border-white/10 bg-[#1f1f1f] px-3 py-3 text-sm"
                  >
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="font-semibold text-slate-100"
                        >{backend.name}</span
                      >
                      <span class="rounded bg-white/10 px-2 py-0.5 text-xs text-slate-300"
                        >{backend.key}</span
                      >
                      <span class="rounded bg-white/10 px-2 py-0.5 text-xs text-slate-300"
                        >{backend.source}</span
                      >
                      <span
                        class={`rounded px-2 py-0.5 text-xs ${
                          backend.status === "error"
                            ? "bg-rose-500/15 text-rose-300"
                            : backend.status === "active"
                              ? "bg-emerald-500/15 text-emerald-300"
                              : "bg-amber-500/15 text-amber-300"
                        }`}
                      >
                        {backend.status}
                      </span>
                      <span class="text-xs text-slate-500"
                        >v{backend.version}</span
                      >
                    </div>

                    {#if backend.description}
                      <p class="mt-2 text-xs text-slate-400">
                        {backend.description}
                      </p>
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
                  Feature Plugins
                </h2>
                <p class="text-xs leading-5 text-slate-400">
                  These plugins add optional product capabilities instead of new chat channels.
                </p>
              </div>

              <div class="space-y-2">
                {#each featurePlugins as plugin}
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
                      <span
                        class={`rounded px-2 py-0.5 text-xs ${
                          plugin.enabled
                            ? "bg-emerald-500/15 text-emerald-300"
                            : "bg-white/10 text-slate-300"
                        }`}
                      >
                        {plugin.enabled ? "enabled" : "disabled"}
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
                  </div>
                {/each}
              </div>
            </section>

            {#each featurePlugins.filter((plugin) => (plugin.settingsFields?.length ?? 0) > 0) as plugin}
              <section
                class="space-y-3 rounded-xl border border-white/15 bg-[#2b2b2b] p-4"
              >
                <div class="space-y-1">
                  <h2 class="text-sm font-semibold text-slate-200">
                    {plugin.name}
                  </h2>
                  {#if plugin.description}
                    <p class="text-xs leading-5 text-slate-400">
                      {plugin.description}
                    </p>
                  {/if}
                </div>

                <div class="grid gap-3 md:grid-cols-2">
                  {#each plugin.settingsFields ?? [] as field}
                    {#if field.type === "boolean"}
                      <label class="flex items-center gap-3 text-sm text-slate-300 md:col-span-2">
                        <input
                          checked={Boolean(getFeatureValue(plugin.key, field.key))}
                          on:change={(event) =>
                            setFeatureValue(plugin.key, field.key, (event.currentTarget as HTMLInputElement).checked)}
                          type="checkbox"
                        />
                        {field.label}
                      </label>
                    {:else if field.type === "select"}
                      <label class="grid gap-1.5 text-sm md:col-span-2">
                        <span class="text-slate-300">
                          {field.label}{field.required ? " *" : ""}
                        </span>
                        <select
                          class="rounded-lg border border-white/15 bg-[#1f1f1f] px-3 py-2 text-sm outline-none focus:border-emerald-400"
                          value={String(getFeatureValue(plugin.key, field.key) ?? "")}
                          on:change={(event) =>
                            setFeatureValue(plugin.key, field.key, (event.currentTarget as HTMLSelectElement).value)}
                        >
                          {#each field.options ?? [] as option}
                            <option value={option.value}>{option.label}</option>
                          {/each}
                        </select>
                        {#if field.description}
                          <span class="text-xs leading-5 text-slate-400">
                            {field.description}
                          </span>
                        {/if}
                      </label>
                    {:else}
                      <label class={`grid gap-1.5 text-sm ${field.key === "objectPrefix" ? "md:col-span-2" : ""}`}>
                        <span class="text-slate-300">
                          {field.label}{field.required ? " *" : ""}
                        </span>
                        <input
                          class="rounded-lg border border-white/15 bg-[#1f1f1f] px-3 py-2 text-sm outline-none focus:border-emerald-400"
                          value={String(getFeatureValue(plugin.key, field.key) ?? "")}
                          on:input={(event) =>
                            setFeatureValue(plugin.key, field.key, (event.currentTarget as HTMLInputElement).value)}
                          placeholder={field.placeholder ?? ""}
                          type={field.type}
                        />
                        {#if field.description}
                          <span class="text-xs leading-5 text-slate-400">
                            {field.description}
                          </span>
                        {/if}
                      </label>
                    {/if}
                  {/each}
                </div>
              </section>
            {/each}

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

            <Button variant="default" size="md" type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save Plugin Settings"}
            </Button>

            {#if message}
              <Alert variant="success">{message}</Alert>
            {/if}
            {#if error}
              <Alert variant="destructive">{error}</Alert>
            {/if}
    </form>
  {/if}
</PageShell>
