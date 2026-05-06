<script lang="ts">
  import { onMount } from "svelte";
  import { Alert, AlertDescription } from "$lib/components/ui/alert";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "$lib/components/ui/card";
  import { Checkbox } from "$lib/components/ui/checkbox";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { Textarea } from "$lib/components/ui/textarea";

  interface AgentItem {
    id: string;
    name: string;
    description: string;
    enabled: boolean;
    profileFiles: AgentFiles;
    isNew: boolean;
  }

  type AgentFiles = Record<string, string>;

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

  const fileNames = ["AGENTS.md", "SOUL.md", "IDENTITY.md", "SONG.md"];

  let loading = true;
  let saving = false;
  let error = "";
  let message = "";

  let agents: AgentItem[] = [];
  let builtInSubagents: BuiltInSubagentItem[] = [];
  let subagentConfiguredModelLabel = "";
  let subagentModelLevels: Record<string, { key: string; label: string }> = {};
  let selectedAgentId = "";
  let savedSnapshots: Record<string, string> = {};

  function createAgentId(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return `agent-${crypto.randomUUID().slice(0, 8)}`;
    }
    return `agent-${Math.random().toString(36).slice(2, 10)}`;
  }

  function emptyFiles(): AgentFiles {
    return Object.fromEntries(fileNames.map((fileName) => [fileName, ""]));
  }

  function createAgent(): AgentItem {
    return {
      id: createAgentId(),
      name: "",
      description: "",
      enabled: true,
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
      profileFiles: Object.fromEntries(fileNames.map((fileName) => [fileName, String(agent.profileFiles[fileName] ?? "")])),
      isNew: agent.isNew
    };
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
      const [res, subagentsRes] = await Promise.all([
        fetch("/api/settings"),
        fetch("/api/settings/subagents")
      ]);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load settings");
      const subagentData = await subagentsRes.json();
      if (!subagentData.ok) throw new Error(subagentData.error || "Failed to load subagents");
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
      const rawAgents = Array.isArray(data.settings?.agents) ? data.settings.agents : [];
      agents = await Promise.all(
        rawAgents.map(async (agent: AgentItem) => ({
          id: agent.id,
          name: agent.name ?? "",
          description: agent.description ?? "",
          enabled: agent.enabled ?? true,
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
    const shouldSave = window.confirm('当前 Agent 有未保存变更。点击“确定”先保存并切换，点击“取消”留在当前 Agent。');
    if (!shouldSave) return false;
    return save();
  }

  async function selectAgent(agentId: string): Promise<void> {
    if (agentId === selectedAgentId) return;
    const ok = await ensureCurrentSavedBeforeSwitch();
    if (!ok) return;
    selectedAgentId = agentId;
  }

  async function selectSubagents(): Promise<void> {
    if (selectedAgentId === subagentsNavId) return;
    const ok = await ensureCurrentSavedBeforeSwitch();
    if (!ok) return;
    selectedAgentId = subagentsNavId;
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
    const confirmed = typeof window === "undefined" ? true : window.confirm(`Delete agent "${agentId}"? This cannot be undone.`);
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
            enabled: normalized.enabled
          }
        })
      });
      const settingsData = await settingsRes.json();
      if (!settingsData.ok) throw new Error(settingsData.error || "Failed to save agents");

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
      if (!data.ok) throw new Error(data.error || `Failed to save files for ${normalized.id}`);

      agents = agents.map((agent) => {
        if (agent.id !== selected.id) return agent;
        return { ...normalized, isNew: false };
      });
      if (selected.id !== normalized.id) {
        selectedAgentId = normalized.id;
      }
      savedSnapshots = { ...savedSnapshots, [normalized.id]: agentSnapshot({ ...normalized, isNew: false }) };

      message = `Saved agent: ${normalized.name || normalized.id}`;
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
  $: showingSubagents = selectedAgentId === subagentsNavId;
  $: selectedAgentDirty = selectedAgent
    ? agentSnapshot(selectedAgent) !== (savedSnapshots[selectedAgent.id] ?? "")
    : false;

  onMount(loadSettings);
