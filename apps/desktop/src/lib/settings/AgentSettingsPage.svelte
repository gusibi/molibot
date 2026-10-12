<script lang="ts">
  import AgentBindingsSection from "./AgentBindingsSection.svelte";
  import { projectAgentBindings } from "./agentBindings";
  import AgentMemorySection from "./AgentMemorySection.svelte";
  import ArrowLeft from "reicon-svelte/icons/ArrowLeft";
  import User from "reicon-svelte/icons/User";
  import Cpu from "reicon-svelte/icons/Cpu";
  import Gear from "reicon-svelte/icons/Gear";
  import Chat from "reicon-svelte/icons/Chat";
  import Book from "reicon-svelte/icons/Book";
  import Wrench from "reicon-svelte/icons/Puzzle";
  import Button from "../components/ui/Button.svelte";
  import AgentAvatar from "../components/ui/AgentAvatar.svelte";
  import SelectControl from "../components/ui/SelectControl.svelte";
  import IosSwitch from "../components/ui/IosSwitch.svelte";
  import SettingRow from "../components/ui/SettingRow.svelte";
  import { session } from "../stores/session.svelte";
  import { agentsStore, updateAgentEdit, saveAgentEditor, cancelAgentEdit } from "../stores/agents.svelte";
  import { modelsStore, loadModels } from "../stores/models.svelte";
  import { uploadDesktopAgentAvatar, loadDesktopAgentSkills, loadDesktopAgentBindings, type DesktopAgentSkillOption, type DesktopAgentBinding } from "../api";
  import { AGENT_TOOL_GROUPS } from "@molibot/shared/agentCapabilities";
  import { modelOptionCopy } from "../presentation";
  import avatarPresets from "virtual:agent-avatars";
  let { onClose = cancelAgentEdit, backLabel }: { onClose?: () => void; backLabel?: string } = $props();
  const zh = $derived(session.locale === "zh-CN");
  let section = $state("basic");
  let bodyElement = $state<HTMLDivElement>();
  $effect(() => { section; bodyElement?.scrollTo({ top: 0 }); });
  let profileFile = $state("AGENTS.md");
  let avatarPresetsVisible = $state(false);
  let avatarFile = $state<File | null>(null);
  let avatarPreview = $state("");
  let avatarUploading = $state(false);
  let fileInput = $state<HTMLInputElement>();
  const profileOptions = $derived([
    { value: "AGENTS.md", label: zh ? "协作规则 · AGENTS.md" : "Collaboration rules · AGENTS.md", hint: zh ? "定义职责、工作流程与行动边界。共享规则在全局工作区文件中维护。" : "Define responsibilities, workflows and action boundaries. Maintain shared rules in global workspace files." },
    { value: "IDENTITY.md", label: zh ? "身份 · IDENTITY.md" : "Identity · IDENTITY.md", hint: zh ? "定义 Agent 是谁、擅长什么；名称和简介是界面展示信息。" : "Define who the Agent is and its expertise. Name and description are display metadata." },
    { value: "SOUL.md", label: zh ? "表达风格 · SOUL.md" : "Voice and tone · SOUL.md", hint: zh ? "定义语气、价值取向和交流风格。" : "Define tone, values and communication style." },
    { value: "SONG.md", label: zh ? "补充文本 · SONG.md" : "Supplementary text · SONG.md", hint: zh ? "可选补充提示文本；不是知识库或记忆记录。" : "Optional supplementary instructions; this is not a knowledge base or memory record." }
  ]);
  const profileHint = $derived(profileOptions.find(item => item.value === profileFile)?.hint ?? "");
  $effect(() => {
    if (!avatarFile) { avatarPreview = ""; return; }
    const url = URL.createObjectURL(avatarFile);
    avatarPreview = url;
    return () => URL.revokeObjectURL(url);
  });
  function chooseAvatar(src: string) {
    avatarFile = null;
    updateAgentEdit(d => ({ ...d, avatar: src }));
  }
  function chooseUpload(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0]; input.value = "";
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      session.error = zh ? "请选择不超过 5 MB 的 PNG、JPEG 或 WebP 图片。" : "Choose a PNG, JPEG or WebP image up to 5 MB.";
      return;
    }
    session.error = ""; avatarFile = file;
  }
  let sharedSkillsVisible = $state(false);
  let skills = $state<DesktopAgentSkillOption[]>([]);
  let channels = $state<DesktopAgentBinding[]>([]);
  let bindings = $state<Record<string, boolean>>({});
  let resourceError = $state("");
  let resourceLoading = $state(true);
  let resourceRetry = $state(0);
  const draft = $derived(agentsStore.agentEdit!);
  const resourceAgentId = $derived(draft.id);
  const sections = $derived([
    { id: "basic", label: zh ? "基础信息" : "Basic information", icon: User },
    { id: "role", label: zh ? "角色与规则" : "Role and rules", icon: Book },
    { id: "models", label: zh ? "模型与能力" : "Models and capabilities", icon: Cpu },
    { id: "tools", label: zh ? "技能与工具" : "Skills and tools", icon: Wrench },
    { id: "memory", label: zh ? "记忆与知识" : "Memory and knowledge", icon: Book },
    { id: "channels", label: zh ? "绑定的机器人" : "Bound bots", icon: Chat },
    { id: "advanced", label: zh ? "高级设置" : "Advanced settings", icon: Gear }
  ]);
  $effect(() => { resourceAgentId; bindings = {}; });
  $effect(() => {
    resourceRetry;
    if (!session.serviceReady) return;
    const endpoint = session.endpoint;
    const id = resourceAgentId;
    if (!endpoint) return;
    let active = true;
    resourceLoading = true;
    Promise.all([loadDesktopAgentSkills(endpoint, id), loadDesktopAgentBindings(endpoint)]).then(([catalog, summary]) => {
      if (!active) return;
      skills = catalog; channels = summary; resourceError = "";
    }).catch(error => { if (active) resourceError = String(error); }).finally(() => { if (active) resourceLoading = false; });
    return () => { active = false; };
  });
  $effect(() => {
    if (session.serviceReady && session.endpoint && session.endpoint !== modelsStore.loadedEndpoint) void loadModels(session.endpoint);
  });
  function setFile(name: string, value: string) { updateAgentEdit(d => ({ ...d, files: { ...d.files, [name]: value } })); }
  function toggleList(field: "disabledTools" | "disabledSkillPaths", values: readonly string[], enabled: boolean) {
    updateAgentEdit(d => ({ ...d, [field]: enabled ? (d[field] ?? []).filter(value => !values.includes(value)) : [...new Set([...(d[field] ?? []), ...values])] }));
  }
  async function save() {
    if (!session.endpoint || avatarUploading || agentsStore.saving) return;
    const changes = projectAgentBindings(channels, draft.id.trim(), bindings).changes;
    if (avatarFile) {
      const editingDraft = agentsStore.agentEdit;
      avatarUploading = true;
      try {
        const avatar = await uploadDesktopAgentAvatar(session.endpoint, draft.id.trim(), avatarFile);
        if (agentsStore.agentEdit !== editingDraft) return;
        updateAgentEdit(d => ({ ...d, avatar }));
        avatarFile = null;
      } catch (error) { session.error = String(error); return; }
      finally { avatarUploading = false; }
    }
    await saveAgentEditor(changes);
    if (!agentsStore.agentEdit) onClose();
  }
