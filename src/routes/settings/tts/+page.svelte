<script lang="ts">
  import { onMount } from "svelte";
  import { Alert, AlertDescription } from "$lib/components/ui/alert";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "$lib/components/ui/card";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { NativeSelect, NativeSelectOption } from "$lib/components/ui/native-select";
  import { IosSwitch } from "$lib/components/ui/ios-switch";
  import { locale } from "$lib/ui/i18n";

  type ProviderId = "macos" | "xiaomi";
  type AudioFormat = "wav" | "mp3" | "aiff" | "m4a" | "caf";

  interface TtsGenerateSettings {
    enabled: boolean;
    defaultProvider: ProviderId;
    providers: {
      macos: { enabled: boolean; voice: string; format: AudioFormat };
      xiaomi: { enabled: boolean; apiKey: string; baseUrl: string; model: string; voice: string; format: AudioFormat };
    };
  }

  interface VoiceOption {
    id: string;
    label?: string;
    locale?: string;
    gender?: string;
    sample?: string;
  }

  const COPY = {
    "zh-CN": {
      title: "语音合成",
      desc: "配置内置 Agent 文本转语音工具。支持 macOS 系统语音和小米 MiMo TTS。",
      enableTool: "启用内置 ttsGenerate 工具",
      enableToolDesc: "禁用后，语音合成请求会返回配置错误，不会调用本地语音或外部 API。",
      defaultProvider: "默认 Provider",
      macosProvider: "macOS 系统语音",
      xiaomiProvider: "小米 MiMo TTS",
      macosTitle: "macOS 系统语音",
      macosDesc: "使用当前 macOS 系统自带的 say 命令生成音频。非 macOS 系统不可用。",
      xiaomiTitle: "小米 MiMo TTS",
      xiaomiDesc: "通过小米 MiMo speech synthesis API 生成 wav 音频。",
      enabled: "启用",
      unavailable: "当前系统不可用",
      available: "可用",
      voice: "音色",
      model: "模型",
      format: "格式",
      apiKey: "API Key",
      baseUrl: "Base URL",
      noModel: "系统语音无模型选择",
      testTitle: "测试语音合成",
      testText: "测试文本",
      testTextPlaceholder: "输入要合成为语音的文本",
      testProvider: "测试 Provider",
      testButton: "测试生成",
      testingButton: "生成中...",
      testResultTitle: "测试结果",
      saveButton: "保存设置",
      savingButton: "保存中...",
      savedMsg: "语音合成设置已保存。",
      loadError: "加载设置失败",
      saveError: "保存设置失败",
      testError: "语音合成测试失败"
    },
    "en-US": {
      title: "Speech Synthesis",
      desc: "Configure the built-in Agent text-to-speech tool. Supports macOS system voices and Xiaomi MiMo TTS.",
      enableTool: "Enable built-in ttsGenerate tool",
      enableToolDesc: "When disabled, speech generation requests return a settings error instead of calling local speech or external APIs.",
      defaultProvider: "Default Provider",
      macosProvider: "macOS System Voice",
      xiaomiProvider: "Xiaomi MiMo TTS",
      macosTitle: "macOS System Voice",
      macosDesc: "Use the current macOS system say command to generate audio. Unavailable on non-macOS systems.",
      xiaomiTitle: "Xiaomi MiMo TTS",
      xiaomiDesc: "Generate wav audio through the Xiaomi MiMo speech synthesis API.",
      enabled: "Enabled",
      unavailable: "Unavailable on this system",
      available: "Available",
      voice: "Voice",
      model: "Model",
      format: "Format",
      apiKey: "API Key",
      baseUrl: "Base URL",
      noModel: "System voices do not have model selection",
      testTitle: "Test Speech Synthesis",
      testText: "Test text",
      testTextPlaceholder: "Enter text to synthesize",
      testProvider: "Test Provider",
      testButton: "Test Generate",
      testingButton: "Generating...",
      testResultTitle: "Test Result",
      saveButton: "Save settings",
      savingButton: "Saving...",
      savedMsg: "Speech synthesis settings saved.",
      loadError: "Failed to load settings",
      saveError: "Failed to save settings",
      testError: "Speech synthesis test failed"
    }
  };

  function t(key: keyof typeof COPY["en-US"]): string {
    return COPY[$locale]?.[key] ?? COPY["en-US"][key];
  }

  const xiaomiVoices: VoiceOption[] = [
    { id: "mimo_default", label: "MiMo-默认", locale: "因部署集群而异" },
    { id: "冰糖", label: "冰糖", locale: "中文", gender: "女性" },
    { id: "茉莉", label: "茉莉", locale: "中文", gender: "女性" },
    { id: "苏打", label: "苏打", locale: "中文", gender: "男性" },
    { id: "白桦", label: "白桦", locale: "中文", gender: "男性" },
    { id: "Mia", label: "Mia", locale: "英文", gender: "女性" },
    { id: "Chloe", label: "Chloe", locale: "英文", gender: "女性" },
    { id: "Milo", label: "Milo", locale: "英文", gender: "男性" },
    { id: "Dean", label: "Dean", locale: "英文", gender: "男性" }
  ];

  let loading = true;
  let saving = false;
  let testing = false;
  let message = "";
  let error = "";
  let testResult: any = null;
  let showApiKey = false;
  let macosAvailable = false;
  let macosVoices: VoiceOption[] = [];
  let testText = "你好，这是 Molibot 的语音合成测试。";
  let testProvider: ProviderId = "xiaomi";

  let ttsGenerate: TtsGenerateSettings = {
    enabled: true,
    defaultProvider: "macos",
    providers: {
      macos: { enabled: true, voice: "", format: "aiff" },
      xiaomi: {
        enabled: false,
        apiKey: "",
        baseUrl: "https://api.xiaomimimo.com/v1",
        model: "mimo-v2-tts",
        voice: "mimo_default",
        format: "wav"
      }
    }
  };

  async function loadSettings(): Promise<void> {
    loading = true;
    message = "";
    error = "";
    try {
      const res = await fetch("/api/settings/dynamic/tts-generate");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || t("loadError"));
      ttsGenerate = { ...ttsGenerate, ...(data.value ?? {}) };
      testProvider = ttsGenerate.defaultProvider;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  async function loadVoices(): Promise<void> {
    try {
      const res = await fetch("/api/settings/tts-generate/voices?provider=macos");
      const data = await res.json();
      macosAvailable = Boolean(data.available);
      macosVoices = data.voices || [];
    } catch {
      macosAvailable = false;
      macosVoices = [];
    }
  }

  async function save(): Promise<void> {
    saving = true;
    message = "";
    error = "";
    try {
      const res = await fetch("/api/settings/dynamic/tts-generate", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: ttsGenerate })
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || t("saveError"));
      ttsGenerate = data.value;
      message = t("savedMsg");
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      saving = false;
    }
  }

  async function testSynthesis(): Promise<void> {
    testing = true;
    message = "";
    error = "";
    testResult = null;
    try {
      const providerConfig = ttsGenerate.providers[testProvider];
      const res = await fetch("/api/settings/tts-generate/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: testText,
          provider: testProvider,
          voice: providerConfig.voice,
          model: testProvider === "xiaomi" ? ttsGenerate.providers.xiaomi.model : undefined,
          format: providerConfig.format,
          ttsGenerate
        })
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || t("testError"));
      testResult = data.result;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      testing = false;
    }
  }

  onMount(() => {
    loadSettings();
    loadVoices();
  });
