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

  interface EngineSettings { enabled: boolean; name?: string; modelKey: string }
  interface RecognitionSettings {
    enabled: boolean;
    defaultEngine: string;
    engineOrder: string[];
    engines: Record<string, EngineSettings>;
  }
  interface ModelOption {
    key: string;
    label: string;
    providerId: string;
    modelId: string;
    verification: "untested" | "passed" | "failed";
  }

  const COPY = {
    "zh-CN": {
      title: "图片识别策略", desc: "主模型支持视觉时直接读取原图；主模型不支持时，Agent 才会按需通过 read 工具调用这里的识别引擎。",
      enabled: "启用按需图片识别", enabledDesc: "关闭后，纯文本主模型不能通过 read 获取图片内容；原生视觉主模型不受影响。",
      defaultEngine: "默认引擎", automatic: "自动（按下方顺序故障转移）", engines: "API 识别引擎", enginesDesc: "一个引擎绑定一个已配置的视觉模型。自动模式会按顺序尝试所有已启用引擎。",
      add: "添加 API 引擎", noModels: "暂无可用视觉模型。请先在 AI 服务商页面添加并启用带 vision 能力的模型。",
      name: "显示名称", model: "视觉模型", enabledEngine: "启用", moveUp: "上移", moveDown: "下移", remove: "删除",
      cliTitle: "本地 CLI 适配器", cliDesc: "第一期不启用。本模块已预留统一引擎执行接口，第二期可接入本地 CLI，而无需修改 read 工具或 Channel。",
      testTitle: "测试识别", testDesc: "使用当前未保存的表单配置测试一张图片。不会写入对话记录。", image: "测试图片", prompt: "识别要求（可选）",
      promptPlaceholder: "例如：只提取截图中的错误信息", testEngine: "测试引擎", test: "开始测试", testing: "识别中…", result: "识别结果",
      save: "保存设置", saving: "保存中…", saved: "图片识别设置已保存。", loadError: "加载图片识别设置失败", saveError: "保存失败", testError: "识别测试失败"
    },
    "en-US": {
      title: "Image recognition policy", desc: "Vision-capable primary models receive the original image. Text-only models invoke these engines on demand through the read tool.",
      enabled: "Enable on-demand recognition", enabledDesc: "When disabled, text-only primary models cannot inspect images through read. Native vision models are unaffected.",
      defaultEngine: "Default engine", automatic: "Auto (fail over in the order below)", engines: "API recognition engines", enginesDesc: "Each engine binds to one configured vision model. Auto mode tries every enabled engine in order.",
      add: "Add API engine", noModels: "No vision models are available. Add and enable a model with the vision capability under AI Providers first.",
      name: "Display name", model: "Vision model", enabledEngine: "Enabled", moveUp: "Move up", moveDown: "Move down", remove: "Remove",
      cliTitle: "Local CLI adapter", cliDesc: "Not enabled in phase one. The engine execution seam is ready for a phase-two CLI adapter without changing read or any Channel.",
      testTitle: "Test recognition", testDesc: "Test an image with the unsaved form values. The result is not added to a conversation.", image: "Test image", prompt: "Recognition prompt (optional)",
      promptPlaceholder: "For example: extract only the error message", testEngine: "Test engine", test: "Run test", testing: "Recognizing…", result: "Recognition result",
      save: "Save settings", saving: "Saving…", saved: "Image recognition settings saved.", loadError: "Failed to load image recognition settings", saveError: "Save failed", testError: "Recognition test failed"
    }
  } as const;

  let loading = true;
  let saving = false;
  let testing = false;
  let message = "";
  let error = "";
  let models: ModelOption[] = [];
  let imageRecognition: RecognitionSettings = { enabled: true, defaultEngine: "auto", engineOrder: [], engines: {} };
  let testFile: File | null = null;
  let testPrompt = "";
  let testEngine = "auto";
  let testResult = "";

  $: language = $locale === "zh-CN" ? "zh-CN" : "en-US";
  $: copy = COPY[language];
  $: orderedEngines = imageRecognition.engineOrder
    .map((id) => ({ id, settings: imageRecognition.engines[id] }))
    .filter((item): item is { id: string; settings: EngineSettings } => Boolean(item.settings));

  function nextEngineId(): string {
    let index = 1;
    while (imageRecognition.engines[`vision-${index}`]) index += 1;
    return `vision-${index}`;
  }

  function addEngine() {
    if (models.length === 0) return;
    const id = nextEngineId();
    imageRecognition = {
      ...imageRecognition,
      engineOrder: [...imageRecognition.engineOrder, id],
      engines: { ...imageRecognition.engines, [id]: { enabled: true, name: `Vision ${imageRecognition.engineOrder.length + 1}`, modelKey: models[0].key } }
    };
  }

  function removeEngine(id: string) {
    const engines = { ...imageRecognition.engines };
    delete engines[id];
    imageRecognition = {
      ...imageRecognition,
      defaultEngine: imageRecognition.defaultEngine === id ? "auto" : imageRecognition.defaultEngine,
      engineOrder: imageRecognition.engineOrder.filter((item) => item !== id),
      engines
    };
  }

  function moveEngine(id: string, offset: -1 | 1) {
    const order = [...imageRecognition.engineOrder];
    const from = order.indexOf(id);
    const to = from + offset;
    if (from < 0 || to < 0 || to >= order.length) return;
    [order[from], order[to]] = [order[to], order[from]];
    imageRecognition = { ...imageRecognition, engineOrder: order };
  }

  async function load() {
    loading = true;
    try {
      const response = await fetch("/api/settings/image-recognition", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || copy.loadError);
      imageRecognition = payload.value;
      models = payload.models;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : copy.loadError;
    } finally {
      loading = false;
    }
  }

  async function save() {
    saving = true; error = ""; message = "";
    try {
      const response = await fetch("/api/settings/image-recognition", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value: imageRecognition })
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || copy.saveError);
      imageRecognition = payload.value;
      message = copy.saved;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : copy.saveError;
    } finally { saving = false; }
  }

  async function testRecognition() {
    if (!testFile) return;
    testing = true; error = ""; testResult = "";
    try {
      const form = new FormData();
      form.set("image", testFile);
      form.set("value", JSON.stringify(imageRecognition));
      form.set("engineId", testEngine);
      form.set("prompt", testPrompt);
      const response = await fetch("/api/settings/image-recognition/test", { method: "POST", body: form });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || copy.testError);
      testResult = payload.result.text;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : copy.testError;
    } finally { testing = false; }
  }

  onMount(load);
