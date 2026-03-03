<script lang="ts">
  import { onMount } from "svelte";

  interface AgentItem {
    id: string;
    name: string;
    description: string;
    enabled: boolean;
    profileFiles: AgentFiles;
  }

  type AgentFiles = Record<string, string>;

  const fileNames = ["AGENTS.md", "SOUL.md", "IDENTITY.md", "SONG.md"];

  let loading = true;
  let saving = false;
  let error = "";
  let message = "";

  let agents: AgentItem[] = [];
  let selectedAgentId = "";

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
      profileFiles: emptyFiles()
    };
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
      const res = await fetch("/api/settings");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load settings");
      const rawAgents = Array.isArray(data.settings?.agents) ? data.settings.agents : [];
      agents = await Promise.all(
        rawAgents.map(async (agent: AgentItem) => ({
          id: agent.id,
          name: agent.name ?? "",
          description: agent.description ?? "",
          enabled: agent.enabled ?? true,
          profileFiles: await loadAgentFiles(agent.id)
        }))
      );
      if (agents.length === 0) {
        const next = createAgent();
        agents = [next];
      }
      selectedAgentId = agents[0]?.id ?? "";
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  async function selectAgent(agentId: string): Promise<void> {
    selectedAgentId = agentId;
  }

  function addAgent(): void {
    const next = createAgent();
    agents = [...agents, next];
    selectedAgentId = next.id;
  }

  async function removeAgent(agentId: string): Promise<void> {
    const settingsRes = await fetch("/api/settings");
    const settingsData = await settingsRes.json();
    const referenced = Object.values(settingsData.settings?.channels ?? {}).some((channel: any) =>
      Array.isArray(channel?.instances) && channel.instances.some((instance: any) => instance.agentId === agentId)
    );
    if (referenced) {
      error = "This agent is still linked to one or more bots. Unlink it first.";
      return;
    }

    agents = agents.filter((agent) => agent.id !== agentId);
    if (agents.length === 0) {
      const next = createAgent();
      agents = [next];
    }
    selectedAgentId = agents[0]?.id ?? "";
  }

  async function save(): Promise<void> {
    saving = true;
    error = "";
    message = "";
    try {
      const normalizedAgents = agents
        .map((agent) => ({
          id: agent.id.trim(),
          name: agent.name.trim(),
          description: agent.description.trim(),
          enabled: Boolean(agent.enabled),
          profileFiles: agent.profileFiles
        }))
        .filter((agent) => agent.id);

      const settingsRes = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agents: normalizedAgents })
      });
      const settingsData = await settingsRes.json();
      if (!settingsData.ok) throw new Error(settingsData.error || "Failed to save agents");

      for (const agent of normalizedAgents) {
        const res = await fetch("/api/settings/profile-files", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scope: "agent",
            agentId: agent.id,
            files: agent.profileFiles
          })
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || `Failed to save files for ${agent.id}`);
      }

      message = "Agent settings and Markdown files saved.";
      await loadSettings();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      saving = false;
    }
  }

  $: selectedAgent = agents.find((agent) => agent.id === selectedAgentId);
  $: selectedFiles = selectedAgent?.profileFiles ?? emptyFiles();

  onMount(loadSettings);
</script>

