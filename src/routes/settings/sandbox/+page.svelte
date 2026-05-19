<script lang="ts">
  import { onMount } from "svelte";
  import { Alert, AlertDescription } from "$lib/components/ui/alert";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "$lib/components/ui/card";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { NativeSelect, NativeSelectOption } from "$lib/components/ui/native-select";
  import { Switch } from "$lib/components/ui/switch";
  import { Textarea } from "$lib/components/ui/textarea";

  type InitFailureMode = "warn-disable" | "block";
  type EnvInheritMode = "minimal" | "allowlist" | "full";

  interface ToolSandboxSettings {
    enabled: boolean;
    initFailureMode: InitFailureMode;
    envFilePath: string;
    env: {
      inheritMode: EnvInheritMode;
      allow: string[];
      deny: string[];
    };
    network: {
      allowedDomains: string[];
      deniedDomains: string[];
    };
    filesystem: {
      denyRead: string[];
      allowWrite: string[];
      denyWrite: string[];
    };
  }

  interface Diagnostics {
    enabled: boolean;
    platform: string;
    supportedPlatform: boolean;
    dependenciesAvailable: boolean;
    envFilePath: string;
    envFileExists: boolean;
    envFileReadable: boolean;
    envFileError?: string;
    envKeysAvailable: string[];
    envKeysInjected: string[];
    envKeysDenied: string[];
    envKeysMissing: string[];
    sandboxInitialized: boolean;
    sandboxError?: string;
    effectiveNetwork: ToolSandboxSettings["network"];
    effectiveFilesystem: ToolSandboxSettings["filesystem"];
  }

  const defaultSandbox: ToolSandboxSettings = {
    enabled: false,
    initFailureMode: "warn-disable",
    envFilePath: ".env.sandbox.local",
    env: {
      inheritMode: "minimal",
      allow: [],
      deny: []
    },
    network: {
      allowedDomains: [
        "npmjs.org",
        "*.npmjs.org",
        "registry.npmjs.org",
        "registry.yarnpkg.com",
        "pypi.org",
        "*.pypi.org",
        "github.com",
        "*.github.com",
        "api.github.com",
        "raw.githubusercontent.com"
      ],
      deniedDomains: []
    },
    filesystem: {
      denyRead: ["~/.ssh", "~/.aws", "~/.gnupg", ".env", ".env.*", ".env.sandbox.local"],
      allowWrite: [".", "/tmp"],
      denyWrite: [".env", ".env.*", "*.pem", "*.key"]
    }
  };

  let loading = true;
  let saving = false;
  let diagnosing = false;
  let message = "";
  let error = "";
  let sandbox: ToolSandboxSettings = structuredClone(defaultSandbox);
  let diagnostics: Diagnostics | null = null;

  let envAllowText = "";
  let envDenyText = "";
  let networkAllowText = "";
  let networkDenyText = "";
  let denyReadText = "";
  let allowWriteText = "";
  let denyWriteText = "";

  function listToText(values: string[]): string {
    return values.join("\n");
  }

  function textToList(value: string): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const row of value.split(/\r?\n|,/)) {
      const item = row.trim();
      if (!item || seen.has(item)) continue;
      seen.add(item);
      out.push(item);
    }
    return out;
  }

  function syncTextFromSandbox(): void {
    envAllowText = listToText(sandbox.env.allow);
    envDenyText = listToText(sandbox.env.deny);
    networkAllowText = listToText(sandbox.network.allowedDomains);
    networkDenyText = listToText(sandbox.network.deniedDomains);
    denyReadText = listToText(sandbox.filesystem.denyRead);
    allowWriteText = listToText(sandbox.filesystem.allowWrite);
    denyWriteText = listToText(sandbox.filesystem.denyWrite);
  }

  function buildPatch(): ToolSandboxSettings {
    return {
      ...sandbox,
      env: {
        inheritMode: sandbox.env.inheritMode,
        allow: textToList(envAllowText),
        deny: textToList(envDenyText)
      },
      network: {
        allowedDomains: textToList(networkAllowText),
        deniedDomains: textToList(networkDenyText)
      },
      filesystem: {
        denyRead: textToList(denyReadText),
        allowWrite: textToList(allowWriteText),
        denyWrite: textToList(denyWriteText)
      }
    };
  }

  function badgeVariant(ok: boolean): "default" | "destructive" | "secondary" {
    return ok ? "default" : "destructive";
  }

  function previewKeys(keys: string[]): string {
    if (keys.length === 0) return "None";
    if (keys.length <= 12) return keys.join(", ");
    return `${keys.slice(0, 12).join(", ")} +${keys.length - 12} more`;
  }

  async function loadSettings(): Promise<void> {
    loading = true;
    message = "";
    error = "";
    try {
      const res = await fetch("/api/settings");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load settings");
      sandbox = { ...structuredClone(defaultSandbox), ...(data.settings?.toolSandbox ?? {}) };
      sandbox.env = { ...defaultSandbox.env, ...(data.settings?.toolSandbox?.env ?? {}) };
      sandbox.network = { ...defaultSandbox.network, ...(data.settings?.toolSandbox?.network ?? {}) };
      sandbox.filesystem = { ...defaultSandbox.filesystem, ...(data.settings?.toolSandbox?.filesystem ?? {}) };
      syncTextFromSandbox();
      await runDiagnostics();
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
      const next = buildPatch();
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolSandbox: next })
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to save sandbox settings");
      sandbox = data.settings.toolSandbox;
      syncTextFromSandbox();
      message = "Sandbox settings saved. New runs will use the updated policy.";
      await runDiagnostics();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      saving = false;
    }
  }

  async function runDiagnostics(): Promise<void> {
    diagnosing = true;
    try {
      const res = await fetch("/api/settings/sandbox-diagnostics");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to run diagnostics");
      diagnostics = data.diagnostics;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      diagnosing = false;
    }
  }

  onMount(loadSettings);
