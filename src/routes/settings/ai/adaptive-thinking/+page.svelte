<script lang="ts">
  import { onMount } from "svelte";
  import { Alert, AlertDescription } from "$lib/components/ui/alert";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { NativeSelect, NativeSelectOption } from "$lib/components/ui/native-select";
  import { IosSwitch } from "$lib/components/ui/ios-switch";
  import { locale, initLocale } from "$lib/ui/i18n";

  type LocaleKey = "zh-CN" | "en-US";
  type ThinkingLevel = "low" | "medium" | "high";
  type Strategy = "fixed" | "auto";

  interface AdaptiveConfig {
    enabled: boolean;
    baseUrl: string;
    hasApiKey: boolean;
    defaultStrategy: Strategy;
    maxThinkingLevel: ThinkingLevel;
    fallbackThinkingLevel: ThinkingLevel;
    confidenceThreshold: number;
    timeoutMs: number;
  }

  const COPY: Record<LocaleKey, Record<string, string>> = {
    "zh-CN": {
      eyebrow: "决策引擎",
      title: "自适应思考",
      desc: "使用 Jev 在每个新 Turn 开始前选择合适的推理力度。功能默认关闭，固定思考等级不会调用 Jev。",
      on: "已启用",
      off: "已关闭",
      enable: "启用自适应思考",
      enableHint: "关闭时保留配置；Auto 会使用确定性的回退等级继续执行。",
      host: "Jev API Host",
      hostHint: "填写 TypeSafe API 的服务地址，不要包含 /v1/systemone。",
      key: "API Key",
      keyHint: "密钥只在服务端保存，页面只显示是否已配置。",
      keyPlaceholder: "输入新 Key（留空则保留已保存的 Key）",
      clearKey: "清除已保存 Key",
      undo: "撤销",
      strategy: "默认思考策略",
      strategyHint: "只影响没有 Session 或 Project 覆盖的范围。",
      fixed: "固定等级",
      auto: "Auto（逐轮判断）",
      low: "低",
      medium: "中",
      high: "高",
      ceiling: "自动思考上限",
      ceilingHint: "Auto 和回退结果的最终执行等级都不会超过此上限。",
      fallback: "回退思考等级",
      fallbackHint: "决策模型关闭或不可用时使用；请求失败、超时或低置信度固定使用“中”。",
      threshold: "置信度阈值",
      thresholdHint: "低于此值的 Choice 使用回退。初始值 0.6，需用真实任务集校准。",
      timeout: "决策超时（毫秒）",
      timeoutHint: "包含完整请求；范围 100–5000ms。",
      advanced: "高级设置",
      advancedHint: "调整置信度和延迟，不改变确定性的执行策略。",
      test: "测试连接",
      testing: "测试中...",
      testSuccess: "连接成功",
      save: "保存设置",
      saving: "保存中...",
      saved: "已保存",
      reset: "重置",
      loading: "加载配置中...",
      failedLoad: "加载自适应思考配置失败",
      failedSave: "保存自适应思考配置失败",
      clearConfirm: "保存后将清除已保存的 Jev API Key，确定继续吗？"
    },
    "en-US": {
      eyebrow: "Decision Engine",
      title: "Adaptive Thinking",
      desc: "Use Jev to choose reasoning effort before each new Turn. The feature is off by default; fixed levels never call Jev.",
      on: "On",
      off: "Off",
      enable: "Enable Adaptive Thinking",
      enableHint: "Configuration is kept when disabled; Auto uses the deterministic fallback level.",
      host: "Jev API Host",
      hostHint: "TypeSafe API service address, without /v1/systemone.",
      key: "API Key",
      keyHint: "The key stays server-side; this page only shows whether one is configured.",
      keyPlaceholder: "Enter a new key (leave blank to keep the saved key)",
      clearKey: "Clear saved key",
      undo: "Undo",
      strategy: "Default thinking strategy",
      strategyHint: "Used only when no Session or Project override exists.",
      fixed: "Fixed level",
      auto: "Auto (decide per Turn)",
      low: "Low",
      medium: "Medium",
      high: "High",
      ceiling: "Automatic ceiling",
      ceilingHint: "Final Auto and fallback levels never exceed this ceiling.",
      fallback: "Fallback thinking level",
      fallbackHint: "Used when the decision model is off or unavailable. Failed, timed out, or low-confidence decisions use medium.",
      threshold: "Confidence threshold",
      thresholdHint: "Choices below this value fall back. Starts at 0.6 and needs real-task calibration.",
      timeout: "Decision timeout (ms)",
      timeoutHint: "Covers the complete request; range 100–5000ms.",
      advanced: "Advanced settings",
      advancedHint: "Fine-tune confidence and latency without changing deterministic execution policy.",
      test: "Test connection",
      testing: "Testing...",
      testSuccess: "Connection successful",
      save: "Save settings",
      saving: "Saving...",
      saved: "Saved",
      reset: "Reset",
      loading: "Loading configuration...",
      failedLoad: "Failed to load Adaptive Thinking settings",
      failedSave: "Failed to save Adaptive Thinking settings",
      clearConfirm: "This will clear the saved Jev API Key after saving. Continue?"
    }
  };

  const DEFAULTS: AdaptiveConfig = {
    enabled: false,
    baseUrl: "https://api.typesafe.ai",
    hasApiKey: false,
    defaultStrategy: "fixed",
    maxThinkingLevel: "high",
    fallbackThinkingLevel: "medium",
    confidenceThreshold: 0.6,
    timeoutMs: 1000
  };

  let config: AdaptiveConfig = { ...DEFAULTS };
  let apiKey = "";
  let clearApiKey = false;
  let loading = true;
  let saving = false;
  let testing = false;
  let status = "";
  let statusVariant: "default" | "destructive" = "default";
  let lastSaved: AdaptiveConfig = { ...DEFAULTS };
  $: copy = COPY[$locale as LocaleKey] ?? COPY["en-US"];

  function snapshot(): AdaptiveConfig {
    return { ...config };
  }

  async function load(): Promise<void> {
    loading = true;
    status = "";
    try {
      initLocale();
      const response = await fetch("/api/settings/adaptive-thinking");
      const payload = await response.json();
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || copy.failedLoad);
      config = {
        enabled: Boolean(payload.enabled),
        baseUrl: String(payload.baseUrl ?? DEFAULTS.baseUrl),
        hasApiKey: Boolean(payload.hasApiKey),
        defaultStrategy: payload.defaultStrategy === "auto" ? "auto" : "fixed",
        maxThinkingLevel: ["low", "medium", "high"].includes(payload.maxThinkingLevel) ? payload.maxThinkingLevel : DEFAULTS.maxThinkingLevel,
        fallbackThinkingLevel: ["low", "medium", "high"].includes(payload.fallbackThinkingLevel) ? payload.fallbackThinkingLevel : DEFAULTS.fallbackThinkingLevel,
        confidenceThreshold: Number(payload.confidenceThreshold ?? DEFAULTS.confidenceThreshold),
        timeoutMs: Number(payload.timeoutMs ?? DEFAULTS.timeoutMs)
      };
      lastSaved = snapshot();
      apiKey = "";
      clearApiKey = false;
    } catch (error) {
      status = error instanceof Error ? error.message : String(error);
      statusVariant = "destructive";
    } finally {
      loading = false;
    }
  }

  async function save(): Promise<void> {
    if (clearApiKey && typeof window !== "undefined" && !window.confirm(copy.clearConfirm)) return;
    saving = true;
    status = "";
    try {
      const response = await fetch("/api/settings/adaptive-thinking", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...config, apiKey: apiKey || undefined, clearApiKey })
      });
      const payload = await response.json();
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || copy.failedSave);
      config.hasApiKey = Boolean(payload.hasApiKey);
      apiKey = "";
      clearApiKey = false;
      lastSaved = snapshot();
      status = copy.saved;
      statusVariant = "default";
    } catch (error) {
      status = error instanceof Error ? error.message : String(error);
      statusVariant = "destructive";
    } finally {
      saving = false;
    }
  }

  async function testConnection(): Promise<void> {
    testing = true;
    status = "";
    try {
      const response = await fetch("/api/settings/adaptive-thinking/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: config.baseUrl, apiKey, timeoutMs: config.timeoutMs })
      });
      const payload = await response.json();
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || copy.failedSave);
      status = copy.testSuccess + (payload.model ? " · " + payload.model : "");
      statusVariant = "default";
    } catch (error) {
      status = error instanceof Error ? error.message : String(error);
      statusVariant = "destructive";
    } finally {
      testing = false;
    }
  }

  function reset(): void {
    config = { ...lastSaved };
    apiKey = "";
    clearApiKey = false;
    status = "";
  }

  onMount(() => {
    void load();
  });