</script>

<div class="tts-page">
  <!-- Hero Header -->
  <header class="tts-hero">
    <span class="tts-badge">Built-in Tool</span>
    <h1 class="tts-hero-title">{t("title")}</h1>
    <p class="tts-hero-desc">{t("desc")}</p>
  </header>

  {#if error}
    <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
  {/if}
  {#if message}
    <Alert><AlertDescription>{message}</AlertDescription></Alert>
  {/if}

  {#if loading}
    <p class="py-8 text-sm text-muted-foreground">Loading settings...</p>
  {:else}
    <form id="tts-form" class="space-y-5" onsubmit={(event) => { event.preventDefault(); save(); }}>
      <Card>
        <CardHeader>
          <CardTitle class="text-sm">Default Behavior</CardTitle>
          <CardDescription>Select the default behavior for speech generation commands.</CardDescription>
        </CardHeader>
        <CardContent class="grid gap-5">
          <div class="flex items-center justify-between gap-4 rounded-lg border bg-muted/30 px-4 py-3">
            <div>
              <Label for="tts-enabled">{t("enableTool")}</Label>
              <p class="mt-1 text-xs text-muted-foreground">{t("enableToolDesc")}</p>
            </div>
            <IosSwitch id="tts-enabled" bind:checked={ttsGenerate.enabled} />
          </div>

          <div class="grid gap-4 sm:grid-cols-2">
            <div class="grid gap-1.5">
              <Label for="default-provider">{t("defaultProvider")}</Label>
              <NativeSelect id="default-provider" bind:value={ttsGenerate.defaultProvider}>
                <NativeSelectOption value="macos">{t("macosProvider")}</NativeSelectOption>
                <NativeSelectOption value="xiaomi">{t("xiaomiProvider")}</NativeSelectOption>
              </NativeSelect>
            </div>
          </div>
        </CardContent>
      </Card>

      <div class="grid gap-5 lg:grid-cols-2">
        <!-- macOS Card -->
        <Card>
          <CardHeader>
            <div class="flex items-center gap-2">
              <CardTitle class="text-sm">{t("macosTitle")}</CardTitle>
              <Badge variant={macosAvailable ? "default" : "secondary"}>{macosAvailable ? t("available") : t("unavailable")}</Badge>
            </div>
            <CardDescription>{t("macosDesc")}</CardDescription>
          </CardHeader>
          <CardContent class="grid gap-4">
            <div class="flex items-center justify-between gap-4 rounded-lg border bg-muted/30 px-4 py-3">
              <Label for="macos-enabled">{t("enabled")}</Label>
              <IosSwitch id="macos-enabled" bind:checked={ttsGenerate.providers.macos.enabled} />
            </div>

            <div class="grid gap-1.5">
              <Label for="macos-voice">{t("voice")}</Label>
              {#if macosVoices.length > 0}
                <NativeSelect id="macos-voice" bind:value={ttsGenerate.providers.macos.voice}>
                  <NativeSelectOption value="">System Default</NativeSelectOption>
                  {#each macosVoices as voice}
                    <NativeSelectOption value={voice.id}>{voice.label ?? voice.id}{voice.locale ? ` · ${voice.locale}` : ""}{voice.gender ? ` · ${voice.gender}` : ""}</NativeSelectOption>
                  {/each}
                </NativeSelect>
              {:else}
                <Input id="macos-voice" bind:value={ttsGenerate.providers.macos.voice} placeholder="Tingting" />
              {/if}
            </div>

            <div class="grid gap-1.5">
              <Label for="macos-format">{t("format")}</Label>
              <NativeSelect id="macos-format" bind:value={ttsGenerate.providers.macos.format}>
                <NativeSelectOption value="aiff">AIFF</NativeSelectOption>
                <NativeSelectOption value="m4a">M4A</NativeSelectOption>
                <NativeSelectOption value="caf">CAF</NativeSelectOption>
              </NativeSelect>
            </div>

            <p class="text-xs text-muted-foreground">{t("noModel")}</p>
          </CardContent>
        </Card>

        <!-- Xiaomi Card -->
        <Card>
          <CardHeader>
            <CardTitle class="text-sm">{t("xiaomiTitle")}</CardTitle>
            <CardDescription>{t("xiaomiDesc")}</CardDescription>
          </CardHeader>
          <CardContent class="grid gap-4">
            <div class="flex items-center justify-between gap-4 rounded-lg border bg-muted/30 px-4 py-3">
              <Label for="xiaomi-enabled">{t("enabled")}</Label>
              <IosSwitch id="xiaomi-enabled" bind:checked={ttsGenerate.providers.xiaomi.enabled} />
            </div>

            <div class="grid gap-1.5">
              <Label for="xiaomi-api-key">{t("apiKey")}</Label>
              <div class="flex items-center gap-1.5">
                <Input
                  id="xiaomi-api-key"
                  type={showApiKey ? "text" : "password"}
                  autocomplete="off"
                  bind:value={ttsGenerate.providers.xiaomi.apiKey}
                  placeholder="MIMO_API_KEY"
                />
                <button
                  type="button"
                  class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                  onclick={() => (showApiKey = !showApiKey)}
                  aria-label={showApiKey ? "Hide API key" : "Show API key"}
                >
                  {#if showApiKey}
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/></svg>
                  {:else}
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>
                  {/if}
                </button>
              </div>
            </div>

            <div class="grid gap-1.5">
              <Label for="xiaomi-base-url">{t("baseUrl")}</Label>
              <Input id="xiaomi-base-url" bind:value={ttsGenerate.providers.xiaomi.baseUrl} placeholder="https://api.xiaomimimo.com/v1" />
            </div>

            <div class="grid gap-1.5">
              <Label for="xiaomi-model">{t("model")}</Label>
              <Input id="xiaomi-model" bind:value={ttsGenerate.providers.xiaomi.model} placeholder="mimo-v2-tts" />
            </div>

            <div class="grid gap-1.5">
              <Label for="xiaomi-voice">{t("voice")}</Label>
              <NativeSelect id="xiaomi-voice" bind:value={ttsGenerate.providers.xiaomi.voice}>
                {#each xiaomiVoices as voice}
                  <NativeSelectOption value={voice.id}>{voice.label ?? voice.id}{voice.locale ? ` · ${voice.locale}` : ""}{voice.gender ? ` · ${voice.gender}` : ""}</NativeSelectOption>
                {/each}
              </NativeSelect>
            </div>

            <div class="grid gap-1.5">
              <Label for="xiaomi-format">{t("format")}</Label>
              <NativeSelect id="xiaomi-format" bind:value={ttsGenerate.providers.xiaomi.format}>
                <NativeSelectOption value="wav">WAV</NativeSelectOption>
                <NativeSelectOption value="mp3">MP3</NativeSelectOption>
              </NativeSelect>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle class="text-sm">{t("testTitle")}</CardTitle>
          <CardDescription>{t("testTextPlaceholder")}</CardDescription>
        </CardHeader>
        <CardContent class="space-y-4">
          <div class="grid gap-2 sm:grid-cols-[minmax(0,1fr)_220px_auto]">
            <Input bind:value={testText} placeholder={t("testTextPlaceholder")} />
            <NativeSelect bind:value={testProvider}>
              <NativeSelectOption value="macos">{t("macosProvider")}</NativeSelectOption>
              <NativeSelectOption value="xiaomi">{t("xiaomiProvider")}</NativeSelectOption>
            </NativeSelect>
            <Button type="button" variant="secondary" onclick={testSynthesis} disabled={testing}>{testing ? t("testingButton") : t("testButton")}</Button>
          </div>
          {#if testResult}
            <div class="rounded-lg border bg-muted/30 p-4 text-sm">
              <p class="text-xs font-semibold text-foreground">{t("testResultTitle")}</p>
              {#if testResult.details?.filePath}
                {@const audioRelPath = testResult.details.filePath.split('/test-audio/')[1] ?? testResult.details.path}
                <div class="mt-3">
                  <audio controls src="/api/settings/tts-generate/audio?file=test-audio/{audioRelPath}" class="w-full" style="height: 40px;">
                    Your browser does not support the audio element.
                  </audio>
                </div>
              {/if}
              <details class="mt-3">
                <summary class="cursor-pointer text-xs text-muted-foreground hover:text-foreground">Raw JSON</summary>
                <pre class="mt-2 max-h-[32rem] overflow-auto whitespace-pre-wrap break-words rounded-md border bg-background/70 p-3 text-[11px] leading-5 text-muted-foreground">{JSON.stringify(testResult.details ?? testResult, null, 2)}</pre>
              </details>
            </div>
          {/if}
        </CardContent>
      </Card>
    </form>
  {/if}
</div>

{#if !loading}
  <!-- Fixed Footer Bar -->
  <footer class="settings-footbar">
    <div class="settings-footbar-status">
      {#if saving}
        <span class="flex items-center gap-2 text-xs font-medium text-muted-foreground animate-pulse">
          Saving changes...
        </span>
      {:else if message}
        <span class="flex items-center gap-2 text-xs font-medium text-emerald-600 dark:text-emerald-500">
          {message}
        </span>
      {:else if error}
        <span class="flex items-center gap-2 text-xs font-medium text-destructive">
          {error}
        </span>
      {/if}
    </div>
    <div class="flex items-center gap-3">
      <Button type="submit" form="tts-form" variant="default" size="sm" disabled={loading || saving} class="h-9 px-6 text-xs font-bold">
        {saving ? t("savingButton") : t("saveButton")}
      </Button>
    </div>
  </footer>
{/if}
