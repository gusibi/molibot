<script lang="ts">
  import { onMount } from "svelte";
  import PageShell from "$lib/ui/PageShell.svelte";
  import Button from "$lib/ui/Button.svelte";
  import Alert from "$lib/ui/Alert.svelte";

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
    if (!data.ok) {
      throw new Error(data.error || "Failed to load agent files");
    }
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
    const shouldSave = window.confirm("当前 Agent 有未保存变更。点击“确定”先保存并切换，点击“取消”留在当前 Agent。");
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
    savedSnapshots = {
      ...savedSnapshots,
      [next.id]: agentSnapshot(next)
    };
    selectedAgentId = next.id;
  }

  async function removeAgent(agentId: string): Promise<void> {
    const confirmed =
      typeof window === "undefined"
        ? true
        : window.confirm(`Delete agent "${agentId}"? This cannot be undone.`);
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
      savedSnapshots = {
        ...savedSnapshots,
        [next.id]: agentSnapshot(next)
      };
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
        return {
          ...normalized,
          isNew: false
        };
      });
      if (selected.id !== normalized.id) {
        selectedAgentId = normalized.id;
      }
      savedSnapshots = {
        ...savedSnapshots,
        [normalized.id]: agentSnapshot({ ...normalized, isNew: false })
      };

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

