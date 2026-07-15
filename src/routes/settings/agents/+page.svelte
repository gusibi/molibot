<script lang="ts">
  import { onMount } from "svelte";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { IosSwitch } from "$lib/components/ui/ios-switch";
  import { Textarea } from "$lib/components/ui/textarea";
  import { NativeSelect, NativeSelectOption } from "$lib/components/ui/native-select";
  import { locale } from "$lib/ui/i18n";

  type AgentModelRoute = "text" | "vision" | "stt";

  interface AgentModelRouting {
    textModelKey: string;
    visionModelKey: string;
    sttModelKey: string;
  }

  interface ModelRouteOption {
    key: string;
    label: string;
  }

  interface AgentItem {
    id: string;
    name: string;
    description: string;
    enabled: boolean;
    modelRouting: AgentModelRouting;
    profileFiles: AgentFiles;
    isNew: boolean;
  }

  type AgentFiles = Record<string, string>;

  interface BuiltInAgentTemplateItem {
    id: string;
    name: string;
    description: string;
    category: string;
    source: string;
    installed: boolean;
  }

  interface BuiltInSubagentItem {
    name: string;
    description: string;
    tools: string[];
    modelHint?: string;
    modelLevel?: string;
    activeModelKey?: string;
    activeModelLabel?: string;
    activeModelSource?: string;
  }

  const subagentsNavId = "__built_in_subagents__";
  const templatesNavId = "__built_in_templates__";

  const fileNames = ["AGENTS.md", "SOUL.md", "IDENTITY.md", "SONG.md"];

  const COPY = {
    "zh-CN": {
      eyebrow: "身份层",
      customCount: "个自定义智能体",
      title: "Agents",
      desc: "管理可复用的智能体身份，并直接编辑其 Markdown 提示词文件。",
      loading: "正在加载智能体设置...",
      listTitle: "Agent 列表",
      listDesc: "个已配置",
      addBtn: "添加空白 Agent",
      templatesLabel: "内置模板",
      templatesDesc: "个可安装角色",
      templatesTitle: "内置 Agent 模板",
      templatesHelp: "模板来自应用目录。安装会复制到 workspace/agents，之后可独立编辑，升级不会静默覆盖。",
      installBtn: "安装",
      installedBtn: "已安装",
      installingBtn: "安装中...",
      installSuccess: "已安装 Agent：",
      installFailed: "安装模板失败",
      subagentsLabel: "内置 Subagent",
      subagentsDesc: "个内置委派角色",
      builtInTag: "内置",
      builtInTitle: "内置 Subagents",
      builtInDesc: "共享子智能体工具使用的只读委派角色。",
      configureRoute: "配置模型路由",
      explicitRoute: "显式 Subagent 路由：",
      notSet: "未设置",
      routeExplanation: "。每个角色将依次使用下方的模型级别映射、此备选路由以及文本路由。",
      notConfigured: "未配置",
      tools: "工具",
      modelLevel: "模型级别",
      effectiveModel: "生效模型",
      source: "来源",
      notResolved: "未解析",
      unknown: "未知",
      metaTitle: "Agent 元数据",
      metaDesc: "设置 Agent ID、显示名称、描述以及启用状态。",
      removeBtn: "删除",
      idLabel: "Agent ID",
      nameLabel: "Agent 名称",
      idLocked: "创建后 Agent ID 将被锁定以保持引用稳定。",
      descLabel: "描述",
      descPlaceholder: "对该智能体角色和身份的简短描述。",
      enableLabel: "启用这个 Agent",
      enableDesc: "禁用的智能体将保留但无法在运行时选择。",
      modelTitle: "专有模型",
      modelDesc: "为该 Agent 指定文本 / 视觉 / 语音转写模型；保留“跟随全局”则使用全局模型路由。其它路由（TTS、压缩、子智能体）始终走全局。",
      modelGlobalOption: "跟随全局（默认）",
      modelTextLabel: "文本模型",
      modelVisionLabel: "视觉模型",
      modelSttLabel: "语音转写模型",
      modelRouteLink: "查看全局模型路由 →",
      overridesTitle: "Agent Markdown 覆盖文件",
      overridesDesc: "留空内容将删除该文件，使运行时回退到上层配置。",
      saving: "保存中...",
      savingMsg: "正在保存变更...",
      saveBtn: "保存 Agent 设置",
      resetBtn: "重置",
      confirmDelete: "确认删除吗？此操作无法撤销。",
      unsavedConfirm: "当前 Agent 有未保存变更。点击“确定”先保存并切换，点击“取消”留在当前 Agent。",
      failedLoad: "加载配置失败",
      failedLoadSub: "加载 Subagent 失败",
      failedSave: "保存 Agent 失败",
      failedSaveFiles: "保存配置文件失败",
      savedSuccess: "已保存 Agent："
    },
    "en-US": {
      eyebrow: "Identity Layer",
      customCount: "custom agents",
      title: "Agents",
      desc: "Manage reusable agent identities and edit their Markdown prompt files directly.",
      loading: "Loading agent settings...",
      listTitle: "Agent List",
      listDesc: "configured",
      addBtn: "Add Blank Agent",
      templatesLabel: "Built-in Templates",
      templatesDesc: "installable roles",
      templatesTitle: "Built-in Agent Templates",
      templatesHelp: "Templates are discovered from the application directory. Installing copies one into workspace/agents; future upgrades never silently overwrite your edited copy.",
      installBtn: "Install",
      installedBtn: "Installed",
      installingBtn: "Installing...",
      installSuccess: "Installed Agent: ",
      installFailed: "Failed to install template",
      subagentsLabel: "Subagents",
      subagentsDesc: "built-in delegation roles",
      builtInTag: "BUILT-IN",
      builtInTitle: "Built-in Subagents",
      builtInDesc: "Read-only delegation roles used by the shared subagent tool.",
      configureRoute: "Configure model route",
      explicitRoute: "Explicit subagent route:",
      notSet: "not set",
      routeExplanation: ". Each role first uses its model level mapping below, then this fallback route, then the text route.",
      notConfigured: "not configured",
      tools: "Tools",
      modelLevel: "Model level",
      effectiveModel: "Effective model",
      source: "Source",
      notResolved: "not resolved",
      unknown: "unknown",
      metaTitle: "Agent Metadata",
      metaDesc: "Set agent ID, display name, description, and toggled status.",
      removeBtn: "Remove",
      idLabel: "Agent ID",
      nameLabel: "Agent Name",
      idLocked: "Agent ID is locked after creation to keep references stable.",
      descLabel: "Description",
      descPlaceholder: "Short description of this agent's role and identity.",
      enableLabel: "Enable this agent",
      enableDesc: "Disabled agents stay saved but are not selectable at runtime.",
      modelTitle: "Dedicated Models",
      modelDesc: "Pick text / vision / STT models for this agent; leave on \"Follow global\" to use the global model routing. Other routes (TTS, compaction, subagents) always follow global.",
      modelGlobalOption: "Follow global (default)",
      modelTextLabel: "Text model",
      modelVisionLabel: "Vision model",
      modelSttLabel: "Speech-to-text model",
      modelRouteLink: "View global model routing →",
      overridesTitle: "Agent Markdown Overrides",
      overridesDesc: "Empty content removes the file so the runtime falls back to upper layers.",
      saving: "Saving...",
      savingMsg: "Saving changes...",
      saveBtn: "Save Agent Settings",
      resetBtn: "Reset",
      confirmDelete: "Delete agent? This cannot be undone.",
      unsavedConfirm: "Current Agent has unsaved changes. Click 'OK' to save and switch, or 'Cancel' to stay on this Agent.",
      failedLoad: "Failed to load settings",
      failedLoadSub: "Failed to load subagents",
      failedSave: "Failed to save agents",
      failedSaveFiles: "Failed to save files",
      savedSuccess: "Saved agent: "
    }
  } as const;

  let loading = true;
  let saving = false;
  let error = "";
  let message = "";

  let agents: AgentItem[] = [];
  let builtInTemplates: BuiltInAgentTemplateItem[] = [];
  let installingTemplateId = "";
  let modelRouteOptions: Record<AgentModelRoute, ModelRouteOption[]> = { text: [], vision: [], stt: [] };
  let builtInSubagents: BuiltInSubagentItem[] = [];
  let subagentConfiguredModelLabel = "";
  let subagentModelLevels: Record<string, { key: string; label: string }> = {};
  let selectedAgentId = "";
  let savedSnapshots: Record<string, string> = {};

  $: copy = COPY[$locale] ?? COPY["en-US"];
  $: modelRouteFields = [
    { route: "text" as AgentModelRoute, label: copy.modelTextLabel },
    { route: "vision" as AgentModelRoute, label: copy.modelVisionLabel },
    { route: "stt" as AgentModelRoute, label: copy.modelSttLabel }
  ];

  function createAgentId(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return `agent-${crypto.randomUUID().slice(0, 8)}`;
    }
    return `agent-${Math.random().toString(36).slice(2, 10)}`;
  }

  function emptyFiles(): AgentFiles {
    return Object.fromEntries(fileNames.map((fileName) => [fileName, ""]));
  }

  function emptyModelRouting(): AgentModelRouting {
    return { textModelKey: "", visionModelKey: "", sttModelKey: "" };
  }

  function normalizeModelRouting(input: Partial<AgentModelRouting> | undefined): AgentModelRouting {
    return {
      textModelKey: String(input?.textModelKey ?? "").trim(),
      visionModelKey: String(input?.visionModelKey ?? "").trim(),
      sttModelKey: String(input?.sttModelKey ?? "").trim()
    };
  }

  function createAgent(): AgentItem {
    return {
      id: createAgentId(),
      name: "",
      description: "",
      enabled: true,
      modelRouting: emptyModelRouting(),
      profileFiles: emptyFiles(),
      isNew: true
    };
  }

  function normalizeAgent(agent: AgentItem): AgentItem {
    return {
      ...agent,
      id: agent.id.trim(),
      name: agent.name.trim(),
      description: agent.description.trim(),
      enabled: Boolean(agent.enabled),
      modelRouting: normalizeModelRouting(agent.modelRouting),
      profileFiles: Object.fromEntries(fileNames.map((fileName) => [fileName, String(agent.profileFiles[fileName] ?? "")])),
      isNew: agent.isNew
    };
  }

  function modelRouteOption(route: AgentModelRoute): ModelRouteOption[] {
    return modelRouteOptions[route] ?? [];
  }

  function modelRoutingKey(route: AgentModelRoute): keyof AgentModelRouting {
    return route === "text" ? "textModelKey" : route === "vision" ? "visionModelKey" : "sttModelKey";
  }

  function setAgentModelRoute(route: AgentModelRoute, value: string): void {
    if (!selectedAgent) return;
    selectedAgent.modelRouting = { ...selectedAgent.modelRouting, [modelRoutingKey(route)]: value };
    agents = agents;
  }

  function agentSnapshot(agent: AgentItem): string {
    return JSON.stringify(normalizeAgent(agent));
  }

  async function loadAgentFiles(agentId: string): Promise<AgentFiles> {
    if (!agentId) return emptyFiles();
    const res = await fetch(`/api/settings/profile-files?scope=agent&agentId=${encodeURIComponent(agentId)}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Failed to load agent files");
    return Object.assign(emptyFiles(), data.files ?? {});
  }

  async function loadSettings(): Promise<void> {
    loading = true;
    error = "";
    message = "";
    try {
      const [res, subagentsRes, modelSwitchRes, templatesRes] = await Promise.all([
        fetch("/api/settings/agent"),
        fetch("/api/settings/subagents"),
        fetch("/api/settings/model-switch"),
        fetch("/api/settings/agent-templates")
      ]);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || copy.failedLoad);
      const templatesData = await templatesRes.json();
      if (!templatesData.ok) throw new Error(templatesData.error || copy.failedLoad);
      builtInTemplates = Array.isArray(templatesData.templates) ? templatesData.templates : [];
      const modelSwitchData = await modelSwitchRes.json();
      if (modelSwitchData?.ok && modelSwitchData.routes) {
        const pick = (route: AgentModelRoute): ModelRouteOption[] =>
          Array.isArray(modelSwitchData.routes[route]?.options)
            ? modelSwitchData.routes[route].options.map((option: ModelRouteOption) => ({
                key: String(option.key ?? ""),
                label: String(option.label ?? option.key ?? "")
              }))
            : [];
        modelRouteOptions = { text: pick("text"), vision: pick("vision"), stt: pick("stt") };
      }
      const subagentData = await subagentsRes.json();
      if (!subagentData.ok) throw new Error(subagentData.error || copy.failedLoadSub);
      builtInSubagents = Array.isArray(subagentData.subagents)
        ? subagentData.subagents.map((item: BuiltInSubagentItem) => ({
            name: String(item.name ?? ""),
            description: String(item.description ?? ""),
            tools: Array.isArray(item.tools) ? item.tools.map((tool) => String(tool)) : [],
            modelHint: item.modelHint ? String(item.modelHint) : undefined,
            modelLevel: item.modelLevel ? String(item.modelLevel) : "",
            activeModelKey: item.activeModelKey ? String(item.activeModelKey) : "",
            activeModelLabel: item.activeModelLabel ? String(item.activeModelLabel) : "",
            activeModelSource: item.activeModelSource ? String(item.activeModelSource) : ""
          }))
        : [];
      subagentConfiguredModelLabel = String(subagentData.configuredModelLabel ?? subagentData.configuredModelKey ?? "");
      subagentModelLevels = subagentData.modelLevels && typeof subagentData.modelLevels === "object"
        ? subagentData.modelLevels
        : {};
      const rawAgents = Array.isArray(data.agents) ? data.agents : [];
      agents = await Promise.all(
        rawAgents.map(async (agent: AgentItem) => ({
          id: agent.id,
          name: agent.name ?? "",
          description: agent.description ?? "",
          enabled: agent.enabled ?? true,
          modelRouting: normalizeModelRouting(agent.modelRouting),
          profileFiles: await loadAgentFiles(agent.id),
          isNew: false
        }))
      );
      if (agents.length === 0) {
        const next = createAgent();
        agents = [next];
      }
      savedSnapshots = Object.fromEntries(agents.map((agent) => [agent.id, agentSnapshot(agent)]));
      selectedAgentId = agents[0]?.id ?? "";
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  async function ensureCurrentSavedBeforeSwitch(): Promise<boolean> {
    const current = agents.find((agent) => agent.id === selectedAgentId);
    if (!current) return true;
    const baseline = savedSnapshots[current.id];
    const dirty = agentSnapshot(current) !== baseline;
    if (!dirty) return true;
    if (typeof window === "undefined") return false;
    const shouldSave = window.confirm(copy.unsavedConfirm);
    if (!shouldSave) return false;
    return save();
  }

  async function selectAgent(agentId: string): Promise<void> {
    if (agentId === selectedAgentId) return;
    const ok = await ensureCurrentSavedBeforeSwitch();
    if (!ok) return;
    selectedAgentId = agentId;
  }

  async function selectTemplates(): Promise<void> {
    if (selectedAgentId === templatesNavId) return;
    const ok = await ensureCurrentSavedBeforeSwitch();
    if (!ok) return;
    selectedAgentId = templatesNavId;
  }

  async function selectSubagents(): Promise<void> {
    if (selectedAgentId === subagentsNavId) return;
    const ok = await ensureCurrentSavedBeforeSwitch();
    if (!ok) return;
    selectedAgentId = subagentsNavId;
  }

  async function installTemplate(templateId: string): Promise<void> {
    if (installingTemplateId) return;
    installingTemplateId = templateId;
    error = "";
    message = "";
    try {
      const res = await fetch("/api/settings/agent-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId })
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || copy.installFailed);
      await loadSettings();
      selectedAgentId = String(data.agentId ?? templateId);
      message = `${copy.installSuccess}${selectedAgentId}`;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      installingTemplateId = "";
    }
  }

  async function addAgent(): Promise<void> {
    const ok = await ensureCurrentSavedBeforeSwitch();
    if (!ok) return;
    const next = createAgent();
    agents = [...agents, next];
    savedSnapshots = { ...savedSnapshots, [next.id]: agentSnapshot(next) };
    selectedAgentId = next.id;
  }

  async function removeAgent(agentId: string): Promise<void> {
    const confirmed = typeof window === "undefined" ? true : window.confirm(copy.confirmDelete);
    if (!confirmed) return;

    const target = agents.find((agent) => agent.id === agentId);
    if (target && !target.isNew) {
      const res = await fetch("/api/settings/agent", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: agentId })
      });
      const data = await res.json();
      if (!data.ok) {
        error = data.error || `Failed to delete agent ${agentId}`;
        return;
      }
    }

    agents = agents.filter((agent) => agent.id !== agentId);
    savedSnapshots = Object.fromEntries(Object.entries(savedSnapshots).filter(([id]) => id !== agentId));
    if (agents.length === 0) {
      const next = createAgent();
      agents = [next];
      savedSnapshots = { ...savedSnapshots, [next.id]: agentSnapshot(next) };
    }
    selectedAgentId = agents[0]?.id ?? "";
  }

  async function save(): Promise<boolean> {
    const selected = agents.find((agent) => agent.id === selectedAgentId) ?? agents[0];
    if (!selected) return false;

    saving = true;
    error = "";
    message = "";
    try {
      const normalized = normalizeAgent(selected);
      if (!normalized.id) throw new Error("Agent ID is required");

      const settingsRes = await fetch("/api/settings/agent", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          previousId: selected.isNew ? "" : selected.id,
          agent: {
            id: normalized.id,
            name: normalized.name,
            description: normalized.description,
            enabled: normalized.enabled,
            modelRouting: normalized.modelRouting
          }
        })
      });
      const settingsData = await settingsRes.json();
      if (!settingsData.ok) throw new Error(settingsData.error || copy.failedSave);

      const res = await fetch("/api/settings/profile-files", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: "agent",
          agentId: normalized.id,
          files: normalized.profileFiles
        })
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || `${copy.failedSaveFiles} ${normalized.id}`);

      agents = agents.map((agent) => {
        if (agent.id !== selected.id) return agent;
        return { ...normalized, isNew: false };
      });
      if (selected.id !== normalized.id) {
        selectedAgentId = normalized.id;
      }
      savedSnapshots = { ...savedSnapshots, [normalized.id]: agentSnapshot({ ...normalized, isNew: false }) };

      message = `${copy.savedSuccess}${normalized.name || normalized.id}`;
      return true;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      return false;
    } finally {
      saving = false;
    }
  }

  $: selectedAgent = agents.find((agent) => agent.id === selectedAgentId);
  $: selectedFiles = selectedAgent?.profileFiles ?? emptyFiles();
  $: showingTemplates = selectedAgentId === templatesNavId;
  $: showingSubagents = selectedAgentId === subagentsNavId;
  $: selectedAgentDirty = selectedAgent
    ? agentSnapshot(selectedAgent) !== (savedSnapshots[selectedAgent.id] ?? "")
    : false;

  onMount(loadSettings);
</script>

<div class="channel-page">
  <header class="channel-hero">
    <span class="channel-badge">{copy.eyebrow}</span>
    <span class="channel-badge">{agents.length} {copy.customCount}</span>
    <h1 class="channel-hero-title">{copy.title}</h1>
    <p class="channel-hero-desc">{copy.desc}</p>
  </header>

  {#if loading}
    <div class="channel-loading">{copy.loading}</div>
  {:else}
    <div class="channel-master-detail">
      <div class="channel-card">
        <div class="channel-card-header">
          <div>
            <h2 class="channel-card-title">{copy.listTitle}</h2>
            <p class="channel-card-desc">{agents.length} {copy.listDesc}</p>
          </div>
          <Button variant="outline" size="sm" type="button" onclick={addAgent}>
            {copy.addBtn}
          </Button>
        </div>
        <div class="channel-card-body">
          <button
            class="channel-sidebar-btn {showingTemplates ? 'channel-sidebar-btn--active' : ''}"
            type="button"
            onclick={selectTemplates}
          >
            <span>
              <span class="channel-sidebar-btn-name">{copy.templatesLabel}</span>
              <span class="channel-sidebar-btn-id">{builtInTemplates.length} {copy.templatesDesc}</span>
            </span>
            <span class="channel-sidebar-badge">{copy.builtInTag}</span>
          </button>

          <button
            class="channel-sidebar-btn {showingSubagents ? 'channel-sidebar-btn--active' : ''}"
            type="button"
            onclick={selectSubagents}
          >
            <span>
              <span class="channel-sidebar-btn-name">{copy.subagentsLabel}</span>
              <span class="channel-sidebar-btn-id">{builtInSubagents.length} {copy.subagentsDesc}</span>
            </span>
            <span class="channel-sidebar-badge">{copy.builtInTag}</span>
          </button>

          {#each agents as agent (agent.id)}
            <button
              class="channel-sidebar-btn {selectedAgentId === agent.id ? 'channel-sidebar-btn--active' : ''}"
              type="button"
              onclick={() => selectAgent(agent.id)}
            >
              <span>
                <span class="channel-sidebar-btn-name">{agent.name || agent.id}</span>
                <span class="channel-sidebar-btn-id">{agent.id}</span>
              </span>
              <span class="channel-sidebar-badge {agent.enabled ? 'channel-sidebar-badge--on' : ''}">
                {agent.enabled ? "On" : "Off"}
              </span>
            </button>
          {/each}
        </div>
      </div>

      {#if showingTemplates}
        <div class="channel-form">
          <div class="channel-card">
            <div class="channel-card-header">
              <div>
                <h2 class="channel-card-title">{copy.templatesTitle}</h2>
                <p class="channel-card-desc">{copy.templatesHelp}</p>
              </div>
            </div>
          </div>
          <div class="channel-field-row" style="grid-template-columns: 1fr 1fr;">
            {#each builtInTemplates as template (template.id)}
              <div class="channel-card">
                <div class="channel-card-header">
                  <div>
                    <h3 class="channel-card-title">{template.name}</h3>
                    <p class="channel-card-desc">{template.description}</p>
                  </div>
                  <span class="channel-sidebar-badge">{template.category}</span>
                </div>
                <div class="channel-card-body">
                  <div class="channel-field">
                    <span class="channel-sidebar-btn-id">{template.id} · {template.source}</span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    disabled={template.installed || Boolean(installingTemplateId)}
                    onclick={() => installTemplate(template.id)}
                  >
                    {template.installed ? copy.installedBtn : installingTemplateId === template.id ? copy.installingBtn : copy.installBtn}
                  </Button>
                </div>
              </div>
            {/each}
          </div>
        </div>
      {:else if showingSubagents}
        <div class="channel-form">
          <div class="channel-card">
            <div class="channel-card-header">
              <div>
                <h2 class="channel-card-title">{copy.builtInTitle}</h2>
                <p class="channel-card-desc">{copy.builtInDesc}</p>
              </div>
              <a class="channel-hero-link text-primary hover:underline" href="/settings/ai/routing">{copy.configureRoute}</a>
            </div>
            <div class="channel-card-body">
              <div class="channel-hint" style="background: var(--muted); padding: 0.75rem; border-radius: 6px;">
                {copy.explicitRoute}
                <strong class="text-foreground">{subagentConfiguredModelLabel || copy.notSet}</strong>
                {copy.routeExplanation}
              </div>
              <div class="channel-field-row">
                {#each ["haiku", "sonnet", "opus", "thinking"] as level}
                  <div class="channel-card" style="padding: 1rem;">
                    <div class="channel-sidebar-btn-id" style="font-weight: 600; text-transform: uppercase;">{level}</div>
                    <div class="channel-sidebar-btn-name" style="margin-top: 0.25rem;">{subagentModelLevels[level]?.label || copy.notConfigured}</div>
                  </div>
                {/each}
              </div>
            </div>
          </div>

          <div class="channel-field-row" style="grid-template-columns: 1fr 1fr;">
            {#each builtInSubagents as subagent (subagent.name)}
              <div class="channel-card">
                <div class="channel-card-header">
                  <div>
                    <h3 class="channel-card-title">{subagent.name}</h3>
                    <p class="channel-card-desc">{subagent.description}</p>
                  </div>
                </div>
                <div class="channel-card-body">
                  <div class="channel-field">
                    <span class="channel-sidebar-btn-id">{copy.tools}</span>
                    <span class="channel-sidebar-btn-name">{subagent.tools.length > 0 ? subagent.tools.join(", ") : "default"}</span>
                  </div>
                  <div class="channel-field">
                    <span class="channel-sidebar-btn-id">{copy.modelLevel}</span>
                    <span class="channel-sidebar-btn-name">{subagent.modelLevel || subagent.modelHint || "none"}</span>
                  </div>
                  <div class="channel-field">
                    <span class="channel-sidebar-btn-id">{copy.effectiveModel}</span>
                    <span class="channel-sidebar-btn-name">{subagent.activeModelLabel || subagent.activeModelKey || copy.notResolved}</span>
                  </div>
                  <div class="channel-field">
                    <span class="channel-sidebar-btn-id">{copy.source}</span>
                    <span class="channel-sidebar-btn-name">{subagent.activeModelSource || copy.unknown}</span>
                  </div>
                </div>
              </div>
            {/each}
          </div>
        </div>
      {:else if selectedAgent}
        <form id="agent-form" class="channel-form" onsubmit={(event) => { event.preventDefault(); void save(); }}>
          <div class="channel-card">
            <div class="channel-card-header">
              <div>
                <h2 class="channel-card-title">{copy.metaTitle}</h2>
                <p class="channel-card-desc">{copy.metaDesc}</p>
              </div>
              <Button
                variant="destructive"
                size="sm"
                type="button"
                onclick={() => removeAgent(selectedAgent.id)}
              >
                {copy.removeBtn}
              </Button>
            </div>
            <div class="channel-card-body">
              <div class="channel-field-row">
                <div class="channel-field">
                  <Label for="agent-id">{copy.idLabel}</Label>
                  <Input
                    id="agent-id"
                    bind:value={selectedAgent.id}
                    placeholder="moli"
                    disabled={!selectedAgent.isNew}
                  />
                </div>
                <div class="channel-field">
                  <Label for="agent-name">{copy.nameLabel}</Label>
                  <Input
                    id="agent-name"
                    bind:value={selectedAgent.name}
                    placeholder="Moli"
                  />
                </div>
              </div>

              {#if !selectedAgent.isNew}
                <p class="channel-hint">{copy.idLocked}</p>
              {/if}

              <div class="channel-field">
                <Label for="agent-desc">{copy.descLabel}</Label>
                <Textarea
                  id="agent-desc"
                  class="channel-textarea"
                  style="min-height: 80px;"
                  bind:value={selectedAgent.description}
                  placeholder={copy.descPlaceholder}
                />
              </div>

              <div class="channel-toggle-row">
                <div class="channel-toggle-label">
                  <Label for="agent-enabled">{copy.enableLabel}</Label>
                  <p>{copy.enableDesc}</p>
                </div>
                <IosSwitch id="agent-enabled" bind:checked={selectedAgent.enabled} />
              </div>
            </div>
          </div>

          <div class="channel-card">
            <div class="channel-card-header">
              <div>
                <h2 class="channel-card-title">{copy.modelTitle}</h2>
                <p class="channel-card-desc">{copy.modelDesc}</p>
              </div>
              <a class="channel-hero-link text-primary hover:underline" href="/settings/ai/routing">{copy.modelRouteLink}</a>
            </div>
            <div class="channel-card-body">
              <div class="channel-field-row">
                {#each modelRouteFields as field (field.route)}
                  <div class="channel-field">
                    <Label for={`agent-model-${field.route}`}>{field.label}</Label>
                    <NativeSelect
                      id={`agent-model-${field.route}`}
                      value={selectedAgent.modelRouting[modelRoutingKey(field.route)]}
                      onchange={(e) => setAgentModelRoute(field.route, (e.currentTarget as HTMLSelectElement).value)}
                    >
                      <NativeSelectOption value="">{copy.modelGlobalOption}</NativeSelectOption>
                      {#each modelRouteOption(field.route) as option (option.key)}
                        <NativeSelectOption value={option.key}>{option.label}</NativeSelectOption>
                      {/each}
                    </NativeSelect>
                  </div>
                {/each}
              </div>
            </div>
          </div>

          <div class="channel-card">
            <div class="channel-card-header">
              <div>
                <h2 class="channel-card-title">{copy.overridesTitle}</h2>
                <p class="channel-card-desc">{copy.overridesDesc}</p>
              </div>
            </div>
            <div class="channel-accordion">
              {#each fileNames as fileName}
                <details class="channel-accordion-item">
                  <summary>{fileName}</summary>
                  <div class="channel-accordion-body">
                    <Textarea
                      id={`agent-${fileName}`}
                      class="channel-textarea font-mono"
                      style="min-height: 180px;"
                      bind:value={selectedFiles[fileName]}
                      placeholder={`Edit ${fileName} here`}
                    />
                  </div>
                </details>
              {/each}
            </div>
          </div>
        </form>
      {/if}
    </div>
  {/if}
</div>

{#if selectedAgent && !showingSubagents && !showingTemplates}
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
      <Button variant="outline" size="sm" onclick={loadSettings} disabled={loading || saving}>
        {copy.resetBtn}
      </Button>
      <button type="submit" form="agent-form" class="settings-footbar-btn" disabled={loading || saving}>
        {saving ? copy.saving : copy.saveBtn}
      </button>
    </div>
  </footer>
{/if}