</script>

{#if loading}
  <p class="py-8 text-sm text-muted-foreground">{copy.loadError}…</p>
{:else}
  <form id="image-recognition-form" class="space-y-5" onsubmit={(event) => { event.preventDefault(); save(); }}>
    <Card>
      <CardHeader><CardTitle class="text-sm">{copy.title}</CardTitle><CardDescription>{copy.desc}</CardDescription></CardHeader>
      <CardContent class="grid gap-5">
        <div class="flex items-center justify-between gap-4 rounded-lg border bg-muted/30 px-4 py-3">
          <div><Label for="recognition-enabled">{copy.enabled}</Label><p class="mt-1 text-xs text-muted-foreground">{copy.enabledDesc}</p></div>
          <IosSwitch id="recognition-enabled" bind:checked={imageRecognition.enabled} />
        </div>
        <div class="grid gap-1.5 sm:max-w-md">
          <Label for="recognition-default">{copy.defaultEngine}</Label>
          <NativeSelect id="recognition-default" bind:value={imageRecognition.defaultEngine}>
            <NativeSelectOption value="auto">{copy.automatic}</NativeSelectOption>
            {#each orderedEngines as engine}<NativeSelectOption value={engine.id}>{engine.settings.name || engine.id}</NativeSelectOption>{/each}
          </NativeSelect>
        </div>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div><CardTitle class="text-sm">{copy.engines}</CardTitle><CardDescription>{copy.enginesDesc}</CardDescription></div>
          <Button type="button" variant="outline" size="sm" disabled={models.length === 0} onclick={addEngine}>{copy.add}</Button>
        </div>
      </CardHeader>
      <CardContent class="space-y-3">
        {#if models.length === 0}<Alert><AlertDescription>{copy.noModels}</AlertDescription></Alert>{/if}
        {#each orderedEngines as engine, index (engine.id)}
          <div class="grid gap-4 rounded-lg border bg-muted/30 p-4">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div class="flex items-center gap-2"><Badge variant="secondary">{index + 1}</Badge><code class="text-xs text-muted-foreground">{engine.id}</code></div>
              <div class="flex items-center gap-2"><Label class="text-xs">{copy.enabledEngine}</Label><IosSwitch bind:checked={engine.settings.enabled} /></div>
            </div>
            <div class="grid gap-3 sm:grid-cols-[minmax(140px,0.6fr)_minmax(240px,1.4fr)]">
              <div class="grid gap-1.5"><Label>{copy.name}</Label><Input bind:value={engine.settings.name} /></div>
              <div class="grid gap-1.5"><Label>{copy.model}</Label><NativeSelect bind:value={engine.settings.modelKey}>{#each models as model}<NativeSelectOption value={model.key}>{model.label} · {model.verification}</NativeSelectOption>{/each}</NativeSelect></div>
            </div>
            <div class="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" disabled={index === 0} onclick={() => moveEngine(engine.id, -1)}>{copy.moveUp}</Button>
              <Button type="button" variant="ghost" size="sm" disabled={index === orderedEngines.length - 1} onclick={() => moveEngine(engine.id, 1)}>{copy.moveDown}</Button>
              <Button type="button" variant="ghost" size="sm" class="text-destructive" onclick={() => removeEngine(engine.id)}>{copy.remove}</Button>
            </div>
          </div>
        {/each}
      </CardContent>
    </Card>

    <Card>
      <CardHeader><CardTitle class="text-sm">{copy.cliTitle} <Badge variant="outline">Phase 2</Badge></CardTitle><CardDescription>{copy.cliDesc}</CardDescription></CardHeader>
    </Card>

    <Card>
      <CardHeader><CardTitle class="text-sm">{copy.testTitle}</CardTitle><CardDescription>{copy.testDesc}</CardDescription></CardHeader>
      <CardContent class="grid gap-4">
        <div class="grid gap-3 sm:grid-cols-2">
          <div class="grid gap-1.5"><Label for="recognition-test-image">{copy.image}</Label><Input id="recognition-test-image" type="file" accept="image/png,image/jpeg,image/gif,image/webp" onchange={(event) => testFile = event.currentTarget.files?.[0] ?? null} /></div>
          <div class="grid gap-1.5"><Label for="recognition-test-engine">{copy.testEngine}</Label><NativeSelect id="recognition-test-engine" bind:value={testEngine}><NativeSelectOption value="auto">{copy.automatic}</NativeSelectOption>{#each orderedEngines as engine}<NativeSelectOption value={engine.id}>{engine.settings.name || engine.id}</NativeSelectOption>{/each}</NativeSelect></div>
        </div>
        <div class="grid gap-1.5"><Label for="recognition-test-prompt">{copy.prompt}</Label><Input id="recognition-test-prompt" bind:value={testPrompt} placeholder={copy.promptPlaceholder} /></div>
        <div><Button type="button" variant="outline" disabled={!testFile || testing || orderedEngines.length === 0} onclick={testRecognition}>{testing ? copy.testing : copy.test}</Button></div>
        {#if testResult}<div class="rounded-lg border bg-muted/30 p-4"><p class="mb-2 text-xs font-semibold text-muted-foreground">{copy.result}</p><p class="whitespace-pre-wrap text-sm leading-6">{testResult}</p></div>{/if}
      </CardContent>
    </Card>
  </form>
{/if}

<footer class="settings-footbar">
  <div class="settings-footbar-status">{#if message}<span class="text-xs font-medium text-emerald-600 dark:text-emerald-500">{message}</span>{:else if error}<span class="text-xs font-medium text-destructive">{error}</span>{/if}</div>
  <Button type="submit" form="image-recognition-form" size="sm" disabled={loading || saving} class="h-9 px-6 text-xs font-bold">{saving ? copy.saving : copy.save}</Button>
</footer>