</script>

<div class="mx-auto flex max-w-7xl flex-col gap-6 px-6 py-8 sm:px-10 sm:py-10">
  <header class="flex flex-col gap-3">
    <Badge variant="secondary" class="w-fit">Identity Layer</Badge>
    <div class="flex max-w-3xl flex-col gap-2">
      <h1 class="text-3xl font-semibold tracking-tight text-foreground">Agents</h1>
      <p class="text-sm leading-6 text-muted-foreground">
        Manage reusable agent identities and edit their Markdown prompt files directly.
      </p>
    </div>
  </header>

  {#if loading}
    <p class="py-8 text-sm text-muted-foreground">Loading agent settings...</p>
  {:else}
    <div class="grid gap-6 lg:grid-cols-[280px_1fr]">
      <Card>
        <CardHeader class="pb-3">
          <div class="flex items-center justify-between">
            <CardTitle class="text-sm">Agent List</CardTitle>
            <Button variant="outline" size="sm" type="button" onclick={addAgent}>Add Agent</Button>
          </div>
        </CardHeader>
        <CardContent class="space-y-1">
          <button
            class="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition hover:bg-muted/60 {showingSubagents ? 'bg-muted' : ''}"
            type="button"
            onclick={selectSubagents}
          >
            <span class="min-w-0">
              <span class="block truncate font-medium text-foreground">Subagents</span>
              <span class="block truncate text-xs text-muted-foreground">{builtInSubagents.length} built-in delegation roles</span>
            </span>
            <Badge variant="secondary" class="shrink-0 text-[10px]">BUILT-IN</Badge>
          </button>

          {#each agents as agent (agent.id)}
            <button
              class="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition hover:bg-muted/60 {selectedAgentId === agent.id ? 'bg-muted' : ''}"
              type="button"
              onclick={() => selectAgent(agent.id)}
            >
              <span class="min-w-0">
                <span class="block truncate font-medium text-foreground">{agent.name || agent.id}</span>
                <span class="block truncate text-xs text-muted-foreground">{agent.id}</span>
              </span>
              <Badge variant={agent.enabled ? "default" : "outline"} class="shrink-0 text-[10px]">
                {agent.enabled ? "ON" : "OFF"}
              </Badge>
            </button>
          {/each}
        </CardContent>
      </Card>

      {#if showingSubagents}
        <div class="space-y-4">
          <Card>
            <CardHeader>
              <div class="flex items-center justify-between gap-4">
                <div>
                  <CardTitle class="text-sm">Built-in Subagents</CardTitle>
                  <CardDescription>
                    Read-only delegation roles used by the shared subagent tool.
                  </CardDescription>
                </div>
                <a class="text-sm font-medium text-primary hover:underline" href="/settings/ai/routing">Configure model route</a>
              </div>
            </CardHeader>
            <CardContent class="space-y-4">
              <div class="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
                Explicit subagent route:
                <span class="text-foreground">{subagentConfiguredModelLabel || "not set"}</span>.
                Each role first uses its model level mapping below, then this fallback route, then the text route.
              </div>
              <dl class="grid gap-2 text-sm md:grid-cols-2">
                {#each ["haiku", "sonnet", "opus", "thinking"] as level}
                  <div class="rounded-lg border bg-muted/40 p-3">
                    <dt class="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{level}</dt>
                    <dd class="mt-1 text-foreground">{subagentModelLevels[level]?.label || "not configured"}</dd>
                  </div>
                {/each}
              </dl>
            </CardContent>
          </Card>

          <div class="grid gap-3 md:grid-cols-2">
            {#each builtInSubagents as subagent (subagent.name)}
              <Card>
                <CardHeader>
                  <div class="flex items-center justify-between gap-3">
                    <div class="min-w-0">
                      <CardTitle class="truncate text-base">{subagent.name}</CardTitle>
                      <CardDescription>{subagent.description}</CardDescription>
                    </div>
                    <Badge variant="secondary" class="shrink-0 text-[10px]">BUILT-IN</Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <dl class="grid gap-2 text-sm">
                    <div>
                      <dt class="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Tools</dt>
                      <dd class="mt-1 text-foreground">{subagent.tools.length > 0 ? subagent.tools.join(", ") : "default"}</dd>
                    </div>
                    <div>
                      <dt class="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Model level</dt>
                      <dd class="mt-1 text-foreground">{subagent.modelLevel || subagent.modelHint || "none"}</dd>
                    </div>
                    <div>
                      <dt class="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Effective model</dt>
                      <dd class="mt-1 text-foreground">{subagent.activeModelLabel || subagent.activeModelKey || "not resolved"}</dd>
                    </div>
                    <div>
                      <dt class="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Source</dt>
                      <dd class="mt-1 text-foreground">{subagent.activeModelSource || "unknown"}</dd>
                    </div>
                  </dl>
                </CardContent>
              </Card>
            {/each}
          </div>
        </div>
      {:else if selectedAgent}
        <form class="space-y-4" onsubmit={(e) => { e.preventDefault(); save(); }}>
          <Card>
            <CardHeader>
              <div class="flex items-center justify-between">
                <CardTitle class="text-sm">Agent Metadata</CardTitle>
                <Button variant="destructive" size="sm" type="button" onclick={() => removeAgent(selectedAgent.id)}>
                  Remove Agent
                </Button>
              </div>
            </CardHeader>
            <CardContent class="space-y-4">
              <div class="grid gap-1.5">
                <Label for="agent-id">Agent ID</Label>
                <Input id="agent-id" bind:value={selectedAgent.id} placeholder="moli" disabled={!selectedAgent.isNew} />
              </div>
              {#if !selectedAgent.isNew}
                <p class="text-xs text-muted-foreground">Agent ID is locked after creation to keep references stable.</p>
              {/if}

              <div class="grid gap-1.5">
                <Label for="agent-name">Agent Name</Label>
                <Input id="agent-name" bind:value={selectedAgent.name} placeholder="Moli" />
              </div>

              <div class="grid gap-1.5">
                <Label for="agent-desc">Description</Label>
                <Textarea
                  id="agent-desc"
                  class="min-h-[88px]"
                  bind:value={selectedAgent.description}
                  placeholder="Short description of this agent's role and identity."
                />
              </div>

              <div class="flex items-center gap-3">
                <Checkbox id="agent-enabled" bind:checked={selectedAgent.enabled} />
                <Label for="agent-enabled" class="text-sm">Enable this agent</Label>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle class="text-sm">Agent Markdown Files</CardTitle>
              <CardDescription>
                Empty content removes the file so the runtime falls back to upper layers.
              </CardDescription>
            </CardHeader>
            <CardContent class="space-y-3">
              {#each fileNames as fileName}
                <div class="grid gap-1.5">
                  <Label for="agent-{fileName}">{fileName}</Label>
                  <Textarea
                    id="agent-{fileName}"
                    class="min-h-[180px] font-mono text-sm"
                    bind:value={selectedFiles[fileName]}
                    placeholder={`Edit ${fileName} here`}
                  />
                </div>
              {/each}
            </CardContent>
          </Card>

          <div class="flex items-center gap-3">
            <Button variant="default" type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save This Agent"}
            </Button>
            {#if selectedAgentDirty}
              <span class="text-xs text-muted-foreground">Current agent has unsaved changes.</span>
            {/if}
          </div>

          {#if message}
            <Alert variant="default"><AlertDescription>{message}</AlertDescription></Alert>
          {/if}
          {#if error}
            <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
          {/if}
        </form>
      {/if}
    </div>
  {/if}
</div>
