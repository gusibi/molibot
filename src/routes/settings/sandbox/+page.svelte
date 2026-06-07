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
  import { initLocale, locale } from "$lib/ui/i18n";

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

  type SandboxProfileName = "observe" | "build" | "strict" | "custom";

  interface ProfileTemplate {
    name: SandboxProfileName;
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

  const DEFAULT_DENY_READ = ["~/.ssh", "~/.aws", "~/.gnupg", ".env", ".env.*", ".env.sandbox.local"];
  const DEFAULT_DENY_WRITE = [".env", ".env.*", "*.pem", "*.key"];

  const profiles: Record<"observe" | "build" | "strict", ProfileTemplate> = {
    observe: {
      name: "observe",
      enabled: true,
      initFailureMode: "warn-disable",
      envFilePath: ".env.sandbox.local",
      env: {
        inheritMode: "minimal",
        allow: [],
        deny: []
      },
      network: {
        allowedDomains: ["*"],
        deniedDomains: []
      },
      filesystem: {
        denyRead: DEFAULT_DENY_READ,
        allowWrite: ["/tmp", "scratch"],
        denyWrite: DEFAULT_DENY_WRITE
      }
    },
    build: {
      name: "build",
      enabled: true,
      initFailureMode: "warn-disable",
      envFilePath: ".env.sandbox.local",
      env: {
        inheritMode: "full",
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
        denyRead: DEFAULT_DENY_READ,
        allowWrite: [".", "/tmp", "scratch"],
        denyWrite: DEFAULT_DENY_WRITE
      }
    },
    strict: {
      name: "strict",
      enabled: true,
      initFailureMode: "block",
      envFilePath: ".env.sandbox.local",
      env: {
        inheritMode: "minimal",
        allow: [],
        deny: []
      },
      network: {
        allowedDomains: [],
        deniedDomains: []
      },
      filesystem: {
        denyRead: DEFAULT_DENY_READ,
        allowWrite: ["/tmp"],
        denyWrite: DEFAULT_DENY_WRITE
      }
    }
  };

  const COPY = {
    "zh-CN": {
      observeTitle: "Observe 只读观察",
      observeDesc: "只读运行。允许网络访问但禁止改写项目源文件，适用于只读分析或代码库搜索任务。",
      buildTitle: "Build 构建生成",
      buildDesc: "代码生成与运行。允许网络访问标准源并可写工作区，适用于编译、自动重构与工具链调用。",
      strictTitle: "Strict 极度隔离",
      strictDesc: "最高级密闭沙盒。禁止一切网络访问，禁止改写源文件，最小化环境变量注入。",
      presetTitle: "安全策略预设 (Sandbox Profiles)",
      presetDesc: "选择预设模式一键配置沙盒规则。您仍可以在下方微调所有细节。",
      customProfile: "自定义配置策略 (Custom Profile) · 已根据下方细节做了修改",
      activeProfile: "当前策略级别",
      badgeCustom: "自定义",
      badgeActive: "当前生效"
    },
    "en-US": {
      observeTitle: "Observe (Read-Only)",
      observeDesc: "Read-only execution. Allows network access but blocks writes to the project workspace. Best for analysis and search tasks.",
      buildTitle: "Build (Read/Write)",
      buildDesc: "Code generation and execution. Allows standard network access and workspace modifications. Best for builds and refactoring.",
      strictTitle: "Strict (Isolated)",
      strictDesc: "Maximum sandbox isolation. Disables all network access, blocks workspace writes, and restricts env variables.",
      presetTitle: "Security Profile Presets",
      presetDesc: "Choose a preset mode to configure sandbox rules instantly. You can still fine-tune all details below.",
      customProfile: "Custom Profile · Modified from presets below",
      activeProfile: "Active Security Profile",
      badgeCustom: "Custom",
      badgeActive: "Active"
    }
  } as const;

  let envAllowText = "";
  let envDenyText = "";
  let networkAllowText = "";
  let networkDenyText = "";
  let denyReadText = "";
  let allowWriteText = "";
  let denyWriteText = "";

  $: copy = COPY[$locale] ?? COPY["en-US"];

  function arraysMatch(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    const sortedA = [...a].sort();
    const sortedB = [...b].sort();
    return sortedA.every((val, index) => val === sortedB[index]);
  }

  function detectProfile(
    enabled: boolean,
    initFailureMode: InitFailureMode,
    envInheritMode: EnvInheritMode,
    envAllow: string,
    envDeny: string,
    netAllow: string,
    netDeny: string,
    fsDenyRead: string,
    fsAllowWrite: string,
    fsDenyWrite: string
  ): SandboxProfileName {
    if (!enabled) return "custom";
    const parsedEnvAllow = textToList(envAllow);
    const parsedEnvDeny = textToList(envDeny);
    const parsedNetAllow = textToList(netAllow);
    const parsedNetDeny = textToList(netDeny);
    const parsedFsDenyRead = textToList(fsDenyRead);
    const parsedFsAllowWrite = textToList(fsAllowWrite);
    const parsedFsDenyWrite = textToList(fsDenyWrite);

    for (const [key, profile] of Object.entries(profiles) as [["observe" | "build" | "strict", ProfileTemplate]]) {
      if (
        enabled === profile.enabled &&
        initFailureMode === profile.initFailureMode &&
        envInheritMode === profile.env.inheritMode &&
        arraysMatch(parsedEnvAllow, profile.env.allow) &&
        arraysMatch(parsedEnvDeny, profile.env.deny) &&
        arraysMatch(parsedNetAllow, profile.network.allowedDomains) &&
        arraysMatch(parsedNetDeny, profile.network.deniedDomains) &&
        arraysMatch(parsedFsDenyRead, profile.filesystem.denyRead) &&
        arraysMatch(parsedFsAllowWrite, profile.filesystem.allowWrite) &&
        arraysMatch(parsedFsDenyWrite, profile.filesystem.denyWrite)
      ) {
        return key;
      }
    }
    return "custom";
  }

  $: activeProfile = detectProfile(
    sandbox.enabled,
    sandbox.initFailureMode,
    sandbox.env.inheritMode,
    envAllowText,
    envDenyText,
    networkAllowText,
    networkDenyText,
    denyReadText,
    allowWriteText,
    denyWriteText
  );

  function applyProfile(profileName: "observe" | "build" | "strict"): void {
    const profile = profiles[profileName];
    sandbox.enabled = profile.enabled;
    sandbox.initFailureMode = profile.initFailureMode;
    sandbox.env.inheritMode = profile.env.inheritMode;
    sandbox.envFilePath = profile.envFilePath;
    
    envAllowText = listToText(profile.env.allow);
    envDenyText = listToText(profile.env.deny);
    networkAllowText = listToText(profile.network.allowedDomains);
    networkDenyText = listToText(profile.network.deniedDomains);
    denyReadText = listToText(profile.filesystem.denyRead);
    allowWriteText = listToText(profile.filesystem.allowWrite);
    denyWriteText = listToText(profile.filesystem.denyWrite);
  }

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
      const res = await fetch("/api/settings/dynamic/sandbox");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load settings");
      sandbox = { ...structuredClone(defaultSandbox), ...(data.value ?? {}) };
      sandbox.env = { ...defaultSandbox.env, ...(data.value?.env ?? {}) };
      sandbox.network = { ...defaultSandbox.network, ...(data.value?.network ?? {}) };
      sandbox.filesystem = { ...defaultSandbox.filesystem, ...(data.value?.filesystem ?? {}) };
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
      const res = await fetch("/api/settings/dynamic/sandbox", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: next })
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to save sandbox settings");
      sandbox = data.value;
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

  onMount(() => {
    initLocale();
    void loadSettings();
  });
