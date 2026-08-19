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
    initFailureMode: "block",
    envFilePath: ".env",
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
      denyRead: ["~/.ssh", "~/.aws", "~/.gnupg", ".env", ".env.*"],
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

  type SandboxProfileName = "full" | "standard" | "readonly" | "locked" | "custom";

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

  const DEFAULT_DENY_READ = ["~/.ssh", "~/.aws", "~/.gnupg", ".env", ".env.*"];
  const DEFAULT_DENY_WRITE = [".env", ".env.*", "*.pem", "*.key"];

  const profiles: Record<"full" | "standard" | "readonly" | "locked", ProfileTemplate> = {
    full: {
      name: "full",
      enabled: true,
      initFailureMode: "block",
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
        allowWrite: [".", "/tmp", "scratch"],
        denyWrite: DEFAULT_DENY_WRITE
      }
    },
    standard: {
      name: "standard",
      enabled: true,
      initFailureMode: "block",
      envFilePath: ".env",
      env: {
        inheritMode: "allowlist",
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
    readonly: {
      name: "readonly",
      enabled: true,
      initFailureMode: "block",
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
        allowWrite: ["/tmp", "scratch"],
        denyWrite: DEFAULT_DENY_WRITE
      }
    },
    locked: {
      name: "locked",
      enabled: true,
      initFailureMode: "block",
      envFilePath: ".env",
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
      lockedTitle: "锁定",
      lockedDesc: "完全隔离：断网，只能写临时目录，环境变量最小化。",
      lockedBadge: "最高隔离",
      readonlyTitle: "只读",
      readonlyDesc: "能联网查资料，但不能修改项目文件。",
      readonlyBadge: "安全探索",
      standardTitle: "标准",
      standardDesc: "日常开发：网络放行常用开发站点，可修改项目文件。",
      standardBadge: "推荐开发",
      fullTitle: "全开",
      fullDesc: "最宽松：网络全部放行，可修改项目文件。请确认你信任当前任务。",
      fullBadge: "完全信任",
      netOffline: "断网",
      netAll: "全部放行",
      netDev: "常用开发源",
      fsTemp: "仅 /tmp",
      fsReadonly: "项目只读",
      fsWorkspace: "可写项目",
      envMinimal: "最小环境",
      envAllowlist: "白名单环境",
      strictest: "最严格",
      permissive: "最宽松",
      customInEffect: "当前策略已在下方自定义，不再匹配任一预设",
      resetToStandard: "重置为标准预设",
      customDesc: "自定义 · 你在下方修改过细节，不再对应任何档位。拖动滑条可回到预设档位。",
      presetTitle: "沙箱严格程度",
      presetDesc: "从左（最严格）到右（最宽松）拖动选择。拖动后仍可在下方微调细节，微调后会变为「自定义」。",
      badgeCustom: "自定义",
      currentLevel: "当前档位"
    },
    "en-US": {
      lockedTitle: "Locked",
      lockedDesc: "Fully isolated: no network, temp-dir writes only, minimal env.",
      lockedBadge: "Max Isolation",
      readonlyTitle: "Read-Only",
      readonlyDesc: "Network allowed for research, but project files cannot be modified.",
      readonlyBadge: "Safe Research",
      standardTitle: "Standard",
      standardDesc: "Everyday development: common dev sites allowed, project files writable.",
      standardBadge: "Recommended",
      fullTitle: "Full Access",
      fullDesc: "Most permissive: all network, project files writable. Only for tasks you trust.",
      fullBadge: "Trusted Tasks",
      netOffline: "Offline",
      netAll: "All Network",
      netDev: "Dev Registries",
      fsTemp: "/tmp only",
      fsReadonly: "Read-only project",
      fsWorkspace: "Project writable",
      envMinimal: "Minimal env",
      envAllowlist: "Allowlist env",
      strictest: "Strictest",
      permissive: "Most permissive",
      customInEffect: "Customized policy in effect; fine-tuned below",
      resetToStandard: "Reset to Standard",
      customDesc: "Custom · you modified details below; this no longer matches a preset. Drag the slider to return to one.",
      presetTitle: "Sandbox strictness",
      presetDesc: "Drag from left (strictest) to right (most permissive). Fine-tune below; edits switch to Custom.",
      badgeCustom: "Custom",
      currentLevel: "Current level"
    }
  } as const;

  // Slider axis, strictest → most permissive.
  const SLIDER_LEVELS: Array<"locked" | "readonly" | "standard" | "full"> = ["locked", "readonly", "standard", "full"];

  function levelTitle(name: "locked" | "readonly" | "standard" | "full"): string {
    const titles = { locked: copy.lockedTitle, readonly: copy.readonlyTitle, standard: copy.standardTitle, full: copy.fullTitle } as const;
    return titles[name];
  }

  function levelDesc(name: "locked" | "readonly" | "standard" | "full"): string {
    const descs = { locked: copy.lockedDesc, readonly: copy.readonlyDesc, standard: copy.standardDesc, full: copy.fullDesc } as const;
    return descs[name];
  }

  function levelBadge(name: "locked" | "readonly" | "standard" | "full"): string {
    const badges = { locked: copy.lockedBadge, readonly: copy.readonlyBadge, standard: copy.standardBadge, full: copy.fullBadge } as const;
    return badges[name];
  }

  function levelNetwork(name: "locked" | "readonly" | "standard" | "full"): string {
    const nets = { locked: copy.netOffline, readonly: copy.netAll, standard: copy.netDev, full: copy.netAll } as const;
    return nets[name];
  }

  function levelFilesystem(name: "locked" | "readonly" | "standard" | "full"): string {
    const fs = { locked: copy.fsTemp, readonly: copy.fsReadonly, standard: copy.fsWorkspace, full: copy.fsWorkspace } as const;
    return fs[name];
  }

  function levelEnv(name: "locked" | "readonly" | "standard" | "full"): string {
    const envs = { locked: copy.envMinimal, readonly: copy.envMinimal, standard: copy.envAllowlist, full: copy.envMinimal } as const;
    return envs[name];
  }

  function applyLevelByIndex(index: number): void {
    const level = SLIDER_LEVELS[index];
    if (level) applyProfile(level);
  }

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

    for (const [key, profile] of Object.entries(profiles) as [["full" | "standard" | "readonly" | "locked", ProfileTemplate]]) {
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

  // Slider position: -1 means Custom (details edited; no preset stop active).
  $: sliderIndex = SLIDER_LEVELS.indexOf(activeProfile as "locked" | "readonly" | "standard" | "full");
  $: isCustom = sliderIndex === -1;

  function applyProfile(profileName: "full" | "standard" | "readonly" | "locked"): void {
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
      const res = await fetch("/api/settings/sandbox");
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
      const res = await fetch("/api/settings/sandbox", {
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
          <div class="sandbox-presets-panel" data-level={isCustom ? "custom" : SLIDER_LEVELS[sliderIndex]}>
            <!-- 4-Card Preset Selection Matrix -->
            <div class="sandbox-tier-cards" role="radiogroup" aria-label={copy.presetTitle}>
              {#each SLIDER_LEVELS as level, index (level)}
                {@const selected = !isCustom && sliderIndex === index}
                <button
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  class="sandbox-tier-card {selected ? 'active' : ''}"
                  data-tier={level}
                  onclick={() => applyLevelByIndex(index)}
                >
                  <div class="sandbox-tier-card-header">
                    <div class="sandbox-tier-icon-wrap" data-tier={level}>
                      {#if level === "locked"}
                        <svg class="sandbox-tier-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M10 2.5L3.5 5.5v5c0 5 3.5 8 6.5 9 3-1 6.5-4 6.5-9v-5L10 2.5z"/>
                          <path d="M8 10l1.5 1.5L13 8"/>
                        </svg>
                      {:else if level === "readonly"}
                        <svg class="sandbox-tier-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                          <circle cx="10" cy="10" r="7.5"/>
                          <path d="M2.5 10h15M10 2.5a11 11 0 0 1 0 15M10 2.5a11 11 0 0 0 0 15"/>
                        </svg>
                      {:else if level === "standard"}
                        <svg class="sandbox-tier-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M13 3l4 4-10 10H3v-4L13 3zM11 5l4 4"/>
                        </svg>
                      {:else}
                        <svg class="sandbox-tier-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                          <rect x="3.5" y="8.5" width="13" height="9" rx="2"/>
                          <path d="M7 8.5V5.5a3 3 0 0 1 6 0v1.5"/>
                        </svg>
                      {/if}
                    </div>
                    <div class="sandbox-tier-title-group">
                      <span class="sandbox-tier-title">{levelTitle(level)}</span>
                      <span class="sandbox-tier-badge" data-tier={level}>{levelBadge(level)}</span>
                    </div>
                    {#if selected}
                      <div class="sandbox-tier-check-mark" aria-hidden="true">
                        <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M3 7.2l2.8 2.8L11 4"/>
                        </svg>
                      </div>
                    {/if}
                  </div>

                  <p class="sandbox-tier-desc">{levelDesc(level)}</p>

                  <div class="sandbox-tier-tags">
                    <span class="sandbox-tier-tag">
                      <svg class="sandbox-pill-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
                        <circle cx="8" cy="8" r="6"/>
                        <path d="M2 8h12M8 2a9 9 0 0 1 0 12M8 2a9 9 0 0 0 0 12"/>
                      </svg>
                      {levelNetwork(level)}
                    </span>
                    <span class="sandbox-tier-tag">
                      <svg class="sandbox-pill-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M2.5 4.5h3l1.5 2h6.5v6.5h-11z"/>
                      </svg>
                      {levelFilesystem(level)}
                    </span>
                    <span class="sandbox-tier-tag">
                      <svg class="sandbox-pill-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
                        <rect x="2.5" y="3.5" width="11" height="9" rx="1.5"/>
                        <path d="M5.5 7l2 2-2 2M9.5 11h2"/>
                      </svg>
                      {levelEnv(level)}
                    </span>
                  </div>
                </button>
              {/each}
            </div>

            <!-- Integrated Spectrum Track Bar -->
            <div class="sandbox-slider" data-level={isCustom ? "custom" : SLIDER_LEVELS[sliderIndex]}>
              <div class="sandbox-spectrum-meta">
                <span class="sandbox-spectrum-bound">
                  <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M7 1.5L2 3.8v3.5c0 3.5 2.5 5.7 5 6.4 2.5-.7 5-2.9 5-6.4V3.8L7 1.5z"/>
                  </svg>
                  {copy.strictest}
                </span>
                <span class="sandbox-spectrum-status">
                  {#if isCustom}
                    <Badge variant="secondary" class="text-[10px] py-0.5 px-2 font-semibold uppercase">{copy.badgeCustom}</Badge>
                  {:else}
                    <span class="sandbox-slider-badge">{levelTitle(SLIDER_LEVELS[sliderIndex])} · {levelBadge(SLIDER_LEVELS[sliderIndex])}</span>
                  {/if}
                </span>
                <span class="sandbox-spectrum-bound">
                  {copy.permissive}
                  <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M7.5 1.5l-5 6h4.5l-1 5 6-7h-4.5l1-4z"/>
                  </svg>
                </span>
              </div>

              <div class="sandbox-slider-track-wrap">
                <div class="sandbox-slider-track" aria-hidden="true"></div>
                <div
                  class="sandbox-slider-fill"
                  style="width: {isCustom ? '0%' : `${(sliderIndex / (SLIDER_LEVELS.length - 1)) * 100}%`}"
                  aria-hidden="true"
                ></div>
                <input
                  class="sandbox-slider-input"
                  type="range"
                  min="0"
                  max={SLIDER_LEVELS.length - 1}
                  step="1"
                  value={isCustom ? 0 : sliderIndex}
                  aria-label={copy.presetTitle}
                  oninput={(e) => applyLevelByIndex(Number((e.target as HTMLInputElement).value))}
                />
                {#each SLIDER_LEVELS as level, index (level)}
                  <button
                    type="button"
                    class="sandbox-slider-stop {!isCustom && sliderIndex === index ? 'sandbox-slider-stop--active' : ''}"
                    style="left: {(index / (SLIDER_LEVELS.length - 1)) * 100}%"
                    onclick={() => applyLevelByIndex(index)}
                    aria-label={levelTitle(level)}
                    aria-pressed={!isCustom && sliderIndex === index}
                  ></button>
                {/each}
              </div>
            </div>

            <!-- Custom Policy Callout -->
            {#if isCustom}
              <div class="sandbox-custom-callout">
                <div class="sandbox-custom-callout-icon">
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8">
                    <path d="M2.5 13.5l11-11M9 2.5h4.5v4.5M10.5 9.5l3 3M2.5 5.5l3 3"/>
                  </svg>
                </div>
                <div class="sandbox-custom-callout-text">
                  <strong>{copy.badgeCustom}</strong>
                  <p>{copy.customInEffect}</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  class="sandbox-custom-reset-btn"
                  onclick={() => applyProfile("standard")}
                >
                  {copy.resetToStandard}
                </Button>
              </div>
            {/if}
          </div>
        </div>
      </div>

      <div class="channel-card">
        <div class="channel-card-header">
          <div>
            <h2 class="channel-card-title">Runtime Mode</h2>
            <p class="channel-card-desc">Sandbox applies to Agent bash and subagent bash. Initialization failures block execution.</p>
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
            <Input id="sb-env-path" bind:value={sandbox.envFilePath} placeholder=".env" />
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
  /* Sandbox Preset Cards & Spectrum Matrix */
  .sandbox-presets-panel {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin-bottom: 0.5rem;
  }
  .sandbox-tier-cards {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0.625rem;
  }
  .sandbox-tier-card {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    text-align: left;
    padding: 0.75rem;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: var(--card);
    cursor: pointer;
    outline: none;
    font: inherit;
    color: inherit;
    transition: transform 0.15s ease, border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
  }
  .sandbox-tier-card:hover {
    background: var(--accent);
    border-color: color-mix(in oklab, var(--muted-foreground) 35%, var(--border));
    transform: translateY(-1px);
  }
  .sandbox-tier-card:focus-visible {
    box-shadow: 0 0 0 2px var(--background), 0 0 0 4px var(--primary);
  }
  .sandbox-tier-card[data-tier="locked"].active {
    border-color: var(--success, #10b981);
    background: color-mix(in oklab, var(--success, #10b981) 8%, var(--card));
    box-shadow: 0 0 0 1px var(--success, #10b981), 0 4px 12px color-mix(in oklab, var(--success, #10b981) 12%, transparent);
  }
  .sandbox-tier-card[data-tier="readonly"].active {
    border-color: var(--primary);
    background: color-mix(in oklab, var(--primary) 8%, var(--card));
    box-shadow: 0 0 0 1px var(--primary), 0 4px 12px color-mix(in oklab, var(--primary) 12%, transparent);
  }
  .sandbox-tier-card[data-tier="standard"].active {
    border-color: var(--primary);
    background: color-mix(in oklab, var(--primary) 8%, var(--card));
    box-shadow: 0 0 0 1px var(--primary), 0 4px 12px color-mix(in oklab, var(--primary) 12%, transparent);
  }
  .sandbox-tier-card[data-tier="full"].active {
    border-color: var(--destructive);
    background: color-mix(in oklab, var(--destructive) 8%, var(--card));
    box-shadow: 0 0 0 1px var(--destructive), 0 4px 12px color-mix(in oklab, var(--destructive) 14%, transparent);
  }
  .sandbox-tier-card-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
    min-height: 1.75rem;
  }
  .sandbox-tier-icon-wrap {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.75rem;
    height: 1.75rem;
    border-radius: calc(var(--radius) - 2px);
    background: var(--muted);
    color: var(--muted-foreground);
    flex-shrink: 0;
  }
  .sandbox-tier-card.active .sandbox-tier-icon-wrap[data-tier="locked"] {
    background: color-mix(in oklab, var(--success, #10b981) 20%, transparent);
    color: var(--success, #10b981);
  }
  .sandbox-tier-card.active .sandbox-tier-icon-wrap[data-tier="readonly"],
  .sandbox-tier-card.active .sandbox-tier-icon-wrap[data-tier="standard"] {
    background: color-mix(in oklab, var(--primary) 20%, transparent);
    color: var(--primary);
  }
  .sandbox-tier-card.active .sandbox-tier-icon-wrap[data-tier="full"] {
    background: color-mix(in oklab, var(--destructive) 20%, transparent);
    color: var(--destructive);
  }
  .sandbox-tier-icon {
    width: 0.9375rem;
    height: 0.9375rem;
  }
  .sandbox-tier-title-group {
    display: flex;
    flex-direction: column;
    gap: 0.0625rem;
    min-width: 0;
    flex: 1;
  }
  .sandbox-tier-title {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--foreground);
    line-height: 1.2;
  }
  .sandbox-tier-badge {
    font-size: 0.6875rem;
    font-weight: 600;
    color: var(--muted-foreground);
    line-height: 1;
  }
  .sandbox-tier-card.active .sandbox-tier-badge[data-tier="locked"] {
    color: var(--success, #10b981);
  }
  .sandbox-tier-card.active .sandbox-tier-badge[data-tier="readonly"],
  .sandbox-tier-card.active .sandbox-tier-badge[data-tier="standard"] {
    color: var(--primary);
  }
  .sandbox-tier-card.active .sandbox-tier-badge[data-tier="full"] {
    color: var(--destructive);
  }
  .sandbox-tier-check-mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1rem;
    height: 1rem;
    border-radius: 9999px;
    flex-shrink: 0;
    color: #fff;
  }
  .sandbox-tier-card[data-tier="locked"] .sandbox-tier-check-mark {
    background: var(--success, #10b981);
  }
  .sandbox-tier-card[data-tier="readonly"] .sandbox-tier-check-mark,
  .sandbox-tier-card[data-tier="standard"] .sandbox-tier-check-mark {
    background: var(--primary);
  }
  .sandbox-tier-card[data-tier="full"] .sandbox-tier-check-mark {
    background: var(--destructive);
  }
  .sandbox-tier-check-mark svg {
    width: 0.625rem;
    height: 0.625rem;
  }
  .sandbox-tier-desc {
    font-size: 0.75rem;
    line-height: 1.45;
    color: var(--muted-foreground);
    margin: 0 0 0.625rem 0;
    flex: 1;
    min-height: 2.125rem;
  }
  .sandbox-tier-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }
  .sandbox-tier-tag {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.125rem 0.375rem;
    border-radius: calc(var(--radius) - 4px);
    font-size: 0.6875rem;
    line-height: 1.3;
    font-weight: 500;
    background: var(--muted);
    color: var(--muted-foreground);
    border: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
  }
  .sandbox-pill-icon {
    width: 0.6875rem;
    height: 0.6875rem;
    flex-shrink: 0;
    opacity: 0.85;
  }
  /* Slider Spectrum Track */
  .sandbox-slider {
    width: 100%;
    margin-top: 0.25rem;
    --slider-accent: var(--primary);
  }
  .sandbox-slider[data-level="locked"] { --slider-accent: var(--success, #10b981); }
  .sandbox-slider[data-level="readonly"] { --slider-accent: var(--primary); }
  .sandbox-slider[data-level="standard"] { --slider-accent: var(--primary); }
  .sandbox-slider[data-level="full"] { --slider-accent: var(--destructive); }
  .sandbox-spectrum-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.375rem;
    font-size: 0.75rem;
    color: var(--muted-foreground);
  }
  .sandbox-spectrum-bound {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.6875rem;
    color: var(--muted-foreground);
    font-weight: 500;
  }
  .sandbox-spectrum-bound svg {
    width: 0.75rem;
    height: 0.75rem;
  }
  .sandbox-spectrum-status {
    display: inline-flex;
    align-items: center;
  }
  .sandbox-slider-badge {
    display: inline-flex;
    align-items: center;
    border-radius: 9999px;
    padding: 0.125rem 0.625rem;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--slider-accent);
    border: 1px solid color-mix(in oklab, var(--slider-accent) 35%, transparent);
    background: color-mix(in oklab, var(--slider-accent) 10%, transparent);
    width: fit-content;
  }
  .sandbox-slider-track-wrap {
    position: relative;
    height: 1.25rem;
    display: flex;
    align-items: center;
  }
  .sandbox-slider-track,
  .sandbox-slider-fill {
    position: absolute;
    left: 0;
    right: 0;
    height: 0.375rem;
    border-radius: 9999px;
  }
  .sandbox-slider-track {
    background: var(--muted);
  }
  .sandbox-slider-fill {
    right: auto;
    background: var(--slider-accent);
    transition: width 0.2s ease, background 0.2s ease;
  }
  .sandbox-slider-input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    opacity: 0;
    cursor: pointer;
    z-index: 2;
  }
  .sandbox-slider-stop {
    position: absolute;
    transform: translate(-50%, -50%);
    top: 50%;
    width: 0.875rem;
    height: 0.875rem;
    border-radius: 9999px;
    border: 2px solid var(--border);
    background: var(--background);
    cursor: pointer;
    padding: 0;
    transition: all 0.2s ease;
    z-index: 1;
  }
  .sandbox-slider-stop--active {
    border-color: var(--slider-accent);
    background: var(--slider-accent);
    box-shadow: 0 0 0 3px color-mix(in oklab, var(--slider-accent) 25%, transparent);
  }
  .sandbox-custom-callout {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.625rem 0.875rem;
    border-radius: calc(var(--radius) - 2px);
    background: color-mix(in oklab, var(--primary) 8%, var(--card));
    border: 1px solid color-mix(in oklab, var(--primary) 25%, transparent);
  }
  .sandbox-custom-callout-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.75rem;
    height: 1.75rem;
    border-radius: calc(var(--radius) - 4px);
    background: color-mix(in oklab, var(--primary) 15%, transparent);
    color: var(--primary);
    flex-shrink: 0;
  }
  .sandbox-custom-callout-icon svg {
    width: 0.9375rem;
    height: 0.9375rem;
  }
  .sandbox-custom-callout-text {
    flex: 1;
    min-width: 0;
  }
  .sandbox-custom-callout-text strong {
    display: block;
    font-size: 0.8125rem;
    color: var(--foreground);
    line-height: 1.2;
  }
  .sandbox-custom-callout-text p {
    margin: 0.125rem 0 0;
    font-size: 0.75rem;
    color: var(--muted-foreground);
    line-height: 1.35;
  }
  .sandbox-custom-callout :global(.sandbox-custom-reset-btn) {
    font-size: 0.75rem;
    padding: 0.25rem 0.625rem;
    height: 1.75rem;
    flex-shrink: 0;
  }
  @media (max-width: 680px) {
    .sandbox-tier-cards {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @media (max-width: 440px) {
    .sandbox-tier-cards {
      grid-template-columns: 1fr;
    }
  }
</style>
