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

  function readFeatureFieldValue(settings: any, plugin: CatalogEntry, field: PluginSettingField): PluginFieldValue {
    const pluginSettings = plugin.settingsKey ? settings?.plugins?.[plugin.settingsKey] ?? {} : {};
    if (plugin.key === "cloudflare-html-publish" && field.key === "workerBaseHost") {
      const legacy = pluginSettings?.workerBaseHost ?? pluginSettings?.publicBaseUrl;
      if (legacy !== undefined && legacy !== null && String(legacy).trim()) return String(legacy);
    }
    const raw = pluginSettings?.[field.key];
    if (field.type === "boolean") return raw === undefined ? Boolean(field.defaultValue ?? false) : Boolean(raw);
    if (raw === undefined || raw === null) return typeof field.defaultValue === "string" ? field.defaultValue : "";
    return String(raw);
  }

  function setFeaturePluginDefaults(settings: any): void {
    featurePluginValues = Object.fromEntries(
      featurePlugins.map((plugin) => [
        plugin.key,
        Object.fromEntries((plugin.settingsFields ?? []).map((field) => [field.key, readFeatureFieldValue(settings, plugin, field)])),
      ]),
    );
  }

  function getFeatureValue(pluginKey: string, fieldKey: string): PluginFieldValue {
    return featurePluginValues[pluginKey]?.[fieldKey] ?? "";
  }

  function setFeatureValue(pluginKey: string, fieldKey: string, value: PluginFieldValue): void {
    featurePluginValues = { ...featurePluginValues, [pluginKey]: { ...(featurePluginValues[pluginKey] ?? {}), [fieldKey]: value } };
  }

  function statusVariant(status: string): "default" | "destructive" | "secondary" {
    if (status === "error") return "destructive";
    if (status === "active") return "default";
    return "secondary";
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
      memoryBackend = String((data.settings?.plugins?.memory as any)?.backend ?? (data.settings?.plugins?.memory as any)?.core ?? "json-file");

      const pluginRes = await fetch("/api/settings/plugins");
      const pluginData = await pluginRes.json();
      if (!pluginData.ok) throw new Error(pluginData.error || "Failed to load plugin catalog");
      channelPlugins = Array.isArray(pluginData.catalog?.channels) ? pluginData.catalog.channels : [];
      providerPlugins = Array.isArray(pluginData.catalog?.providers) ? pluginData.catalog.providers : [];
      featurePlugins = Array.isArray(pluginData.catalog?.features) ? pluginData.catalog.features : [];
      memoryBackendCatalog = Array.isArray(pluginData.catalog?.memoryBackends) ? pluginData.catalog.memoryBackends : [];
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
                if (field.type === "boolean") return [field.key, Boolean(value)];
                return [field.key, String(value ?? "").trim()];
              }),
            ),
          ]),
      );
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plugins: { memory: { enabled: memoryEnabled, backend: memoryBackend || "json-file" }, ...featurePluginPatch },
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to save plugin settings");
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

