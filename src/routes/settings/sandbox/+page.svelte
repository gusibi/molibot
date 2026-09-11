<script lang="ts">
  import { onMount } from "svelte";
  import { Alert, AlertDescription } from "$lib/components/ui/alert";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { NativeSelect, NativeSelectOption } from "$lib/components/ui/native-select";
  import { Textarea } from "$lib/components/ui/textarea";
  import { initLocale, locale } from "$lib/ui/i18n";

  type EnvInheritMode = "minimal" | "allowlist" | "full";

  interface ToolSandboxSettings {
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

  interface SandboxDiagnostics {
    platform: string;
    supportedPlatform: boolean;
    dependenciesAvailable: boolean;
    sandboxInitialized: boolean;
    sandboxError?: string;
  }

  const DEFAULT_DENY_READ = ["~/.ssh", "~/.aws", "~/.gnupg", ".env", ".env.*"];
  const DEFAULT_DENY_WRITE = [".env", ".env.*", "*.pem", "*.key"];

  const defaultSandbox: ToolSandboxSettings = {
    envFilePath: ".env",
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
      allowWrite: [],
      denyWrite: DEFAULT_DENY_WRITE
    }
  };

  const COPY = {
    "zh-CN": {
      eyebrow: "工具安全",
      title: "执行环境",
      subtitle: "决定 Agent shell 命令的执行方式；不影响浏览器、MCP 或渠道投递行为。",
      loading: "正在加载执行环境设置...",
      backendTitle: "沙箱后端",
      backendDesc: "手动 / 接受修改模式默认在沙箱内执行命令；全自动（完全访问）模式直接在宿主机运行，沙箱限制不适用。",
      backendName: "Anthropic Local Sandbox",
      statusPlatform: "平台",
      statusSupported: "支持的平台",
      statusDeps: "依赖可用",
      statusInitialized: "沙箱已初始化",
      yes: "是",
      no: "否",
      diagRefresh: "运行诊断",
      diagChecking: "检查中...",
      diagEmpty: "运行诊断以查看沙箱生效状态。",
      advancedTitle: "高级限制",
      advancedDesc: "仅约束沙箱内执行的命令（手动 / 接受修改模式），不是浏览器或 MCP 的防火墙。",
      credTitle: "凭证注入",
      credDesc: "Molibot 解析工作区环境文件，仅将允许的键注入沙箱子进程。",
      envPathLabel: "工作区环境文件",
      envPathHint: "使用相对路径指向项目本地密钥，沙箱会阻止直接读取此文件。",
      envModeLabel: "环境变量继承",
      envModeMinimal: "最小化 + 白名单",
      envModeAllowlist: "宿主机/环境文件白名单",
      envModeFull: "完整宿主机环境变量排除黑名单",
      envAllowLabel: "允许的环境变量键",
      envDenyLabel: "拒绝的环境变量键",
      netTitle: "网络",
      netDesc: "仅约束沙箱内命令的网络访问，不是浏览器/MCP 防火墙；默认不限制。",
      netAllowLabel: "允许的域名",
      netAllowPlaceholder: "默认不限制（*）。每行一个域名，如 registry.npmjs.org",
      netDenyLabel: "拒绝的域名",
      fsTitle: "文件系统",
      fsDesc: "读取基于黑名单，写入基于白名单。",
      fsWriteLabel: "允许的写入路径",
      fsDenyReadLabel: "拒绝的读取路径",
      fsDenyWriteLabel: "拒绝的写入路径",
      resetBtn: "重置",
      saving: "保存中...",
      savingMsg: "正在保存变更...",
      saveBtn: "保存执行环境限制",
      saved: "执行环境限制已保存，新的运行将使用更新后的策略。",
      failedLoad: "加载执行环境设置失败",
      failedSave: "保存执行环境设置失败",
      failedDiag: "运行诊断失败"
    },
    "en-US": {
      eyebrow: "Tool Security",
      title: "Execution Environment",
      subtitle: "Controls how Agent shell commands run; does not change browser, MCP, or channel delivery behavior.",
      loading: "Loading execution environment settings...",
      backendTitle: "Sandbox Backend",
      backendDesc: "Manual and Accept-edits modes run commands inside the sandbox by default; Auto (Full Access) runs directly on the host and ignores these restrictions.",
      backendName: "Anthropic Local Sandbox",
      statusPlatform: "Platform",
      statusSupported: "Supported platform",
      statusDeps: "Dependencies available",
      statusInitialized: "Sandbox initialized",
      yes: "Yes",
      no: "No",
      diagRefresh: "Run diagnostics",
      diagChecking: "Checking...",
      diagEmpty: "Run diagnostics to inspect the effective sandbox state.",
      advancedTitle: "Advanced restrictions",
      advancedDesc: "Applies only to commands executed inside the sandbox (Manual / Accept-edits modes); not a browser or MCP firewall.",
      credTitle: "Credential injection",
      credDesc: "Molibot parses the workspace env file and injects only allowed keys into sandboxed child processes.",
      envPathLabel: "Workspace env file",
      envPathHint: "Use a relative path for project-local secrets. The sandbox denies direct reads of this file.",
      envModeLabel: "Environment inheritance",
      envModeMinimal: "Minimal + allowlist",
      envModeAllowlist: "Host/env-file allowlist",
      envModeFull: "Full host env minus denylist",
      envAllowLabel: "Allowed env keys",
      envDenyLabel: "Denied env keys",
      netTitle: "Network",
      netDesc: "Restricts network access for commands inside the sandbox only — not a browser/MCP firewall; unrestricted by default.",
      netAllowLabel: "Allowed domains",
      netAllowPlaceholder: "Unrestricted by default (*). One domain per line, e.g. registry.npmjs.org",
      netDenyLabel: "Denied domains",
      fsTitle: "Filesystem",
      fsDesc: "Reads are denylist based; writes are allowlist based.",
      fsWriteLabel: "Allowed write paths",
      fsDenyReadLabel: "Denied read paths",
      fsDenyWriteLabel: "Denied write paths",
      resetBtn: "Reset",
      saving: "Saving...",
      savingMsg: "Saving changes...",
      saveBtn: "Save execution environment",
      saved: "Execution environment restrictions saved. New runs will use the updated policy.",
      failedLoad: "Failed to load execution environment settings",
      failedSave: "Failed to save execution environment settings",
      failedDiag: "Failed to run diagnostics"
    }
  } as const;

  let loading = true;
  let saving = false;
  let diagnosing = false;
  let message = "";
  let error = "";

  let envFilePath = defaultSandbox.envFilePath;
  let envInheritMode: EnvInheritMode = defaultSandbox.env.inheritMode;
  let envAllowText = "";
  let envDenyText = "";
  let networkAllowText = "";
  let networkDenyText = "";
  let denyReadText = "";
  let allowWriteText = "";
  let denyWriteText = "";
  let diagnostics: SandboxDiagnostics | null = null;

  $: copy = COPY[$locale] ?? COPY["en-US"];

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

  function syncTextFromSandbox(sandbox: ToolSandboxSettings): void {
    envFilePath = sandbox.envFilePath;
    envInheritMode = sandbox.env.inheritMode;
    envAllowText = listToText(sandbox.env.allow);
    envDenyText = listToText(sandbox.env.deny);
    networkAllowText = listToText(sandbox.network.allowedDomains);
    networkDenyText = listToText(sandbox.network.deniedDomains);
    denyReadText = listToText(sandbox.filesystem.denyRead);
    allowWriteText = listToText(sandbox.filesystem.allowWrite);
    denyWriteText = listToText(sandbox.filesystem.denyWrite);
  }

  function applyLoadedValue(value: Partial<ToolSandboxSettings> | null | undefined): void {
    const sandbox: ToolSandboxSettings = {
      envFilePath: String(value?.envFilePath ?? defaultSandbox.envFilePath).trim() || defaultSandbox.envFilePath,
      env: {
        inheritMode: value?.env?.inheritMode ?? defaultSandbox.env.inheritMode,
        allow: value?.env?.allow ?? defaultSandbox.env.allow,
        deny: value?.env?.deny ?? defaultSandbox.env.deny
      },
      network: {
        allowedDomains: value?.network?.allowedDomains ?? defaultSandbox.network.allowedDomains,
        deniedDomains: value?.network?.deniedDomains ?? defaultSandbox.network.deniedDomains
      },
      filesystem: {
        denyRead: value?.filesystem?.denyRead ?? defaultSandbox.filesystem.denyRead,
        allowWrite: value?.filesystem?.allowWrite ?? defaultSandbox.filesystem.allowWrite,
        denyWrite: value?.filesystem?.denyWrite ?? defaultSandbox.filesystem.denyWrite
      }
    };
    syncTextFromSandbox(sandbox);
  }

  function buildPatch(): ToolSandboxSettings {
    return {
      envFilePath: envFilePath.trim() || defaultSandbox.envFilePath,
      env: {
        inheritMode: envInheritMode,
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

  function badgeVariant(ok: boolean): "default" | "destructive" {
    return ok ? "default" : "destructive";
  }

  async function loadSettings(): Promise<void> {
    loading = true;
    message = "";
    error = "";
    try {
      const res = await fetch("/api/settings/sandbox");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || copy.failedLoad);
      applyLoadedValue(data.value);
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
      const res = await fetch("/api/settings/sandbox", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: buildPatch() })
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || copy.failedSave);
      applyLoadedValue(data.value);
      message = copy.saved;
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
      if (!data.ok) throw new Error(data.error || copy.failedDiag);
      diagnostics = {
        platform: String(data.diagnostics?.platform ?? ""),
        supportedPlatform: Boolean(data.diagnostics?.supportedPlatform),
        dependenciesAvailable: Boolean(data.diagnostics?.dependenciesAvailable),
        sandboxInitialized: Boolean(data.diagnostics?.sandboxInitialized),
        sandboxError: data.diagnostics?.sandboxError ? String(data.diagnostics.sandboxError) : undefined
      };
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
    <Badge variant="secondary">{copy.eyebrow}</Badge>
    <h1 class="channel-hero-title">{copy.title}</h1>
    <p class="channel-hero-desc">
      {copy.subtitle}
    </p>
  </header>

  {#if loading}
    <p class="py-8 text-sm text-muted-foreground">{copy.loading}</p>
  {:else}
    <form id="sandbox-form" class="channel-form" onsubmit={(e) => { e.preventDefault(); save(); }}>
      <div class="channel-card">
        <div class="channel-card-header">
          <div class="flex flex-wrap items-center justify-between gap-3 w-full">
            <div>
              <h2 class="channel-card-title">{copy.backendTitle}</h2>
              <p class="channel-card-desc">{copy.backendDesc}</p>
            </div>
            <Button type="button" variant="outline" size="sm" onclick={runDiagnostics} disabled={diagnosing}>
              {diagnosing ? copy.diagChecking : copy.diagRefresh}
            </Button>
          </div>
        </div>
        <div class="channel-card-body">
          <div class="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{copy.backendName}</Badge>
          </div>

          {#if diagnostics}
            <div class="flex flex-wrap gap-2 pt-2">
              <Badge variant="outline">{copy.statusPlatform}: {diagnostics.platform}</Badge>
              <Badge variant={badgeVariant(diagnostics.supportedPlatform)}>
                {copy.statusSupported}: {diagnostics.supportedPlatform ? copy.yes : copy.no}
              </Badge>
              <Badge variant={badgeVariant(diagnostics.dependenciesAvailable)}>
                {copy.statusDeps}: {diagnostics.dependenciesAvailable ? copy.yes : copy.no}
              </Badge>
              <Badge variant={badgeVariant(diagnostics.sandboxInitialized)}>
                {copy.statusInitialized}: {diagnostics.sandboxInitialized ? copy.yes : copy.no}
              </Badge>
            </div>

            {#if diagnostics.sandboxError}
              <Alert variant="destructive" class="mt-2"><AlertDescription>{diagnostics.sandboxError}</AlertDescription></Alert>
            {/if}
          {:else}
            <p class="text-xs pt-2 text-muted-foreground">{copy.diagEmpty}</p>
          {/if}
        </div>
      </div>

      <div class="channel-card mb-16">
        <div class="channel-card-header">
          <div>
            <h2 class="channel-card-title">{copy.advancedTitle}</h2>
            <p class="channel-card-desc">{copy.advancedDesc}</p>
          </div>
        </div>
        <div class="channel-card-body">
          <div class="channel-accordion">
            <details class="channel-accordion-item">
              <summary>{copy.credTitle}</summary>
              <div class="channel-accordion-body">
                <p class="channel-hint">{copy.credDesc}</p>
                <div class="channel-field">
                  <Label for="sb-env-path">{copy.envPathLabel}</Label>
                  <Input id="sb-env-path" bind:value={envFilePath} placeholder=".env" />
                  <p class="channel-hint">{copy.envPathHint}</p>
                </div>
                <div class="channel-field">
                  <Label for="sb-env-mode">{copy.envModeLabel}</Label>
                  <NativeSelect id="sb-env-mode" bind:value={envInheritMode}>
                    <NativeSelectOption value="minimal">{copy.envModeMinimal}</NativeSelectOption>
                    <NativeSelectOption value="allowlist">{copy.envModeAllowlist}</NativeSelectOption>
                    <NativeSelectOption value="full">{copy.envModeFull}</NativeSelectOption>
                  </NativeSelect>
                </div>
                <div class="channel-field-row pt-2">
                  <div class="channel-field">
                    <Label for="sb-env-allow">{copy.envAllowLabel}</Label>
                    <Textarea id="sb-env-allow" class="font-mono text-xs" bind:value={envAllowText} rows={6} placeholder={"OPENAI_API_KEY\nTAVILY_API_KEY"} />
                  </div>
                  <div class="channel-field">
                    <Label for="sb-env-deny">{copy.envDenyLabel}</Label>
                    <Textarea id="sb-env-deny" class="font-mono text-xs" bind:value={envDenyText} rows={6} placeholder={"TELEGRAM_BOT_TOKEN\nMOLIBOT_*"} />
                  </div>
                </div>
              </div>
            </details>

            <details class="channel-accordion-item">
              <summary>{copy.netTitle}</summary>
              <div class="channel-accordion-body">
                <p class="channel-hint">{copy.netDesc}</p>
                <div class="channel-field">
                  <Label for="sb-net-allow">{copy.netAllowLabel}</Label>
                  <Textarea id="sb-net-allow" class="font-mono text-xs" bind:value={networkAllowText} rows={8} placeholder={copy.netAllowPlaceholder} />
                </div>
                <div class="channel-field">
                  <Label for="sb-net-deny">{copy.netDenyLabel}</Label>
                  <Textarea id="sb-net-deny" class="font-mono text-xs" bind:value={networkDenyText} rows={4} />
                </div>
              </div>
            </details>

            <details class="channel-accordion-item">
              <summary>{copy.fsTitle}</summary>
              <div class="channel-accordion-body">
                <p class="channel-hint">{copy.fsDesc}</p>
                <div class="channel-field">
                  <Label for="sb-fs-write">{copy.fsWriteLabel}</Label>
                  <Textarea id="sb-fs-write" class="font-mono text-xs" bind:value={allowWriteText} rows={4} />
                </div>
                <div class="channel-field">
                  <Label for="sb-fs-read">{copy.fsDenyReadLabel}</Label>
                  <Textarea id="sb-fs-read" class="font-mono text-xs" bind:value={denyReadText} rows={4} />
                </div>
                <div class="channel-field">
                  <Label for="sb-fs-deny-write">{copy.fsDenyWriteLabel}</Label>
                  <Textarea id="sb-fs-deny-write" class="font-mono text-xs" bind:value={denyWriteText} rows={4} />
                </div>
              </div>
            </details>
          </div>
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
        {copy.savingMsg}
      </span>
    {:else if message}
      <span class="settings-footbar-ok">{message}</span>
    {/if}
    {#if error}
      <span class="settings-footbar-error">{error}</span>
    {/if}
  </div>
  <div class="settings-footbar-actions">
    <Button variant="outline" size="sm" onclick={loadSettings} disabled={loading || saving}>{copy.resetBtn}</Button>
    <button type="submit" form="sandbox-form" class="settings-footbar-btn" disabled={loading || saving}>
      {saving ? copy.saving : copy.saveBtn}
    </button>
  </div>
</footer>