</script>

<div class="adaptive-page">
  <header class="adaptive-hero">
    <div class="flex flex-wrap items-center gap-2">
      <Badge variant="secondary">{copy.eyebrow}</Badge>
      <Badge variant={config.enabled ? "default" : "outline"}>{config.enabled ? copy.on : copy.off}</Badge>
    </div>
    <h1>{copy.title}</h1>
    <p>{copy.desc}</p>
  </header>

  {#if status && !saving}
    <Alert variant={statusVariant}>
      <AlertDescription>{status}</AlertDescription>
    </Alert>
  {/if}

  {#if loading}
    <p class="adaptive-loading">{copy.loading}</p>
  {:else}
    <form id="adaptive-thinking-form" class="adaptive-form" onsubmit={(event) => { event.preventDefault(); void save(); }}>
      <section class="adaptive-card">
        <div class="adaptive-card-header">
          <div>
            <h2>{copy.enable}</h2>
            <p>{copy.enableHint}</p>
          </div>
          <IosSwitch id="adaptive-enabled" bind:checked={config.enabled} />
        </div>
      </section>

      <section class="adaptive-card">
        <div class="adaptive-card-header">
          <h2>{copy.host}</h2>
          <p>{copy.hostHint}</p>
        </div>
        <div class="adaptive-fields">
          <div class="adaptive-field">
            <Label for="adaptive-host">{copy.host}</Label>
            <Input id="adaptive-host" bind:value={config.baseUrl} placeholder="https://api.typesafe.ai" />
          </div>
          <div class="adaptive-field">
            <Label for="adaptive-key">{copy.key}</Label>
            <Input id="adaptive-key" type="password" bind:value={apiKey} placeholder={config.hasApiKey ? copy.keyPlaceholder : "jv_live_..."} autocomplete="new-password" />
            <p>{copy.keyHint}</p>
            {#if config.hasApiKey}
              <button type="button" class="adaptive-clear" onclick={() => { clearApiKey = !clearApiKey; }} aria-pressed={clearApiKey}>
                {clearApiKey ? copy.undo : copy.clearKey}
              </button>
            {/if}
          </div>
          <div class="adaptive-test-row">
            <Button type="button" variant="outline" onclick={testConnection} disabled={testing || saving || !apiKey}>
              {testing ? copy.testing : copy.test}
            </Button>
          </div>
        </div>
      </section>

      <section class="adaptive-card adaptive-card-spaced">
        <div class="adaptive-card-header">
          <h2>{copy.strategy}</h2>
          <p>{copy.strategyHint}</p>
        </div>
        <div class="adaptive-fields adaptive-fields-three">
          <div class="adaptive-field">
            <Label for="adaptive-strategy">{copy.strategy}</Label>
            <NativeSelect id="adaptive-strategy" bind:value={config.defaultStrategy}>
              <NativeSelectOption value="fixed">{copy.fixed}</NativeSelectOption>
              <NativeSelectOption value="auto">{copy.auto}</NativeSelectOption>
            </NativeSelect>
          </div>
          <div class="adaptive-field">
            <Label for="adaptive-ceiling">{copy.ceiling}</Label>
            <NativeSelect id="adaptive-ceiling" bind:value={config.maxThinkingLevel}>
              <NativeSelectOption value="low">{copy.low}</NativeSelectOption>
              <NativeSelectOption value="medium">{copy.medium}</NativeSelectOption>
              <NativeSelectOption value="high">{copy.high}</NativeSelectOption>
            </NativeSelect>
            <p>{copy.ceilingHint}</p>
          </div>
          <div class="adaptive-field">
            <Label for="adaptive-fallback">{copy.fallback}</Label>
            <NativeSelect id="adaptive-fallback" bind:value={config.fallbackThinkingLevel}>
              <NativeSelectOption value="low">{copy.low}</NativeSelectOption>
              <NativeSelectOption value="medium">{copy.medium}</NativeSelectOption>
              <NativeSelectOption value="high">{copy.high}</NativeSelectOption>
            </NativeSelect>
            <p>{copy.fallbackHint}</p>
          </div>
        </div>
      </section>

      <section class="adaptive-card adaptive-card-spaced">
        <div class="adaptive-card-header">
          <h2>{copy.advanced}</h2>
          <p>{copy.advancedHint}</p>
        </div>
        <div class="adaptive-fields adaptive-fields-two">
          <div class="adaptive-field">
            <Label for="adaptive-threshold">{copy.threshold}</Label>
            <Input id="adaptive-threshold" type="number" min="0" max="1" step="0.01" bind:value={config.confidenceThreshold} />
            <p>{copy.thresholdHint}</p>
          </div>
          <div class="adaptive-field">
            <Label for="adaptive-timeout">{copy.timeout}</Label>
            <Input id="adaptive-timeout" type="number" min="100" max="5000" step="100" bind:value={config.timeoutMs} />
            <p>{copy.timeoutHint}</p>
          </div>
        </div>
      </section>
    </form>
  {/if}
</div>

<footer class="settings-footbar">
  <div class="settings-footbar-status">
    {#if saving}
      <span class="settings-footbar-saving">{copy.saving}</span>
    {:else if status}
      <span class={statusVariant === "destructive" ? "settings-footbar-error" : "settings-footbar-ok"}>{status}</span>
    {/if}
  </div>
  <div class="settings-footbar-actions">
    <Button variant="outline" size="sm" onclick={reset} disabled={loading || saving}>{copy.reset}</Button>
    <button type="submit" form="adaptive-thinking-form" class="settings-footbar-btn" disabled={loading || saving}>
      {saving ? copy.saving : copy.save}
    </button>
  </div>
</footer>

<style>
  .adaptive-page { max-width: 980px; margin: 0 auto; padding: 2rem 2.5rem 7rem; color: var(--foreground); }
  .adaptive-hero { margin-bottom: 1.5rem; }
  .adaptive-hero h1 { margin: 0.75rem 0 0.5rem; font-size: clamp(1.75rem, 3vw, 2.5rem); font-weight: 700; letter-spacing: -0.03em; }
  .adaptive-hero p, .adaptive-card-header p, .adaptive-field p { color: var(--muted-foreground); font-size: 0.875rem; line-height: 1.55; }
  .adaptive-card { border: 1px solid var(--border); border-radius: 0.875rem; background: var(--card); padding: 1.25rem; }
  .adaptive-card-spaced { margin-top: 1rem; }
  .adaptive-card-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; }
  .adaptive-card-header h2 { margin: 0; font-size: 1rem; font-weight: 650; }
  .adaptive-card-header p { margin: 0.35rem 0 0; max-width: 54rem; }
  .adaptive-fields { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 1rem; margin-top: 1.25rem; }
  .adaptive-fields-three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .adaptive-fields-two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .adaptive-field { display: flex; flex-direction: column; gap: 0.45rem; min-width: 0; }
  .adaptive-test-row { display: flex; align-items: end; }
  .adaptive-clear { align-self: flex-start; color: var(--destructive); font-size: 0.75rem; text-decoration: underline; }
  .adaptive-loading { padding: 2rem 0; color: var(--muted-foreground); }
  @media (max-width: 760px) {
    .adaptive-page { padding: 1.25rem 1rem 7rem; }
    .adaptive-fields, .adaptive-fields-three, .adaptive-fields-two { grid-template-columns: 1fr; }
  }
</style>