<div class="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-8 sm:px-10 sm:py-10">
  <header class="flex flex-col gap-3">
    <Badge variant="secondary" class="w-fit">Runtime Extensions</Badge>
    <div class="flex max-w-3xl flex-col gap-2">
      <h1 class="text-3xl font-semibold tracking-tight text-foreground">Plugin Settings</h1>
      <p class="text-sm leading-6 text-muted-foreground">Enable or disable optional runtime plugins.</p>
    </div>
  </header>

  {#if loading}
    <p class="py-8 text-sm text-muted-foreground">Loading plugin settings...</p>
  {:else}
    <form class="space-y-4" onsubmit={(e) => { e.preventDefault(); save(); }}>
      <Card>
        <CardHeader>
          <CardTitle class="text-sm">Memory Backend</CardTitle>
        </CardHeader>
        <CardContent class="space-y-4">
          <div class="flex items-center gap-3">
            <Checkbox id="pl-mem" bind:checked={memoryEnabled} />
            <Label for="pl-mem" class="text-sm">Enable memory</Label>
          </div>

          <div class="grid gap-1.5">
            <Label for="pl-backend">Memory backend</Label>
            <NativeSelect id="pl-backend" bind:value={memoryBackend}>
              <NativeSelectOption value="json-file">json-file (built-in backend)</NativeSelectOption>
              <NativeSelectOption value="mory">mory (SDK-backed backend)</NativeSelectOption>
            </NativeSelect>
          </div>

          <p class="text-xs text-muted-foreground">
            This is a memory backend switch, not a channel plugin. `json-file` keeps the current flat-file behavior. `mory` switches the gateway to the SDK-backed SQLite engine without changing the agent-facing API.
          </p>

          <div class="space-y-2 pt-2">
            {#each memoryBackendCatalog as backend}
              <div class="rounded-lg border bg-muted/40 px-3 py-3 text-sm">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="font-semibold text-foreground">{backend.name}</span>
                  <Badge variant="secondary">{backend.key}</Badge>
                  <Badge variant="secondary">{backend.source}</Badge>
                  <Badge variant={statusVariant(backend.status)}>{backend.status}</Badge>
                  <span class="text-xs text-muted-foreground">v{backend.version}</span>
                </div>
                {#if backend.description}
                  <p class="mt-2 text-xs text-muted-foreground">{backend.description}</p>
                {/if}
              </div>
            {/each}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle class="text-sm">Feature Plugins</CardTitle>
          <CardDescription>These plugins add optional product capabilities instead of new chat channels.</CardDescription>
        </CardHeader>
        <CardContent class="space-y-2">
          {#each featurePlugins as plugin}
            <div class="rounded-lg border bg-muted/40 px-3 py-3 text-sm">
              <div class="flex flex-wrap items-center gap-2">
                <span class="font-semibold text-foreground">{plugin.name}</span>
                <Badge variant="secondary">{plugin.key}</Badge>
                <Badge variant="secondary">{plugin.source}</Badge>
                <Badge variant={statusVariant(plugin.status)}>{plugin.status}</Badge>
                <Badge variant={plugin.enabled ? "default" : "secondary"}>{plugin.enabled ? "enabled" : "disabled"}</Badge>
                <span class="text-xs text-muted-foreground">v{plugin.version}</span>
              </div>
              {#if plugin.description}
                <p class="mt-2 text-xs text-muted-foreground">{plugin.description}</p>
              {/if}
            </div>
          {/each}
        </CardContent>
      </Card>

      {#each featurePlugins.filter((plugin) => (plugin.settingsFields?.length ?? 0) > 0) as plugin}
        <Card>
          <CardHeader>
            <CardTitle class="text-sm">{plugin.name}</CardTitle>
            {#if plugin.description}
              <CardDescription>{plugin.description}</CardDescription>
            {/if}
          </CardHeader>
          <CardContent>
            <div class="grid gap-3 md:grid-cols-2">
              {#each plugin.settingsFields ?? [] as field}
                {#if field.type === "boolean"}
                  <div class="flex items-center gap-3 md:col-span-2">
                    <Checkbox
                      id="pl-{plugin.key}-{field.key}"
                      checked={Boolean(getFeatureValue(plugin.key, field.key))}
                      onchange={(e) => setFeatureValue(plugin.key, field.key, (e.currentTarget as HTMLInputElement).checked)}
                    />
                    <Label for="pl-{plugin.key}-{field.key}" class="text-sm">{field.label}</Label>
                  </div>
                {:else if field.type === "select"}
                  <div class="grid gap-1.5 md:col-span-2">
                    <Label for="pl-{plugin.key}-{field.key}">{field.label}{field.required ? " *" : ""}</Label>
                    <NativeSelect
                      id="pl-{plugin.key}-{field.key}"
                      value={String(getFeatureValue(plugin.key, field.key) ?? "")}
                      onchange={(e) => setFeatureValue(plugin.key, field.key, (e.currentTarget as HTMLSelectElement).value)}
                    >
                      {#each field.options ?? [] as option}
                        <NativeSelectOption value={option.value}>{option.label}</NativeSelectOption>
                      {/each}
                    </NativeSelect>
                    {#if field.description}
                      <span class="text-xs text-muted-foreground">{field.description}</span>
                    {/if}
                  </div>
                {:else}
                  <div class="grid gap-1.5 {field.key === 'objectPrefix' ? 'md:col-span-2' : ''}">
                    <Label for="pl-{plugin.key}-{field.key}">{field.label}{field.required ? " *" : ""}</Label>
                    <Input
                      id="pl-{plugin.key}-{field.key}"
                      value={String(getFeatureValue(plugin.key, field.key) ?? "")}
                      oninput={(e) => setFeatureValue(plugin.key, field.key, (e.currentTarget as HTMLInputElement).value)}
                      placeholder={field.placeholder ?? ""}
                      type={field.type}
                    />
                    {#if field.description}
                      <span class="text-xs text-muted-foreground">{field.description}</span>
                    {/if}
                  </div>
                {/if}
              {/each}
            </div>
          </CardContent>
        </Card>
      {/each}

      <Card>
        <CardHeader>
          <CardTitle class="text-sm">Channel Plugins</CardTitle>
          <CardDescription>
            Built-in channel plugins live in the codebase. External channel plugins are discovered from <code class="font-mono text-xs">$&#123;"DATA_DIR"&#125;/plugins/channels/*/plugin.json</code>.
          </CardDescription>
        </CardHeader>
        <CardContent class="space-y-2">
          {#each channelPlugins as plugin}
            <div class="rounded-lg border bg-muted/40 px-3 py-3 text-sm">
              <div class="flex flex-wrap items-center gap-2">
                <span class="font-semibold text-foreground">{plugin.name}</span>
                <Badge variant="secondary">{plugin.key}</Badge>
                <Badge variant="secondary">{plugin.source}</Badge>
                <Badge variant={statusVariant(plugin.status)}>{plugin.status}</Badge>
                <span class="text-xs text-muted-foreground">v{plugin.version}</span>
              </div>
              {#if plugin.description}
                <p class="mt-2 text-xs text-muted-foreground">{plugin.description}</p>
              {/if}
              {#if plugin.manifestPath}
                <p class="mt-2 text-xs text-muted-foreground">manifest: {plugin.manifestPath}</p>
              {/if}
              {#if plugin.entryPath}
                <p class="mt-1 text-xs text-muted-foreground">entry: {plugin.entryPath}</p>
              {/if}
              {#if plugin.error}
                <p class="mt-2 text-xs text-destructive">{plugin.error}</p>
              {/if}
            </div>
          {/each}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle class="text-sm">Provider Plugins</CardTitle>
          <CardDescription>
            Built-in providers come from the current codebase. External provider manifests are discovered from <code class="font-mono text-xs">$&#123;"DATA_DIR"&#125;/plugins/providers/*/plugin.json</code>.
          </CardDescription>
        </CardHeader>
        <CardContent class="space-y-2">
          {#each providerPlugins as plugin}
            <div class="rounded-lg border bg-muted/40 px-3 py-3 text-sm">
              <div class="flex flex-wrap items-center gap-2">
                <span class="font-semibold text-foreground">{plugin.name}</span>
                <Badge variant="secondary">{plugin.key}</Badge>
                <Badge variant="secondary">{plugin.source}</Badge>
                <Badge variant={statusVariant(plugin.status)}>{plugin.status}</Badge>
                <span class="text-xs text-muted-foreground">v{plugin.version}</span>
              </div>
              {#if plugin.description}
                <p class="mt-2 text-xs text-muted-foreground">{plugin.description}</p>
              {/if}
              {#if plugin.manifestPath}
                <p class="mt-2 text-xs text-muted-foreground">manifest: {plugin.manifestPath}</p>
              {/if}
              {#if plugin.entryPath}
                <p class="mt-1 text-xs text-muted-foreground">entry: {plugin.entryPath}</p>
              {/if}
              {#if plugin.error}
                <p class="mt-2 text-xs text-destructive">{plugin.error}</p>
              {/if}
            </div>
          {/each}
        </CardContent>
      </Card>

      <Button variant="default" type="submit" disabled={saving}>
        {saving ? "Saving..." : "Save Plugin Settings"}
      </Button>

      {#if message}
        <Alert variant="default"><AlertDescription>{message}</AlertDescription></Alert>
      {/if}
      {#if error}
        <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
      {/if}
    </form>
  {/if}
</div>
