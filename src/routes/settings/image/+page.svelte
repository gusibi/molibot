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
  import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "$lib/components/ui/table";
  import { locale } from "$lib/ui/i18n";

  type EngineId = "agnes" | "openai" | "openai-chat" | "modelscope" | "google" | "volcengine";

  interface EngineSettings {
    enabled: boolean;
    apiKey: string;
    baseUrl?: string;
    model?: string;
  }

  interface ImageGenerateSettings {
    enabled: boolean;
    defaultEngine: EngineId | "auto";
    engines: Record<EngineId, EngineSettings>;
  }

  interface ImageTask {
    id: string;
    engine: string;
    sessionId: string;
    status: "processing" | "completed" | "failed";
    prompt: string;
    imagePath?: string;
    imageUrl?: string;
    requestParams?: any;
    errorMessage?: string;
    createdAt: string;
    updatedAt: string;
  }

  const COPY = {
    "zh-CN": {
      title: "图像生成",
      desc: "配置内置 Agent 图像生成工具。支持 Agnes Image、OpenAI、OpenAI Chat Completions 兼容协议、Google Imagen、火山引擎及 ModelScope 的多引擎路由。",
      enableTool: "启用内置 imageGenerate 工具",
      enableToolDesc: "禁用后，该工具在调用时会返回配置错误，而不会实际执行。",
      defaultEngine: "默认引擎",
      autoEngine: "自动优先级顺序",
      autoEngineDesc: "在自动模式下，工具会依次检测 Agnes、OpenAI Images、OpenAI Chat、Google、火山引擎和 ModelScope，使用第一个配置了有效 API Key 的引擎。",
      enginesTitle: "图像生成引擎",
      enginesDesc: "配置各图像生成服务方的认证密钥、默认模型及 API 端点。",
      apiKey: "API Key",
      baseUrl: "自定义 Base URL",
      model: "模型 ID",
      engineEnabled: "启用引擎",
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
      testSizePlaceholder: "尺寸 (如 1024x1024)",
      tasksTitle: "最近生成记录",
      tasksDesc: "查看和管理图像生成记录。",
      createdAt: "生成时间",
      taskId: "任务 ID",
      engine: "引擎",
      prompt: "提示词",
      status: "状态",
      action: "操作",
      delete: "删除",
      statusProcessing: "生成中",
      statusCompleted: "已完成",
      statusFailed: "失败",
      noTasks: "暂无最近生成记录。",
      taskDetailsTitle: "记录详情",
      taskIdLabel: "任务 ID",
      imagePathLabel: "保存路径",
      imageUrlLabel: "图片链接",
      errorLabel: "错误信息",
      requestParamsLabel: "请求参数",
      downloadImage: "下载图片",
      close: "关闭",
      viewResult: "查看结果",
      viewParams: "查看参数",
      loadingText: "正在加载设置...",
      savingText: "正在保存修改..."
    },
    "en-US": {
      title: "Image Generation",
      desc: "Configure the built-in Agent image generation tool. Multi-engine routing is supported across Agnes Image, OpenAI, OpenAI Chat Completions-compatible APIs, Google Imagen, Volcengine, and ModelScope.",
      enableTool: "Enable built-in imageGenerate tool",
      enableToolDesc: "When disabled, the tool returns a settings error instead of executing.",
      defaultEngine: "Default engine",
      autoEngine: "Auto priority order",
      autoEngineDesc: "In auto mode, the tool iterates through Agnes, OpenAI Images, OpenAI Chat, Google, Volcengine, and ModelScope in order, using the first one with a valid API key configured.",
      enginesTitle: "Image Generation Engines",
      enginesDesc: "Configure credentials, default models, and API endpoints for your selected painting providers.",
      apiKey: "API Key",
      baseUrl: "Custom base URL",
      model: "Model ID",
      engineEnabled: "Engine enabled",
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
      testSizePlaceholder: "Size (e.g. 1024x1024)",
      tasksTitle: "Recent Generations",
      tasksDesc: "View and manage image generation history.",
      createdAt: "Generated At",
      taskId: "Task ID",
      engine: "Engine",
      prompt: "Prompt",
      status: "Status",
      action: "Action",
      delete: "Delete",
      statusProcessing: "Processing",
      statusCompleted: "Completed",
      statusFailed: "Failed",
      noTasks: "No recent tasks found.",
      taskDetailsTitle: "Generation Details",
      taskIdLabel: "Task ID",
      imagePathLabel: "Image Path",
      imageUrlLabel: "Image URL",
      errorLabel: "Error",
      requestParamsLabel: "Request Parameters",
      downloadImage: "Download Image",
      close: "Close",
      viewResult: "View Result",
      viewParams: "View Params",
      loadingText: "Loading settings...",
      savingText: "Saving changes..."
    }
  };

  function t(key: keyof typeof COPY["en-US"]): string {
    return COPY[$locale]?.[key] ?? COPY["en-US"][key];
  }

  const engines: Array<{ id: EngineId; name: string; hint: string; keyLabel: string; defaultUrl: string; defaultModel: string }> = [
    { id: "agnes", name: "Agnes Image", hint: "High-performance OpenAI-compatible editing and generation (agnes-image-2.0-flash). ELO 1,184.", keyLabel: "AGNES_API_KEY", defaultUrl: "https://apihub.agnes-ai.com", defaultModel: "agnes-image-2.0-flash" },
    { id: "openai", name: "OpenAI Images", hint: "Official OpenAI image generation via gpt-image-2.", keyLabel: "OPENAI_API_KEY", defaultUrl: "https://api.openai.com", defaultModel: "gpt-image-2" },
    { id: "openai-chat", name: "OpenAI Chat Format", hint: "OpenAI-compatible /v1/chat/completions protocol for providers that return image URLs or Base64 from chat messages.", keyLabel: "OPENAI_API_KEY", defaultUrl: "https://api.openai.com", defaultModel: "gpt-4o" },
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
  let tasks: ImageTask[] = [];
  let activeTaskDetails: ImageTask | null = null;

  let imageGenerate: ImageGenerateSettings = {
    enabled: true,
    defaultEngine: "auto",
    engines: {
      agnes: { enabled: false, apiKey: "", model: "" },
      openai: { enabled: false, apiKey: "", model: "" },
      "openai-chat": { enabled: false, apiKey: "", model: "" },
      modelscope: { enabled: false, apiKey: "", model: "" },
      google: { enabled: false, apiKey: "", model: "" },
      volcengine: { enabled: false, apiKey: "", model: "" }
    }
  };

  function mergeImageGenerateSettings(value: any): ImageGenerateSettings {
    const incoming = value ?? {};
    const incomingEngines = incoming.engines ?? {};
    const mergedEngines = Object.fromEntries(
      engines.map((engine) => {
        const current = imageGenerate.engines[engine.id];
        const incomingEngine = incomingEngines[engine.id] ?? {};
        const apiKey = String(incomingEngine.apiKey ?? current.apiKey ?? "").trim();
        return [engine.id, {
          ...current,
          ...incomingEngine,
          enabled: incomingEngine.enabled === undefined ? Boolean(apiKey || current.apiKey) : Boolean(incomingEngine.enabled),
          apiKey
        }];
      })
    ) as Record<EngineId, EngineSettings>;

    return {
      ...imageGenerate,
      ...incoming,
      engines: mergedEngines
    };
  }

  async function loadSettings(): Promise<void> {
    loading = true;
    message = "";
    error = "";
    try {
      const res = await fetch("/api/settings/dynamic/image-generate");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || t("loadError"));
      imageGenerate = mergeImageGenerateSettings(data.value);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  async function loadTasks(): Promise<void> {
    try {
      const res = await fetch("/api/settings/image-generate/tasks");
      const data = await res.json();
      if (data.ok) {
        tasks = data.tasks || [];
      }
    } catch (e) {
      console.error("Failed to load tasks", e);
    }
  }

  async function deleteTask(taskId: string): Promise<void> {
    try {
      const res = await fetch(`/api/settings/image-generate/tasks?taskId=${taskId}`, { method: "DELETE" });
      const data = await res.json();
      if (data.ok) {
        tasks = tasks.filter(t => t.id !== taskId);
      }
    } catch (e) {
      console.error("Failed to delete task", e);
    }
  }

  async function save(): Promise<void> {
    saving = true;
    message = "";
    error = "";
    try {
      const res = await fetch("/api/settings/dynamic/image-generate", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: imageGenerate })
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || t("saveError"));
      imageGenerate = mergeImageGenerateSettings(data.value);
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
      await loadTasks();
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

      if (engineId === "agnes" || engineId === "openai" || engineId === "modelscope") {
        if (pathname === "" || pathname === "/") {
          return `${cleanUrl}/v1/images/generations`;
        } else if (pathname.endsWith("/v1")) {
          return `${cleanUrl}/images/generations`;
        } else {
          return cleanUrl;
        }
      }

      if (engineId === "openai-chat") {
        if (pathname === "" || pathname === "/") {
          return `${cleanUrl}/v1/chat/completions`;
        } else if (pathname.endsWith("/v1")) {
          return `${cleanUrl}/chat/completions`;
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

    if (engineId === "agnes" || engineId === "openai" || engineId === "modelscope") {
      return `${cleanUrl}/v1/images/generations`;
    } else if (engineId === "openai-chat") {
      return `${cleanUrl}/v1/chat/completions`;
    } else if (engineId === "volcengine") {
      return `${cleanUrl}/api/v3/images/generations`;
    } else {
      return `${cleanUrl}/v1beta/models/imagen-3.0-generate-001:predict?key=YOUR_API_KEY`;
    }
  }

  onMount(async () => {
    await loadSettings();
    await loadTasks();
  });
</script>

<div class="image-page">
  <!-- Hero Header -->
  <header class="image-hero">
    <span class="image-badge">Built-in Tool</span>
    <h1 class="image-hero-title">{t("title")}</h1>
    <p class="image-hero-desc">{t("desc")}</p>
  </header>

  {#if loading}
    <p class="py-8 text-sm text-muted-foreground">{t("loadingText")}</p>
  {:else}
    <form id="image-form" class="space-y-5" onsubmit={(event) => { event.preventDefault(); save(); }}>
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
            <IosSwitch id="image-enabled" bind:checked={imageGenerate.enabled} />
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
                <div class="flex flex-col items-end gap-1">
                  <Label class="text-xs text-muted-foreground">{t("engineEnabled")}</Label>
                  <IosSwitch bind:checked={imageGenerate.engines[engine.id].enabled} aria-label={`Enable ${engine.name}`} />
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
                      class="settings-icon-btn"
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

    </form>

    <Card class="mt-6">
      <CardHeader>
        <CardTitle class="text-sm">{t("tasksTitle")}</CardTitle>
        <CardDescription>{t("tasksDesc")}</CardDescription>
      </CardHeader>
      <CardContent class="grid gap-5">
        {#if tasks.length === 0}
          <div class="rounded-xl border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
            {t("noTasks")}
          </div>
        {:else}
          <div class="overflow-x-auto rounded-xl border bg-background">
            <Table class="w-full">
              <TableHeader>
                <TableRow>
                  <TableHead class="w-[180px]">{t("createdAt")}</TableHead>
                  <TableHead class="w-[150px]">{t("taskId")}</TableHead>
                  <TableHead class="w-[110px]">{t("engine")}</TableHead>
                  <TableHead>{t("prompt")}</TableHead>
                  <TableHead class="w-[120px]">{t("status")}</TableHead>
                  <TableHead class="w-[220px] text-right">{t("action")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {#each tasks as task}
                  <TableRow>
                    <TableCell class="font-mono text-xs text-muted-foreground">
                      {new Date(task.createdAt).toLocaleString($locale === "zh-CN" ? "zh-CN" : "en-US", { hour12: false })}
                    </TableCell>
                    <TableCell class="font-mono text-xs text-muted-foreground select-all" title={task.id}>
                      {task.id.slice(0, 8)}...
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" class="text-xs uppercase tracking-wider">{task.engine}</Badge>
                    </TableCell>
                    <TableCell class="max-w-[280px] truncate" title={task.prompt}>
                      {task.prompt}
                    </TableCell>
                    <TableCell>
                      {#if task.status === 'processing'}
                        <Badge variant="outline" class="border-blue-500/30 bg-blue-500/10 text-blue-500">{t("statusProcessing")}</Badge>
                      {:else if task.status === 'completed'}
                        <Badge variant="default" class="bg-emerald-600 hover:bg-emerald-600/95">{t("statusCompleted")}</Badge>
                      {:else}
                        <Badge variant="destructive">{t("statusFailed")}</Badge>
                      {/if}
                      {#if task.errorMessage}
                        <p class="mt-1 max-w-[200px] truncate text-xs text-destructive" title={task.errorMessage}>
                           {task.errorMessage}
                        </p>
                      {/if}
                    </TableCell>
                    <TableCell class="text-right">
                      <div class="flex justify-end gap-2">
                        {#if task.status === 'completed' || task.status === 'failed'}
                          <Button
                            variant="ghost"
                            size="sm"
                            onclick={() => activeTaskDetails = task}
                          >
                            {t("viewResult")}
                          </Button>
                        {/if}
                        {#if task.requestParams}
                          <Button
                            variant="ghost"
                            size="sm"
                            onclick={() => activeTaskDetails = task}
                          >
                            {t("viewParams")}
                          </Button>
                        {/if}
                        <Button
                          variant="ghost"
                          size="sm"
                          class="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onclick={() => deleteTask(task.id)}
                        >
                          {t("delete")}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                {/each}
              </TableBody>
            </Table>
          </div>
        {/if}
      </CardContent>
    </Card>
  {/if}
</div>

{#if activeTaskDetails}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" role="dialog" aria-label={t("taskDetailsTitle")} tabindex="-1" onclick={(e) => { if (e.target === e.currentTarget) activeTaskDetails = null; }} onkeydown={(e) => { if (e.key === "Escape") activeTaskDetails = null; }}>
    <div class="relative w-full max-w-xl rounded-xl border border-border bg-background p-6 shadow-2xl">
      <header class="mb-4 flex items-center justify-between">
        <h3 class="text-lg font-semibold text-foreground">{t("taskDetailsTitle")}</h3>
        <button type="button" aria-label={t("close")} class="rounded-lg p-1 text-muted-foreground hover:bg-muted" onclick={() => activeTaskDetails = null}>
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
      </header>

      <div class="space-y-4">
        {#if activeTaskDetails.status === "completed" && (activeTaskDetails.imagePath || activeTaskDetails.imageUrl)}
          <div class="overflow-hidden rounded-lg border bg-black/5 flex items-center justify-center p-2 max-h-[300px]">
            <img src="/api/settings/image-generate/image?taskId={activeTaskDetails.id}" alt={activeTaskDetails.prompt} class="max-w-full max-h-[280px] object-contain rounded" />
          </div>
        {/if}

        <div class="grid gap-3 text-sm">
          <div class="grid grid-cols-[100px_1fr] gap-2">
            <span class="text-muted-foreground">{t("taskIdLabel")}:</span>
            <span class="font-mono text-xs select-all text-foreground">{activeTaskDetails.id}</span>
          </div>
          <div class="grid grid-cols-[100px_1fr] gap-2">
            <span class="text-muted-foreground">{t("engine")}:</span>
            <span><Badge variant="outline" class="uppercase text-xs tracking-wider">{activeTaskDetails.engine}</Badge></span>
          </div>
          <div class="grid grid-cols-[100px_1fr] gap-2">
            <span class="text-muted-foreground">{t("status")}:</span>
            <span>
              {#if activeTaskDetails.status === 'processing'}
                <Badge variant="outline" class="border-blue-500/30 bg-blue-500/10 text-blue-500">{t("statusProcessing")}</Badge>
              {:else if activeTaskDetails.status === 'completed'}
                <Badge variant="default" class="bg-emerald-600 hover:bg-emerald-600/95">{t("statusCompleted")}</Badge>
              {:else}
                <Badge variant="destructive">{t("statusFailed")}</Badge>
              {/if}
            </span>
          </div>
          <div class="grid grid-cols-[100px_1fr] gap-2">
            <span class="text-muted-foreground">{t("prompt")}:</span>
            <span class="text-foreground leading-5">{activeTaskDetails.prompt}</span>
          </div>
          {#if activeTaskDetails.requestParams}
            <div class="grid grid-cols-[100px_1fr] gap-2">
              <span class="text-muted-foreground">{t("requestParamsLabel")}:</span>
              <pre class="font-mono text-xs bg-muted p-2 rounded max-h-[150px] overflow-auto select-all text-foreground leading-normal break-all whitespace-pre-wrap">{JSON.stringify(activeTaskDetails.requestParams, null, 2)}</pre>
            </div>
          {/if}
          {#if activeTaskDetails.imagePath}
            <div class="grid grid-cols-[100px_1fr] gap-2">
              <span class="text-muted-foreground">{t("imagePathLabel")}:</span>
              <span class="font-mono text-xs select-all break-all text-muted-foreground">{activeTaskDetails.imagePath}</span>
            </div>
          {:else if activeTaskDetails.imageUrl}
            <div class="grid grid-cols-[100px_1fr] gap-2">
              <span class="text-muted-foreground">{t("imageUrlLabel")}:</span>
              <span class="font-mono text-xs select-all break-all text-muted-foreground">{activeTaskDetails.imageUrl}</span>
            </div>
          {/if}
          {#if activeTaskDetails.errorMessage}
            <div class="grid grid-cols-[100px_1fr] gap-2">
              <span class="text-muted-foreground">{t("errorLabel")}:</span>
              <span class="text-destructive font-mono text-xs leading-5">{activeTaskDetails.errorMessage}</span>
            </div>
          {/if}
        </div>
      </div>

      <footer class="mt-6 flex justify-end gap-3">
        {#if activeTaskDetails.status === "completed"}
          <Button href="/api/settings/image-generate/image?taskId={activeTaskDetails.id}" target="_blank" download="image.png">
            {t("downloadImage")}
          </Button>
        {/if}
        <Button variant="outline" onclick={() => activeTaskDetails = null}>{t("close")}</Button>
      </footer>
    </div>
  </div>
{/if}

<footer class="settings-footbar">
  <div class="settings-footbar-status">
    {#if saving}
      <span class="flex items-center gap-2 text-xs font-medium text-muted-foreground animate-pulse">
        {t("savingText")}
      </span>
    {:else if message}
      <span class="flex items-center gap-2 text-xs font-medium text-emerald-600 dark:text-emerald-500">
        {message}
      </span>
    {:else if error}
      <span class="flex items-center gap-2 text-xs font-medium text-destructive animate-fade-in">
        {error}
      </span>
    {/if}
  </div>
  <div class="flex items-center gap-3">
    <Button type="submit" form="image-form" variant="default" size="sm" disabled={loading || saving} class="h-9 px-6 text-xs font-bold">
      {saving ? t("savingButton") : t("saveButton")}
    </Button>
  </div>
</footer>
