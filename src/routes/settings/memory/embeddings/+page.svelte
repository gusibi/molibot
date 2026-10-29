<script lang="ts">
  import { onMount, tick } from "svelte";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { IosSwitch } from "$lib/components/ui/ios-switch";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { NativeSelect, NativeSelectOption } from "$lib/components/ui/native-select";
  import { locale } from "$lib/ui/i18n";

  interface EmbeddingItem {
    id: string;
    name: string;
    enabled: boolean;
    baseUrl: string;
    apiKey: string;
    model: string;
  }

  interface LocalService {
    id: string;
    name: string;
    baseUrl: string;
    models: string[];
    recommended?: string;
  }

  const COPY = {
    "zh-CN": {
      eyebrow: "MEMORY / VECTOR LAB",
      title: "Embedding",
      titleAccent: "models",
      desc: "给记忆系统准备多条向量通道。每条有自己的 Host、Key 和模型；只有一条处于 Active。",
      add: "添加模型",
      refresh: "刷新",
      lanesStat: "条通道",
      activeStat: "条 Active",
      localStat: "个本地服务",
      loading: "正在读取向量配置…",
      active: "Active",
      idle: "空闲",
      inactive: "Standby",
      local: "LOCAL",
      remote: "REMOTE",
      use: "设为 Active",
      using: "切换中…",
      test: "测试连接",
      testing: "测试中…",
      testShort: "测试",
      testResult: "{dimension} 维 · {latency}ms",
      edit: "编辑",
      delete: "删除",
      confirmDelete: "确认删除？",
      cancel: "取消",
      reindex: "重新索引",
      reindexing: "索引中…",
      reindexDone: "索引完成：更新 {updated} 条，剩余 {remaining} 条。",
      emptyTitle: "还没有向量通道",
      emptyDesc: "添加一个 OpenAI 兼容的 Embeddings 端点，或者从下方的本地服务一键添加。",
      activeTitle: "当前召回通道",
      activeDesc: "Memory recall 只使用这一条。切换后旧向量会按模型版本自动回填。",
      lexical: "当前没有可用的 Embedding，召回走词法。",
      lastError: "最近一次探测失败",
      localTitle: "本地，可选",
      localDesc: "检测到本机 Ollama / LM Studio 时可以直接一键加入；不安装也没关系，远程通道继续工作。",
      localMissing: "没有检测到本地服务。",
      localInstall: "Ollama：brew install ollama && ollama serve && ollama pull bge-m3\nLM Studio：下载 Embedding 模型并启动 Local Server。",
      localAdd: "加入",
      localAdding: "加入中…",
      editorNew: "新建向量通道",
      editorEdit: "编辑向量通道",
      editorDesc: "每个通道独立保存 Host、Key 和模型。Key 只存在本地设置库。",
      fieldName: "名称",
      fieldNameHint: "例如：SiliconFlow / 本地 BGE",
      fieldHost: "Host URL",
      fieldHostHint: "例如 https://api.siliconflow.cn 或 http://127.0.0.1:11434",
      fieldModel: "模型",
      fieldModelHint: "例如 BAAI/bge-m3、bge-m3:latest",
      fieldKey: "API Key",
      fieldKeyHint: "本地回环地址可以留空；远程端点通常需要 Key。",
      fieldKeyPlaceholder: "留空或填写 Key",
      editorKickerNew: "VECTOR LANE / NEW",
      editorKickerEdit: "VECTOR LANE / EDIT",
      showKey: "显示",
      hideKey: "隐藏",
      enabled: "启用这条通道",
      save: "保存通道",
      saving: "保存中…",
      saveFailed: "保存失败",
      testOk: "连接成功：{model} · {dimension} 维 · {latency}ms",
      testFailed: "连接失败",
      required: "请填写名称、Host URL 和模型。",
      saved: "向量通道已保存。",
      deleted: "向量通道已删除。",
      activated: "已切换 Active 通道。",
      localAdded: "已加入本地通道：{name} / {model}",
      copied: "已复制",
      copyEndpoint: "复制端点",
      noKey: "未设置 Key",
      statusReady: "就绪",
      statusLexical: "词法",
      suggestions: "建议模型",
      backToList: "返回记忆管理",
      close: "关闭"
    },
    "en-US": {
      eyebrow: "MEMORY / VECTOR LAB",
      title: "Embedding",
      titleAccent: "models",
      desc: "Give memory multiple vector lanes. Each lane has its own host, key and model; exactly one is Active.",
      add: "Add model",
      refresh: "Refresh",
      lanesStat: "lanes",
      activeStat: "active",
      localStat: "local services",
      loading: "Reading vector configuration…",
      active: "Active",
      idle: "Idle",
      inactive: "Standby",
      local: "LOCAL",
      remote: "REMOTE",
      use: "Make Active",
      using: "Switching…",
      test: "Test connection",
      testing: "Testing…",
      testShort: "Test",
      testResult: "{dimension} dims · {latency}ms",
      edit: "Edit",
      delete: "Delete",
      confirmDelete: "Delete this lane?",
      cancel: "Cancel",
      reindex: "Reindex",
      reindexing: "Indexing…",
      reindexDone: "Reindex complete: {updated} updated, {remaining} remaining.",
      emptyTitle: "No vector lanes yet",
      emptyDesc: "Add an OpenAI-compatible Embeddings endpoint, or add a detected local service below.",
      activeTitle: "Active recall lane",
      activeDesc: "Memory recall uses only this lane. Switching models invalidates old vectors and triggers a backfill.",
      lexical: "No usable embedding; recall is lexical.",
      lastError: "Last probe failed",
      localTitle: "Local, optional",
      localDesc: "If Ollama or LM Studio is running on this machine, add it in one click. No install is required to keep using a remote lane.",
      localMissing: "No local service detected.",
      localInstall: "Ollama: brew install ollama && ollama serve && ollama pull bge-m3\nLM Studio: download an embedding model and start the Local Server.",
      localAdd: "Add",
      localAdding: "Adding…",
      editorNew: "New vector lane",
      editorEdit: "Edit vector lane",
      editorDesc: "Each lane stores its own host, key and model. Keys stay in the local settings database.",
      fieldName: "Name",
      fieldNameHint: "e.g. SiliconFlow / Local BGE",
      fieldHost: "Host URL",
      fieldHostHint: "e.g. https://api.siliconflow.cn or http://127.0.0.1:11434",
      fieldModel: "Model",
      fieldModelHint: "e.g. BAAI/bge-m3, bge-m3:latest",
      fieldKey: "API Key",
      fieldKeyHint: "Loopback hosts may leave this empty; remote endpoints usually need a key.",
      fieldKeyPlaceholder: "Empty or paste a key",
      editorKickerNew: "VECTOR LANE / NEW",
      editorKickerEdit: "VECTOR LANE / EDIT",
      showKey: "Show",
      hideKey: "Hide",
      enabled: "Enable this lane",
      save: "Save lane",
      saving: "Saving…",
      saveFailed: "Save failed",
      testOk: "Connected: {model} · {dimension} dims · {latency}ms",
      testFailed: "Connection failed",
      required: "Name, host URL and model are required.",
      saved: "Vector lane saved.",
      deleted: "Vector lane deleted.",
      activated: "Active lane switched.",
      localAdded: "Added local lane: {name} / {model}",
      copied: "Copied",
      copyEndpoint: "Copy endpoint",
      noKey: "No key set",
      statusReady: "Ready",
      statusLexical: "Lexical",
      suggestions: "Suggested models",
      backToList: "Back to memory",
      close: "Close"
    }
  } as const;

  let currentLocale = $state<"zh-CN" | "en-US">("zh-CN");
  let copy = $derived(COPY[currentLocale]);
  let loading = $state(true);
  let items = $state<EmbeddingItem[]>([]);
  let activeId = $state("");
  let status = $state<{ providerId: string; providerName: string; model: string } | null>(null);
  let lastError = $state<{ providerName: string; model?: string; message: string } | null>(null);
  let localServices = $state<LocalService[]>([]);
  let suggestions = $state<string[]>([]);
  let busy = $state("");
  let message = $state("");
  let problem = $state("");
  let backfillMessage = $state("");
  let pendingDeleteId = $state("");
  let editorOpen = $state(false);
  let editorMode = $state<"new" | "edit">("new");
  let editor = $state<EmbeddingItem>(blank());
  let editorBusy = $state("");
  let editorError = $state("");
  let editorMessage = $state("");
  let showKey = $state(false);
  let testingId = $state("");
  let probeResults = $state<Record<string, { ok: boolean; dimension?: number; latencyMs?: number; error?: string }>>({});

  function blank(): EmbeddingItem {
    return { id: "", name: "", enabled: true, baseUrl: "", apiKey: "", model: "" };
  }

  function isLocalHost(url: string): boolean {
    try {
      const host = new URL(url).hostname.toLowerCase();
      return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
    } catch {
      return false;
    }
  }

  function shortHost(url: string): string {
    try {
      const parsed = new URL(url);
      return `${parsed.host}${parsed.pathname.replace(/\/$/, "")}`;
    } catch {
      return url || "—";
    }
  }

  function maskKey(key: string): string {
    if (!key) return copy.noKey;
    return `••••••••${key.slice(-4)}`;
  }

  function endpointFor(url: string): string {
    const base = String(url || "").trim().replace(/\/+$/, "");
    if (!base) return "";
    if (/\/embeddings$/i.test(base)) return base;
    return /\/(v\d+(?:beta\d*)?)$/i.test(base) ? `${base}/embeddings` : `${base}/v1/embeddings`;
  }

  async function responseJson(response: Response): Promise<any> {
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || `${response.status} ${response.statusText}`);
    return data;
  }

  async function load(): Promise<void> {
    loading = true;
    problem = "";
    try {
      const data = await responseJson(await fetch("/api/settings/embedding-models"));
      items = Array.isArray(data.items) ? data.items : [];
      activeId = String(data.activeId ?? "");
      status = data.status ?? null;
      lastError = data.error ?? null;
      localServices = Array.isArray(data.local) ? data.local : [];
      suggestions = Array.isArray(data.suggestions) ? data.suggestions : [];
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  async function openNew(): Promise<void> {
    editorMode = "new";
    editor = blank();
    editorError = "";
    editorMessage = "";
    showKey = false;
    editorOpen = true;
    await tick();
    document.getElementById("embedding-name")?.focus();
  }

  async function openEdit(item: EmbeddingItem): Promise<void> {
    editorMode = "edit";
    editor = { ...item };
    editorError = "";
    editorMessage = "";
    showKey = false;
    editorOpen = true;
    await tick();
    document.getElementById("embedding-name")?.focus();
  }

  function closeEditor(): void {
    if (editorBusy) return;
    editorOpen = false;
  }

  async function save(): Promise<void> {
    editorBusy = "save";
    editorError = "";
    editorMessage = "";
    try {
      if (!editor.name.trim() || !editor.baseUrl.trim() || !editor.model.trim()) {
        throw new Error(copy.required);
      }
      const data = await responseJson(await fetch("/api/settings/embedding-models", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editor)
      }));
      items = Array.isArray(data.items) ? data.items : items;
      activeId = String(data.activeId ?? activeId);
      status = data.status ?? null;
      lastError = data.error ?? null;
      editorOpen = false;
      probeResults = {};
      message = copy.saved;
    } catch (e) {
      editorError = e instanceof Error ? e.message : String(e);
    } finally {
      editorBusy = "";
    }
  }

  async function testEditor(): Promise<void> {
    editorBusy = "test";
    editorError = "";
    editorMessage = "";
    try {
      if (!editor.baseUrl.trim() || !editor.model.trim()) throw new Error(copy.required);
      const data = await responseJson(await fetch("/api/settings/embedding-models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "test",
          id: editor.id || undefined,
          name: editor.name,
          baseUrl: editor.baseUrl,
          apiKey: editor.apiKey,
          model: editor.model
        })
      }));
      editorMessage = copy.testOk
        .replace("{model}", data.probe?.model ?? editor.model)
        .replace("{dimension}", String(data.probe?.dimension ?? 0))
        .replace("{latency}", String(data.probe?.latencyMs ?? 0));
    } catch (e) {
      editorError = e instanceof Error ? e.message : String(e);
    } finally {
      editorBusy = "";
    }
  }


  async function quickTest(item: EmbeddingItem): Promise<void> {
    testingId = item.id;
    problem = "";
    try {
      const data = await responseJson(await fetch("/api/settings/embedding-models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test", id: item.id })
      }));
      if (!data.probe) throw new Error(copy.testFailed);
      probeResults = { ...probeResults, [item.id]: data.probe };
      if (!data.probe?.ok) problem = data.error || copy.testFailed;
      else message = `${item.name}: ${copy.testResult.replace("{dimension}", String(data.probe.dimension ?? 0)).replace("{latency}", String(data.probe.latencyMs ?? 0))}`;
    } catch (e) {
      const failure = { ok: false, error: e instanceof Error ? e.message : String(e) };
      probeResults = { ...probeResults, [item.id]: failure };
      problem = failure.error || copy.testFailed;
    } finally {
      testingId = "";
    }
  }

  async function activate(id: string): Promise<void> {
    busy = `activate:${id}`;
    problem = "";
    try {
      const data = await responseJson(await fetch("/api/settings/embedding-models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "activate", id })
      }));
      activeId = data.activeId ?? id;
      status = data.status ?? null;
      lastError = data.error ?? null;
      message = copy.activated;
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    } finally {
      busy = "";
    }
  }

  async function remove(id: string): Promise<void> {
    busy = `delete:${id}`;
    problem = "";
    try {
      const data = await responseJson(await fetch(`/api/settings/embedding-models?id=${encodeURIComponent(id)}`, {
        method: "DELETE"
      }));
      items = Array.isArray(data.items) ? data.items : items;
      activeId = String(data.activeId ?? "");
      status = data.status ?? null;
      lastError = data.error ?? null;
      pendingDeleteId = "";
      probeResults = {};
      message = copy.deleted;
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    } finally {
      busy = "";
    }
  }

  async function addLocal(service: LocalService, model: string): Promise<void> {
    busy = `local:${service.id}`;
    problem = "";
    try {
      const data = await responseJson(await fetch("/api/settings/embedding-models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "use-local", serviceId: service.id, model })
      }));
      items = Array.isArray(data.items) ? data.items : items;
      activeId = String(data.activeId ?? activeId);
      status = data.status ?? null;
      lastError = data.error ?? null;
      message = copy.localAdded.replace("{name}", service.name).replace("{model}", model);
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    } finally {
      busy = "";
    }
  }

  async function reindex(): Promise<void> {
    busy = "backfill";
    problem = "";
    backfillMessage = "";
    try {
      let total = 0;
      let remaining = 0;
      for (let batch = 0; batch < 20; batch += 1) {
        const data = await responseJson(await fetch("/api/settings/embedding-models", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "backfill", limit: 100 })
        }));
        const updated = Number(data.result?.updatedCount ?? 0);
        remaining = Number(data.result?.remainingCount ?? 0);
        total += updated;
        if (updated === 0 || remaining === 0) break;
      }
      backfillMessage = copy.reindexDone
        .replace("{updated}", String(total))
        .replace("{remaining}", String(remaining));
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    } finally {
      busy = "";
    }
  }

  async function copyEndpoint(item: EmbeddingItem): Promise<void> {
    try {
      await navigator.clipboard.writeText(endpointFor(item.baseUrl));
      message = copy.copied;
    } catch {
      // Clipboard permission is a browser concern; the endpoint is still visible.
    }
  }

  onMount(() => {
    let unsubscribe = () => {};
    try {
      const stored = localStorage.getItem("molibot-web-locale");
      currentLocale = stored === "en-US" ? "en-US" : "zh-CN";
      unsubscribe = locale.subscribe((value) => (currentLocale = value));
    } catch {
      // Non-browser rendering keeps the default locale.
    }
    void load();
    return unsubscribe;
  });
