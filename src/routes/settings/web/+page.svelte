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

  let loading = true;
  let saving = false;
  let message = "";
  let error = "";

  let profiles: WebProfileForm[] = [];
  let agents: AgentItem[] = [];
  let selectedProfileId = "";
  let savedSnapshots: Record<string, string> = {};

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
      if (!data.ok) throw new Error(data.error || "Failed to load settings");

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
    const shouldSave = window.confirm("当前 Profile 有未保存变更。点击“确定”先保存并切换，点击“取消”留在当前 Profile。");
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
        : window.confirm(`Delete web profile "${profileId}"? This cannot be undone.`);
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
      if (!data.ok) throw new Error(data.error || "Failed to save Web profiles");

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
      if (!fileData.ok) throw new Error(fileData.error || `Failed to save profile files for ${normalized.id}`);

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

      message = `Saved profile: ${normalized.name || normalized.id}`;
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
    <span class="channel-badge">Web Runtime</span>
    <span class="channel-badge">{profiles.length} profiles</span>
    <h1 class="channel-hero-title">Web Profiles</h1>
    <p class="channel-hero-desc">
      Configure web runtime profiles, link agents, and edit profile-level Markdown overrides.
    </p>
  </header>

  {#if loading}
    <div class="channel-loading">Loading Web settings...</div>
  {:else}
    <div class="channel-master-detail">
      <div class="channel-card">
        <div class="channel-card-header">
          <div>
            <h2 class="channel-card-title">Profiles</h2>
            <p class="channel-card-desc">{profiles.length} configured</p>
          </div>
          <Button variant="outline" size="sm" type="button" onclick={addProfile}>
            Add
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
                {profile.enabled ? "On" : "Off"}
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
                <h2 class="channel-card-title">Profile Configuration</h2>
                <p class="channel-card-desc">
                  Profile ID, display name, enabled state, and linked agent.
                </p>
              </div>
              <Button
                variant="destructive"
                size="sm"
                type="button"
                onclick={() => removeProfile(selectedProfile.id)}
              >
                Remove
              </Button>
            </div>
            <div class="channel-card-body">
              <div class="channel-field-row">
                <div class="channel-field">
                  <Label for="web-profile-id">Profile ID</Label>
                  <Input
                    id="web-profile-id"
                    bind:value={selectedProfile.id}
                    placeholder="marketing-web"
                    disabled={!selectedProfile.isNew}
                  />
                </div>
                <div class="channel-field">
                  <Label for="web-profile-name">Profile Name</Label>
                  <Input
                    id="web-profile-name"
                    bind:value={selectedProfile.name}
                    placeholder="Marketing Web"
                  />
                </div>
              </div>

              {#if !selectedProfile.isNew}
                <p class="channel-hint">
                  Profile ID is locked after creation to keep workspace paths and references stable.
                </p>
              {/if}

              <div class="channel-toggle-row">
                <div class="channel-toggle-label">
                  <Label for="web-profile-enabled">Enable this profile instance</Label>
                  <p>Disabled profiles stay saved but are not selectable at runtime.</p>
                </div>
                <IosSwitch id="web-profile-enabled" bind:checked={selectedProfile.enabled} />
              </div>

              <div class="channel-toggle-row">
                <div class="channel-toggle-label">
                  <Label for="web-profile-sandbox">Sandbox override</Label>
                  <p>Override the global sandbox setting for this profile. Leave unchecked to inherit.</p>
                </div>
                <div class="channel-toggle-controls">
                  {#if selectedProfile.sandboxEnabled !== undefined}
                    <Badge variant={selectedProfile.sandboxEnabled ? "secondary" : "destructive"}>
                      {selectedProfile.sandboxEnabled ? "Force ON" : "Force OFF"}
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
                      Reset
                    </Button>
                  {/if}
                </div>
              </div>

              <div class="channel-field">
                <Label for="web-profile-agent">Linked Agent</Label>
                <NativeSelect id="web-profile-agent" bind:value={selectedProfile.agentId}>
                  <NativeSelectOption value="">No agent (global fallback only)</NativeSelectOption>
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
                <h2 class="channel-card-title">Profile Markdown Overrides</h2>
                <p class="channel-card-desc">
                  Files are saved as real Markdown documents with metadata headers. Leave empty to remove the override.
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
                      placeholder={`Edit ${fileName} here`}
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
              <h2 class="channel-card-title">No profile selected</h2>
              <p class="channel-card-desc">Create a profile to configure the Web runtime.</p>
            </div>
          </div>
          <Button variant="outline" type="button" onclick={addProfile}>
            Add Profile
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
        Saving changes...
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
      Reset
    </Button>
    <button type="submit" form="channel-form" class="settings-footbar-btn" disabled={loading || saving}>
      {saving ? "Saving..." : "Save Web Settings"}
    </button>
  </div>
</footer>
