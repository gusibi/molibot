<script lang="ts">
  import { onMount } from "svelte";

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
          }) => ({
            id: profile.id ?? createProfileId(),
            name: profile.name ?? "",
            enabled: profile.enabled ?? true,
            agentId: profile.agentId ?? "",
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

<div class="mx-auto max-w-7xl space-y-6 px-6 py-8 sm:px-10 sm:py-12">
  <div>
    <h1 class="text-2xl font-semibold">Web Profiles</h1>
    <p class="text-sm text-slate-400">
      Configure web runtime profiles, link agents, and edit profile-level Markdown overrides.
    </p>
  </div>

  {#if loading}
    <div class="rounded-xl border border-white/15 bg-[#2b2b2b] px-4 py-3 text-sm text-slate-300">
      Loading web profiles...
    </div>
  {:else}
    <div class="grid gap-6 lg:grid-cols-[280px_1fr]">
      <section class="space-y-3 rounded-xl border border-white/15 bg-[#2b2b2b] p-4">
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-semibold text-slate-200">Profiles</h2>
          <button
            class="cursor-pointer rounded-md border border-white/20 bg-white/5 px-2 py-1 text-xs text-slate-200 hover:bg-white/10"
            type="button"
            on:click={addProfile}
          >
            Add Profile
          </button>
        </div>

        <div class="space-y-2">
          {#each profiles as profile (profile.id)}
            <button
              class={`flex w-full items-start justify-between rounded-lg border px-3 py-2 text-left text-sm ${
                selectedProfile?.id === profile.id
                  ? "border-emerald-400/60 bg-emerald-500/10 text-emerald-200"
                  : "border-white/10 bg-[#1f1f1f] text-slate-300 hover:border-white/20"
              }`}
              type="button"
              on:click={() => selectProfile(profile.id)}
            >
              <span>
                <span class="block font-medium">{profile.name || profile.id}</span>
                <span class="block text-xs text-slate-400">{profile.id}</span>
              </span>
              <span class={`text-[10px] ${profile.enabled ? "text-emerald-300" : "text-slate-500"}`}>
                {profile.enabled ? "ON" : "OFF"}
              </span>
            </button>
          {/each}
        </div>
      </section>

      {#if selectedProfile}
        <form class="space-y-4" on:submit|preventDefault={save}>
          <section class="space-y-4 rounded-xl border border-white/15 bg-[#2b2b2b] p-4">
            <div class="flex items-center justify-between">
              <h2 class="text-sm font-semibold text-slate-200">Profile Configuration</h2>
              <button
                class="cursor-pointer rounded-md border border-rose-500/50 bg-rose-500/10 px-2 py-1 text-xs text-rose-300 hover:bg-rose-500/20"
                type="button"
                on:click={() => removeProfile(selectedProfile.id)}
              >
                Remove Profile
              </button>
            </div>

            <div class="grid gap-3 md:grid-cols-2">
              <label class="grid gap-1.5 text-sm">
                <span class="text-slate-300">Profile ID</span>
                <input
                  class="rounded-lg border border-white/15 bg-[#1f1f1f] px-3 py-2 text-sm outline-none focus:border-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
                  bind:value={selectedProfile.id}
                  placeholder="marketing-web"
                  disabled={!selectedProfile.isNew}
                />
              </label>

              <label class="grid gap-1.5 text-sm">
                <span class="text-slate-300">Profile Name</span>
                <input
                  class="rounded-lg border border-white/15 bg-[#1f1f1f] px-3 py-2 text-sm outline-none focus:border-emerald-400"
                  bind:value={selectedProfile.name}
                  placeholder="Marketing Web"
                />
              </label>
            </div>
            {#if !selectedProfile.isNew}
              <p class="text-xs text-slate-500">
                Profile ID is locked after creation to keep workspace paths and references stable.
              </p>
            {/if}

            <label class="flex items-center gap-3 text-sm text-slate-300">
              <input bind:checked={selectedProfile.enabled} type="checkbox" />
              Enable this profile instance
            </label>

            <label class="grid gap-1.5 text-sm">
              <span class="text-slate-300">Linked Agent</span>
              <select
                class="rounded-lg border border-white/15 bg-[#1f1f1f] px-3 py-2 text-sm outline-none focus:border-emerald-400"
                bind:value={selectedProfile.agentId}
              >
                <option value="">No agent (global fallback only)</option>
                {#each agents.filter((agent) => agent.enabled) as agent (agent.id)}
                  <option value={agent.id}>{agent.name || agent.id}</option>
                {/each}
              </select>
            </label>
          </section>

          <section class="space-y-3 rounded-xl border border-white/15 bg-[#2b2b2b] p-4">
            <div>
              <h3 class="text-sm font-semibold text-slate-200">Profile Markdown Overrides</h3>
              <p class="mt-1 text-xs text-slate-400">
                Files are saved as real Markdown documents with metadata headers. Leave empty to remove the override.
              </p>
            </div>

            {#each profileFileNames as fileName}
              <label class="grid gap-1.5 text-sm">
                <span class="text-slate-300">{fileName}</span>
                <textarea
                  class="min-h-[160px] rounded-lg border border-white/15 bg-[#1f1f1f] px-3 py-2 font-mono text-sm outline-none focus:border-emerald-400"
                  bind:value={selectedProfile.profileFiles[fileName]}
                  placeholder={`Edit ${fileName} here`}
                ></textarea>
              </label>
            {/each}
          </section>

          <button
            class="cursor-pointer rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black transition-colors duration-200 hover:bg-slate-200 disabled:cursor-not-allowed disabled:bg-slate-600 disabled:text-slate-300"
            type="submit"
            disabled={saving}
          >
            {saving ? "Saving..." : "Save This Profile"}
          </button>
          {#if selectedProfileDirty}
            <p class="text-xs text-amber-300">Current profile has unsaved changes.</p>
          {/if}

          {#if message}
            <p class="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
              {message}
            </p>
          {/if}
          {#if error}
            <p class="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
              {error}
            </p>
          {/if}
        </form>
      {/if}
    </div>
  {/if}
</div>
