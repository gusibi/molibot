<script lang="ts">
  import { onMount } from "svelte";
  import { Alert, AlertDescription } from "$lib/components/ui/alert";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "$lib/components/ui/card";
  import { Checkbox } from "$lib/components/ui/checkbox";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { NativeSelect, NativeSelectOption } from "$lib/components/ui/native-select";
  import { Textarea } from "$lib/components/ui/textarea";

  type AdapterKind = "codex" | "claude-code" | "custom";
  type ApprovalMode = "manual" | "auto-safe" | "auto-all";

  type TargetForm = {
    id: string; name: string; adapter: AdapterKind; enabled: boolean;
    command: string; argsText: string; envText: string; cwd: string;
  };

  type ProjectForm = {
    id: string; name: string; enabled: boolean; path: string;
    allowedTargetIds: string[]; defaultApprovalMode: ApprovalMode;
  };

  const approvalModes: ApprovalMode[] = ["manual", "auto-safe", "auto-all"];
  const adapterKinds: AdapterKind[] = ["codex", "claude-code", "custom"];
  const codexPresetArgs = ["-y", "@zed-industries/codex-acp"];
  const claudeCodePresetArgs = ["-y", "@zed-industries/claude-code-acp"];
  const adapterPresets: Record<Exclude<AdapterKind, "custom">, Omit<TargetForm, "enabled" | "cwd">> = {
    codex: { id: "codex", name: "Codex ACP", adapter: "codex", command: "npx", argsText: codexPresetArgs.join("\n"), envText: "" },
    "claude-code": { id: "claude-code", name: "Claude Code ACP", adapter: "claude-code", command: "npx", argsText: claudeCodePresetArgs.join("\n"), envText: "" }
  };

  let loading = true;
  let saving = false;
  let message = "";
  let error = "";
  let enabled = true;
  let targets: TargetForm[] = [];
  let projects: ProjectForm[] = [];

  function parseArgsText(input: string): string[] {
    return input.split("\n").map((value) => value.trim()).filter(Boolean);
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
      if (separatorIndex <= 0) throw new Error(`Invalid env line '${line}'. Use KEY=VALUE.`);
      const key = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1).trim();
      if (!key) throw new Error(`Invalid env line '${line}'. Missing key.`);
      env[key] = value;
    }
    return env;
  }

  function formatEnv(input: unknown): string {
    if (!input || typeof input !== "object" || Array.isArray(input)) return "";
    return Object.entries(input as Record<string, unknown>).map(([key, value]) => `${key}=${String(value ?? "")}`).join("\n");
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
        id, name: String(item.name ?? id).trim() || id,
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
        ? item.allowedTargetIds.map((value) => String(value ?? "").trim()).filter(Boolean) : [];
      return {
        id, name: String(item.name ?? id).trim() || id,
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
      targets = [...targets, { id: `target-${nextIndex}`, name: `Target ${nextIndex}`, adapter, enabled: true, command: "", argsText: "", envText: "", cwd: "" }];
      return;
    }
    const preset = adapterPresets[adapter];
    targets = [...targets, { ...preset, id: targets.some((t) => t.id === preset.id) ? `${preset.id}-${nextIndex}` : preset.id, enabled: true, cwd: "" }];
  }

  function addProject(): void {
    const nextIndex = projects.length + 1;
    projects = [...projects, { id: `project-${nextIndex}`, name: `Project ${nextIndex}`, enabled: true, path: "", allowedTargetIds: [], defaultApprovalMode: "manual" as ApprovalMode }];
  }

  function removeTarget(index: number): void {
    const removed = targets[index]?.id ?? "";
    targets = targets.filter((_, i) => i !== index);
    if (!removed) return;
    projects = projects.map((p) => ({ ...p, allowedTargetIds: p.allowedTargetIds.filter((id) => id !== removed) }));
  }

  function removeProject(index: number): void {
    projects = projects.filter((_, i) => i !== index);
  }

  function updateProjectTarget(projectIndex: number, targetId: string, checked: boolean): void {
    projects = projects.map((p, i) => {
      if (i !== projectIndex) return p;
      const nextIds = checked ? Array.from(new Set([...p.allowedTargetIds, targetId])) : p.allowedTargetIds.filter((id) => id !== targetId);
      return { ...p, allowedTargetIds: nextIds };
    });
  }

  function validateUniqueIds(kind: string, ids: string[]): void {
    const seen = new Set<string>();
    for (const id of ids) {
      if (!id) throw new Error(`${kind} id is required.`);
      if (seen.has(id)) throw new Error(`Duplicate ${kind} id '${id}'.`);
      seen.add(id);
    }
  }

  function buildPayload() {
    validateUniqueIds("target", targets.map((t) => t.id.trim()));
    validateUniqueIds("project", projects.map((p) => p.id.trim()));
    const targetPayload = targets.map((target) => {
      const id = target.id.trim();
      const command = target.command.trim();
      if (!command) throw new Error(`Target '${id}' is missing command.`);
      return { id, name: target.name.trim() || id, adapter: normalizeAdapter(target.adapter), enabled: target.enabled, command, args: parseArgsText(target.argsText), env: parseEnvText(target.envText), cwd: target.cwd.trim() };
    });
    const allowedTargetIds = new Set(targetPayload.map((t) => t.id));
    const projectPayload = projects.map((project) => {
      const id = project.id.trim();
      const path = project.path.trim();
      if (!path) throw new Error(`Project '${id}' is missing path.`);
      if (!path.startsWith("/")) throw new Error(`Project '${id}' path must be absolute.`);
      const nextAllowedTargets = project.allowedTargetIds.map((tid) => tid.trim()).filter(Boolean);
      for (const tid of nextAllowedTargets) {
        if (!allowedTargetIds.has(tid)) throw new Error(`Project '${id}' references unknown target '${tid}'.`);
      }
      return { id, name: project.name.trim() || id, enabled: project.enabled, path, allowedTargetIds: nextAllowedTargets, defaultApprovalMode: normalizeApprovalMode(project.defaultApprovalMode) };
    });
    return { enabled, targets: targetPayload, projects: projectPayload };
  }

  async function loadSettings(): Promise<void> {
    loading = true; error = ""; message = "";
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
      enabled = true; targets = []; projects = [];
    } finally {
      loading = false;
    }
  }

  async function save(): Promise<void> {
    saving = true; error = ""; message = "";
    try {
      const payload = buildPayload();
      const res = await fetch("/api/settings", {
        method: "PUT", headers: { "Content-Type": "application/json" },
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

<div class="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8 sm:px-10 sm:py-10">
  <header class="flex flex-col gap-3">
    <Badge variant="secondary" class="w-fit">Control Plane</Badge>
    <div class="flex max-w-3xl flex-col gap-2">
      <h1 class="text-3xl font-semibold tracking-tight text-foreground">ACP Targets</h1>
      <p class="text-sm leading-6 text-muted-foreground">
        Configure coding-agent adapters and the project allowlist used by Telegram ACP commands. Projects must use absolute paths, and approval defaults are applied when a new ACP session starts.
      </p>
    </div>
    <div class="flex items-center gap-2">
      <Button variant="outline" onclick={loadSettings} disabled={loading || saving}>Refresh</Button>
      <Button variant="default" onclick={save} disabled={loading || saving}>
        {saving ? "Saving..." : "Save ACP Settings"}
      </Button>
    </div>
  </header>

  {#if message}
    <Alert variant="default"><AlertDescription>{message}</AlertDescription></Alert>
  {/if}
  {#if error}
    <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
  {/if}

  {#if loading}
    <p class="py-8 text-sm text-muted-foreground">Loading ACP settings...</p>
  {:else}
    <form class="space-y-6" onsubmit={(e) => { e.preventDefault(); save(); }}>
      <Card>
        <CardHeader>
          <CardTitle class="text-sm">Global Switch</CardTitle>
          <CardDescription>
            Disable ACP here if you want Telegram commands to stay visible in code but reject new coding sessions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div class="flex items-center gap-3">
            <Checkbox id="acp-enabled" bind:checked={enabled} />
            <Label for="acp-enabled" class="text-sm">Enable ACP control plane</Label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle class="text-sm">Targets</CardTitle>
              <CardDescription>
                One target equals one ACP adapter process. Built-in presets are <code class="font-mono text-xs">codex</code> = <code class="font-mono text-xs">npx {codexPresetArgs.join(" ")}</code> and <code class="font-mono text-xs">claude-code</code> = <code class="font-mono text-xs">npx {claudeCodePresetArgs.join(" ")}</code>.
              </CardDescription>
            </div>
            <div class="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onclick={() => addTarget("codex")} type="button">Add Codex</Button>
              <Button variant="outline" size="sm" onclick={() => addTarget("claude-code")} type="button">Add Claude Code</Button>
              <Button variant="outline" size="sm" onclick={() => addTarget("custom")} type="button">Add Custom</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent class="space-y-4">
          {#if targets.length === 0}
            <div class="rounded-xl border border-dashed bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
              No ACP targets configured.
            </div>
          {:else}
            {#each targets as target, index}
              <div class="space-y-4 rounded-xl border bg-background p-4">
                <div class="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 class="text-sm font-semibold text-foreground">{target.name || target.id || `Target ${index + 1}`}</h3>
                    <p class="text-xs text-muted-foreground">Adapter id must stay stable because projects reference it.</p>
                  </div>
                  <Button variant="destructive" size="sm" type="button" onclick={() => removeTarget(index)}>Remove</Button>
                </div>

                <div class="grid gap-4 md:grid-cols-2">
                  <div class="grid gap-1.5">
                    <Label for="acp-tid-{index}">Target ID</Label>
                    <Input id="acp-tid-{index}" bind:value={target.id} />
                  </div>
                  <div class="grid gap-1.5">
                    <Label for="acp-tname-{index}">Display Name</Label>
                    <Input id="acp-tname-{index}" bind:value={target.name} />
                  </div>
                  <div class="grid gap-1.5">
                    <Label for="acp-tadapter-{index}">Adapter</Label>
                    <NativeSelect id="acp-tadapter-{index}" bind:value={target.adapter}>
                      {#each adapterKinds as ak}
                        <NativeSelectOption value={ak}>{ak}</NativeSelectOption>
                      {/each}
                    </NativeSelect>
                  </div>
                  <div class="grid gap-1.5 md:col-span-2">
                    <Label for="acp-tcmd-{index}">Command</Label>
                    <Input id="acp-tcmd-{index}" bind:value={target.command} placeholder="npx" />
                  </div>
                  <div class="grid gap-1.5">
                    <Label for="acp-targs-{index}">Args (one per line)</Label>
                    <Textarea id="acp-targs-{index}" class="min-h-[120px] font-mono text-xs" bind:value={target.argsText} placeholder={target.adapter === "claude-code" ? "-y\n@zed-industries/claude-code-acp" : "-y\n@zed-industries/codex-acp"} />
                  </div>
                  <div class="grid gap-1.5">
                    <Label for="acp-tenv-{index}">Env (KEY=VALUE per line)</Label>
                    <Textarea id="acp-tenv-{index}" class="min-h-[120px] font-mono text-xs" bind:value={target.envText} placeholder={target.adapter === "claude-code" ? "ANTHROPIC_API_KEY=..." : "OPENAI_API_KEY=..."} />
                  </div>
                  <div class="grid gap-1.5">
                    <Label for="acp-tcwd-{index}">Working Directory Override</Label>
                    <Input id="acp-tcwd-{index}" bind:value={target.cwd} placeholder="." />
                  </div>
                  <div class="flex items-center gap-3 pt-7">
                    <Checkbox id="acp-tenabled-{index}" bind:checked={target.enabled} />
                    <Label for="acp-tenabled-{index}" class="text-sm">Target enabled</Label>
                  </div>
                </div>
              </div>
            {/each}
          {/if}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle class="text-sm">Projects</CardTitle>
              <CardDescription>
                Projects are the ACP allowlist. Telegram should select these by stable id instead of sending raw paths.
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onclick={addProject} type="button">Add Project</Button>
          </div>
        </CardHeader>
        <CardContent class="space-y-4">
          {#if projects.length === 0}
            <div class="rounded-xl border border-dashed bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
              No ACP projects configured.
            </div>
          {:else}
            {#each projects as project, index}
              <div class="space-y-4 rounded-xl border bg-background p-4">
                <div class="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 class="text-sm font-semibold text-foreground">{project.name || project.id || `Project ${index + 1}`}</h3>
                    <p class="text-xs text-muted-foreground">Path must be absolute. Approval mode becomes the session default in Telegram ACP.</p>
                  </div>
                  <Button variant="destructive" size="sm" type="button" onclick={() => removeProject(index)}>Remove</Button>
                </div>

                <div class="grid gap-4 md:grid-cols-2">
                  <div class="grid gap-1.5">
                    <Label for="acp-pid-{index}">Project ID</Label>
                    <Input id="acp-pid-{index}" bind:value={project.id} />
                  </div>
                  <div class="grid gap-1.5">
                    <Label for="acp-pname-{index}">Display Name</Label>
                    <Input id="acp-pname-{index}" bind:value={project.name} />
                  </div>
                  <div class="grid gap-1.5 md:col-span-2">
                    <Label for="acp-ppath-{index}">Absolute Path</Label>
                    <Input id="acp-ppath-{index}" bind:value={project.path} placeholder="./your-project" />
                  </div>
                  <div class="grid gap-1.5">
                    <Label for="acp-pmode-{index}">Default Approval Mode</Label>
                    <NativeSelect id="acp-pmode-{index}" bind:value={project.defaultApprovalMode}>
                      {#each approvalModes as mode}
                        <NativeSelectOption value={mode}>{mode}</NativeSelectOption>
                      {/each}
                    </NativeSelect>
                  </div>
                  <div class="flex items-center gap-3 pt-7">
                    <Checkbox id="acp-penabled-{index}" bind:checked={project.enabled} />
                    <Label for="acp-penabled-{index}" class="text-sm">Project enabled</Label>
                  </div>
                </div>

                <div class="space-y-2">
                  <p class="text-sm font-medium text-foreground">Allowed Targets</p>
                  {#if targets.length === 0}
                    <div class="rounded-lg border border-dashed bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                      Add at least one target before binding projects.
                    </div>
                  {:else}
                    <div class="grid gap-2 md:grid-cols-2">
                      {#each targets as target}
                        <label class="flex items-center gap-3 rounded-lg border bg-card px-3 py-2 text-sm">
                          <Checkbox
                            checked={project.allowedTargetIds.includes(target.id)}
                            onchange={(e) => updateProjectTarget(index, target.id, (e.currentTarget as HTMLInputElement).checked)}
                          />
                          <span class="min-w-0">
                            <span class="block truncate font-medium text-foreground">{target.name || target.id}</span>
                            <span class="block truncate text-xs text-muted-foreground">{target.id}</span>
                          </span>
                        </label>
                      {/each}
                    </div>
                  {/if}
                </div>
              </div>
            {/each}
          {/if}
        </CardContent>
      </Card>

      <div class="flex justify-end">
        <Button variant="default" type="submit" disabled={saving}>
          {saving ? "Saving..." : "Save ACP Settings"}
        </Button>
      </div>
    </form>
  {/if}
</div>