</script>

<div class="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-8 sm:px-10 sm:py-10">
  <header class="flex flex-col gap-3">
    <Badge variant="secondary" class="w-fit">Tool Security</Badge>
    <div class="flex max-w-3xl flex-col gap-2">
      <h1 class="text-3xl font-semibold tracking-tight text-foreground">Sandbox Policy</h1>
      <p class="text-sm leading-6 text-muted-foreground">
        Restrict Agent shell commands without changing browser, ACP, MCP, or channel delivery behavior.
      </p>
    </div>
  </header>

  {#if loading}
    <p class="py-8 text-sm text-muted-foreground">Loading sandbox settings...</p>
  {:else}
    <form class="flex flex-col gap-4" onsubmit={(e) => { e.preventDefault(); save(); }}>
      {#if message}
        <Alert><AlertDescription>{message}</AlertDescription></Alert>
      {/if}
      {#if error}
        <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
      {/if}

      <Card>
        <CardHeader>
          <CardTitle>Runtime Mode</CardTitle>
          <CardDescription>Sandbox applies only to Agent bash and subagent bash. It is off by default.</CardDescription>
        </CardHeader>
        <CardContent class="flex flex-col gap-5">
          <div class="flex items-center justify-between gap-4 rounded-lg border bg-muted/30 px-4 py-3">
            <div class="flex flex-col gap-1">
              <Label for="sb-enabled">Enable OS sandbox for bash</Label>
              <p class="text-xs text-muted-foreground">When enabled, bash runs with filtered env, filesystem write limits, and network allowlists.</p>
            </div>
            <Switch id="sb-enabled" bind:checked={sandbox.enabled} />
          </div>

          <div class="grid gap-4 md:grid-cols-2">
            <div class="flex flex-col gap-2">
              <Label for="sb-failure">Initialization failure mode</Label>
              <NativeSelect id="sb-failure" bind:value={sandbox.initFailureMode}>
                <NativeSelectOption value="warn-disable">Warn and disable sandbox</NativeSelectOption>
                <NativeSelectOption value="block">Block bash when sandbox fails</NativeSelectOption>
              </NativeSelect>
            </div>
            <div class="flex flex-col gap-2">
              <Label for="sb-env-mode">Environment inheritance</Label>
              <NativeSelect id="sb-env-mode" bind:value={sandbox.env.inheritMode}>
                <NativeSelectOption value="minimal">Minimal + allowlist</NativeSelectOption>
                <NativeSelectOption value="allowlist">Host/env-file allowlist</NativeSelectOption>
                <NativeSelectOption value="full">Full host env minus denylist</NativeSelectOption>
              </NativeSelect>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Environment Injection</CardTitle>
          <CardDescription>Molibot parses the workspace env file and injects only allowed keys into sandboxed child processes.</CardDescription>
        </CardHeader>
        <CardContent class="flex flex-col gap-4">
          <div class="flex flex-col gap-2">
            <Label for="sb-env-path">Workspace env file</Label>
            <Input id="sb-env-path" bind:value={sandbox.envFilePath} placeholder=".env.sandbox.local" />
            <p class="text-xs text-muted-foreground">Use a relative path for project-local secrets. The sandbox denies direct reads of this file.</p>
          </div>
          <div class="grid gap-4 md:grid-cols-2">
            <div class="flex flex-col gap-2">
              <Label for="sb-env-allow">Allowed env keys</Label>
              <Textarea id="sb-env-allow" bind:value={envAllowText} rows={6} placeholder={"OPENAI_API_KEY\nTAVILY_API_KEY"} />
            </div>
            <div class="flex flex-col gap-2">
              <Label for="sb-env-deny">Denied env keys</Label>
              <Textarea id="sb-env-deny" bind:value={envDenyText} rows={6} placeholder={"TELEGRAM_BOT_TOKEN\nMOLIBOT_*"} />
            </div>
          </div>
        </CardContent>
      </Card>

      <div class="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Network Policy</CardTitle>
            <CardDescription>Network access is allowlist based when sandboxing is active.</CardDescription>
          </CardHeader>
          <CardContent class="flex flex-col gap-4">
            <div class="flex flex-col gap-2">
              <Label for="sb-net-allow">Allowed domains</Label>
              <Textarea id="sb-net-allow" bind:value={networkAllowText} rows={8} />
            </div>
            <div class="flex flex-col gap-2">
              <Label for="sb-net-deny">Denied domains</Label>
              <Textarea id="sb-net-deny" bind:value={networkDenyText} rows={4} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Filesystem Policy</CardTitle>
            <CardDescription>Reads are denylist based; writes are allowlist based.</CardDescription>
          </CardHeader>
          <CardContent class="flex flex-col gap-4">
            <div class="flex flex-col gap-2">
              <Label for="sb-fs-write">Allowed write paths</Label>
              <Textarea id="sb-fs-write" bind:value={allowWriteText} rows={4} />
            </div>
            <div class="flex flex-col gap-2">
              <Label for="sb-fs-read">Denied read paths</Label>
              <Textarea id="sb-fs-read" bind:value={denyReadText} rows={4} />
            </div>
            <div class="flex flex-col gap-2">
              <Label for="sb-fs-deny-write">Denied write paths</Label>
              <Textarea id="sb-fs-deny-write" bind:value={denyWriteText} rows={4} />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="flex flex-col gap-1">
              <CardTitle>Diagnostics</CardTitle>
              <CardDescription>Checks platform support, dependencies, env parsing, and effective policy without exposing values.</CardDescription>
            </div>
            <Button type="button" variant="outline" onclick={runDiagnostics} disabled={diagnosing}>
              {diagnosing ? "Checking..." : "Run diagnostics"}
            </Button>
          </div>
        </CardHeader>
        <CardContent class="flex flex-col gap-4">
          {#if diagnostics}
            <div class="flex flex-wrap gap-2">
              <Badge variant={badgeVariant(diagnostics.supportedPlatform)}>Platform: {diagnostics.platform}</Badge>
              <Badge variant={badgeVariant(diagnostics.dependenciesAvailable)}>Dependencies</Badge>
              <Badge variant={badgeVariant(!diagnostics.enabled || diagnostics.sandboxInitialized)}>Initialized</Badge>
              <Badge variant={badgeVariant(diagnostics.envFileExists ? diagnostics.envFileReadable : true)}>Env file</Badge>
            </div>

            <div class="grid gap-3 text-sm md:grid-cols-2">
              <div class="rounded-lg border bg-muted/30 p-3">
                <p class="font-medium text-foreground">Env file</p>
                <p class="mt-1 break-all text-xs text-muted-foreground">{diagnostics.envFilePath}</p>
                <p class="mt-2 text-xs text-muted-foreground">
                  Exists: {diagnostics.envFileExists ? "yes" : "no"} · Readable: {diagnostics.envFileReadable ? "yes" : "no"}
                </p>
                {#if diagnostics.envFileError}
                  <p class="mt-2 text-xs text-destructive">{diagnostics.envFileError}</p>
                {/if}
              </div>
              <div class="rounded-lg border bg-muted/30 p-3">
                <p class="font-medium text-foreground">Injected keys</p>
                <p class="mt-1 text-xs text-muted-foreground">{previewKeys(diagnostics.envKeysInjected)}</p>
                <p class="mt-2 text-xs text-muted-foreground">Denied: {previewKeys(diagnostics.envKeysDenied)}</p>
                <p class="mt-2 text-xs text-muted-foreground">Missing allowlist: {previewKeys(diagnostics.envKeysMissing)}</p>
              </div>
            </div>

            {#if diagnostics.sandboxError}
              <Alert variant="destructive"><AlertDescription>{diagnostics.sandboxError}</AlertDescription></Alert>
            {/if}
          {:else}
            <p class="text-sm text-muted-foreground">Run diagnostics to inspect the effective sandbox state.</p>
          {/if}
        </CardContent>
      </Card>

      <div class="flex justify-end gap-3">
        <Button type="button" variant="outline" onclick={loadSettings} disabled={saving}>Reset</Button>
        <Button type="submit" disabled={saving}>{saving ? "Saving..." : "Save sandbox policy"}</Button>
      </div>
    </form>
  {/if}
</div>