</script>

<svelte:window onkeydown={(event) => { if (event.key === "Escape") closeEditor(); }} />

<div class="embedding-lab">
  <header class="embedding-lab-hero">
    <div class="embedding-lab-hero-copy">
      <a class="embedding-lab-back" href="/settings/memory">← {copy.backToList}</a>
      <span class="embedding-lab-eyebrow">{copy.eyebrow}</span>
      <h1 class="embedding-lab-title">
        {copy.title}<br /><em>{copy.titleAccent}</em>
      </h1>
      <p class="embedding-lab-lede">{copy.desc}</p>
      <div class="embedding-lab-stats" aria-hidden="true">
        <span><b>{String(items.length).padStart(2, "0")}</b>{copy.lanesStat}</span>
        <span><b>{status ? "01" : "00"}</b>{copy.activeStat}</span>
        <span><b>{String(localServices.length).padStart(2, "0")}</b>{copy.localStat}</span>
      </div>
      <div class="embedding-lab-hero-actions">
        <Button onclick={openNew}>{copy.add}</Button>
        <Button variant="outline" onclick={load} disabled={loading}>{copy.refresh}</Button>
      </div>
    </div>
    <div class="embedding-lab-orbit" aria-hidden="true">
      <span class="embedding-lab-orbit-ring embedding-lab-orbit-ring--one"></span>
      <span class="embedding-lab-orbit-ring embedding-lab-orbit-ring--two"></span>
      <span class="embedding-lab-orbit-ring embedding-lab-orbit-ring--three"></span>
      <span class="embedding-lab-orbit-dot embedding-lab-orbit-dot--one"></span>
      <span class="embedding-lab-orbit-dot embedding-lab-orbit-dot--two"></span>
      <span class="embedding-lab-orbit-core">
        <small>{status ? copy.active : copy.idle}</small>
        <strong>{status?.model ? status.model.split(":")[0].slice(0, 12) : "—"}</strong>
      </span>
    </div>
  </header>

  <section class="embedding-lab-strip" aria-live="polite">
    <div class="embedding-lab-strip-main">
      <span class="embedding-lab-strip-kicker">{copy.activeTitle}</span>
      <strong>{status ? `${status.providerName} / ${status.model}` : copy.lexical}</strong>
      <span class="embedding-lab-strip-note">{copy.activeDesc}</span>
    </div>
    <div class="embedding-lab-strip-actions">
      <Badge variant={status ? "secondary" : "outline"}>
        {status ? copy.statusReady : copy.statusLexical}
      </Badge>
      <Button variant="outline" size="sm" onclick={reindex} disabled={Boolean(busy) || !status}>
        {busy === "backfill" ? copy.reindexing : copy.reindex}
      </Button>
    </div>
  </section>

  {#if message || problem || backfillMessage || lastError}
    <div class="embedding-lab-notices" aria-live="polite">
      {#if message}<div class="embedding-lab-toast">{message}</div>{/if}
      {#if backfillMessage}<div class="embedding-lab-toast embedding-lab-toast--quiet">{backfillMessage}</div>{/if}
      {#if problem}<div class="embedding-lab-toast embedding-lab-toast--error">{problem}</div>{/if}
      {#if lastError && items.length > 0}
        <div class="embedding-lab-toast embedding-lab-toast--quiet">
          {copy.lastError}: {lastError.providerName}{lastError.model ? ` / ${lastError.model}` : ""} — {lastError.message}
        </div>
      {/if}
    </div>
  {/if}

  {#if loading}
    <div class="embedding-lab-skeleton">
      <div></div><div></div><div></div>
    </div>
  {:else if items.length === 0}
    <section class="embedding-lab-empty">
      <span class="embedding-lab-empty-mark">∅</span>
      <h2>{copy.emptyTitle}</h2>
      <p>{copy.emptyDesc}</p>
      <Button onclick={openNew}>{copy.add}</Button>
    </section>
  {:else}
    <section class="embedding-lab-grid" aria-label={copy.activeTitle}>
      {#each items as item, index (item.id)}
        <article
          class:embedding-lab-card--active={item.id === activeId}
          class="embedding-lab-card"
          style={`--i:${index};`}
          aria-current={item.id === activeId ? "true" : undefined}
        >
          <div class="embedding-lab-card-top">
            <span class="embedding-lab-index">{String(index + 1).padStart(2, "0")}</span>
            <div class="embedding-lab-badges">
              <Badge variant={isLocalHost(item.baseUrl) ? "outline" : "secondary"}>
                {isLocalHost(item.baseUrl) ? copy.local : copy.remote}
              </Badge>
              {#if item.id === activeId}<Badge>{copy.active}</Badge>{/if}
              {#if !item.enabled}<Badge variant="outline">{copy.inactive}</Badge>{/if}
            </div>
          </div>

          <div class="embedding-lab-card-heading">
            <h2>{item.name || item.id}</h2>
            <code>{item.model || "—"}</code>
          </div>

          <div class="embedding-lab-card-host">
            <span>{shortHost(item.baseUrl)}</span>
            <button type="button" class="embedding-lab-copy" onclick={() => copyEndpoint(item)} aria-label={copy.copyEndpoint}>
              ⧉
            </button>
          </div>

          <dl class="embedding-lab-meta">
            <div><dt>{copy.fieldKey}</dt><dd>{maskKey(item.apiKey)}</dd></div>
            <div><dt>Endpoint</dt><dd>{endpointFor(item.baseUrl).replace(/^https?:\/\//, "")}</dd></div>
          </dl>
          {#if probeResults[item.id]}
            <div class="embedding-lab-probe" class:is-error={!probeResults[item.id].ok}>
              {probeResults[item.id].ok
                ? copy.testResult.replace("{dimension}", String(probeResults[item.id].dimension ?? 0)).replace("{latency}", String(probeResults[item.id].latencyMs ?? 0))
                : probeResults[item.id].error}
            </div>
          {/if}

          <div class="embedding-lab-card-actions">
            {#if item.id !== activeId}
              <Button size="sm" onclick={() => activate(item.id)} disabled={Boolean(busy) || !item.enabled}>
                {busy === `activate:${item.id}` ? copy.using : copy.use}
              </Button>
            {/if}
            <Button variant="ghost" size="sm" onclick={() => quickTest(item)} disabled={testingId === item.id}>
              {testingId === item.id ? copy.testing : copy.testShort}
            </Button>
            <Button variant="outline" size="sm" onclick={() => openEdit(item)}>{copy.edit}</Button>
            {#if pendingDeleteId === item.id}
              <span class="embedding-lab-confirm">
                <span>{copy.confirmDelete}</span>
                <Button variant="destructive" size="sm" onclick={() => remove(item.id)} disabled={busy === `delete:${item.id}`}>
                  {copy.delete}
                </Button>
                <Button variant="ghost" size="sm" onclick={() => (pendingDeleteId = "")}>{copy.cancel}</Button>
              </span>
            {:else}
              <Button variant="ghost" size="sm" onclick={() => (pendingDeleteId = item.id)}>{copy.delete}</Button>
            {/if}
          </div>
        </article>
      {/each}

      <button type="button" class="embedding-lab-add-card" onclick={openNew}>
        <span>＋</span>
        <strong>{copy.add}</strong>
        <small>{copy.editorDesc}</small>
      </button>
    </section>
  {/if}

  <section class="embedding-lab-local">
    <div class="embedding-lab-local-head">
      <div>
        <span class="embedding-lab-eyebrow">{copy.localTitle}</span>
        <p>{copy.localDesc}</p>
      </div>
      <span class="embedding-lab-local-dot" class:is-on={localServices.length > 0}></span>
    </div>

    {#if localServices.length > 0}
      <div class="embedding-lab-local-grid">
        {#each localServices as service (service.id)}
          <article class="embedding-lab-local-card">
            <div class="embedding-lab-local-title">
              <strong>{service.name}</strong>
              <span>{shortHost(service.baseUrl)}</span>
            </div>
            <div class="embedding-lab-local-models">
              {#each service.models as model (model)}
                <button
                  type="button"
                  class="embedding-lab-model-chip"
                  onclick={() => addLocal(service, model)}
                  disabled={Boolean(busy)}
                >
                  <span>{model}</span>
                  <b>{busy === `local:${service.id}` ? copy.localAdding : copy.localAdd}</b>
                </button>
              {/each}
            </div>
          </article>
        {/each}
      </div>
    {:else}
      <div class="embedding-lab-local-empty">
        <p>{copy.localMissing}</p>
        <pre>{copy.localInstall}</pre>
      </div>
    {/if}
  </section>

  {#if editorOpen}
    <div class="embedding-lab-overlay" onclick={(event) => { if (event.target === event.currentTarget) closeEditor(); }} role="presentation">
      <div class="embedding-lab-editor" role="dialog" tabindex="-1" aria-modal="true" aria-labelledby="embedding-editor-title">
        <div class="embedding-lab-editor-head">
          <div>
            <span class="embedding-lab-eyebrow">{editorMode === "new" ? copy.editorKickerNew : copy.editorKickerEdit}</span>
            <h2 id="embedding-editor-title">{editor.name || (editorMode === "new" ? copy.editorNew : copy.editorEdit)}</h2>
          </div>
          <button type="button" class="embedding-lab-close" onclick={closeEditor} aria-label={copy.close}>×</button>
        </div>
        <p class="embedding-lab-editor-desc">{copy.editorDesc}</p>

        <div class="embedding-lab-form">
          <div class="embedding-lab-field">
            <Label for="embedding-name">{copy.fieldName}</Label>
            <Input id="embedding-name" bind:value={editor.name} placeholder={copy.fieldNameHint} />
          </div>
          <div class="embedding-lab-field">
            <Label for="embedding-host">{copy.fieldHost}</Label>
            <Input id="embedding-host" bind:value={editor.baseUrl} placeholder={copy.fieldHostHint} spellcheck="false" />
          </div>
          <div class="embedding-lab-field">
            <Label for="embedding-model">{copy.fieldModel}</Label>
            <Input id="embedding-model" bind:value={editor.model} placeholder={copy.fieldModelHint} list="embedding-model-options" spellcheck="false" />
            <datalist id="embedding-model-options">
              {#each suggestions as suggestion (suggestion)}
                <option value={suggestion}></option>
              {/each}
            </datalist>
          </div>
          <div class="embedding-lab-field">
            <Label for="embedding-key">{copy.fieldKey}</Label>
            <div class="embedding-lab-key-row">
              <Input
                id="embedding-key"
                type={showKey ? "text" : "password"}
                bind:value={editor.apiKey}
                placeholder={copy.fieldKeyPlaceholder}
                spellcheck="false"
              />
              <button type="button" class="embedding-lab-reveal" onclick={() => (showKey = !showKey)}>
                {showKey ? copy.hideKey : copy.showKey}
              </button>
            </div>
            <p class="embedding-lab-hint">{copy.fieldKeyHint}</p>
          </div>
          <div class="embedding-lab-toggle-row">
            <div>
              <Label for="embedding-enabled">{copy.enabled}</Label>
              <p class="embedding-lab-hint">{isLocalHost(editor.baseUrl) ? copy.local : copy.remote}</p>
            </div>
            <IosSwitch id="embedding-enabled" bind:checked={editor.enabled} />
          </div>
        </div>

        {#if editorMessage}<div class="embedding-lab-toast">{editorMessage}</div>{/if}
        {#if editorError}<div class="embedding-lab-toast embedding-lab-toast--error">{editorError}</div>{/if}

        <div class="embedding-lab-editor-actions">
          <Button variant="outline" onclick={testEditor} disabled={Boolean(editorBusy)}>
            {editorBusy === "test" ? copy.testing : copy.test}
          </Button>
          <Button onclick={save} disabled={Boolean(editorBusy)}>
            {editorBusy === "save" ? copy.saving : copy.save}
          </Button>
        </div>
      </div>
    </div>
  {/if}
</div>