</script>

<div class="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-8 sm:px-10 sm:py-10">
  <header class="flex flex-col gap-3">
    <Badge variant="secondary" class="w-fit">Tool Security</Badge>
    <div class="flex max-w-3xl flex-col gap-2">
      <h1 class="text-3xl font-semibold tracking-tight text-foreground">Sandbox Policy</h1>
      <p class="text-sm leading-6 text-muted-foreground">
        Restrict Agent shell commands without changing browser, MCP, or channel delivery behavior.
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
          <CardTitle>{copy.presetTitle}</CardTitle>
          <CardDescription>{copy.presetDesc}</CardDescription>
        </CardHeader>
        <CardContent class="flex flex-col gap-4">
          <div class="grid gap-4 md:grid-cols-3">
            <button
              type="button"
              onclick={() => applyProfile("observe")}
              class="flex flex-col text-left rounded-xl border p-4 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md cursor-pointer {activeProfile === 'observe' ? 'border-[color-mix(in_oklab,var(--primary)_50%,var(--border))] bg-[color-mix(in_oklab,var(--primary)_10%,var(--card))] ring-2 ring-primary/20' : 'bg-card border-border hover:border-muted-foreground/30'}"
            >
              <div class="flex items-center justify-between w-full">
                <span class="font-semibold text-foreground text-sm">{copy.observeTitle}</span>
                {#if activeProfile === 'observe'}
                  <Badge variant="default" class="text-[10px] py-0.5 px-2 font-semibold tracking-wide uppercase">{copy.badgeActive}</Badge>
                {/if}
              </div>
              <p class="mt-2 text-xs leading-relaxed text-muted-foreground flex-1">{copy.observeDesc}</p>
            </button>

            <button
              type="button"
              onclick={() => applyProfile("build")}
              class="flex flex-col text-left rounded-xl border p-4 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md cursor-pointer {activeProfile === 'build' ? 'border-[color-mix(in_oklab,var(--primary)_50%,var(--border))] bg-[color-mix(in_oklab,var(--primary)_10%,var(--card))] ring-2 ring-primary/20' : 'bg-card border-border hover:border-muted-foreground/30'}"
            >
              <div class="flex items-center justify-between w-full">
                <span class="font-semibold text-foreground text-sm">{copy.buildTitle}</span>
                {#if activeProfile === 'build'}
                  <Badge variant="default" class="text-[10px] py-0.5 px-2 font-semibold tracking-wide uppercase">{copy.badgeActive}</Badge>
                {/if}
              </div>
              <p class="mt-2 text-xs leading-relaxed text-muted-foreground flex-1">{copy.buildDesc}</p>
            </button>

            <button
              type="button"
              onclick={() => applyProfile("strict")}
              class="flex flex-col text-left rounded-xl border p-4 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md cursor-pointer {activeProfile === 'strict' ? 'border-[color-mix(in_oklab,var(--primary)_50%,var(--border))] bg-[color-mix(in_oklab,var(--primary)_10%,var(--card))] ring-2 ring-primary/20' : 'bg-card border-border hover:border-muted-foreground/30'}"
            >
              <div class="flex items-center justify-between w-full">
                <span class="font-semibold text-foreground text-sm">{copy.strictTitle}</span>
                {#if activeProfile === 'strict'}
                  <Badge variant="default" class="text-[10px] py-0.5 px-2 font-semibold tracking-wide uppercase">{copy.badgeActive}</Badge>
                {/if}
              </div>
              <p class="mt-2 text-xs leading-relaxed text-muted-foreground flex-1">{copy.strictDesc}</p>
            </button>
          </div>

          {#if activeProfile === 'custom'}
            <div class="mt-2 flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-500">
              <svg class="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
              </svg>
              <span>{copy.customProfile}</span>
            </div>
          {/if}
        </CardContent>
      </Card>

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
