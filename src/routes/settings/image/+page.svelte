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
  import { locale } from "$lib/ui/i18n";

  type EngineId = "agnes" | "modelscope" | "google" | "volcengine";

  interface EngineSettings {
    apiKey: string;
    baseUrl?: string;
    model?: string;
  }

  interface ImageGenerateSettings {
    enabled: boolean;
    defaultEngine: EngineId | "auto";
    engines: Record<EngineId, EngineSettings>;
  }

  const COPY = {
    "zh-CN": {
      title: "图像生成",
      desc: "配置内置 Agent 图像生成工具。支持 Agnes Image、Google Imagen、火山引擎及 ModelScope 的多引擎路由。",
      enableTool: "启用内置 imageGenerate 工具",
      enableToolDesc: "禁用后，该工具在调用时会返回配置错误，而不会实际执行。",
      defaultEngine: "默认引擎",
      autoEngine: "自动优先级顺序",
      autoEngineDesc: "在自动模式下，工具会依次检测 Agnes、Google、火山引擎和 ModelScope，使用第一个配置了有效 API Key 的引擎。",
      enginesTitle: "图像生成引擎",
      enginesDesc: "配置各图像生成服务方的认证密钥、默认模型及 API 端点。",
      apiKey: "API Key",
      baseUrl: "自定义 Base URL",
      model: "模型 ID",
      resolvedUrl: "解析后 URL",
      testTitle: "测试图像生成",
      testDesc: "即时测试配置的可用性。测试将使用表单中未保存的值尝试生成一张测试图片。",
      testPromptPlaceholder: "输入提示词以生成图片",
      testButton: "测试",
      testingButton: "生成中...",
      testResultTitle: "测试响应结果",
      saveButton: "保存设置",
      savingButton: "保存中...",
      savedMsg: "图像生成设置已保存。",
      loadError: "加载设置失败",
      saveError: "保存设置失败",
      testError: "图像生成测试失败",
      defaultBehavior: "默认行为",
      defaultBehaviorDesc: "选择图像生成指令的默认行为。",
      testSizePlaceholder: "尺寸 (如 1024x1024)"
    },
    "en-US": {
      title: "Image Generation",
      desc: "Configure the built-in Agent image generation tool. Multi-engine routing is supported across Agnes Image, Google Imagen, Volcengine, and ModelScope.",
      enableTool: "Enable built-in imageGenerate tool",
      enableToolDesc: "When disabled, the tool returns a settings error instead of executing.",
      defaultEngine: "Default engine",
      autoEngine: "Auto priority order",
      autoEngineDesc: "In auto mode, the tool iterates through Agnes, Google, Volcengine, and ModelScope in order, using the first one with a valid API key configured.",
      enginesTitle: "Image Generation Engines",
      enginesDesc: "Configure credentials, default models, and API endpoints for your selected painting providers.",
      apiKey: "API Key",
      baseUrl: "Custom base URL",
      model: "Model ID",
      resolvedUrl: "Resolved URL",
      testTitle: "Test Image Generation",
      testDesc: "Test the configured settings in real-time. Unsaved values from the form will be used to attempt generating a test image.",
      testPromptPlaceholder: "Enter a prompt to draw",
      testButton: "Test",
      testingButton: "Generating...",
      testResultTitle: "ImageGenerateToolResponse",
      saveButton: "Save settings",
      savingButton: "Saving...",
      savedMsg: "Image generation settings saved.",
      loadError: "Failed to load settings",
      saveError: "Failed to save image settings",
      testError: "Image generation test failed",
      defaultBehavior: "Default Behavior",
      defaultBehaviorDesc: "Select the default behavior for image generation commands.",
      testSizePlaceholder: "Size (e.g. 1024x1024)"
    }
  };

  function t(key: keyof typeof COPY["en-US"]): string {
    return COPY[$locale]?.[key] ?? COPY["en-US"][key];
  }

  const engines: Array<{ id: EngineId; name: string; hint: string; keyLabel: string; defaultUrl: string; defaultModel: string }> = [
    { id: "agnes", name: "Agnes Image", hint: "High-performance OpenAI-compatible editing and generation (agnes-image-2.0-flash). ELO 1,184.", keyLabel: "AGNES_API_KEY", defaultUrl: "https://apihub.agnes-ai.com", defaultModel: "agnes-image-2.0-flash" },
    { id: "google", name: "Google Imagen", hint: "Excellent English instruction adherence, realism, and style consistency.", keyLabel: "GOOGLE_API_KEY", defaultUrl: "https://generativelanguage.googleapis.com", defaultModel: "imagen-3.0-generate-001" },
    { id: "volcengine", name: "Volcengine (Seedream)", hint: "Outstanding Chinese comprehension and illustration generation.", keyLabel: "VOLCENGINE_API_KEY", defaultUrl: "https://ark.cn-beijing.volces.com", defaultModel: "cv_vit_huge_p14_laion2b_s32b_b64_seedream" },
    { id: "modelscope", name: "ModelScope", hint: "High-speed and cost-effective generic generation (Z-Image-Turbo).", keyLabel: "MODELSCOPE_API_KEY", defaultUrl: "https://api-inference.modelscope.cn", defaultModel: "Tongyi-MAI/Z-Image-Turbo" }
  ];

  let loading = true;
  let saving = false;
  let testing = false;
  let message = "";
  let error = "";
  let testPrompt = "A futuristic cyberpunk cat logo";
  let testEngine: EngineId | "auto" = "auto";
  let testSize = "";
  let testResult: any = null;

  let showApiKey: Record<string, boolean> = {};

  let imageGenerate: ImageGenerateSettings = {
    enabled: true,
    defaultEngine: "auto",
    engines: {
      agnes: { apiKey: "", model: "" },
      modelscope: { apiKey: "", model: "" },
      google: { apiKey: "", model: "" },
      volcengine: { apiKey: "", model: "" }
    }
  };

  async function loadSettings(): Promise<void> {
    loading = true;
    message = "";
    error = "";
    try {
      const res = await fetch("/api/settings");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || t("loadError"));
      imageGenerate = { ...imageGenerate, ...(data.settings?.imageGenerate ?? {}) };
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
        body: JSON.stringify({ imageGenerate })
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || t("saveError"));
      imageGenerate = data.settings.imageGenerate;
      message = t("savedMsg");
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      saving = false;
    }
  }

  async function runTest(): Promise<void> {
    testing = true;
    message = "";
    error = "";
    testResult = null;
    try {
      const res = await fetch("/api/settings/image-generate/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: testPrompt, engine: testEngine, size: testSize || undefined, imageGenerate })
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

  function resolveCompleteUrl(engineId: EngineId, baseUrl: string, apiKey = ""): string {
    const rawUrl = baseUrl.trim() || engines.find(e => e.id === engineId)?.defaultUrl || "";
    const cleanUrl = rawUrl.replace(/\/+$/, "");
    if (!cleanUrl) return "";

    try {
      let parseUrl = cleanUrl;
      if (!/^https?:\/\//i.test(parseUrl)) {
        parseUrl = "https://" + parseUrl;
      }
      const urlObj = new URL(parseUrl);
      const pathname = urlObj.pathname.replace(/\/+$/, "");

      if (engineId === "agnes" || engineId === "modelscope") {
        if (pathname === "" || pathname === "/") {
          return `${cleanUrl}/v1/images/generations`;
        } else if (pathname.endsWith("/v1")) {
          return `${cleanUrl}/images/generations`;
        } else {
          return cleanUrl;
        }
      }

      if (engineId === "volcengine") {
        if (pathname === "" || pathname === "/") {
          return `${cleanUrl}/api/v3/images/generations`;
        } else if (pathname.endsWith("/api/v3")) {
          return `${cleanUrl}/images/generations`;
        } else if (pathname.endsWith("/api")) {
          return `${cleanUrl}/v3/images/generations`;
        } else {
          return cleanUrl;
        }
      }

      if (engineId === "google") {
        const keyPart = apiKey ? `?key=${apiKey.replace(/./g, "*")}` : "?key=YOUR_API_KEY";
        if (pathname === "" || pathname === "/") {
          return `${cleanUrl}/v1beta/models/imagen-3.0-generate-001:predict${keyPart}`;
        } else if (pathname.endsWith("/v1beta")) {
          return `${cleanUrl}/models/imagen-3.0-generate-001:predict${keyPart}`;
        } else {
          return cleanUrl.includes("key=") ? cleanUrl : `${cleanUrl}${cleanUrl.includes("?") ? "&" : "?"}key=YOUR_API_KEY`;
        }
      }
    } catch {
      // fallback
    }

    if (engineId === "agnes" || engineId === "modelscope") {
      return `${cleanUrl}/v1/images/generations`;
    } else if (engineId === "volcengine") {
      return `${cleanUrl}/api/v3/images/generations`;
    } else {
      return `${cleanUrl}/v1beta/models/imagen-3.0-generate-001:predict?key=YOUR_API_KEY`;
    }
  }

  onMount(loadSettings);
</script>

<div class="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-8 sm:px-10 sm:py-10">
  <header class="flex flex-col gap-3">
    <Badge variant="secondary" class="w-fit">Built-in Tool</Badge>
    <div class="max-w-3xl space-y-2">
      <h1 class="text-3xl font-semibold tracking-tight text-foreground">{t("title")}</h1>
      <p class="text-sm leading-6 text-muted-foreground">{t("desc")}</p>
    </div>
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
    <form class="space-y-5" onsubmit={(event) => { event.preventDefault(); save(); }}>
      <Card>
        <CardHeader>
          <CardTitle class="text-sm">{t("defaultBehavior")}</CardTitle>
          <CardDescription>{t("defaultBehaviorDesc")}</CardDescription>
        </CardHeader>
        <CardContent class="grid gap-5">
          <div class="flex items-center justify-between gap-4 rounded-lg border bg-muted/30 px-4 py-3">
            <div>
              <Label for="image-enabled">{t("enableTool")}</Label>
              <p class="mt-1 text-xs text-muted-foreground">{t("enableToolDesc")}</p>
            </div>
            <Switch id="image-enabled" bind:checked={imageGenerate.enabled} />
          </div>

          <div class="grid gap-4 sm:grid-cols-2">
            <div class="grid gap-1.5">
              <Label for="default-engine">{t("defaultEngine")}</Label>
              <NativeSelect id="default-engine" bind:value={imageGenerate.defaultEngine}>
                <NativeSelectOption value="auto">{t("autoEngine")}</NativeSelectOption>
                {#each engines as engine}
                  <NativeSelectOption value={engine.id}>{engine.name}</NativeSelectOption>
                {/each}
              </NativeSelect>
              <p class="text-xs leading-5 text-muted-foreground">{t("autoEngineDesc")}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle class="text-sm">{t("enginesTitle")}</CardTitle>
          <CardDescription>{t("enginesDesc")}</CardDescription>
        </CardHeader>
        <CardContent class="space-y-3">
          {#each engines as engine}
            <div class="grid gap-3 rounded-lg border bg-muted/30 p-4">
              <div class="flex items-start justify-between gap-4 border-b border-border/40 pb-3">
                <div>
                  <div class="flex flex-wrap items-center gap-2">
                    <p class="text-sm font-semibold text-foreground">{engine.name}</p>
                    <Badge variant="secondary">{engine.id}</Badge>
                  </div>
                  <p class="mt-1 text-xs leading-5 text-muted-foreground">{engine.hint}</p>
                </div>
              </div>
              
              <div class="grid gap-3 sm:grid-cols-3 pt-2">
                <div class="grid gap-1.5">
                  <Label>{engine.keyLabel}</Label>
                  <div class="flex items-center gap-1.5">
                    <Input
                      type={showApiKey[engine.id] ? "text" : "password"}
                      autocomplete="off"
                      bind:value={imageGenerate.engines[engine.id].apiKey}
                    />
                    <button
                      type="button"
                      class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                      onclick={() => (showApiKey[engine.id] = !showApiKey[engine.id])}
                      aria-label={showApiKey[engine.id] ? "Hide API key" : "Show API key"}
                    >
                      {#if showApiKey[engine.id]}
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/></svg>
                      {:else}
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>
                      {/if}
                    </button>
                  </div>
                </div>

                <div class="grid gap-1.5">
                  <Label>{t("model")}</Label>
                  <Input placeholder={engine.defaultModel} bind:value={imageGenerate.engines[engine.id].model} />
                </div>
                
                <div class="grid gap-1.5">
                  <Label>{t("baseUrl")}</Label>
                  <Input placeholder={engine.defaultUrl} bind:value={imageGenerate.engines[engine.id].baseUrl} />
                  <p class="text-xs leading-5 text-muted-foreground mt-0.5">
                    {t("resolvedUrl")}: <code class="break-all font-semibold text-primary">{resolveCompleteUrl(engine.id, imageGenerate.engines[engine.id].baseUrl ?? "", imageGenerate.engines[engine.id].apiKey)}</code>
                  </p>
                </div>
              </div>
            </div>
          {/each}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle class="text-sm">{t("testTitle")}</CardTitle>
          <CardDescription>{t("testDesc")}</CardDescription>
        </CardHeader>
        <CardContent class="space-y-4">
          <div class="grid gap-2 sm:grid-cols-[minmax(0,1fr)_180px_180px_auto]">
            <Input bind:value={testPrompt} placeholder={t("testPromptPlaceholder")} />
            <NativeSelect bind:value={testEngine}>
              <NativeSelectOption value="auto">{t("autoEngine")}</NativeSelectOption>
              {#each engines as engine}
                <NativeSelectOption value={engine.id}>{engine.name}</NativeSelectOption>
              {/each}
            </NativeSelect>
            <Input bind:value={testSize} placeholder={t("testSizePlaceholder")} />
            <Button type="button" variant="secondary" onclick={runTest} disabled={testing}>{testing ? t("testingButton") : t("testButton")}</Button>
          </div>
          {#if testResult}
            <div class="rounded-lg border bg-muted/30 p-4 text-sm">
              <p class="text-xs font-semibold text-foreground">{t("testResultTitle")}</p>
              <pre class="mt-3 max-h-[32rem] overflow-auto whitespace-pre-wrap break-words rounded-md border bg-background/70 p-3 text-[11px] leading-5 text-muted-foreground">{JSON.stringify(testResult, null, 2)}</pre>
            </div>
          {/if}
        </CardContent>
      </Card>

      <div class="flex justify-end">
        <Button type="submit" disabled={saving}>{saving ? t("savingButton") : t("saveButton")}</Button>
      </div>
    </form>
  {/if}
</div>
