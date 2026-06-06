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
  import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "$lib/components/ui/table";
  import { locale } from "$lib/ui/i18n";

  type EngineId = "agnes" | "volcengine";

  interface EngineSettings {
    enabled: boolean;
    apiKey: string;
    model?: string;
    baseUrl?: string;
  }

  interface VideoGenerateSettings {
    enabled: boolean;
    defaultEngine: EngineId | "auto";
    engines: Record<EngineId, EngineSettings>;
  }

  interface VideoTask {
    id: string;
    engine: string;
    sessionId: string;
    status: "processing" | "completed" | "failed";
    progress: number;
    prompt: string;
    videoPath?: string;
    errorMessage?: string;
    createdAt: string;
    updatedAt: string;
  }

  const COPY = {
    "zh-CN": {
      title: "视频生成",
      desc: "配置内置 Agent 视频生成工具。支持 Agnes Video 和 Volcengine (火山引擎) 双引擎路由。",
      enableTool: "启用内置 videoGenerate 工具",
      enableToolDesc: "禁用后，该工具在调用时会返回配置错误，而不会实际执行。",
      defaultEngine: "默认引擎",
      autoEngineDesc: "在 Auto 模式下，工具会依次检测 Agnes 和 Volcengine，使用第一个配置了有效 API Key 的引擎。",
      enginesTitle: "视频生成引擎",
      enginesDesc: "配置各视频生成服务方的认证密钥、默认模型及 API 端点。",
      apiKey: "API Key",
      baseUrl: "自定义 Base URL",
      model: "模型 ID",
      testTitle: "测试视频生成",
      testDesc: "即时测试配置的可用性。测试将使用表单中未保存的值尝试生成一段测试视频。",
      testPromptPlaceholder: "输入提示词以生成视频",
      testButton: "测试",
      testingButton: "生成中...",
      testResultTitle: "测试响应结果",
      saveButton: "保存设置",
      savingButton: "保存中...",
      savedMsg: "视频生成设置已保存。",
      loadError: "加载设置失败",
      saveError: "保存设置失败",
      testError: "视频生成测试失败",
      engineEnabled: "启用引擎",
      tasksTitle: "最近生成任务",
      tasksDesc: "查看和管理异步视频生成任务的状态与进度。",
      createdAt: "创建时间",
      taskId: "任务 ID",
      engine: "引擎",
      prompt: "提示词",
      status: "状态",
      progress: "进度",
      action: "操作",
      delete: "删除",
      statusProcessing: "生成中",
      statusCompleted: "已完成",
      statusFailed: "失败",
      noTasks: "暂无最近生成任务。",
      taskDetailsTitle: "任务详情",
      taskIdLabel: "任务 ID",
      videoPathLabel: "保存路径",
      downloadVideo: "下载视频",
      close: "关闭",
      viewResult: "查看结果"
    },
    "en-US": {
      title: "Video Generation",
      desc: "Configure the built-in Agent video generation tool. Multi-engine routing is supported across Agnes Video and Volcengine.",
      enableTool: "Enable built-in videoGenerate tool",
      enableToolDesc: "When disabled, the tool returns a settings error instead of executing.",
      defaultEngine: "Default engine",
      autoEngineDesc: "In auto mode, the tool iterates through Agnes and Volcengine in order, using the first one with a valid API key configured.",
      enginesTitle: "Video Generation Engines",
      enginesDesc: "Configure credentials, default models, and API endpoints for your selected video providers.",
      apiKey: "API Key",
      baseUrl: "Custom base URL",
      model: "Model ID",
      testTitle: "Test Video Generation",
      testDesc: "Test the configured settings in real-time. Unsaved values from the form will be used to attempt generating a test video.",
      testPromptPlaceholder: "Enter a prompt to generate video",
      testButton: "Test",
      testingButton: "Generating...",
      testResultTitle: "VideoGenerateToolResponse",
      saveButton: "Save settings",
      savingButton: "Saving...",
      savedMsg: "Video generation settings saved.",
      loadError: "Failed to load settings",
      saveError: "Failed to save video settings",
      testError: "Video generation test failed",
      engineEnabled: "Engine enabled",
      tasksTitle: "Recent Generation Tasks",
      tasksDesc: "View and manage the status and progress of asynchronous video generation tasks.",
      createdAt: "Created At",
      taskId: "Task ID",
      engine: "Engine",
      prompt: "Prompt",
      status: "Status",
      progress: "Progress",
      action: "Action",
      delete: "Delete",
      statusProcessing: "Processing",
      statusCompleted: "Completed",
      statusFailed: "Failed",
      noTasks: "No recent tasks found.",
      taskDetailsTitle: "Task Details",
      taskIdLabel: "Task ID",
      videoPathLabel: "Video Path",
      downloadVideo: "Download Video",
      close: "Close",
      viewResult: "View Result"
    }
  };

  function t(key: keyof typeof COPY["en-US"]): string {
    return COPY[$locale]?.[key] ?? COPY["en-US"][key];
  }

  const engines: Array<{ id: EngineId; name: string; hint: string; keyLabel: string; defaultUrl: string; defaultModel: string }> = [
    { id: "agnes", name: "Agnes Video", hint: "High-performance OpenAI-style cinematic video generation (agnes-video-v2.0).", keyLabel: "AGNES_API_KEY", defaultUrl: "https://apihub.agnes-ai.com", defaultModel: "agnes-video-v2.0" },
    { id: "volcengine", name: "Volcengine (Doubao)", hint: "Outstanding semantic Chinese video generation (doubao-seedance-2.0).", keyLabel: "VOLCENGINE_API_KEY", defaultUrl: "https://ark.cn-beijing.volces.com", defaultModel: "doubao-seedance-2.0" }
  ];

  let loading = true;
  let saving = false;
  let testing = false;
  let message = "";
  let error = "";
  let testPrompt = "A cinematic shot of a sunset over the sea";
  let testEngine: EngineId | "auto" = "auto";
  let testResult: any = null;

  let showApiKey: Record<string, boolean> = {};
  let tasks: VideoTask[] = [];
  let pollInterval: any = null;
  let activeTaskDetails: VideoTask | null = null;

  let videoGenerate: VideoGenerateSettings = {
    enabled: true,
    defaultEngine: "auto",
    engines: {
      agnes: { enabled: false, apiKey: "", model: "" },
      volcengine: { enabled: false, apiKey: "", model: "" }
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
      videoGenerate = { ...videoGenerate, ...(data.settings?.videoGenerate ?? {}) };
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  async function loadTasks(): Promise<void> {
    try {
      const res = await fetch("/api/settings/video-generate/tasks");
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
      const res = await fetch(`/api/settings/video-generate/tasks?taskId=${taskId}`, { method: "DELETE" });
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
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoGenerate })
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || t("saveError"));
      videoGenerate = data.settings.videoGenerate;
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
      const res = await fetch("/api/settings/video-generate/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: testPrompt, engine: testEngine, videoGenerate })
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

  function resolveCompleteUrl(engineId: EngineId, baseUrl: string): string {
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

      if (engineId === "agnes") {
        if (pathname === "" || pathname === "/") {
          return `${cleanUrl}/v1/videos`;
        } else if (pathname.endsWith("/v1")) {
          return `${cleanUrl}/videos`;
        } else {
          return cleanUrl;
        }
      }

      if (engineId === "volcengine") {
        if (pathname === "" || pathname === "/") {
          return `${cleanUrl}/api/plan/v3/contents/generations/tasks`;
        } else if (pathname.endsWith("/api/plan/v3")) {
          return `${cleanUrl}/contents/generations/tasks`;
        } else {
          return cleanUrl;
        }
      }
    } catch {
      // fallback
    }

    if (engineId === "agnes") {
      return `${cleanUrl}/v1/videos`;
    } else {
      return `${cleanUrl}/api/plan/v3/contents/generations/tasks`;
    }
  }

  onMount(() => {
    loadSettings();
    loadTasks();
    pollInterval = setInterval(loadTasks, 30000);
    return () => {
      if (pollInterval) clearInterval(pollInterval);
    };
  });
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
          <CardTitle class="text-sm">Default Behavior</CardTitle>
          <CardDescription>Select the default behavior for video generation commands.</CardDescription>
        </CardHeader>
        <CardContent class="grid gap-5">
          <div class="flex items-center justify-between gap-4 rounded-lg border bg-muted/30 px-4 py-3">
            <div>
              <Label for="video-enabled">{t("enableTool")}</Label>
              <p class="mt-1 text-xs text-muted-foreground">{t("enableToolDesc")}</p>
            </div>
            <Switch id="video-enabled" bind:checked={videoGenerate.enabled} />
          </div>

          <div class="grid gap-4 sm:grid-cols-2">
            <div class="grid gap-1.5">
              <Label for="default-engine">{t("defaultEngine")}</Label>
              <NativeSelect id="default-engine" bind:value={videoGenerate.defaultEngine}>
                <NativeSelectOption value="auto">Auto priority order</NativeSelectOption>
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
              <div class="flex items-start justify-between gap-4">
                <div>
                  <div class="flex flex-wrap items-center gap-2">
                    <p class="text-sm font-semibold text-foreground">{engine.name}</p>
                    <Badge variant="secondary">{engine.id}</Badge>
                  </div>
                  <p class="mt-1 text-xs leading-5 text-muted-foreground">{engine.hint}</p>
                </div>
                <div class="flex flex-col items-end gap-1">
                  <Label class="text-xs text-muted-foreground">{t("engineEnabled")}</Label>
                  <Switch bind:checked={videoGenerate.engines[engine.id].enabled} aria-label={`Enable ${engine.name}`} />
                </div>
              </div>
              
              <div class="grid gap-3 sm:grid-cols-3">
                <div class="grid gap-1.5">
                  <Label>{engine.keyLabel}</Label>
                  <div class="flex items-center gap-1.5">
                    <Input
                      type={showApiKey[engine.id] ? "text" : "password"}
                      autocomplete="off"
                      bind:value={videoGenerate.engines[engine.id].apiKey}
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
                  <Input placeholder={engine.defaultModel} bind:value={videoGenerate.engines[engine.id].model} />
                </div>
                
                <div class="grid gap-1.5">
                  <Label>{t("baseUrl")}</Label>
                  <Input placeholder={engine.defaultUrl} bind:value={videoGenerate.engines[engine.id].baseUrl} />
                  <p class="text-xs leading-5 text-muted-foreground">
                    Resolved URL: <code class="break-all font-semibold text-primary">{resolveCompleteUrl(engine.id, videoGenerate.engines[engine.id].baseUrl ?? "")}</code>
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
          <div class="grid gap-2 sm:grid-cols-[minmax(0,1fr)_220px_auto]">
            <Input bind:value={testPrompt} placeholder={t("testPromptPlaceholder")} />
            <NativeSelect bind:value={testEngine}>
              <NativeSelectOption value="auto">Auto engine</NativeSelectOption>
              {#each engines as engine}
                <NativeSelectOption value={engine.id}>{engine.name}</NativeSelectOption>
              {/each}
            </NativeSelect>
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
                  <TableHead class="w-[90px]">{t("progress")}</TableHead>
                  <TableHead class="w-[80px] text-right">{t("action")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {#each tasks as task}
                  <TableRow>
                    <TableCell class="font-mono text-xs text-muted-foreground">
                      {new Date(task.createdAt).toLocaleString(undefined, { hour12: false })}
                    </TableCell>
                    <TableCell class="font-mono text-xs text-muted-foreground select-all" title={task.id}>
                      {task.id}
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
                    <TableCell class="font-medium">
                      {task.progress}%
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

  {#if activeTaskDetails}
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onclick={() => activeTaskDetails = null}>
      <div class="relative w-full max-w-xl rounded-xl border border-border bg-background p-6 shadow-2xl" onclick={(e) => e.stopPropagation()}>
        <header class="mb-4 flex items-center justify-between">
          <h3 class="text-lg font-semibold text-foreground">{t("taskDetailsTitle")}</h3>
          <button class="rounded-lg p-1 text-muted-foreground hover:bg-muted" onclick={() => activeTaskDetails = null}>
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </header>

        <div class="space-y-4">
          {#if activeTaskDetails.status === "completed" && activeTaskDetails.videoPath}
            <div class="overflow-hidden rounded-lg border bg-black aspect-video flex items-center justify-center">
              <video controls src="/api/settings/video-generate/video?taskId={activeTaskDetails.id}" class="w-full h-full max-h-[300px]">
                Your browser does not support the video tag.
              </video>
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
            {#if activeTaskDetails.videoPath}
              <div class="grid grid-cols-[100px_1fr] gap-2">
                <span class="text-muted-foreground">{t("videoPathLabel")}:</span>
                <span class="font-mono text-xs select-all break-all text-muted-foreground">{activeTaskDetails.videoPath}</span>
              </div>
            {/if}
            {#if activeTaskDetails.errorMessage}
              <div class="grid grid-cols-[100px_1fr] gap-2">
                <span class="text-muted-foreground">{t("error")}:</span>
                <span class="text-destructive font-mono text-xs leading-5">{activeTaskDetails.errorMessage}</span>
              </div>
            {/if}
          </div>
        </div>

        <footer class="mt-6 flex justify-end gap-3">
          {#if activeTaskDetails.status === "completed"}
            <Button href="/api/settings/video-generate/video?taskId={activeTaskDetails.id}" target="_blank" download="video.mp4">
              {t("downloadVideo")}
            </Button>
          {/if}
          <Button variant="outline" onclick={() => activeTaskDetails = null}>{t("close")}</Button>
        </footer>
      </div>
    </div>
  {/if}
</div>
