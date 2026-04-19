<script lang="ts">
  import { onMount } from "svelte";
  import PageShell from "$lib/ui/PageShell.svelte";
  import Button from "$lib/ui/Button.svelte";
  import Alert from "$lib/ui/Alert.svelte";

  type AdapterKind = "codex" | "claude-code" | "custom";
  type ApprovalMode = "manual" | "auto-safe" | "auto-all";

  type TargetForm = {
    id: string;
    name: string;
    adapter: AdapterKind;
    enabled: boolean;
    command: string;
    argsText: string;
    envText: string;
    cwd: string;
  };

  type ProjectForm = {
    id: string;
    name: string;
    enabled: boolean;
    path: string;
    allowedTargetIds: string[];
    defaultApprovalMode: ApprovalMode;
  };

  const approvalModes: ApprovalMode[] = ["manual", "auto-safe", "auto-all"];
  const adapterKinds: AdapterKind[] = ["codex", "claude-code", "custom"];
  const codexPresetArgs = ["-y", "@zed-industries/codex-acp"];
  const claudeCodePresetArgs = ["-y", "@zed-industries/claude-code-acp"];
  const adapterPresets: Record<Exclude<AdapterKind, "custom">, Omit<TargetForm, "enabled" | "cwd">> = {
    codex: {
      id: "codex",
      name: "Codex ACP",
      adapter: "codex",
      command: "npx",
      argsText: codexPresetArgs.join("\n"),
      envText: ""
    },
    "claude-code": {
      id: "claude-code",
      name: "Claude Code ACP",
      adapter: "claude-code",
      command: "npx",
      argsText: claudeCodePresetArgs.join("\n"),
      envText: ""
    }
  };

  let loading = true;
  let saving = false;
  let message = "";
  let error = "";
  let enabled = true;
  let targets: TargetForm[] = [];
  let projects: ProjectForm[] = [];

  function parseArgsText(input: string): string[] {
    return input
      .split("\n")
      .map((value) => value.trim())
      .filter(Boolean);
  }

  function formatArgs(args: unknown): string {
    if (!Array.isArray(args)) return "";
    return args.map((value) => String(value ?? "").trim()).filter(Boolean).join("\n");
  }

  function parseEnvText(input: string): Record<string, string> {
    const env: Record<string, string> = {};
    for (const rawLine of input.split("\n")) {
      const line = rawLine.trim();
      if (!line) continue;
      const separatorIndex = line.indexOf("=");
      if (separatorIndex <= 0) {
        throw new Error(`Invalid env line '${line}'. Use KEY=VALUE.`);
      }
      const key = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1).trim();
      if (!key) {
        throw new Error(`Invalid env line '${line}'. Missing key.`);
      }
      env[key] = value;
    }
    return env;
  }

  function formatEnv(input: unknown): string {
    if (!input || typeof input !== "object" || Array.isArray(input)) return "";
    return Object.entries(input as Record<string, unknown>)
      .map(([key, value]) => `${key}=${String(value ?? "")}`)
      .join("\n");
  }

  function normalizeApprovalMode(input: unknown): ApprovalMode {
    const raw = String(input ?? "").trim().toLowerCase();
    if (raw === "auto-safe" || raw === "auto-all") return raw;
    return "manual";
  }

  function normalizeAdapter(input: unknown): AdapterKind {
    const raw = String(input ?? "").trim().toLowerCase();
    if (raw === "codex" || raw === "claude-code") return raw;
    return "custom";
  }

  function normalizeTargets(input: unknown): TargetForm[] {
    if (!Array.isArray(input)) return [];
    return input.map((row, index) => {
      const item = row && typeof row === "object" ? row as Record<string, unknown> : {};
      const id = String(item.id ?? "").trim() || `target-${index + 1}`;
      return {
        id,
        name: String(item.name ?? id).trim() || id,
        adapter: normalizeAdapter(item.adapter),
        enabled: item.enabled === undefined ? true : Boolean(item.enabled),
        command: String(item.command ?? "").trim(),
        argsText: formatArgs(item.args),
        envText: formatEnv(item.env),
        cwd: String(item.cwd ?? "").trim(),
      };
    });
  }

  function normalizeProjects(input: unknown): ProjectForm[] {
    if (!Array.isArray(input)) return [];
    return input.map((row, index) => {
      const item = row && typeof row === "object" ? row as Record<string, unknown> : {};
      const id = String(item.id ?? "").trim() || `project-${index + 1}`;
      const allowedTargetIds = Array.isArray(item.allowedTargetIds)
        ? item.allowedTargetIds.map((value) => String(value ?? "").trim()).filter(Boolean)
        : [];
      return {
        id,
        name: String(item.name ?? id).trim() || id,
        enabled: item.enabled === undefined ? true : Boolean(item.enabled),
        path: String(item.path ?? "").trim(),
        allowedTargetIds,
        defaultApprovalMode: normalizeApprovalMode(item.defaultApprovalMode),
      };
    });
  }

  function addTarget(adapter: AdapterKind = "custom"): void {
    const nextIndex = targets.length + 1;
    if (adapter === "custom") {
      targets = [
        ...targets,
        {
          id: `target-${nextIndex}`,
          name: `Target ${nextIndex}`,
          adapter,
          enabled: true,
          command: "",
          argsText: "",
          envText: "",
          cwd: "",
        },
      ];
      return;
    }

    const preset = adapterPresets[adapter];
    targets = [
      ...targets,
      {
        ...preset,
        id: targets.some((target) => target.id === preset.id) ? `${preset.id}-${nextIndex}` : preset.id,
        enabled: true,
        cwd: "",
      },
    ];
  }

  function addProject(): void {
    const nextIndex = projects.length + 1;
    projects = [
      ...projects,
      {
        id: `project-${nextIndex}`,
        name: `Project ${nextIndex}`,
        enabled: true,
        path: "",
        allowedTargetIds: [],
        defaultApprovalMode: "manual",
      },
    ];
  }

  function removeTarget(index: number): void {
    const removed = targets[index]?.id ?? "";
    targets = targets.filter((_, currentIndex) => currentIndex !== index);
    if (!removed) return;
    projects = projects.map((project) => ({
      ...project,
      allowedTargetIds: project.allowedTargetIds.filter((id) => id !== removed),
    }));
  }

  function removeProject(index: number): void {
    projects = projects.filter((_, currentIndex) => currentIndex !== index);
  }

  function updateProjectTarget(projectIndex: number, targetId: string, checked: boolean): void {
    projects = projects.map((project, index) => {
      if (index !== projectIndex) return project;
      const nextIds = checked
        ? Array.from(new Set([...project.allowedTargetIds, targetId]))
        : project.allowedTargetIds.filter((id) => id !== targetId);
      return { ...project, allowedTargetIds: nextIds };
    });
  }

  function validateUniqueIds(kind: string, ids: string[]): void {
    const seen = new Set<string>();
    for (const id of ids) {
      if (!id) {
        throw new Error(`${kind} id is required.`);
      }
      if (seen.has(id)) {
        throw new Error(`Duplicate ${kind} id '${id}'.`);
      }
      seen.add(id);
    }
  }

  function buildPayload(): {
    enabled: boolean;
    targets: Array<{
      id: string;
      name: string;
      adapter: AdapterKind;
      enabled: boolean;
      command: string;
      args: string[];
      env: Record<string, string>;
      cwd: string;
    }>;
    projects: Array<{
      id: string;
      name: string;
      enabled: boolean;
      path: string;
      allowedTargetIds: string[];
      defaultApprovalMode: ApprovalMode;
    }>;
  } {
    validateUniqueIds("target", targets.map((target) => target.id.trim()));
    validateUniqueIds("project", projects.map((project) => project.id.trim()));

    const targetPayload = targets.map((target) => {
      const id = target.id.trim();
      const command = target.command.trim();
      if (!command) {
        throw new Error(`Target '${id}' is missing command.`);
      }
      return {
        id,
        name: target.name.trim() || id,
        adapter: normalizeAdapter(target.adapter),
        enabled: target.enabled,
        command,
        args: parseArgsText(target.argsText),
        env: parseEnvText(target.envText),
        cwd: target.cwd.trim(),
      };
    });

    const allowedTargetIds = new Set(targetPayload.map((target) => target.id));
    const projectPayload = projects.map((project) => {
      const id = project.id.trim();
      const path = project.path.trim();
      if (!path) {
        throw new Error(`Project '${id}' is missing path.`);
      }
      if (!path.startsWith("/")) {
        throw new Error(`Project '${id}' path must be absolute.`);
      }
      const nextAllowedTargets = project.allowedTargetIds
        .map((targetId) => targetId.trim())
        .filter(Boolean);
      for (const targetId of nextAllowedTargets) {
        if (!allowedTargetIds.has(targetId)) {
          throw new Error(`Project '${id}' references unknown target '${targetId}'.`);
        }
      }
      return {
        id,
        name: project.name.trim() || id,
        enabled: project.enabled,
        path,
        allowedTargetIds: nextAllowedTargets,
        defaultApprovalMode: normalizeApprovalMode(project.defaultApprovalMode),
      };
    });

    return {
      enabled,
      targets: targetPayload,
      projects: projectPayload,
    };
  }

  async function loadSettings(): Promise<void> {
    loading = true;
    error = "";
    message = "";
    try {
      const res = await fetch("/api/settings");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load ACP settings");
      enabled = data.settings?.acp?.enabled === undefined ? true : Boolean(data.settings.acp.enabled);
      targets = normalizeTargets(data.settings?.acp?.targets);
      projects = normalizeProjects(data.settings?.acp?.projects);
      message = "ACP settings loaded.";
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
      enabled = true;
      targets = [];
      projects = [];
    } finally {
      loading = false;
    }
  }

  async function save(): Promise<void> {
    saving = true;
    error = "";
    message = "";
    try {
      const payload = buildPayload();
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acp: payload }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to save ACP settings");
      enabled = data.settings?.acp?.enabled === undefined ? payload.enabled : Boolean(data.settings.acp.enabled);
      targets = normalizeTargets(data.settings?.acp?.targets ?? payload.targets);
      projects = normalizeProjects(data.settings?.acp?.projects ?? payload.projects);
      message = "ACP settings saved.";
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      saving = false;
    }
  }

  onMount(loadSettings);
