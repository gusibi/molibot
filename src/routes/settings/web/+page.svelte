<script lang="ts">
  import { onMount } from "svelte";
  import { Alert, AlertDescription } from "$lib/components/ui/alert";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle
  } from "$lib/components/ui/card";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { NativeSelect, NativeSelectOption } from "$lib/components/ui/native-select";
  import { Skeleton } from "$lib/components/ui/skeleton";
  import { Switch } from "$lib/components/ui/switch";
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

<div class="mx-auto flex max-w-7xl flex-col gap-6 px-6 py-8 sm:px-10 sm:py-10">
  <header class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <Badge variant="secondary">Web Runtime</Badge>
      <Badge variant="outline">{profiles.length} profiles</Badge>
    </div>
    <div class="flex max-w-3xl flex-col gap-2">
      <h1 class="text-3xl font-semibold tracking-tight text-foreground">Web Profiles</h1>
      <p class="text-sm leading-6 text-muted-foreground">
        Configure web runtime profiles, link agents, and edit profile-level Markdown overrides.
      </p>
    </div>
  </header>

  {#if loading}
    <div class="grid gap-4 lg:grid-cols-[18rem_1fr]">
      <Card>
        <CardHeader>
          <Skeleton class="h-5 w-24" />
          <Skeleton class="h-4 w-40" />
        </CardHeader>
        <CardContent class="flex flex-col gap-2">
          <Skeleton class="h-14 w-full" />
          <Skeleton class="h-14 w-full" />
          <Skeleton class="h-14 w-full" />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <Skeleton class="h-5 w-44" />
          <Skeleton class="h-4 w-72 max-w-full" />
        </CardHeader>
        <CardContent class="flex flex-col gap-4">
          <Skeleton class="h-8 w-full" />
          <Skeleton class="h-8 w-full" />
          <Skeleton class="h-40 w-full" />
        </CardContent>
      </Card>
    </div>
  {:else}
    <div class="grid gap-4 lg:grid-cols-[18rem_1fr]">
      <Card class="h-fit">
        <CardHeader>
          <div class="flex items-center justify-between gap-3">
            <div>
              <CardTitle>Profiles</CardTitle>
              <CardDescription>{profiles.length} configured</CardDescription>
            </div>
            <Button variant="outline" size="sm" type="button" onclick={addProfile}>
              Add
            </Button>
          </div>
        </CardHeader>
        <CardContent class="flex flex-col gap-2">
          {#each profiles as profile (profile.id)}
            <button
              class={`flex w-full items-start justify-between gap-3 rounded-lg border px-3 py-3 text-left transition hover:bg-muted/60 ${
                selectedProfile?.id === profile.id ? "border-primary bg-muted" : "border-border bg-background"
              }`}
              type="button"
              onclick={() => selectProfile(profile.id)}
            >
              <span class="min-w-0">
                <span class="block truncate text-sm font-medium text-foreground">{profile.name || profile.id}</span>
                <span class="block truncate text-xs text-muted-foreground">{profile.id}</span>
              </span>
              <Badge variant={profile.enabled ? "secondary" : "outline"}>
                {profile.enabled ? "On" : "Off"}
              </Badge>
            </button>
          {/each}
        </CardContent>
      </Card>

      {#if selectedProfile}
        <form class="flex flex-col gap-4" onsubmit={(event) => { event.preventDefault(); void save(); }}>
          <Card>
            <CardHeader>
              <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle>Profile Configuration</CardTitle>
                  <CardDescription>
                    Profile ID, display name, enabled state, and linked agent.
                  </CardDescription>
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
            </CardHeader>
            <CardContent class="flex flex-col gap-5">
              <div class="grid gap-4 md:grid-cols-2">
                <div class="flex flex-col gap-2">
                  <Label for="web-profile-id">Profile ID</Label>
                  <Input
                    id="web-profile-id"
                    bind:value={selectedProfile.id}
                    placeholder="marketing-web"
                    disabled={!selectedProfile.isNew}
                  />
                </div>

                <div class="flex flex-col gap-2">
                  <Label for="web-profile-name">Profile Name</Label>
                  <Input
                    id="web-profile-name"
                    bind:value={selectedProfile.name}
                    placeholder="Marketing Web"
                  />
                </div>
              </div>

              {#if !selectedProfile.isNew}
                <p class="text-xs leading-5 text-muted-foreground">
                  Profile ID is locked after creation to keep workspace paths and references stable.
                </p>
              {/if}

              <div class="flex items-center justify-between gap-4 rounded-lg border bg-muted/30 p-4">
                <div class="flex flex-col gap-1">
                  <Label for="web-profile-enabled">Enable this profile instance</Label>
                  <p class="text-xs text-muted-foreground">Disabled profiles stay saved but are not selectable at runtime.</p>
                </div>
                <Switch id="web-profile-enabled" bind:checked={selectedProfile.enabled} />
              </div>

              <div class="flex flex-col gap-2">
                <Label for="web-profile-agent">Linked Agent</Label>
                <NativeSelect id="web-profile-agent" class="w-full" bind:value={selectedProfile.agentId}>
                  <NativeSelectOption value="">No agent (global fallback only)</NativeSelectOption>
                  {#each agents.filter((agent) => agent.enabled) as agent (agent.id)}
                    <NativeSelectOption value={agent.id}>{agent.name || agent.id}</NativeSelectOption>
                  {/each}
                </NativeSelect>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Profile Markdown Overrides</CardTitle>
              <CardDescription>
                Files are saved as real Markdown documents with metadata headers. Leave empty to remove the override.
              </CardDescription>
            </CardHeader>
            <CardContent class="flex flex-col gap-4">
              {#each profileFileNames as fileName}
                <div class="flex flex-col gap-2">
                  <Label for={`web-profile-${fileName}`}>{fileName}</Label>
                  <Textarea
                    id={`web-profile-${fileName}`}
                    class="min-h-40 font-mono text-sm"
                    bind:value={selectedProfile.profileFiles[fileName]}
                    placeholder={`Edit ${fileName} here`}
                  />
                </div>
              {/each}
            </CardContent>
          </Card>

          <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save This Profile"}
            </Button>
            {#if selectedProfileDirty}
              <Badge variant="outline">Unsaved changes</Badge>
            {/if}
          </div>

          {#if message}
            <Alert>
              <AlertDescription>{message}</AlertDescription>
            </Alert>
          {/if}
          {#if error}
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          {/if}
        </form>
      {:else}
        <Card>
          <CardHeader>
            <CardTitle>No profile selected</CardTitle>
            <CardDescription>Create a profile to configure the Web runtime.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" type="button" onclick={addProfile}>
              Add Profile
            </Button>
          </CardContent>
        </Card>
      {/if}
    </div>
  {/if}
</div>
