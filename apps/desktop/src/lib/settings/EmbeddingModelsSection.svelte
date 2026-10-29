<script lang="ts">
  import Copy from "reicon-svelte/icons/Copy";
  import Database from "reicon-svelte/icons/Database";
  import Eye from "reicon-svelte/icons/Eye";
  import EyeSlash from "reicon-svelte/icons/EyeSlash";
  import HardDrive from "reicon-svelte/icons/HardDrive";
  import PenLine from "reicon-svelte/icons/PenLine";
  import Plus from "reicon-svelte/icons/Plus";
  import Pulse from "reicon-svelte/icons/Pulse";
  import Refresh from "reicon-svelte/icons/Refresh";
  import Trash from "reicon-svelte/icons/Trash";
  import AlertDialog from "../components/ui/AlertDialog.svelte";
  import Dialog from "../components/ui/Dialog.svelte";
  import IosSwitch from "../components/ui/IosSwitch.svelte";
  import SettingGroup from "../components/ui/SettingGroup.svelte";
  import SkeletonRows from "../components/ui/SkeletonRows.svelte";
  import { session } from "../stores/session.svelte";
  import {
    activateDesktopEmbeddingModel,
    addLocalDesktopEmbeddingModel,
    backfillDesktopEmbeddings,
    deleteDesktopEmbeddingModel,
    loadDesktopEmbeddingModels,
    saveDesktopEmbeddingModel,
    testDesktopEmbeddingModel,
    type DesktopEmbeddingFailure,
    type DesktopEmbeddingModel,
    type DesktopEmbeddingState,
    type DesktopEmbeddingStatus,
    type DesktopLocalEmbeddingService
  } from "../api";

  const emptyDraft = (): DesktopEmbeddingModel => ({
    id: "",
    name: "",
    enabled: true,
    baseUrl: "",
    apiKey: "",
    model: ""
  });

  let copy = $derived(session.locale === "zh-CN" ? {
    add: "添加向量通道",
    refresh: "刷新",
    emptyTitle: "还没有向量通道",
    emptyDescription: "添加一个 OpenAI 兼容的 Embeddings 端点，或从本机 Ollama / LM Studio 一键加入。",
    active: "Active",
    local: "本地",
    remote: "远程",
    disabled: "已停用",
    use: "设为 Active",
    test: "测试连接",
    editLabel: "编辑",
    delete: "删除",
    deleteConfirm: "删除这条向量通道？",
    deleteHint: "删除后，使用这条通道生成的向量会从召回中移除。本地设置项会立即消失。",
    model: "模型",
    host: "Host URL",
    key: "API Key",
    enabled: "启用这条通道",
    name: "名称",
    save: "保存",
    saved: "向量通道已保存。",
    deleted: "向量通道已删除。",
    deleting: "删除中…",
    activated: "已切换 Active 通道。",
    localAdded: "已加入本地通道：{name} / {model}",
    cancel: "取消",
    close: "关闭",
    testing: "测试中…",
    adding: "加入中…",
    switching: "切换中…",
    saving: "保存中…",
    testOk: "{dimension} 维 · {latency} ms",
    backfill: "重新索引",
    backfilling: "索引中…",
    backfillDone: "索引完成：更新 {updated} 条，剩余 {remaining} 条。",
    localTitle: "本地服务",
    localDescription: "检测到本机 Ollama / LM Studio 时可一键加入；不安装也不影响远程通道。",
    localMissing: "没有检测到本地服务。",
    localDetected: "已检测到",
    localInstall: "Ollama：brew install ollama && ollama serve && ollama pull bge-m3\nLM Studio：下载 Embedding 模型并启动 Local Server。",
    addLocal: "加入",
    error: "操作失败",
    loading: "正在读取向量配置…",
    unavailable: "本地服务就绪后即可配置向量通道。",
    keyHint: "本地回环地址可以留空；远程端点通常需要 Key。",
    keyPlaceholder: "粘贴 API Key",
    enabledHint: "保存后立即参与记忆召回；可随时在列表里切换 Active。",
    newTitle: "新建向量通道",
    editTitle: "编辑向量通道",
    newDescription: "每条通道独立保存 Host、Key 和模型，只有一条会成为 Active。",
    editDescription: "修改后保存即可生效；切换到其它模型会触发旧向量的回填。",
    statusLexical: "当前没有可用的 Embedding，记忆召回使用词法检索。",
    recallTitle: "当前召回通道",
    emptyKicker: "记忆召回",
    lexicalTitle: "词法召回",
    lexicalBody: "尚未启用向量通道。",
    lanesTitle: "向量通道",
    lanesDescription: "每条通道独立配置。Active 通道负责当前所有记忆召回。",
    activeDescription: "切换通道后，旧向量会按模型版本自动回填。",
    laneCount: "条通道",
    localCount: "个本地服务",
    activeCount: "条 Active",
    endpointPreview: "将请求",
    showKey: "显示 Key",
    hideKey: "隐藏 Key",
    copyEndpoint: "复制端点",
    copyCommand: "复制命令",
    copied: "已复制",
    noKey: "未设置 Key",
    lastError: "最近一次探测失败",
    notConfigured: "尚未选择模型",
    addHint: "OpenAI 兼容 / Embeddings"
  } : {
    add: "Add vector lane",
    refresh: "Refresh",
    emptyTitle: "No vector lanes yet",
    emptyDescription: "Add an OpenAI-compatible embeddings endpoint, or join a local Ollama / LM Studio service in one click.",
    active: "Active",
    local: "Local",
    remote: "Remote",
    disabled: "Disabled",
    use: "Make Active",
    test: "Test connection",
    editLabel: "Edit",
    delete: "Delete",
    deleteConfirm: "Delete this vector lane?",
    deleteHint: "Vectors produced by this lane stop being used for recall. The local setting is removed immediately.",
    model: "Model",
    host: "Host URL",
    key: "API Key",
    enabled: "Enable this lane",
    name: "Name",
    save: "Save",
    saved: "Vector lane saved.",
    deleted: "Vector lane deleted.",
    deleting: "Deleting…",
    activated: "Active lane switched.",
    localAdded: "Added local lane: {name} / {model}",
    cancel: "Cancel",
    close: "Close",
    testing: "Testing…",
    adding: "Adding…",
    switching: "Switching…",
    saving: "Saving…",
    testOk: "{dimension} dims · {latency} ms",
    backfill: "Reindex",
    backfilling: "Indexing…",
    backfillDone: "Reindex complete: {updated} updated, {remaining} remaining.",
    localTitle: "Local services",
    localDescription: "Join a running Ollama / LM Studio service in one click. Skipping it leaves remote lanes untouched.",
    localMissing: "No local service detected.",
    localDetected: "Detected",
    localInstall: "Ollama: brew install ollama && ollama serve && ollama pull bge-m3\nLM Studio: download an embedding model and start the Local Server.",
    addLocal: "Join",
    error: "Request failed",
    loading: "Loading vector configuration…",
    unavailable: "Vector lanes can be configured once the local service is ready.",
    keyHint: "Loopback hosts may leave this empty; remote endpoints usually need a key.",
    keyPlaceholder: "Paste an API key",
    enabledHint: "Becomes available for recall after saving; switch Active anytime from the list.",
    newTitle: "New vector lane",
    editTitle: "Edit vector lane",
    newDescription: "Each lane stores its own host, key and model. Only one lane becomes Active.",
    editDescription: "Save to apply. Switching to a different model triggers a backfill of existing vectors.",
    statusLexical: "No usable embedding; memory recall is lexical.",
    recallTitle: "Active recall lane",
    emptyKicker: "Memory recall",
    lexicalTitle: "Lexical recall",
    lexicalBody: "No vector lane is active yet.",
    lanesTitle: "Vector lanes",
    lanesDescription: "Each lane has its own connection. The Active lane serves every memory recall.",
    activeDescription: "Switching lanes backfills existing vectors for the new model.",
    laneCount: "lanes",
    localCount: "local services",
    activeCount: "active",
    endpointPreview: "Will request",
    showKey: "Show key",
    hideKey: "Hide key",
    copyEndpoint: "Copy endpoint",
    copyCommand: "Copy commands",
    copied: "Copied",
    noKey: "No key set",
    lastError: "Last probe failed",
    notConfigured: "No model selected",
    addHint: "OpenAI-compatible / Embeddings"
  });

  let loading = $state(true);
  let busy = $state("");
  let error = $state("");
  let message = $state("");
  let items = $state<DesktopEmbeddingModel[]>([]);
  let activeId = $state("");
  let status = $state<DesktopEmbeddingStatus | null>(null);
  let lastError = $state<DesktopEmbeddingFailure | null>(null);
  let localServices = $state<DesktopLocalEmbeddingService[]>([]);
  let suggestions = $state<string[]>([]);
  let draft = $state<DesktopEmbeddingModel | null>(null);
  let draftIsNew = $state(false);
  let draftError = $state("");
  let draftMessage = $state("");
  let showKey = $state(false);
  let deleting = $state<DesktopEmbeddingModel | null>(null);
  let probeResults = $state<Record<string, { ok: boolean; dimension?: number; latencyMs?: number; error?: string }>>({});
  let loadedEndpoint = $state("");
  let copiedId = $state("");

  const activeItem = $derived(items.find((item) => item.id === activeId) ?? null);

  function apply(state: DesktopEmbeddingState): void {
    items = state.items ?? [];
    activeId = state.activeId ?? "";
    status = state.status ?? null;
    lastError = state.error ?? null;
    if (state.local !== undefined) localServices = state.local;
    if (state.suggestions !== undefined) suggestions = state.suggestions;
  }

  function fail(errorValue: unknown): void {
    error = errorValue instanceof Error ? errorValue.message : String(errorValue);
  }

  async function load(): Promise<void> {
    const endpoint = session.serviceReady ? session.endpoint : "";
    if (!endpoint) return;
    loading = true;
    error = "";
    try {
      apply(await loadDesktopEmbeddingModels(endpoint));
    } catch (errorValue) {
      fail(errorValue);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    const endpoint = session.serviceReady ? session.endpoint : "";
    if (!endpoint || endpoint === loadedEndpoint) return;
    loadedEndpoint = endpoint;
    void load();
  });

  function openNew(): void {
    draft = emptyDraft();
    draftIsNew = true;
    draftError = "";
    draftMessage = "";
    showKey = false;
  }

  function openEdit(item: DesktopEmbeddingModel): void {
    draft = { ...item };
    draftIsNew = false;
    draftError = "";
    draftMessage = "";
    showKey = false;
  }

  function closeDraft(): void {
    if (busy === "save" || busy === "draft-test") return;
    draft = null;
    draftError = "";
    draftMessage = "";
  }

  async function save(): Promise<void> {
    if (!draft || !session.endpoint) return;
    if (!draft.name.trim() || !draft.baseUrl.trim() || !draft.model.trim()) {
      draftError = `${copy.name} / ${copy.host} / ${copy.model}`;
      return;
    }
    busy = "save";
    draftError = "";
    draftMessage = "";
    try {
      apply(await saveDesktopEmbeddingModel(session.endpoint, draft));
      draft = null;
      probeResults = {};
      message = copy.saved;
    } catch (errorValue) {
      draftError = errorValue instanceof Error ? errorValue.message : String(errorValue);
    } finally {
      busy = "";
    }
  }

  async function testDraft(): Promise<void> {
    if (!draft || !session.endpoint) return;
    busy = "draft-test";
    draftError = "";
    draftMessage = "";
    try {
      const result = await testDesktopEmbeddingModel(session.endpoint, draft);
      if (!result.probe?.ok) throw new Error(result.probe?.error || copy.error);
      draftMessage = copy.testOk
        .replace("{dimension}", String(result.probe.dimension ?? 0))
        .replace("{latency}", String(result.probe.latencyMs ?? 0));
    } catch (errorValue) {
      draftError = errorValue instanceof Error ? errorValue.message : String(errorValue);
    } finally {
      busy = "";
    }
  }

  async function activate(id: string): Promise<void> {
    if (!session.endpoint) return;
    busy = `active:${id}`;
    error = "";
    message = "";
    try {
      apply(await activateDesktopEmbeddingModel(session.endpoint, id));
      message = copy.activated;
    } catch (errorValue) {
      fail(errorValue);
    } finally {
      busy = "";
    }
  }

  async function remove(id: string): Promise<void> {
    if (!session.endpoint) return;
    busy = `delete:${id}`;
    error = "";
    message = "";
    try {
      apply(await deleteDesktopEmbeddingModel(session.endpoint, id));
      deleting = null;
      message = copy.deleted;
    } catch (errorValue) {
      fail(errorValue);
    } finally {
      busy = "";
    }
  }

  async function quickTest(item: DesktopEmbeddingModel): Promise<void> {
    if (!session.endpoint) return;
    busy = `test:${item.id}`;
    error = "";
    try {
      const result = await testDesktopEmbeddingModel(session.endpoint, item);
      probeResults = {
        ...probeResults,
        [item.id]: result.probe ?? { ok: false, error: copy.error }
      };
    } catch (errorValue) {
      probeResults = {
        ...probeResults,
        [item.id]: { ok: false, error: errorValue instanceof Error ? errorValue.message : String(errorValue) }
      };
    } finally {
      busy = "";
    }
  }

  async function addLocal(service: DesktopLocalEmbeddingService, model: string): Promise<void> {
    if (!session.endpoint) return;
    busy = `local:${service.id}`;
    error = "";
    try {
      apply(await addLocalDesktopEmbeddingModel(session.endpoint, service.id, model));
      message = copy.localAdded.replace("{name}", service.name).replace("{model}", model);
    } catch (errorValue) {
      fail(errorValue);
    } finally {
      busy = "";
    }
  }

  async function reindex(): Promise<void> {
    if (!session.endpoint) return;
    busy = "backfill";
    error = "";
    try {
      let updated = 0;
      let remaining = 0;
      for (let batch = 0; batch < 20; batch += 1) {
        const result = await backfillDesktopEmbeddings(session.endpoint, 100);
        const current = Number(result.result?.updatedCount ?? 0);
        updated += current;
        remaining = Number(result.result?.remainingCount ?? 0);
        if (current === 0 || remaining === 0) break;
      }
      message = copy.backfillDone.replace("{updated}", String(updated)).replace("{remaining}", String(remaining));
    } catch (errorValue) {
      fail(errorValue);
    } finally {
      busy = "";
    }
  }

  async function copyText(value: string, id: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      copiedId = id;
      window.setTimeout(() => {
        if (copiedId === id) copiedId = "";
      }, 1600);
    } catch {
      // Clipboard permission is a browser concern; the endpoint stays visible.
    }
  }

  function isLocal(item: DesktopEmbeddingModel): boolean {
    try {
      const host = new URL(item.baseUrl).hostname;
      return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
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

  function endpointFor(url: string): string {
    const base = String(url ?? "").trim().replace(/\/+$/, "");
    if (!base) return "";
    if (/\/embeddings$/i.test(base)) return base;
    return /\/(v\d+(?:beta\d*)?)$/i.test(base) ? `${base}/embeddings` : `${base}/v1/embeddings`;
  }

  function keyLabel(item: DesktopEmbeddingModel): string {
    if (!item.apiKey) return copy.noKey;
    return `•••• ${item.apiKey.slice(-4)}`;
  }

  function probeLabel(result: { ok: boolean; dimension?: number; latencyMs?: number; error?: string }): string {
    if (!result.ok) return result.error || copy.error;
    return copy.testOk
      .replace("{dimension}", String(result.dimension ?? 0))
      .replace("{latency}", String(result.latencyMs ?? 0));
  }
</script>

<div class="embedding-page">
  {#if !session.serviceReady}
    <SettingGroup>
      <div class="embedding-unavailable">
        <strong>{copy.lanesTitle}</strong>
        <p>{copy.unavailable}</p>
      </div>
    </SettingGroup>
  {:else if loading && items.length === 0}
    <section class="embedding-overview is-skeleton" aria-busy="true">
      <div class="embedding-skeleton-hero">
        <span></span>
        <i></i>
        <em></em>
      </div>
      <SkeletonRows count={2} label={copy.loading} />
    </section>
  {:else}
    {#if items.length === 0}
      <section class="embedding-overview is-empty" aria-label={copy.emptyTitle}>
        <div class="embedding-empty-art" aria-hidden="true">
          <svg viewBox="0 0 220 112" fill="none">
            <path d="M28 78 62 52 96 62 128 30 160 46 192 24" stroke="currentColor" stroke-opacity=".26" stroke-width="1" stroke-linecap="round" />
            <path d="M62 52 74 88 112 96 150 82 160 46" stroke="currentColor" stroke-opacity=".16" stroke-width="1" stroke-linecap="round" />
            <circle cx="28" cy="78" r="2.6" fill="currentColor" fill-opacity=".45" />
            <circle cx="62" cy="52" r="2.6" fill="currentColor" fill-opacity=".45" />
            <circle cx="96" cy="62" r="2.6" fill="currentColor" fill-opacity=".45" />
            <circle cx="128" cy="30" r="4.5" fill="var(--accent)" fill-opacity=".9" />
            <circle cx="128" cy="30" r="10" stroke="var(--accent)" stroke-opacity=".24" />
            <circle cx="160" cy="46" r="2.6" fill="currentColor" fill-opacity=".45" />
            <circle cx="192" cy="24" r="2.6" fill="currentColor" fill-opacity=".45" />
            <circle cx="74" cy="88" r="2.6" fill="currentColor" fill-opacity=".45" />
            <circle cx="112" cy="96" r="2.6" fill="currentColor" fill-opacity=".45" />
            <circle cx="150" cy="82" r="2.6" fill="currentColor" fill-opacity=".45" />
          </svg>
        </div>
        <div class="embedding-empty-copy">
          <span class="embedding-kicker">{copy.emptyKicker}</span>
          <h3>{copy.emptyTitle}</h3>
          <p>{copy.emptyDescription}</p>
        </div>
        <div class="embedding-empty-actions">
          <button class="primary-button" type="button" onclick={openNew}><Plus size={14} aria-hidden="true" />{copy.add}</button>
          <button class="secondary-button" type="button" onclick={() => void load()} disabled={loading}>{copy.refresh}</button>
        </div>
        <p class="embedding-empty-note">{copy.statusLexical}</p>
      </section>
    {:else}
      <section class="embedding-overview" aria-label={copy.recallTitle}>
        <div class="embedding-overview-head">
          <div class="embedding-overview-copy">
            <span class="embedding-kicker">{copy.recallTitle}</span>
            <div class="embedding-overview-title">
              <strong>{status?.model || activeItem?.model || copy.lexicalTitle}</strong>
              <span class="embedding-state" data-state={status ? "ready" : "lexical"}>
                <i aria-hidden="true"></i>{status ? copy.active : copy.statusLexical}
              </span>
            </div>
            <p class="embedding-overview-sub">
              {#if status}
                {status.providerName}{activeItem ? ` · ${shortHost(activeItem.baseUrl)}` : ""}
              {:else}
                {copy.lexicalBody}
              {/if}
            </p>
          </div>
          <div class="embedding-overview-actions">
            <button class="secondary-button" type="button" onclick={() => void reindex()} disabled={Boolean(busy) || !status}>
              {busy === "backfill" ? copy.backfilling : copy.backfill}
            </button>
            <button class="primary-button" type="button" onclick={openNew}>{copy.add}</button>
          </div>
        </div>
        <div class="embedding-overview-foot">
          <span>{copy.activeDescription}</span>
          <span class="embedding-overview-stats">
            <span><b>{String(items.length).padStart(2, "0")}</b>{copy.laneCount}</span>
            <span><b>{String(activeId ? 1 : 0).padStart(2, "0")}</b>{copy.activeCount}</span>
            <span><b>{String(localServices.length).padStart(2, "0")}</b>{copy.localCount}</span>
          </span>
        </div>
      </section>

      <SettingGroup title={copy.lanesTitle} description={copy.lanesDescription}>
        <svelte:fragment slot="action">
          <button class="icon-button" type="button" aria-label={copy.refresh} title={copy.refresh} onclick={() => void load()} disabled={loading}>
            <Refresh size={15} aria-hidden="true" />
          </button>
        </svelte:fragment>
        <div class="embedding-lanes">
          {#each items as item (item.id)}
            {@const isActive = item.id === activeId}
            {@const probe = probeResults[item.id]}
            <article class="embedding-lane" class:is-active={isActive} class:is-disabled={!item.enabled}>
              {#if isActive}<span class="embedding-lane-rail" aria-hidden="true"></span>{/if}
              <span class="embedding-lane-mark" class:is-local={isLocal(item)}>
                {#if isLocal(item)}<HardDrive size={15} aria-hidden="true" />{:else}<Database size={15} aria-hidden="true" />{/if}
              </span>
              <div class="embedding-lane-body">
                <div class="embedding-lane-title">
                  <strong>{item.name || item.id}</strong>
                  {#if isActive}<span class="embedding-badge is-active">{copy.active}</span>{/if}
                  {#if !item.enabled}<span class="embedding-badge">{copy.disabled}</span>{/if}
                  <span class="embedding-kind">{isLocal(item) ? copy.local : copy.remote}</span>
                </div>
                <div class="embedding-lane-meta">
                  <code>{item.model || copy.notConfigured}</code>
                  <span class="embedding-sep" aria-hidden="true"></span>
                  <span class="embedding-host">{shortHost(item.baseUrl)}</span>
                  <span class="embedding-sep" aria-hidden="true"></span>
                  <span>{keyLabel(item)}</span>
                </div>
                {#if probe}
                  <p class="embedding-probe" class:is-error={!probe.ok}>
                    <i aria-hidden="true"></i>{probeLabel(probe)}
                  </p>
                {/if}
              </div>
              <div class="embedding-lane-actions">
                {#if !isActive && item.enabled}
                  <button class="embedding-use" type="button" onclick={() => void activate(item.id)} disabled={Boolean(busy)}>
                    {busy === `active:${item.id}` ? copy.switching : copy.use}
                  </button>
                {/if}
                <button class="embedding-icon-action" class:is-busy={busy === `test:${item.id}`} type="button" aria-label={copy.test} title={copy.test} aria-busy={busy === `test:${item.id}`} onclick={() => void quickTest(item)} disabled={busy === `test:${item.id}`}>
                  <Pulse size={15} aria-hidden="true" />
                </button>
                <button class="embedding-icon-action" type="button" aria-label={copy.editLabel} title={copy.editLabel} onclick={() => openEdit(item)}>
                  <PenLine size={15} aria-hidden="true" />
                </button>
                <button class="embedding-icon-action is-danger" type="button" aria-label={copy.delete} title={copy.delete} onclick={() => { deleting = item; error = ""; }} disabled={Boolean(busy)}>
                  <Trash size={15} aria-hidden="true" />
                </button>
              </div>
            </article>
          {/each}
        </div>
        <button class="embedding-add-row" type="button" onclick={openNew}>
          <span class="embedding-add-icon"><Plus size={14} aria-hidden="true" /></span>
          <span>
            <strong>{copy.add}</strong>
            <small>{copy.addHint}</small>
          </span>
        </button>
      </SettingGroup>
    {/if}

    <SettingGroup title={copy.localTitle} description={copy.localDescription}>
      {#if localServices.length > 0}
        <div class="embedding-local-list">
          {#each localServices as service (service.id)}
            <div class="embedding-local-row">
              <span class="embedding-lane-mark is-local"><HardDrive size={15} aria-hidden="true" /></span>
              <div class="embedding-local-copy">
                <div class="embedding-local-title">
                  <strong>{service.name}</strong>
                  <span class="embedding-badge is-ok">{copy.localDetected}</span>
                </div>
                <code>{shortHost(service.baseUrl)}</code>
              </div>
              <div class="embedding-local-models">
                {#each service.models as model (model)}
                  <button class="embedding-model-chip" type="button" onclick={() => void addLocal(service, model)} disabled={Boolean(busy)}>
                    <span>{model}</span>
                    <b>{busy === `local:${service.id}` ? copy.adding : copy.addLocal}</b>
                  </button>
                {/each}
              </div>
            </div>
          {/each}
        </div>
      {:else}
        <div class="embedding-local-empty">
          <div class="embedding-local-empty-copy">
            <span class="embedding-local-dot" aria-hidden="true"></span>
            <div>
              <strong>{copy.localMissing}</strong>
            </div>
          </div>
          <div class="embedding-command">
            <pre>{copy.localInstall}</pre>
            <button class="embedding-copy" type="button" aria-label={copy.copyCommand} onclick={() => void copyText(copy.localInstall, "install")}>
              <Copy size={14} aria-hidden="true" />
              {copiedId === "install" ? copy.copied : copy.copyCommand}
            </button>
          </div>
        </div>
      {/if}
    </SettingGroup>

    {#if status}
      <p class="embedding-footnote">{status.providerName} / {status.model}{activeItem ? ` · ${endpointFor(activeItem.baseUrl)}` : ""}</p>
    {/if}
    {#if lastError && items.length > 0}
      <p class="settings-action-message error-message" role="alert">{copy.lastError} · {lastError.providerName}{lastError.model ? ` / ${lastError.model}` : ""} — {lastError.message}</p>
    {/if}
    {#if message}<p class="settings-action-message" aria-live="polite">{message}</p>{/if}
    {#if error}<p class="settings-action-message error-message" role="alert">{error}</p>{/if}
  {/if}
</div>

{#if draft}
  <Dialog open={true} busy={busy === "save" || busy === "draft-test"} contentClass="entity-editor-dialog embedding-editor" labelledBy="embedding-editor-title" describedBy="embedding-editor-description" onOpenChange={(next) => { if (!next) closeDraft(); }}>
    <form class="entity-editor-form" onsubmit={(event) => { event.preventDefault(); void save(); }}>
      <header class="entity-editor-head">
        <div>
          <span class="embedding-kicker">{draftIsNew ? copy.newTitle : copy.editTitle}</span>
          <strong id="embedding-editor-title">{draft.name.trim() || (draftIsNew ? copy.newTitle : copy.editTitle)}</strong>
        </div>
        <button class="modal-close" type="button" aria-label={copy.close} onclick={closeDraft}>
          <span aria-hidden="true">×</span>
        </button>
      </header>
      <div class="entity-editor-body">
        <p id="embedding-editor-description" class="embedding-editor-description">{draftIsNew ? copy.newDescription : copy.editDescription}</p>
        <div class="embedding-form">
          <label class="settings-field">
            <span>{copy.name}</span>
            <input bind:value={draft.name} autocomplete="off" placeholder="SiliconFlow BGE" />
          </label>
          <label class="settings-field">
            <span>{copy.host}</span>
            <input bind:value={draft.baseUrl} autocomplete="off" spellcheck="false" placeholder="https://api.siliconflow.cn" />
          </label>
          <label class="settings-field">
            <span>{copy.model}</span>
            <input bind:value={draft.model} list="desktop-embedding-models" autocomplete="off" spellcheck="false" placeholder="BAAI/bge-m3" />
            <datalist id="desktop-embedding-models">{#each suggestions as suggestion (suggestion)}<option value={suggestion}></option>{/each}</datalist>
          </label>
          <label class="settings-field">
            <span>{copy.key}</span>
            <div class="secret-input">
              <input type={showKey ? "text" : "password"} bind:value={draft.apiKey} autocomplete="off" placeholder={copy.keyPlaceholder} />
              <button class="secret-reveal" type="button" aria-label={showKey ? copy.hideKey : copy.showKey} title={showKey ? copy.hideKey : copy.showKey} onclick={() => (showKey = !showKey)}>
                {#if showKey}<EyeSlash size={16} aria-hidden="true" />{:else}<Eye size={16} aria-hidden="true" />{/if}
              </button>
            </div>
            <small>{copy.keyHint}</small>
          </label>
          <div class="embedding-editor-toggle">
            <div>
              <strong>{copy.enabled}</strong>
              <p>{copy.enabledHint}</p>
            </div>
            <IosSwitch checked={draft.enabled} ariaLabel={copy.enabled} onCheckedChange={(enabled) => { if (draft) draft.enabled = enabled; }} />
          </div>
          {#if draft.baseUrl.trim()}
            <div class="embedding-endpoint">
              <span>{copy.endpointPreview}</span>
              <code>{endpointFor(draft?.baseUrl ?? "")}</code>
              <button type="button" aria-label={copy.copyEndpoint} title={copy.copyEndpoint} onclick={() => void copyText(endpointFor(draft?.baseUrl ?? ""), "draft")}>
                {#if copiedId === "draft"}{copy.copied}{:else}<Copy size={14} aria-hidden="true" />{/if}
              </button>
            </div>
          {/if}
        </div>
        {#if draftMessage}<p class="embedding-probe is-ok embedding-draft-status" role="status"><i aria-hidden="true"></i>{draftMessage}</p>{/if}
        {#if draftError}<p class="embedding-probe is-error embedding-draft-status" role="alert"><i aria-hidden="true"></i>{draftError}</p>{/if}
      </div>
      <footer class="entity-editor-foot">
        <button class="secondary-button" type="button" onclick={closeDraft} disabled={Boolean(busy)}>{copy.cancel}</button>
        <div class="embedding-editor-actions">
          <button class="secondary-button" type="button" onclick={() => void testDraft()} disabled={Boolean(busy)}>{busy === "draft-test" ? copy.testing : copy.test}</button>
          <button class="primary-button" type="submit" disabled={Boolean(busy)}>{busy === "save" ? copy.saving : copy.save}</button>
        </div>
      </footer>
    </form>
  </Dialog>
{/if}

{#if deleting}
  <AlertDialog open={true} contentClass="modal-card" labelledBy="embedding-delete-title" describedBy="embedding-delete-description" onOpenChange={(next) => { if (!next) deleting = null; }}>
    <header class="modal-head"><strong id="embedding-delete-title">{copy.delete}</strong></header>
    <div class="modal-body">
      <p id="embedding-delete-description">{copy.deleteConfirm}</p>
      <p><strong>{deleting.name || deleting.id}</strong></p>
      <p>{copy.deleteHint}</p>
      {#if error}<p class="embedding-probe is-error" role="alert"><i aria-hidden="true"></i>{error}</p>{/if}
    </div>
    <footer class="provider-modal-foot">
      <button class="secondary-button" type="button" onclick={() => (deleting = null)}>{copy.cancel}</button>
      <button class="primary-button danger-action" type="button" onclick={() => deleting && void remove(deleting.id)}>{busy === `delete:${deleting.id}` ? copy.deleting : copy.delete}</button>
    </footer>
  </AlertDialog>
{/if}

<style>
  .embedding-page { display: block; }

  .embedding-kicker {
    display: inline-block;
    color: var(--label-tertiary);
    font-size: var(--fs-meta);
    font-weight: 600;
    letter-spacing: var(--tracking-caps);
    line-height: 14px;
    text-transform: uppercase;
  }

  .embedding-overview {
    width: var(--settings-col);
    margin: 2px auto 24px;
    overflow: hidden;
    border: 1px solid var(--hairline);
    border-radius: var(--rounded-md);
    background: var(--card-bg);
  }
  .embedding-overview.is-empty { display: grid; justify-items: center; padding: 34px 28px 30px; text-align: center; }
  .embedding-overview.is-skeleton { display: grid; gap: 0; padding: 0 0 8px; }
  .embedding-overview-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; padding: 20px 20px 16px; }
  .embedding-overview-copy { display: grid; min-width: 0; gap: 5px; }
  .embedding-overview-title { display: flex; align-items: center; gap: 10px; min-width: 0; flex-wrap: wrap; }
  .embedding-overview-title strong { overflow: hidden; color: var(--label-primary); font-family: var(--font-mono); font-size: var(--fs-section); font-weight: 600; line-height: var(--lh-section); text-overflow: ellipsis; white-space: nowrap; }
  .embedding-overview-sub { margin: 0; color: var(--label-secondary); font-size: var(--fs-label); line-height: 18px; }
  .embedding-overview-actions { display: flex; flex: none; align-items: center; gap: 6px; padding-top: 2px; }

  .embedding-state { display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px 2px 6px; border: 1px solid var(--control-border); border-radius: var(--rounded-full); color: var(--label-secondary); font-size: var(--fs-meta); font-weight: 500; line-height: 16px; white-space: nowrap; }
  .embedding-state i { width: 6px; height: 6px; border-radius: 50%; background: var(--label-tertiary); }
  .embedding-state[data-state="ready"] { border-color: color-mix(in srgb, var(--accent) 32%, var(--control-border)); color: var(--accent); }
  .embedding-state[data-state="ready"] i { background: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 12%, transparent); }
  .embedding-state[data-state="lexical"] i { background: var(--warning, #b26a00); }

  .embedding-overview-foot { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 10px 20px; border-top: 1px solid var(--hairline); color: var(--label-secondary); font-size: var(--fs-meta); line-height: 16px; }
  .embedding-overview-stats { display: flex; flex: none; align-items: center; gap: 14px; font-variant-numeric: tabular-nums; }
  .embedding-overview-stats span { display: inline-flex; align-items: baseline; gap: 4px; }
  .embedding-overview-stats b { color: var(--label-primary); font-size: var(--fs-label); font-weight: 600; }

  .embedding-empty-art { width: 220px; height: 112px; margin-bottom: 6px; color: var(--label-primary); }
  .embedding-empty-art svg { width: 100%; height: 100%; }
  .embedding-empty-copy { display: grid; justify-items: center; gap: 5px; max-width: 430px; }
  .embedding-empty-copy h3 { margin: 3px 0 0; color: var(--label-primary); font-size: var(--fs-heading); font-weight: 600; line-height: var(--lh-heading); }
  .embedding-empty-copy p { margin: 0; color: var(--label-secondary); font-size: var(--fs-label); line-height: 1.55; }
  .embedding-empty-actions { display: flex; gap: 6px; margin-top: 14px; }
  .embedding-empty-actions .primary-button, .embedding-empty-actions .secondary-button { gap: 5px; }
  .embedding-empty-note { margin: 14px 0 0; color: var(--label-secondary); font-size: var(--fs-meta); line-height: 16px; }

  .embedding-skeleton-hero { display: grid; gap: 8px; padding: 20px; }
  .embedding-skeleton-hero span, .embedding-skeleton-hero i, .embedding-skeleton-hero em { height: 10px; border-radius: var(--radius-small); background: var(--fill-hover); animation: skeleton-pulse var(--duration-panel) ease-in-out infinite alternate; }
  .embedding-skeleton-hero span { width: 84px; }
  .embedding-skeleton-hero i { width: 46%; height: 22px; }
  .embedding-skeleton-hero em { width: 60%; }

  .embedding-lanes { display: grid; }
  .embedding-lane { position: relative; display: flex; align-items: flex-start; gap: 12px; padding: 14px 16px; }
  .embedding-lane + .embedding-lane { border-top: 1px solid var(--hairline); }
  .embedding-lane.is-active { background: color-mix(in srgb, var(--accent) 4%, transparent); }
  .embedding-lane, .embedding-use, .embedding-icon-action, .embedding-add-row, .embedding-model-chip, .embedding-copy { transition: background var(--duration-instant) var(--ease-standard), color var(--duration-instant) var(--ease-standard), border-color var(--duration-instant) var(--ease-standard); }
  .embedding-lane.is-disabled { opacity: .66; }
  .embedding-lane-rail { position: absolute; top: 12px; bottom: 12px; left: 0; width: 2px; border-radius: 2px; background: var(--accent); }
  .embedding-lane-mark { display: inline-flex; flex: none; align-items: center; justify-content: center; width: 28px; height: 28px; margin-top: 1px; border: 1px solid var(--hairline); border-radius: var(--rounded-full); background: var(--fill); color: var(--label-secondary); }
  .embedding-lane-mark.is-local { color: var(--label-primary); }
  .embedding-lane.is-active .embedding-lane-mark { border-color: color-mix(in srgb, var(--accent) 34%, var(--hairline)); background: color-mix(in srgb, var(--accent) 10%, transparent); color: var(--accent); }
  .embedding-lane-body { display: grid; min-width: 0; flex: 1; gap: 3px; }
  .embedding-lane-title { display: flex; align-items: center; gap: 7px; min-width: 0; flex-wrap: wrap; }
  .embedding-lane-title strong { overflow: hidden; color: var(--label-primary); font-size: var(--fs-body); font-weight: 550; line-height: var(--lh-label); text-overflow: ellipsis; white-space: nowrap; }
  .embedding-kind { color: var(--label-tertiary); font-size: var(--fs-meta); }
  .embedding-badge { padding: 1px 7px; border: 1px solid var(--control-border); border-radius: var(--rounded-full); color: var(--label-secondary); font-size: 10px; font-weight: 600; letter-spacing: .02em; line-height: 15px; text-transform: uppercase; }
  .embedding-badge.is-active { border-color: color-mix(in srgb, var(--accent) 34%, var(--control-border)); background: color-mix(in srgb, var(--accent) 8%, transparent); color: var(--accent); }
  .embedding-badge.is-ok { border-color: color-mix(in srgb, var(--online, #279141) 34%, var(--control-border)); color: var(--online, #279141); }
  .embedding-lane-meta { display: flex; align-items: center; gap: 7px; min-width: 0; color: var(--label-secondary); font-size: var(--fs-meta); line-height: 16px; }
  .embedding-lane-meta code { overflow: hidden; max-width: 42%; color: var(--label-primary); font-family: var(--font-mono); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
  .embedding-host { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .embedding-sep { flex: none; width: 2px; height: 2px; border-radius: 50%; background: var(--label-tertiary); opacity: .8; }
  .embedding-lane-actions { display: flex; flex: none; align-items: center; gap: 2px; padding-top: 1px; }
  .embedding-use { height: var(--control-h-compact); padding: 0 8px; border: 1px solid var(--control-border); border-radius: var(--rounded-sm); background: var(--card-bg); color: var(--label-primary); font-size: var(--fs-meta); font-weight: 500; white-space: nowrap; cursor: pointer; }
  .embedding-use:hover:not(:disabled) { background: var(--control-bg-hover); border-color: var(--control-border-strong); }
  .embedding-use:disabled { opacity: .45; cursor: default; }
  .embedding-icon-action { display: inline-flex; align-items: center; justify-content: center; width: var(--control-h-compact); height: var(--control-h-compact); padding: 0; border: 0; border-radius: var(--rounded-sm); background: transparent; color: var(--label-secondary); cursor: pointer; }
  .embedding-icon-action:hover:not(:disabled) { background: var(--fill); color: var(--label-primary); }
  .embedding-icon-action.is-danger:hover:not(:disabled) { color: var(--danger); }
  .embedding-icon-action.is-busy { color: var(--accent); }
  .embedding-icon-action:disabled { opacity: .4; cursor: default; }
  .embedding-probe { display: flex; align-items: center; gap: 6px; margin: 4px 0 0; color: var(--online, #279141); font-family: var(--font-mono); font-size: 10.5px; line-height: 15px; }
  .embedding-probe i { flex: none; width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
  .embedding-probe.is-error { color: var(--danger); }
  .embedding-probe.is-error i { border-radius: 0; transform: rotate(45deg); }
  .embedding-add-row { display: flex; align-items: center; gap: 10px; width: 100%; padding: 12px 16px; border: 0; border-top: 1px solid var(--hairline); background: transparent; color: inherit; text-align: left; cursor: pointer; }
  .embedding-add-row:hover { background: var(--fill); }
  .embedding-add-icon { display: inline-flex; flex: none; align-items: center; justify-content: center; width: 26px; height: 26px; border: 1px dashed var(--control-border-strong); border-radius: var(--rounded-full); color: var(--label-secondary); }
  .embedding-add-row > span:last-child { display: grid; gap: 1px; }
  .embedding-add-row strong { color: var(--label-primary); font-size: var(--fs-label); font-weight: 500; line-height: 17px; }
  .embedding-add-row small { color: var(--label-secondary); font-size: var(--fs-meta); line-height: 15px; }

  .embedding-local-list { display: grid; }
  .embedding-local-row { display: flex; align-items: center; gap: 10px; padding: 12px 16px; }
  .embedding-local-row + .embedding-local-row { border-top: 1px solid var(--hairline); }
  .embedding-local-copy { display: grid; min-width: 0; gap: 2px; }
  .embedding-local-title { display: flex; align-items: center; gap: 7px; }
  .embedding-local-title strong { color: var(--label-primary); font-size: var(--fs-label); font-weight: 550; }
  .embedding-local-copy code { overflow: hidden; color: var(--label-secondary); font-family: var(--font-mono); font-size: var(--fs-meta); text-overflow: ellipsis; white-space: nowrap; }
  .embedding-local-models { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 5px; margin-left: auto; }
  .embedding-model-chip { display: inline-flex; align-items: center; gap: 6px; height: var(--control-h-compact); padding: 0 8px; border: 1px solid var(--control-border); border-radius: var(--rounded-full); background: var(--card-bg); color: var(--label-primary); font-size: var(--fs-meta); cursor: pointer; }
  .embedding-model-chip span { font-family: var(--font-mono); }
  .embedding-model-chip b { color: var(--accent); font-weight: 500; }
  .embedding-model-chip:hover:not(:disabled) { border-color: var(--control-border-strong); background: var(--control-bg-hover); }
  .embedding-model-chip:disabled { opacity: .5; cursor: default; }

  .embedding-local-empty { display: grid; gap: 14px; padding: 16px; }
  .embedding-local-empty-copy { display: flex; align-items: flex-start; gap: 10px; }
  .embedding-local-dot { flex: none; width: 7px; height: 7px; margin-top: 5px; border-radius: 50%; background: var(--label-tertiary); box-shadow: 0 0 0 4px var(--fill); }
  .embedding-local-empty-copy strong { display: block; color: var(--label-primary); font-size: var(--fs-label); font-weight: 550; }
  .embedding-command { position: relative; overflow: hidden; border: 1px solid var(--hairline); border-radius: var(--rounded-sm); background: var(--fill); }
  .embedding-command pre { margin: 0; padding: 12px 12px 34px; overflow-x: auto; color: var(--label-secondary); font-family: var(--font-mono); font-size: 11px; line-height: 1.6; white-space: pre-wrap; }
  .embedding-copy { position: absolute; right: 6px; bottom: 6px; display: inline-flex; align-items: center; gap: 5px; height: var(--control-h-compact); padding: 0 8px; border: 1px solid var(--control-border); border-radius: var(--rounded-sm); background: var(--card-bg); color: var(--label-secondary); font-size: 10px; cursor: pointer; }
  .embedding-copy:hover { color: var(--label-primary); }

  .embedding-footnote { width: var(--settings-col); margin: -10px auto 0; overflow: hidden; color: var(--label-secondary); font-family: var(--font-mono); font-size: var(--fs-meta); line-height: 16px; text-overflow: ellipsis; white-space: nowrap; }
  .embedding-unavailable { display: grid; gap: 4px; padding: 18px 16px; }
  .embedding-unavailable strong { font-size: var(--fs-label); }
  .embedding-unavailable p { margin: 0; color: var(--label-secondary); font-size: var(--fs-meta); line-height: 1.5; }

  :global(.entity-editor-dialog.embedding-editor) { width: min(620px, calc(100vw - 48px)); }
  :global(.embedding-editor) .entity-editor-head { align-items: flex-start; }
  :global(.embedding-editor) .entity-editor-head > div { display: grid; gap: 2px; }
  :global(.embedding-editor) .entity-editor-head strong { font-size: var(--fs-heading); font-weight: 600; line-height: var(--lh-heading); }
  :global(.embedding-editor) .modal-close { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; border: 0; border-radius: var(--rounded-full); background: var(--fill); color: var(--label-secondary); font-size: 18px; line-height: 1; cursor: pointer; }
  :global(.embedding-editor) .modal-close:hover { color: var(--label-primary); }
  .embedding-editor-description { margin: 0; padding: 0 16px 12px; color: var(--label-secondary); font-size: var(--fs-meta); line-height: 1.55; }
  .embedding-form { display: grid; gap: 14px; padding: 0 16px 16px; }
  .embedding-form .settings-field { font-size: var(--fs-meta); }
  .embedding-form .settings-field input { font-size: var(--fs-label); }
  .embedding-editor-toggle { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 10px 0 0; border-top: 1px solid var(--hairline); }
  .embedding-editor-toggle strong { color: var(--label-primary); font-size: var(--fs-label); font-weight: 500; }
  .embedding-editor-toggle p { margin: 2px 0 0; color: var(--label-tertiary); font-size: var(--fs-meta); line-height: 1.45; }
  .embedding-endpoint { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 7px 9px; border: 1px solid var(--hairline); border-radius: var(--rounded-sm); background: var(--fill); color: var(--label-secondary); font-size: var(--fs-meta); }
  .embedding-endpoint span { flex: none; }
  .embedding-endpoint code { overflow: hidden; color: var(--label-primary); font-family: var(--font-mono); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
  .embedding-endpoint button { flex: none; margin-left: auto; border: 0; background: transparent; color: var(--label-tertiary); font-size: var(--fs-meta); cursor: pointer; }
  .embedding-endpoint button:hover { color: var(--label-primary); }
  .embedding-editor-actions { display: flex; align-items: center; gap: 6px; margin-left: auto; }
  .embedding-draft-status { margin: 0 16px 12px; }
  :global(.embedding-editor) .entity-editor-foot { justify-content: space-between; }

  @media (max-width: 640px) {
    .embedding-overview-head { flex-direction: column; gap: 14px; }
    .embedding-overview-actions { width: 100%; }
    .embedding-overview-actions .primary-button { flex: 1; }
    .embedding-overview-foot { align-items: flex-start; flex-direction: column; gap: 8px; }
    .embedding-lane { flex-wrap: wrap; }
    .embedding-lane-body { min-width: calc(100% - 42px); }
    .embedding-lane-actions { width: 100%; padding-left: 40px; }
    .embedding-lane-actions .embedding-use { margin-right: auto; }
    .embedding-lane-meta { flex-wrap: wrap; }
    .embedding-lane-meta code { max-width: 100%; }
    .embedding-local-row { flex-wrap: wrap; }
    .embedding-local-models { justify-content: flex-start; width: 100%; margin-left: 38px; }
    :global(.entity-editor-dialog.embedding-editor) { width: calc(100vw - 24px); }
    .embedding-empty-art { width: 180px; height: 92px; }
  }
</style>