<PageShell widthClass="max-w-7xl" gapClass="space-y-6">
  <header class="wb-hero">
    <div class="wb-hero-copy">
    <p class="wb-eyebrow">Identity Layer</p>
    <h1>Agents</h1>
    <p class="wb-copy">
      Manage reusable agent identities and edit their Markdown prompt files directly.
    </p>
    </div>
  </header>

  {#if loading}
    <div class="wb-empty-state text-left">
      Loading agent settings...
    </div>
  {:else}
    <div class="wb-config-grid">
      <section class="wb-config-nav space-y-3">
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-semibold text-[var(--foreground)]">Agent List</h2>
          <Button variant="outline" size="sm" type="button" on:click={addAgent}>
            Add Agent
          </Button>
        </div>

        <div class="wb-config-nav-list">
          <button
            class={`wb-config-item ${showingSubagents ? "active" : ""}`}
            type="button"
            on:click={selectSubagents}
          >
            <span class="min-w-0">
              <span class="wb-config-item-title truncate">Subagents</span>
              <span class="wb-config-item-subtitle truncate">{builtInSubagents.length} built-in delegation roles</span>
            </span>
            <span class="wb-config-state" data-enabled={true}>
              BUILT-IN
            </span>
          </button>

          {#each agents as agent (agent.id)}
            <button
              class={`wb-config-item ${selectedAgentId === agent.id ? "active" : ""}`}
              type="button"
              on:click={() => selectAgent(agent.id)}
            >
              <span class="min-w-0">
                <span class="wb-config-item-title truncate">{agent.name || agent.id}</span>
                <span class="wb-config-item-subtitle truncate">{agent.id}</span>
              </span>
              <span class="wb-config-state" data-enabled={agent.enabled}>
                {agent.enabled ? "ON" : "OFF"}
              </span>
            </button>
          {/each}
        </div>
      </section>

      {#if showingSubagents}
        <section class="space-y-4">
          <section class="wb-config-panel space-y-3">
            <div class="flex items-center justify-between gap-4">
              <div>
                <h2 class="text-sm font-semibold text-[var(--foreground)]">Built-in Subagents</h2>
                <p class="mt-1 text-xs text-[var(--muted-foreground)]">
                  Read-only delegation roles used by the shared subagent tool.
                </p>
              </div>
              <a class="text-sm font-medium text-[var(--primary)] hover:underline" href="/settings/ai/routing">Configure model route</a>
            </div>
            <div class="rounded-lg border border-[var(--border)] bg-[color-mix(in_oklab,var(--muted)_55%,transparent)] p-3 text-xs text-[var(--muted-foreground)]">
              Explicit subagent route:
              <span class="text-[var(--foreground)]">{subagentConfiguredModelLabel || "not set"}</span>.
              Each role first uses its model level mapping below, then this fallback route, then the text route.
            </div>
            <dl class="grid gap-2 text-sm md:grid-cols-2">
              {#each ["haiku", "sonnet", "opus", "thinking"] as level}
                <div class="rounded-lg border border-[var(--border)] bg-[color-mix(in_oklab,var(--card)_80%,transparent)] p-3">
                  <dt class="text-xs uppercase tracking-[0.14em] text-[var(--muted-foreground)]">{level}</dt>
                  <dd class="mt-1 text-[var(--foreground)]">{subagentModelLevels[level]?.label || "not configured"}</dd>
                </div>
              {/each}
            </dl>
          </section>

          <section class="grid gap-3 md:grid-cols-2">
            {#each builtInSubagents as subagent (subagent.name)}
              <article class="wb-config-panel space-y-3">
                <div class="flex items-center justify-between gap-3">
                  <div class="min-w-0">
                    <h3 class="truncate text-base font-semibold text-[var(--foreground)]">{subagent.name}</h3>
                    <p class="mt-1 text-sm text-[var(--muted-foreground)]">{subagent.description}</p>
                  </div>
                  <span class="wb-config-state" data-enabled={true}>BUILT-IN</span>
                </div>

                <dl class="grid gap-2 text-sm">
                  <div>
                    <dt class="text-xs uppercase tracking-[0.14em] text-[var(--muted-foreground)]">Tools</dt>
                    <dd class="mt-1 text-[var(--foreground)]">{subagent.tools.length > 0 ? subagent.tools.join(", ") : "default"}</dd>
                  </div>
                  <div>
                    <dt class="text-xs uppercase tracking-[0.14em] text-[var(--muted-foreground)]">Model level</dt>
                    <dd class="mt-1 text-[var(--foreground)]">{subagent.modelLevel || subagent.modelHint || "none"}</dd>
                  </div>
                  <div>
                    <dt class="text-xs uppercase tracking-[0.14em] text-[var(--muted-foreground)]">Effective model</dt>
                    <dd class="mt-1 text-[var(--foreground)]">{subagent.activeModelLabel || subagent.activeModelKey || "not resolved"}</dd>
                  </div>
                  <div>
                    <dt class="text-xs uppercase tracking-[0.14em] text-[var(--muted-foreground)]">Source</dt>
                    <dd class="mt-1 text-[var(--foreground)]">{subagent.activeModelSource || "unknown"}</dd>
                  </div>
                </dl>
              </article>
            {/each}
          </section>
        </section>
      {:else if selectedAgent}
        <form class="space-y-4" on:submit|preventDefault={save}>
          <section class="wb-config-panel space-y-3">
            <div class="flex items-center justify-between">
              <h2 class="text-sm font-semibold text-[var(--foreground)]">Agent Metadata</h2>
              <Button variant="destructive" size="sm" type="button" on:click={() => removeAgent(selectedAgent.id)}>
                Remove Agent
              </Button>
            </div>

            <label class="grid gap-1.5 text-sm">
              <span class="text-[var(--foreground)]">Agent ID</span>
              <input
                class="rounded-lg border border-[var(--border)] bg-[color-mix(in_oklab,var(--card)_88%,transparent)] px-3 py-2 text-sm outline-none focus:border-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-60"
                bind:value={selectedAgent.id}
                placeholder="moli"
                disabled={!selectedAgent.isNew}
              />
            </label>
            {#if !selectedAgent.isNew}
              <p class="wb-note text-xs">
                Agent ID is locked after creation to keep references stable.
              </p>
            {/if}

            <label class="grid gap-1.5 text-sm">
              <span class="text-[var(--foreground)]">Agent Name</span>
              <input
                class="rounded-lg border border-[var(--border)] bg-[color-mix(in_oklab,var(--card)_88%,transparent)] px-3 py-2 text-sm outline-none focus:border-[var(--ring)]"
                bind:value={selectedAgent.name}
                placeholder="Moli"
              />
            </label>

            <label class="grid gap-1.5 text-sm">
              <span class="text-[var(--foreground)]">Description</span>
              <textarea
                class="min-h-[88px] rounded-lg border border-[var(--border)] bg-[color-mix(in_oklab,var(--card)_88%,transparent)] px-3 py-2 text-sm outline-none focus:border-[var(--ring)]"
                bind:value={selectedAgent.description}
                placeholder="Short description of this agent's role and identity."
              ></textarea>
            </label>

            <label class="flex items-center gap-3 text-sm text-[var(--foreground)]">
              <input bind:checked={selectedAgent.enabled} type="checkbox" />
              Enable this agent
            </label>
          </section>

          <section class="wb-config-panel space-y-4">
            <div>
              <h2 class="text-sm font-semibold text-[var(--foreground)]">Agent Markdown Files</h2>
              <p class="mt-1 text-xs text-[var(--muted-foreground)]">
                Empty content removes the file so the runtime falls back to upper layers.
              </p>
            </div>

            {#each fileNames as fileName}
              <label class="grid gap-1.5 text-sm">
                <span class="text-[var(--foreground)]">{fileName}</span>
                <textarea
                  class="min-h-[180px] rounded-lg border border-[var(--border)] bg-[color-mix(in_oklab,var(--card)_88%,transparent)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--ring)]"
                  bind:value={selectedFiles[fileName]}
                  placeholder={`Edit ${fileName} here`}
                ></textarea>
              </label>
            {/each}
          </section>

          <Button variant="default" size="md" type="submit" disabled={saving}>
            {saving ? "Saving..." : "Save This Agent"}
          </Button>
          {#if selectedAgentDirty}
            <p class="wb-warning-note text-xs">Current agent has unsaved changes.</p>
          {/if}

          {#if message}
            <Alert variant="success">{message}</Alert>
          {/if}
          {#if error}
            <Alert variant="destructive">{error}</Alert>
          {/if}
        </form>
      {/if}
    </div>
  {/if}
</PageShell>