</script>

<div class="agent-settings-shell">
<div class="agent-settings-layout">
<aside class="settings-sidebar agent-settings-sidebar">
  <button class="settings-back" type="button" disabled={agentsStore.saving || avatarUploading} onclick={onClose}><ArrowLeft size={16} /><span>{backLabel ?? session.text.back}</span></button>
  <nav class="settings-nav-list" aria-label={zh ? "Agent 设置分类" : "Agent settings categories"}>
    {#each sections as item (item.id)}
      {@const Icon = item.icon}
      <button type="button" class="settings-nav" class:active={section === item.id} aria-current={section === item.id ? "page" : undefined} onclick={() => section = item.id}><Icon size={18} aria-hidden="true" /><span>{item.label}</span></button>
    {/each}
  </nav>
</aside>
<form class="agent-settings-page" onsubmit={event => { event.preventDefault(); void save(); }}>
  <header class="agent-settings-head">
    <AgentAvatar name={draft.name || "Agent"} src={avatarPreview || draft.avatar || ""} />
    <div class="agent-settings-heading">
      <p class="settings-eyebrow">{zh ? "Agent 设置" : "Agent settings"} / {sections.find(item => item.id === section)?.label}</p>
      <h1>{draft.isNew ? (zh ? "创建 Agent" : "Create Agent") : draft.name || draft.id}</h1>
    </div>
  </header>
  <div class="agent-settings-body" bind:this={bodyElement} inert={agentsStore.saving || avatarUploading}>
    <div class="agent-settings-fields">
    {#if resourceError}<p class="agent-settings-error" role="alert">{resourceError}</p><Button onclick={() => resourceRetry++}>{zh ? "重新加载" : "Reload"}</Button>{/if}
    {#if session.error}<p class="agent-settings-error" role="alert">{session.error}</p>{/if}
    {#if section === "basic"}
      <div class="agent-settings-avatar">
        <AgentAvatar name={draft.name || "Agent"} src={avatarPreview || draft.avatar || ""} />
        <div class="agent-avatar-actions">
          <Button onclick={() => fileInput?.click()}>{zh ? "上传本地头像" : "Upload avatar"}</Button>
          <Button aria-expanded={avatarPresetsVisible} onclick={() => avatarPresetsVisible = !avatarPresetsVisible}>{zh ? "选择内置头像" : "Choose a built-in avatar"}</Button>
          <Button onclick={() => chooseAvatar("")}>{zh ? "恢复默认" : "Use default"}</Button>
          <p class="agent-settings-hint">{avatarFile ? avatarFile.name : (zh ? "PNG、JPEG、WebP，最大 5 MB。保存时写入 Agent workspace，无需远程上传。" : "PNG, JPEG or WebP, up to 5 MB. Saved to the Agent workspace locally.")}</p>
        </div>
        <input class="agent-avatar-file" bind:this={fileInput} type="file" accept="image/png,image/jpeg,image/webp" aria-label={zh ? "选择本地头像" : "Choose local avatar"} onchange={chooseUpload} />
      </div>
      {#if avatarPresetsVisible}
      <fieldset class="agent-avatar-presets"><legend>{zh ? "内置头像" : "Built-in avatars"}</legend><div class="agent-avatar-grid">
        {#each avatarPresets as preset}
          <Button variant="icon" class="agent-avatar-choice" ariaLabel={zh ? preset.zh : preset.en} aria-pressed={!avatarFile && draft.avatar === preset.src} onclick={() => chooseAvatar(preset.src)}><img src={preset.src} alt="" width="48" height="48" /></Button>
        {/each}
      </div></fieldset>
      {/if}
      <label class="settings-field"><span>{session.text.agentName}</span><input value={draft.name} oninput={event => updateAgentEdit(d => ({ ...d, name: event.currentTarget.value }))} /></label>
      <p class="agent-settings-hint">{zh ? "名称与简介用于界面展示；行为设定请在“角色与规则”中编辑。" : "Name and description appear in the interface. Configure behavior under Role and rules."}</p>
      <label class="settings-field"><span>{session.text.agentDescription}</span><textarea rows="3" value={draft.description} oninput={event => updateAgentEdit(d => ({ ...d, description: event.currentTarget.value }))}></textarea></label>
    {:else if section === "role"}
      <h2>{zh ? "角色与规则" : "Role and rules"}</h2>
      {#if draft.id === "default"}<p class="agent-settings-hint">{zh ? "Momo 的 AGENTS.md 同时是所有 Agent 的共享规则；其它角色文件作为未单独配置时的默认值。技能、记忆和模型选择仍按当前 Agent 保存。" : "Momo’s AGENTS.md supplies shared rules for every Agent. Other role files provide defaults where no specific file is configured. Skills, memories and model selections remain scoped to this Agent."}</p>{/if}
      <p class="agent-settings-hint">{zh ? "这些 Markdown 文件参与当前 Agent 的系统提示词。切换文件保留草稿，点击保存后生效。" : "These Markdown files contribute to this Agent’s system prompt. Switching files keeps drafts; save to apply changes."}</p>
      <label class="settings-field"><span>{zh ? "配置文件" : "Configuration file"}</span><SelectControl value={profileFile} options={profileOptions} ariaLabel={zh ? "配置文件" : "Configuration file"} onChange={value => profileFile = value} /></label>
      <p class="agent-settings-hint">{profileHint}</p>
      <label class="settings-field"><span>{profileFile}</span><textarea rows="16" spellcheck="false" value={draft.files[profileFile] ?? ""} oninput={event => setFile(profileFile, event.currentTarget.value)}></textarea></label>
    {:else if section === "models"}
      <h2>{sections[2].label}</h2><p class="agent-settings-hint">{zh ? "未单独选择时使用通用模型配置。Provider 和模型资源在通用设置中管理。" : "Follow shared model settings unless overridden. Manage providers and model resources in general settings."}</p>
      {#each [{ key: "textModelKey", route: "text", label: session.text.agentTextModel }, { key: "sttModelKey", route: "stt", label: session.text.agentSttModel }] as field}
        <label class="settings-field"><span>{field.label}</span><SelectControl value={draft.modelRouting[field.key as "textModelKey" | "sttModelKey"]} ariaLabel={field.label} options={[{ value: "", label: session.text.agentFollowGlobal }, ...(modelsStore.modelStates[field.route as "text" | "stt"]?.options ?? []).map(option => ({ value: option.key, label: modelOptionCopy(option).name }))]} onChange={value => updateAgentEdit(d => ({ ...d, modelRouting: { ...d.modelRouting, [field.key]: value } }))} /></label>
      {/each}
    {:else if section === "tools"}
      <h2>{zh ? "工具能力" : "Tool capabilities"}</h2><p class="agent-settings-hint">{zh ? "开关控制这个 Agent 的直接工具调用。命令执行仍可访问网络和文件；隔离限制由通用执行权限管理。" : "Switches control this Agent’s direct tool calls. Commands can still access files and networks; isolation is managed by shared execution permissions."}</p>
      {#each AGENT_TOOL_GROUPS as group}
        <SettingRow title={zh ? group.zh : group.en}><IosSwitch checked={group.tools.every(tool => !(draft.disabledTools ?? []).includes(tool))} ariaLabel={zh ? group.zh : group.en} onCheckedChange={enabled => toggleList("disabledTools", group.tools, enabled)} /></SettingRow>
      {/each}
      <p class="agent-settings-hint">{zh ? "以下配置只影响当前 Agent。专属技能来自这个 Agent 的 skills 目录；共享技能由全局技能中心提供，可在这里单独停用。" : "These settings affect this Agent only. Dedicated skills come from its skills directory; inherited skills come from the global skill center and can be disabled here for this Agent."}</p>
      {#if resourceLoading}<p>{session.text.loading}</p>{:else if resourceError}<p role="alert">{resourceError}</p>{:else}
        {#each ["bot", "global"] as scope}
          {@const scopedSkills = skills.filter(skill => skill.scope === scope)}
          <h2>{scope === "bot" ? (zh ? "Agent 专属技能" : "Agent workspace skills") : (zh ? "继承的共享技能" : "Inherited shared skills")} · {scopedSkills.length}</h2>
          {#if scope === "global"}<Button aria-expanded={sharedSkillsVisible} onclick={() => sharedSkillsVisible = !sharedSkillsVisible}>{sharedSkillsVisible ? (zh ? "收起共享技能" : "Hide shared skills") : (zh ? "查看共享技能" : "View shared skills")}</Button>{/if}
          {#if scope === "bot" || sharedSkillsVisible}
          {#each scopedSkills as skill (skill.path)}<SettingRow title={skill.name} description={skill.description}><IosSwitch checked={!(draft.disabledSkillPaths ?? []).includes(skill.path)} ariaLabel={skill.name} onCheckedChange={enabled => toggleList("disabledSkillPaths", [skill.path], enabled)} /></SettingRow>{:else}<p class="agent-settings-hint">{zh ? "此范围暂无可用技能。" : "No available skills in this scope."}</p>{/each}
          {/if}
        {/each}
      {/if}
    {:else if section === "memory"}
      <h2>{sections[4].label}</h2><SettingRow title={zh ? "使用共享个人记忆" : "Use shared owner memory"} description={zh ? "关闭后保留这个 Agent 自己的记忆，其它 Agent 不受影响。" : "When off, this Agent keeps its own memory. Other Agents are unaffected."}><IosSwitch checked={draft.shareOwnerMemory !== false} ariaLabel={zh ? "使用共享个人记忆" : "Use shared owner memory"} onCheckedChange={shareOwnerMemory => updateAgentEdit(d => ({ ...d, shareOwnerMemory }))} /></SettingRow>
      <AgentMemorySection agentId={draft.id} isNew={draft.isNew} />
    {:else if section === "channels"}
      {#if resourceLoading}<p>{session.text.loading}</p>{:else if resourceError}<p role="alert">{resourceError}</p>{:else}
        <AgentBindingsSection items={channels} agentId={draft.id.trim()} agentName={draft.name || draft.id} agents={agentsStore.agents?.items ?? []} {zh} bind:bindings />
      {/if}
    {:else}
      <h2>{sections[6].label}</h2>
      <label class="settings-field"><span>{session.text.agentId}</span><input value={draft.id} disabled={!draft.isNew} pattern="[a-zA-Z0-9._-]+" required oninput={event => updateAgentEdit(d => ({ ...d, id: event.currentTarget.value }))} /></label>
      <label class="settings-field"><span>{session.text.agentPermissionMode}</span><SelectControl value={draft.permissionMode ?? "inherit"} ariaLabel={session.text.agentPermissionMode} options={[{ value: "inherit", label: session.text.agentPermissionModeInherit }, { value: "plan", label: session.text.permissionModePlan }, { value: "manual", label: session.text.permissionModeManual }, { value: "accept_edits", label: session.text.permissionModeAcceptEdits }, { value: "auto", label: session.text.permissionModeAuto }]} onChange={value => updateAgentEdit(d => ({ ...d, permissionMode: value === "inherit" ? null : value as "plan" | "manual" | "accept_edits" | "auto" }))} /></label>
      <SettingRow title={session.text.agentEnabled}><IosSwitch checked={draft.enabled} ariaLabel={session.text.agentEnabled} onCheckedChange={enabled => updateAgentEdit(d => ({ ...d, enabled }))} /></SettingRow>
      <SettingRow title={zh ? "在对话侧栏显示" : "Show in chat sidebar"}><IosSwitch checked={draft.id === agentsStore.agents?.defaultAgentId || draft.visible !== false} disabled={draft.id === agentsStore.agents?.defaultAgentId} ariaLabel={zh ? "在对话侧栏显示" : "Show in chat sidebar"} onCheckedChange={visible => updateAgentEdit(d => ({ ...d, visible }))} /></SettingRow>
    {/if}
    </div>
  </div>
  <footer class="settings-footbar agent-settings-foot"><p class="settings-footbar-label">{zh ? "更改将在保存后生效" : "Changes apply after saving"}</p><Button disabled={agentsStore.saving || avatarUploading} onclick={onClose}>{session.text.cancel}</Button><Button variant="primary" type="submit" disabled={agentsStore.saving || avatarUploading || !session.serviceReady || !draft.id.trim()}>{agentsStore.saving || avatarUploading ? session.text.onboardingProviderSaving : draft.isNew ? (zh ? "创建" : "Create") : session.text.save}</Button></footer>
</form>

</div>
</div>