</script>

<PageShell widthClass="max-w-6xl" gapClass="space-y-6">
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div class="space-y-2">
      <h1 class="text-2xl font-semibold">ACP Targets</h1>
      <p class="max-w-3xl text-sm text-[var(--muted-foreground)]">
        Configure coding-agent adapters and the project allowlist used by Telegram ACP commands.
        Projects must use absolute paths, and approval defaults are applied when a new ACP session starts.
      </p>
    </div>
    <div class="flex flex-wrap gap-2">
      <Button variant="outline" size="md" on:click={loadSettings} disabled={loading || saving}>
        Refresh
      </Button>
      <Button variant="default" size="md" on:click={save} disabled={loading || saving}>
        {saving ? "Saving..." : "Save ACP Settings"}
      </Button>
    </div>
  </div>

  {#if message}
    <Alert variant="success">{message}</Alert>
  {/if}
  {#if error}
    <Alert variant="destructive">{error}</Alert>
  {/if}

  {#if loading}
    <div class="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-sm text-[var(--muted-foreground)]">
      Loading ACP settings...
    </div>
  {:else}
    <form class="space-y-6" on:submit|preventDefault={save}>
      <section class="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <div class="space-y-1">
          <h2 class="text-sm font-semibold text-[var(--foreground)]">Global Switch</h2>
          <p class="text-xs leading-5 text-[var(--muted-foreground)]">
            Disable ACP here if you want Telegram commands to stay visible in code but reject new coding sessions.
          </p>
        </div>

        <label class="flex items-center gap-3 text-sm text-[var(--foreground)]">
          <input bind:checked={enabled} type="checkbox" />
          Enable ACP control plane
        </label>
      </section>

      <section class="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="space-y-1">
            <h2 class="text-sm font-semibold text-[var(--foreground)]">Targets</h2>
            <p class="max-w-3xl text-xs leading-5 text-[var(--muted-foreground)]">
              One target equals one ACP adapter process. Built-in presets are
              <code>codex</code> = <code>npx {codexPresetArgs.join(" ")}</code> and
              <code>claude-code</code> = <code>npx {claudeCodePresetArgs.join(" ")}</code>.
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" on:click={() => addTarget("codex")} type="button">
              Add Codex
            </Button>
            <Button variant="outline" size="sm" on:click={() => addTarget("claude-code")} type="button">
              Add Claude Code
            </Button>
            <Button variant="outline" size="sm" on:click={() => addTarget("custom")} type="button">
              Add Custom
            </Button>
          </div>
        </div>

        {#if targets.length === 0}
          <div class="rounded-xl border border-dashed border-[var(--border)] bg-[var(--muted)] px-4 py-3 text-sm text-[var(--muted-foreground)]">
            No ACP targets configured.
          </div>
        {:else}
          <div class="space-y-4">
            {#each targets as target, index}
              <article class="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--background)] p-4">
                <div class="flex flex-wrap items-start justify-between gap-3">
                  <div class="space-y-1">
                    <h3 class="text-sm font-semibold text-[var(--foreground)]">
                      {target.name || target.id || `Target ${index + 1}`}
                    </h3>
                    <p class="text-xs text-[var(--muted-foreground)]">
                      Adapter id must stay stable because projects reference it.
                    </p>
                  </div>
                  <Button variant="destructive" size="sm" type="button" on:click={() => removeTarget(index)}>
                    Remove
                  </Button>
                </div>

                <div class="grid gap-4 md:grid-cols-2">
                  <label class="grid gap-1.5 text-sm">
                    <span class="text-[var(--foreground)]">Target ID</span>
                    <input
                      class="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--ring)]"
                      bind:value={target.id}
                    />
                  </label>

                  <label class="grid gap-1.5 text-sm">
                    <span class="text-[var(--foreground)]">Display Name</span>
                    <input
                      class="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--ring)]"
                      bind:value={target.name}
                    />
                  </label>

                  <label class="grid gap-1.5 text-sm">
                    <span class="text-[var(--foreground)]">Adapter</span>
                    <select
                      class="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--ring)]"
                      bind:value={target.adapter}
                    >
                      {#each adapterKinds as adapterKind}
                        <option value={adapterKind}>{adapterKind}</option>
                      {/each}
                    </select>
                  </label>

                  <label class="grid gap-1.5 text-sm md:col-span-2">
                    <span class="text-[var(--foreground)]">Command</span>
                    <input
                      class="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--ring)]"
                      bind:value={target.command}
                      placeholder="npx"
                    />
                  </label>

                  <label class="grid gap-1.5 text-sm">
                    <span class="text-[var(--foreground)]">Args (one per line)</span>
                    <textarea
                      class="min-h-[120px] rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 font-mono text-xs outline-none focus:border-[var(--ring)]"
                      bind:value={target.argsText}
                      placeholder={target.adapter === "claude-code"
                        ? "-y&#10;@zed-industries/claude-code-acp"
                        : "-y&#10;@zed-industries/codex-acp"}
                    ></textarea>
                  </label>

                  <label class="grid gap-1.5 text-sm">
                    <span class="text-[var(--foreground)]">Env (KEY=VALUE per line)</span>
                    <textarea
                      class="min-h-[120px] rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 font-mono text-xs outline-none focus:border-[var(--ring)]"
                      bind:value={target.envText}
                      placeholder={target.adapter === "claude-code" ? "ANTHROPIC_API_KEY=..." : "OPENAI_API_KEY=..."}
                    ></textarea>
                  </label>

                  <label class="grid gap-1.5 text-sm">
                    <span class="text-[var(--foreground)]">Working Directory Override</span>
                    <input
                      class="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--ring)]"
                      bind:value={target.cwd}
                      placeholder="."
                    />
                  </label>

                  <label class="flex items-center gap-3 pt-7 text-sm text-[var(--foreground)]">
                    <input bind:checked={target.enabled} type="checkbox" />
                    Target enabled
                  </label>
                </div>
              </article>
            {/each}
          </div>
        {/if}
      </section>

      <section class="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="space-y-1">
            <h2 class="text-sm font-semibold text-[var(--foreground)]">Projects</h2>
            <p class="max-w-3xl text-xs leading-5 text-[var(--muted-foreground)]">
              Projects are the ACP allowlist. Telegram should select these by stable id instead of sending raw paths.
            </p>
          </div>
          <Button variant="outline" size="sm" on:click={addProject} type="button">
            Add Project
          </Button>
        </div>

        {#if projects.length === 0}
          <div class="rounded-xl border border-dashed border-[var(--border)] bg-[var(--muted)] px-4 py-3 text-sm text-[var(--muted-foreground)]">
            No ACP projects configured.
          </div>
        {:else}
          <div class="space-y-4">
            {#each projects as project, index}
              <article class="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--background)] p-4">
                <div class="flex flex-wrap items-start justify-between gap-3">
                  <div class="space-y-1">
                    <h3 class="text-sm font-semibold text-[var(--foreground)]">
                      {project.name || project.id || `Project ${index + 1}`}
                    </h3>
                    <p class="text-xs text-[var(--muted-foreground)]">
                      Path must be absolute. Approval mode becomes the session default in Telegram ACP.
                    </p>
                  </div>
                  <Button variant="destructive" size="sm" type="button" on:click={() => removeProject(index)}>
                    Remove
                  </Button>
                </div>

                <div class="grid gap-4 md:grid-cols-2">
                  <label class="grid gap-1.5 text-sm">
                    <span class="text-[var(--foreground)]">Project ID</span>
                    <input
                      class="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--ring)]"
                      bind:value={project.id}
                    />
                  </label>

                  <label class="grid gap-1.5 text-sm">
                    <span class="text-[var(--foreground)]">Display Name</span>
                    <input
                      class="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--ring)]"
                      bind:value={project.name}
                    />
                  </label>

                  <label class="grid gap-1.5 text-sm md:col-span-2">
                    <span class="text-[var(--foreground)]">Absolute Path</span>
                    <input
                      class="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--ring)]"
                      bind:value={project.path}
                      placeholder="./your-project"
                    />
                  </label>

                  <label class="grid gap-1.5 text-sm">
                    <span class="text-[var(--foreground)]">Default Approval Mode</span>
                    <select
                      class="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--ring)]"
                      bind:value={project.defaultApprovalMode}
                    >
                      {#each approvalModes as mode}
                        <option value={mode}>{mode}</option>
                      {/each}
                    </select>
                  </label>

                  <label class="flex items-center gap-3 pt-7 text-sm text-[var(--foreground)]">
                    <input bind:checked={project.enabled} type="checkbox" />
                    Project enabled
                  </label>
                </div>

                <div class="space-y-2">
                  <p class="text-sm font-medium text-[var(--foreground)]">Allowed Targets</p>
                  {#if targets.length === 0}
                    <div class="rounded-lg border border-dashed border-[var(--border)] bg-[var(--muted)] px-3 py-2 text-xs text-[var(--muted-foreground)]">
                      Add at least one target before binding projects.
                    </div>
                  {:else}
                    <div class="grid gap-2 md:grid-cols-2">
                      {#each targets as target}
                        <label class="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--foreground)]">
                          <input
                            type="checkbox"
                            checked={project.allowedTargetIds.includes(target.id)}
                            on:change={(event) =>
                              updateProjectTarget(
                                index,
                                target.id,
                                (event.target as HTMLInputElement).checked,
                              )}
                          />
                          <span class="min-w-0">
                            <span class="block truncate font-medium">{target.name || target.id}</span>
                            <span class="block truncate text-xs text-[var(--muted-foreground)]">{target.id}</span>
                          </span>
                        </label>
                      {/each}
                    </div>
                  {/if}
                </div>
              </article>
            {/each}
          </div>
        {/if}
      </section>

      <div class="flex justify-end">
        <Button variant="default" size="md" type="submit" disabled={saving}>
          {saving ? "Saving..." : "Save ACP Settings"}
        </Button>
      </div>
    </form>
  {/if}
</PageShell>