<div class="mx-auto max-w-7xl space-y-6 px-6 py-8 sm:px-10 sm:py-12">
  <div>
    <h1 class="text-2xl font-semibold">Agents</h1>
    <p class="text-sm text-slate-400">
      Manage reusable agent identities and edit their Markdown prompt files directly.
    </p>
  </div>

  {#if loading}
    <div class="rounded-xl border border-white/15 bg-[#2b2b2b] px-4 py-3 text-sm text-slate-300">
      Loading agent settings...
    </div>
  {:else}
    <div class="grid gap-6 lg:grid-cols-[280px_1fr]">
      <section class="space-y-3 rounded-xl border border-white/15 bg-[#2b2b2b] p-4">
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-semibold text-slate-200">Agent List</h2>
          <button
            class="cursor-pointer rounded-md border border-white/20 bg-white/5 px-2 py-1 text-xs text-slate-200 hover:bg-white/10"
            type="button"
            on:click={addAgent}
          >
            Add Agent
          </button>
        </div>

        <div class="space-y-2">
          {#each agents as agent (agent.id)}
            <button
              class={`flex w-full items-start justify-between rounded-lg border px-3 py-2 text-left text-sm ${
                selectedAgentId === agent.id
                  ? "border-emerald-400/60 bg-emerald-500/10 text-emerald-200"
                  : "border-white/10 bg-[#1f1f1f] text-slate-300 hover:border-white/20"
              }`}
              type="button"
              on:click={() => selectAgent(agent.id)}
            >
              <span>
                <span class="block font-medium">{agent.name || agent.id}</span>
                <span class="block text-xs text-slate-400">{agent.id}</span>
              </span>
              <span class={`text-[10px] ${agent.enabled ? "text-emerald-300" : "text-slate-500"}`}>
                {agent.enabled ? "ON" : "OFF"}
              </span>
            </button>
          {/each}
        </div>
      </section>

      {#if selectedAgent}
        <form class="space-y-4" on:submit|preventDefault={save}>
          <section class="space-y-3 rounded-xl border border-white/15 bg-[#2b2b2b] p-4">
            <div class="flex items-center justify-between">
              <h2 class="text-sm font-semibold text-slate-200">Agent Metadata</h2>
              <button
                class="cursor-pointer rounded-md border border-rose-500/50 bg-rose-500/10 px-2 py-1 text-xs text-rose-300 hover:bg-rose-500/20"
                type="button"
                on:click={() => removeAgent(selectedAgent.id)}
              >
                Remove Agent
              </button>
            </div>

            <label class="grid gap-1.5 text-sm">
              <span class="text-slate-300">Agent ID</span>
              <input
                class="rounded-lg border border-white/15 bg-[#1f1f1f] px-3 py-2 text-sm outline-none focus:border-emerald-400"
                  bind:value={selectedAgent.id}
                  placeholder="moli"
                />
            </label>

            <label class="grid gap-1.5 text-sm">
              <span class="text-slate-300">Agent Name</span>
              <input
                class="rounded-lg border border-white/15 bg-[#1f1f1f] px-3 py-2 text-sm outline-none focus:border-emerald-400"
                bind:value={selectedAgent.name}
                placeholder="Moli"
              />
            </label>

            <label class="grid gap-1.5 text-sm">
              <span class="text-slate-300">Description</span>
              <textarea
                class="min-h-[88px] rounded-lg border border-white/15 bg-[#1f1f1f] px-3 py-2 text-sm outline-none focus:border-emerald-400"
                bind:value={selectedAgent.description}
                placeholder="Short description of this agent's role and identity."
              ></textarea>
            </label>

            <label class="flex items-center gap-3 text-sm text-slate-300">
              <input bind:checked={selectedAgent.enabled} type="checkbox" />
              Enable this agent
            </label>
          </section>

          <section class="space-y-4 rounded-xl border border-white/15 bg-[#2b2b2b] p-4">
            <div>
              <h2 class="text-sm font-semibold text-slate-200">Agent Markdown Files</h2>
              <p class="mt-1 text-xs text-slate-400">
                Empty content removes the file so the runtime falls back to upper layers.
              </p>
            </div>

            {#each fileNames as fileName}
              <label class="grid gap-1.5 text-sm">
                <span class="text-slate-300">{fileName}</span>
                <textarea
                  class="min-h-[180px] rounded-lg border border-white/15 bg-[#1f1f1f] px-3 py-2 font-mono text-sm outline-none focus:border-emerald-400"
                  bind:value={selectedFiles[fileName]}
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
            {saving ? "Saving..." : "Save Agent"}
          </button>

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
