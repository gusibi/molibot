<script lang="ts">
  import { onMount } from "svelte";
  import { Alert, AlertDescription } from "$lib/components/ui/alert";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { NativeSelect, NativeSelectOption } from "$lib/components/ui/native-select";
  import { IosSwitch } from "$lib/components/ui/ios-switch";
  import { Textarea } from "$lib/components/ui/textarea";
  import { locale } from "$lib/ui/i18n";

  interface AgentItem {
    id: string;
    name: string;
    enabled: boolean;
  }

  interface WebProfileForm {
    id: string;
    name: string;
    enabled: boolean;
    agentId: string;
    sandboxEnabled?: boolean;
    profileFiles: Record<string, string>;
    isNew: boolean;
  }

  const profileFileNames = ["BOT.md", "SOUL.md", "IDENTITY.md", "SONG.md"];

  const COPY = {
    "zh-CN": {
      eyebrow: "Web 运行环境",
      profilesCount: "个 Profile",
      title: "Web Profiles",
      desc: "配置 Web 运行时 Profile，关联 Agent，并直接编辑 Profile 级的 Markdown 覆盖文件。",
      loading: "正在加载 Web 设置...",
      profilesTitle: "Profiles",
      listDesc: "个已配置",
      addBtn: "添加",
      statusOn: "启用",
      statusOff: "禁用",
      configTitle: "Profile 配置",
      configDesc: "设置 Profile ID、显示名称、启用状态以及关联的 Agent。",
      removeBtn: "删除",
      idLabel: "Profile ID",
      nameLabel: "Profile 名称",
      idLocked: "创建后 Profile ID 将被锁定，以保持工作区路径和引用稳定。",
      enableLabel: "启用该 Profile 实例",
      enableDesc: "禁用的 Profile 将保留但无法在运行时选择。",
      sandboxLabel: "沙箱覆盖",
      sandboxDesc: "覆盖此 Profile 的全局沙箱设置。留空则继承全局设置。",
      forceOn: "强制开启",
      forceOff: "强制关闭",
      resetBtn: "重置",
      linkedAgentLabel: "关联 Agent",
      noAgentFallback: "无 Agent（仅使用全局兜底）",
      overridesTitle: "Profile Markdown 覆盖文件",
      overridesDesc: "文件将保存为包含元数据头部的真实 Markdown 文档。留空则删除覆盖文件。",
      editText: "在此编辑",
      noProfileSelected: "未选择 Profile",
      noProfileSelectedDesc: "创建一个 Profile 来配置 Web 运行时。",
      addProfileBtn: "添加 Profile",
      saving: "保存中...",
      savingMsg: "正在保存变更...",
      saveBtn: "保存 Web 设置",
      confirmDelete: "确认删除 Web Profile 吗？此操作无法撤销。",
      unsavedConfirm: "当前 Profile 有未保存变更。点击“确定”先保存并切换，点击“取消”留在当前 Profile。",
      failedLoad: "加载配置失败",
      failedSave: "保存 Web Profile 失败",
      failedSaveFiles: "保存配置文件失败",
      savedSuccess: "已保存 Profile："
    },
    "en-US": {
      eyebrow: "Web Runtime",
      profilesCount: "profiles",
      title: "Web Profiles",
      desc: "Configure web runtime profiles, link agents, and edit profile-level Markdown overrides.",
      loading: "Loading Web settings...",
      profilesTitle: "Profiles",
      listDesc: "configured",
      addBtn: "Add",
      statusOn: "On",
      statusOff: "Off",
      configTitle: "Profile Configuration",
      configDesc: "Profile ID, display name, enabled state, and linked agent.",
      removeBtn: "Remove",
      idLabel: "Profile ID",
      nameLabel: "Profile Name",
      idLocked: "Profile ID is locked after creation to keep workspace paths and references stable.",
      enableLabel: "Enable this profile instance",
      enableDesc: "Disabled profiles stay saved but are not selectable at runtime.",
      sandboxLabel: "Sandbox override",
      sandboxDesc: "Override the global sandbox setting for this profile. Leave unchecked to inherit.",
      forceOn: "Force ON",
      forceOff: "Force OFF",
      resetBtn: "Reset",
      linkedAgentLabel: "Linked Agent",
      noAgentFallback: "No agent (global fallback only)",
      overridesTitle: "Profile Markdown Overrides",
      overridesDesc: "Files are saved as real Markdown documents with metadata headers. Leave empty to remove the override.",
      editText: "Edit",
      noProfileSelected: "No profile selected",
      noProfileSelectedDesc: "Create a profile to configure the Web runtime.",
      addProfileBtn: "Add Profile",
      saving: "Saving...",
      savingMsg: "Saving changes...",
      saveBtn: "Save Web Settings",
      confirmDelete: "Delete web profile? This cannot be undone.",
      unsavedConfirm: "Current Profile has unsaved changes. Click 'OK' to save and switch, or 'Cancel' to stay on this Profile.",
      failedLoad: "Failed to load settings",
      failedSave: "Failed to save Web profiles",
      failedSaveFiles: "Failed to save profile files",
      savedSuccess: "Saved profile: "
    }
  } as const;

  let loading = true;
  let saving = false;
  let message = "";
  let error = "";

  let profiles: WebProfileForm[] = [];
  let agents: AgentItem[] = [];
  let selectedProfileId = "";
  let savedSnapshots: Record<string, string> = {};

  $: copy = COPY[$locale] ?? COPY["en-US"];

  function createProfileId(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return `web-${crypto.randomUUID().slice(0, 8)}`;
    }
    return `web-${Math.random().toString(36).slice(2, 10)}`;
  }

  function emptyProfileFiles(): Record<string, string> {
    return Object.fromEntries(profileFileNames.map((fileName) => [fileName, ""]));
  }

  function createEmptyProfile(): WebProfileForm {
    return {
      id: createProfileId(),
      name: "",
      enabled: true,
      agentId: "",
      profileFiles: emptyProfileFiles(),
      isNew: true
    };
  }

  function normalizeProfile(profile: WebProfileForm): WebProfileForm {
    return {
      ...profile,
      id: profile.id.trim(),
      name: profile.name.trim(),
      enabled: Boolean(profile.enabled),
      agentId: profile.agentId.trim(),
      profileFiles: Object.fromEntries(
        profileFileNames.map((fileName) => [fileName, String(profile.profileFiles[fileName] ?? "")])
      ),
      isNew: profile.isNew
    };
  }

  function profileSnapshot(profile: WebProfileForm): string {
    return JSON.stringify(normalizeProfile(profile));
  }

  async function loadProfileFiles(profileId: string): Promise<Record<string, string>> {
    if (!profileId) return emptyProfileFiles();
    const res = await fetch(
      `/api/settings/profile-files?scope=bot&channel=web&botId=${encodeURIComponent(profileId)}`
    );
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || `Failed to load profile files for ${profileId}`);
    return Object.assign(emptyProfileFiles(), data.files ?? {});
  }

  async function loadSettings(): Promise<void> {
    loading = true;
    error = "";
    message = "";
    try {
      const res = await fetch("/api/settings");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || copy.failedLoad);

      agents = Array.isArray(data.settings?.agents) ? data.settings.agents : [];
      const fromList = Array.isArray(data.settings?.channels?.web?.instances)
        ? data.settings.channels.web.instances
        : [];

      const mapped = fromList.length > 0
        ? fromList.map((profile: {
            id?: string;
            name?: string;
            enabled?: boolean;
            agentId?: string;
            sandboxEnabled?: boolean;
          }) => ({
            id: profile.id ?? createProfileId(),
            name: profile.name ?? "",
            enabled: profile.enabled ?? true,
            agentId: profile.agentId ?? "",
            sandboxEnabled: profile.sandboxEnabled,
            profileFiles: emptyProfileFiles(),
            isNew: false
          }))
        : [{
            id: "default",
            name: "Default Web",
            enabled: true,
            agentId: "",
            profileFiles: emptyProfileFiles(),
            isNew: false
          }];

      profiles = await Promise.all(
        mapped.map(async (profile) => ({
          ...profile,
          profileFiles: await loadProfileFiles(profile.id)
        }))
      );
      savedSnapshots = Object.fromEntries(
        profiles.map((profile) => [profile.id, profileSnapshot(profile)])
      );
      selectedProfileId = profiles[0]?.id ?? "";
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  async function ensureCurrentSavedBeforeSwitch(): Promise<boolean> {
    const current = profiles.find((profile) => profile.id === selectedProfileId);
    if (!current) return true;
    const baseline = savedSnapshots[current.id];
    const dirty = profileSnapshot(current) !== baseline;
    if (!dirty) return true;
    if (typeof window === "undefined") return false;
    const shouldSave = window.confirm(copy.unsavedConfirm);
    if (!shouldSave) return false;
    return save();
  }

  async function selectProfile(profileId: string): Promise<void> {
    if (profileId === selectedProfileId) return;
    const ok = await ensureCurrentSavedBeforeSwitch();
    if (!ok) return;
    selectedProfileId = profileId;
  }

  async function addProfile(): Promise<void> {
    const ok = await ensureCurrentSavedBeforeSwitch();
    if (!ok) return;
    const next = createEmptyProfile();
    profiles = [...profiles, next];
    savedSnapshots = {
      ...savedSnapshots,
      [next.id]: profileSnapshot(next)
    };
    selectedProfileId = next.id;
  }

  async function removeProfile(profileId: string): Promise<void> {
    const confirmed =
      typeof window === "undefined"
        ? true
        : window.confirm(copy.confirmDelete.replace("{profileId}", profileId));
    if (!confirmed) return;

    const target = profiles.find((profile) => profile.id === profileId);
    if (target && !target.isNew) {
      const res = await fetch("/api/settings/channel-instance", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: "web",
          id: profileId
        })
      });
      const data = await res.json();
      if (!data.ok) {
        error = data.error || `Failed to delete profile ${profileId}`;
        return;
      }
    }

    profiles = profiles.filter((profile) => profile.id !== profileId);
    savedSnapshots = Object.fromEntries(Object.entries(savedSnapshots).filter(([id]) => id !== profileId));
    if (profiles.length === 0) {
      const next = createEmptyProfile();
      profiles = [next];
      savedSnapshots = {
        ...savedSnapshots,
        [next.id]: profileSnapshot(next)
      };
    }
    selectedProfileId = profiles[0]?.id ?? "";
  }

  async function save(): Promise<boolean> {
    const selected = profiles.find((profile) => profile.id === selectedProfileId) ?? profiles[0];
    if (!selected) return false;

    saving = true;
    error = "";
    message = "";
    try {
      const normalized = normalizeProfile(selected);
      if (!normalized.id) throw new Error("Profile ID is required");

      const res = await fetch("/api/settings/channel-instance", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: "web",
          previousId: selected.isNew ? "" : selected.id,
          instance: {
            id: normalized.id,
            name: normalized.name,
            enabled: normalized.enabled,
            agentId: normalized.agentId,
            sandboxEnabled: normalized.sandboxEnabled,
            credentials: {},
            allowedChatIds: []
          }
        })
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || copy.failedSave);

      const fileRes = await fetch("/api/settings/profile-files", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: "bot",
          channel: "web",
          botId: normalized.id,
          files: normalized.profileFiles
        })
      });
      const fileData = await fileRes.json();
      if (!fileData.ok) throw new Error(fileData.error || copy.failedSaveFiles);

      profiles = profiles.map((profile) => {
        if (profile.id !== selected.id) return profile;
        return {
          ...normalized,
          isNew: false
        };
      });
      if (selected.id !== normalized.id) {
        selectedProfileId = normalized.id;
      }
      savedSnapshots = {
        ...savedSnapshots,
        [normalized.id]: profileSnapshot({ ...normalized, isNew: false })
      };

      message = `${copy.savedSuccess}${normalized.name || normalized.id}`;
      return true;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      return false;
    } finally {
      saving = false;
    }
  }

  $: selectedProfile = profiles.find((profile) => profile.id === selectedProfileId) ?? profiles[0];
  $: selectedProfileDirty = selectedProfile
    ? profileSnapshot(selectedProfile) !== (savedSnapshots[selectedProfile.id] ?? "")
    : false;

  onMount(loadSettings);
