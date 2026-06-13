<script lang="ts">
  import { onMount } from "svelte";
  import { Alert, AlertDescription } from "$lib/components/ui/alert";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { NativeSelect, NativeSelectOption } from "$lib/components/ui/native-select";
  import { IosSwitch } from "$lib/components/ui/ios-switch";
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

<div class="channel-page">
  <header class="channel-hero">
    <Badge variant="secondary" class="w-fit">Tool Security</Badge>
    <h1 class="channel-hero-title">Sandbox Policy</h1>
    <p class="channel-hero-desc">
      Restrict Agent shell commands without changing browser, MCP, or channel delivery behavior.
    </p>
  </header>

  {#if loading}
    <p class="py-8 text-sm text-muted-foreground">Loading sandbox settings...</p>
  {:else}
    <form id="sandbox-form" class="channel-form animate-in fade-in duration-200" onsubmit={(e) => { e.preventDefault(); save(); }}>
      <div class="channel-card">
        <div class="channel-card-header">
          <div>
            <h2 class="channel-card-title">{copy.presetTitle}</h2>
            <p class="channel-card-desc">{copy.presetDesc}</p>
          </div>
        </div>
        <div class="channel-card-body">
          <div class="presets-grid">
            <button
              type="button"
              onclick={() => applyProfile("observe")}
              class="preset-card {activeProfile === 'observe' ? 'preset-card--active' : ''}"
            >
              <div class="preset-card-header">
                <span class="preset-card-title">{copy.observeTitle}</span>
                {#if activeProfile === 'observe'}
                  <Badge variant="default" class="text-[10px] py-0.5 px-2 font-semibold uppercase">{copy.badgeActive}</Badge>
                {/if}
              </div>
              <p class="preset-card-desc">{copy.observeDesc}</p>
            </button>

            <button
              type="button"
              onclick={() => applyProfile("build")}
              class="preset-card {activeProfile === 'build' ? 'preset-card--active' : ''}"
            >
              <div class="preset-card-header">
                <span class="preset-card-title">{copy.buildTitle}</span>
                {#if activeProfile === 'build'}
                  <Badge variant="default" class="text-[10px] py-0.5 px-2 font-semibold uppercase">{copy.badgeActive}</Badge>
                {/if}
              </div>
              <p class="preset-card-desc">{copy.buildDesc}</p>
            </button>

            <button
              type="button"
              onclick={() => applyProfile("strict")}
              class="preset-card {activeProfile === 'strict' ? 'preset-card--active' : ''}"
            >
              <div class="preset-card-header">
                <span class="preset-card-title">{copy.strictTitle}</span>
                {#if activeProfile === 'strict'}
                  <Badge variant="default" class="text-[10px] py-0.5 px-2 font-semibold uppercase">{copy.badgeActive}</Badge>
                {/if}
              </div>
              <p class="preset-card-desc">{copy.strictDesc}</p>
            </button>
          </div>

          {#if activeProfile === 'custom'}
            <div class="custom-profile-warning">
              <svg class="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
              </svg>
              <span>{copy.customProfile}</span>
            </div>
          {/if}
        </div>
      </div>

      <div class="channel-card">
        <div class="channel-card-header">
          <div>
            <h2 class="channel-card-title">Runtime Mode</h2>
            <p class="channel-card-desc">Sandbox applies only to Agent bash and subagent bash. It is off by default.</p>
          </div>
        </div>
        <div class="channel-card-body">
          <div class="channel-toggle-row">
            <div class="channel-toggle-label">
              <Label for="sb-enabled">Enable OS sandbox for bash</Label>
              <p>When enabled, bash runs with filtered env, filesystem write limits, and network allowlists.</p>
            </div>
            <IosSwitch id="sb-enabled" bind:checked={sandbox.enabled} />
          </div>

          <div class="channel-field-row pt-2">
            <div class="channel-field">
              <Label for="sb-failure">Initialization failure mode</Label>
              <NativeSelect id="sb-failure" bind:value={sandbox.initFailureMode}>
                <NativeSelectOption value="warn-disable">Warn and disable sandbox</NativeSelectOption>
                <NativeSelectOption value="block">Block bash when sandbox fails</NativeSelectOption>
              </NativeSelect>
            </div>
            <div class="channel-field">
              <Label for="sb-env-mode">Environment inheritance</Label>
              <NativeSelect id="sb-env-mode" bind:value={sandbox.env.inheritMode}>
                <NativeSelectOption value="minimal">Minimal + allowlist</NativeSelectOption>
                <NativeSelectOption value="allowlist">Host/env-file allowlist</NativeSelectOption>
                <NativeSelectOption value="full">Full host env minus denylist</NativeSelectOption>
              </NativeSelect>
            </div>
          </div>
        </div>
      </div>

      <div class="channel-card">
        <div class="channel-card-header">
          <div>
            <h2 class="channel-card-title">Environment Injection</h2>
            <p class="channel-card-desc">Molibot parses the workspace env file and injects only allowed keys into sandboxed child processes.</p>
          </div>
        </div>
        <div class="channel-card-body">
          <div class="channel-field">
            <Label for="sb-env-path">Workspace env file</Label>
            <Input id="sb-env-path" bind:value={sandbox.envFilePath} placeholder=".env.sandbox.local" />
            <p class="channel-hint">Use a relative path for project-local secrets. The sandbox denies direct reads of this file.</p>
          </div>
          <div class="channel-field-row pt-2">
            <div class="channel-field">
              <Label for="sb-env-allow">Allowed env keys</Label>
              <Textarea id="sb-env-allow" class="font-mono text-xs" bind:value={envAllowText} rows={6} placeholder={"OPENAI_API_KEY\nTAVILY_API_KEY"} />
            </div>
            <div class="channel-field">
              <Label for="sb-env-deny">Denied env keys</Label>
              <Textarea id="sb-env-deny" class="font-mono text-xs" bind:value={envDenyText} rows={6} placeholder={"TELEGRAM_BOT_TOKEN\nMOLIBOT_*"} />
            </div>
          </div>
        </div>
      </div>

      <div class="channel-field-row">
        <div class="channel-card">
          <div class="channel-card-header">
            <div>
              <h2 class="channel-card-title">Network Policy</h2>
              <p class="channel-card-desc">Network access is allowlist based when sandboxing is active.</p>
            </div>
          </div>
          <div class="channel-card-body">
            <div class="channel-field">
              <Label for="sb-net-allow">Allowed domains</Label>
              <Textarea id="sb-net-allow" class="font-mono text-xs" bind:value={networkAllowText} rows={8} />
            </div>
            <div class="channel-field">
              <Label for="sb-net-deny">Denied domains</Label>
              <Textarea id="sb-net-deny" class="font-mono text-xs" bind:value={networkDenyText} rows={4} />
            </div>
          </div>
        </div>

        <div class="channel-card">
          <div class="channel-card-header">
            <div>
              <h2 class="channel-card-title">Filesystem Policy</h2>
              <p class="channel-card-desc">Reads are denylist based; writes are allowlist based.</p>
            </div>
          </div>
          <div class="channel-card-body">
            <div class="channel-field">
              <Label for="sb-fs-write">Allowed write paths</Label>
              <Textarea id="sb-fs-write" class="font-mono text-xs" bind:value={allowWriteText} rows={4} />
            </div>
            <div class="channel-field">
              <Label for="sb-fs-read">Denied read paths</Label>
              <Textarea id="sb-fs-read" class="font-mono text-xs" bind:value={denyReadText} rows={4} />
            </div>
            <div class="channel-field">
              <Label for="sb-fs-deny-write">Denied write paths</Label>
              <Textarea id="sb-fs-deny-write" class="font-mono text-xs" bind:value={denyWriteText} rows={4} />
            </div>
          </div>
        </div>
      </div>

      <div class="channel-card mb-16">
        <div class="channel-card-header">
          <div class="flex flex-wrap items-center justify-between gap-3 w-full">
            <div>
              <h2 class="channel-card-title">Diagnostics</h2>
              <p class="channel-card-desc">Checks platform support, dependencies, env parsing, and effective policy without exposing values.</p>
            </div>
            <Button type="button" variant="outline" size="sm" onclick={runDiagnostics} disabled={diagnosing}>
              {diagnosing ? "Checking..." : "Run diagnostics"}
            </Button>
          </div>
        </div>
        <div class="channel-card-body">
          {#if diagnostics}
            <div class="flex flex-wrap gap-2">
              <Badge variant={badgeVariant(diagnostics.supportedPlatform)}>Platform: {diagnostics.platform}</Badge>
              <Badge variant={badgeVariant(diagnostics.dependenciesAvailable)}>Dependencies</Badge>
              <Badge variant={badgeVariant(!diagnostics.enabled || diagnostics.sandboxInitialized)}>Initialized</Badge>
              <Badge variant={badgeVariant(diagnostics.envFileExists ? diagnostics.envFileReadable : true)}>Env file</Badge>
            </div>

            <div class="channel-field-row pt-2">
              <div class="rounded-lg border bg-muted/30 p-3">
                <p class="font-medium text-foreground text-xs">Env file</p>
                <p class="mt-1 break-all text-[11px] text-muted-foreground font-mono">{diagnostics.envFilePath}</p>
                <p class="mt-2 text-[10px] text-muted-foreground">
                  Exists: {diagnostics.envFileExists ? "yes" : "no"} · Readable: {diagnostics.envFileReadable ? "yes" : "no"}
                </p>
                {#if diagnostics.envFileError}
                  <p class="mt-2 text-xs text-destructive">{diagnostics.envFileError}</p>
                {/if}
              </div>
              <div class="rounded-lg border bg-muted/30 p-3">
                <p class="font-medium text-foreground text-xs">Injected keys</p>
                <p class="mt-1 text-[11px] text-muted-foreground font-mono">{previewKeys(diagnostics.envKeysInjected)}</p>
                <p class="mt-2 text-[10px] text-muted-foreground">Denied: {previewKeys(diagnostics.envKeysDenied)}</p>
                <p class="mt-2 text-[10px] text-muted-foreground">Missing allowlist: {previewKeys(diagnostics.envKeysMissing)}</p>
              </div>
            </div>

            {#if diagnostics.sandboxError}
              <Alert variant="destructive" class="mt-2"><AlertDescription>{diagnostics.sandboxError}</AlertDescription></Alert>
            {/if}
          {:else}
            <p class="text-xs text-muted-foreground">Run diagnostics to inspect the effective sandbox state.</p>
          {/if}
        </div>
      </div>
    </form>
  {/if}
</div>

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
    <Button variant="outline" size="sm" onclick={loadSettings} disabled={loading || saving}>Reset</Button>
    <button type="submit" form="sandbox-form" class="settings-footbar-btn" disabled={loading || saving}>
      {saving ? "Saving..." : "Save Sandbox Policy"}
    </button>
  </div>
</footer>

<style>
  .presets-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1rem;
  }
  @media (max-width: 768px) {
    .presets-grid {
      grid-template-columns: 1fr;
    }
  }
  .preset-card {
    display: flex;
    flex-direction: column;
    text-align: left;
    border-radius: 0.75rem;
    border: 1px solid var(--border);
    padding: 1rem;
    background: var(--card);
    cursor: pointer;
    transition: all 0.2s ease;
  }
  .preset-card:hover {
    border-color: var(--muted-foreground);
    transform: translateY(-1px);
    box-shadow: var(--shadow);
  }
  .preset-card--active {
    border-color: var(--primary);
    background: color-mix(in oklab, var(--primary) 6%, var(--card));
    box-shadow: 0 0 0 2px color-mix(in oklab, var(--primary) 20%, transparent);
  }
  .preset-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    margin-bottom: 0.5rem;
  }
  .preset-card-title {
    font-weight: 600;
    color: var(--foreground);
    font-size: 0.875rem;
  }
  .preset-card-desc {
    font-size: 0.75rem;
    line-height: 1.5;
    color: var(--muted-foreground);
    flex: 1;
  }
  .custom-profile-warning {
    margin-top: 0.5rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    border-radius: 0.5rem;
    border: 1px solid color-mix(in oklab, var(--primary) 20%, transparent);
    background: color-mix(in oklab, var(--primary) 5%, transparent);
    padding: 0.5rem 0.75rem;
    font-size: 0.75rem;
    color: var(--primary);
  }
</style>