</script>

<div class="channel-page">
  <header class="channel-hero">
    <span class="channel-badge">{copy.eyebrow}</span>
    <span class="channel-badge">{profiles.length} {copy.profilesCount}</span>
    <h1 class="channel-hero-title">{copy.title}</h1>
    <p class="channel-hero-desc">
      {copy.desc}
    </p>
  </header>

  {#if loading}
    <div class="channel-loading">{copy.loading}</div>
  {:else}
    <div class="channel-master-detail">
      <div class="channel-card">
        <div class="channel-card-header">
          <div>
            <h2 class="channel-card-title">{copy.profilesTitle}</h2>
            <p class="channel-card-desc">{profiles.length} {copy.listDesc}</p>
          </div>
          <Button variant="outline" size="sm" type="button" onclick={addProfile}>
            {copy.addBtn}
          </Button>
        </div>
        <div class="channel-card-body">
          {#each profiles as profile (profile.id)}
            <button
              class="channel-sidebar-btn {selectedProfile?.id === profile.id ? 'channel-sidebar-btn--active' : ''}"
              type="button"
              onclick={() => selectProfile(profile.id)}
            >
              <span>
                <span class="channel-sidebar-btn-name">{profile.name || profile.id}</span>
                <span class="channel-sidebar-btn-id">{profile.id}</span>
              </span>
              <span class="channel-sidebar-badge {profile.enabled ? 'channel-sidebar-badge--on' : ''}">
                {profile.enabled ? copy.statusOn : copy.statusOff}
              </span>
            </button>
          {/each}
        </div>
      </div>

      {#if selectedProfile}
        <form id="channel-form" class="channel-form" onsubmit={(event) => { event.preventDefault(); void save(); }}>
          <div class="channel-card">
            <div class="channel-card-header">
              <div>
                <h2 class="channel-card-title">{copy.configTitle}</h2>
                <p class="channel-card-desc">
                  {copy.configDesc}
                </p>
              </div>
              <Button
                variant="destructive"
                size="sm"
                type="button"
                onclick={() => removeProfile(selectedProfile.id)}
              >
                {copy.removeBtn}
              </Button>
            </div>
            <div class="channel-card-body">
              <div class="channel-field-row">
                <div class="channel-field">
                  <Label for="web-profile-id">{copy.idLabel}</Label>
                  <Input
                    id="web-profile-id"
                    bind:value={selectedProfile.id}
                    placeholder="marketing-web"
                    disabled={!selectedProfile.isNew}
                  />
                </div>
                <div class="channel-field">
                  <Label for="web-profile-name">{copy.nameLabel}</Label>
                  <Input
                    id="web-profile-name"
                    bind:value={selectedProfile.name}
                    placeholder="Marketing Web"
                  />
                </div>
              </div>

              {#if !selectedProfile.isNew}
                <p class="channel-hint">
                  {copy.idLocked}
                </p>
              {/if}

              <div class="channel-toggle-row">
                <div class="channel-toggle-label">
                  <Label for="web-profile-enabled">{copy.enableLabel}</Label>
                  <p>{copy.enableDesc}</p>
                </div>
                <IosSwitch id="web-profile-enabled" bind:checked={selectedProfile.enabled} />
              </div>

              <div class="channel-toggle-row">
                <div class="channel-toggle-label">
                  <Label for="web-profile-sandbox">{copy.sandboxLabel}</Label>
                  <p>{copy.sandboxDesc}</p>
                </div>
                <div class="channel-toggle-controls">
                  {#if selectedProfile.sandboxEnabled !== undefined}
                    <Badge variant={selectedProfile.sandboxEnabled ? "secondary" : "destructive"}>
                      {selectedProfile.sandboxEnabled ? copy.forceOn : copy.forceOff}
                    </Badge>
                  {/if}
                  <IosSwitch
                    id="web-profile-sandbox"
                    checked={selectedProfile.sandboxEnabled === true}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        selectedProfile.sandboxEnabled = true;
                      } else if (selectedProfile.sandboxEnabled === true) {
                        selectedProfile.sandboxEnabled = false;
                      } else {
                        selectedProfile.sandboxEnabled = undefined;
                      }
                    }}
                  />
                  {#if selectedProfile.sandboxEnabled !== undefined}
                    <Button variant="ghost" size="sm" type="button" onclick={() => { selectedProfile.sandboxEnabled = undefined; }}>
                      {copy.resetBtn}
                    </Button>
                  {/if}
                </div>
              </div>

              <div class="channel-field">
                <Label for="web-profile-agent">{copy.linkedAgentLabel}</Label>
                <NativeSelect id="web-profile-agent" bind:value={selectedProfile.agentId}>
                  <NativeSelectOption value="">{copy.noAgentFallback}</NativeSelectOption>
                  {#each agents.filter((agent) => agent.enabled) as agent (agent.id)}
                    <NativeSelectOption value={agent.id}>{agent.name || agent.id}</NativeSelectOption>
                  {/each}
                </NativeSelect>
              </div>
            </div>
          </div>

          <div class="channel-card">
            <div class="channel-card-header">
              <div>
                <h2 class="channel-card-title">{copy.overridesTitle}</h2>
                <p class="channel-card-desc">
                  {copy.overridesDesc}
                </p>
              </div>
            </div>
            <div class="channel-accordion">
              {#each profileFileNames as fileName}
                <details class="channel-accordion-item">
                  <summary>{fileName}</summary>
                  <div class="channel-accordion-body">
                    <Textarea
                      id={`web-profile-${fileName}`}
                      class="channel-textarea"
                      bind:value={selectedProfile.profileFiles[fileName]}
                      placeholder={`${copy.editText} ${fileName}`}
                    />
                  </div>
                </details>
              {/each}
            </div>
          </div>
        </form>
      {:else}
        <div class="channel-card">
          <div class="channel-card-header">
            <div>
              <h2 class="channel-card-title">{copy.noProfileSelected}</h2>
              <p class="channel-card-desc">{copy.noProfileSelectedDesc}</p>
            </div>
          </div>
          <Button variant="outline" type="button" onclick={addProfile}>
            {copy.addProfileBtn}
          </Button>
        </div>
      {/if}
    </div>
  {/if}
</div>

<footer class="settings-footbar">
  <div class="settings-footbar-status">
    {#if saving}
      <span class="settings-footbar-saving">
        <span class="settings-footbar-pulse"></span>
        {copy.saving}
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
    <button type="submit" form="channel-form" class="settings-footbar-btn" disabled={loading || saving}>
      {saving ? copy.saving : copy.saveBtn}
    </button>
  </div>
</footer>
