<script lang="ts">
  import { flushSync } from "svelte";
  import Code from "../icons/duotone/components/Code.svelte";
  import Cpu from "../icons/duotone/components/Cpu.svelte";
  import FileText from "../icons/duotone/components/FileText.svelte";
  import FolderOpen from "../icons/duotone/components/FolderOpen.svelte";
  import MagicWand from "../icons/duotone/components/MagicWand.svelte";
  import Palette from "../icons/duotone/components/Palette.svelte";
  import AddSquare from "reicon-svelte/icons/AddSquare";
  import AngleDown from "reicon-svelte/icons/AngleDown";
  import ArrowLeft from "reicon-svelte/icons/ArrowLeft";
  import ArrowRight from "reicon-svelte/icons/ArrowRight";
  import ArrowUpRight from "reicon-svelte/icons/ArrowUpRight";
  import Check from "reicon-svelte/icons/Check";
  import CheckCircle from "reicon-svelte/icons/CheckCircle";
  import Download from "reicon-svelte/icons/Download";
  import Copy from "reicon-svelte/icons/Copy";
  import ArrowsRotate from "reicon-svelte/icons/ArrowsRotate";
  import Reorder from "reicon-svelte/icons/Reorder";
  import FolderOpenIcon from "reicon-svelte/icons/FolderOpen";
  import Magnifier from "reicon-svelte/icons/Magnifier";
  import Warning from "reicon-svelte/icons/Warning";
  import X from "reicon-svelte/icons/X";
  import type { Translation } from "../i18n";
  import ChatHeader from "./ChatHeader.svelte";
  import WorkspaceSearch from "../components/ui/WorkspaceSearch.svelte";
  import AlertDialog from "../components/ui/AlertDialog.svelte";
  import Button from "../components/ui/Button.svelte";
  import Dialog from "../components/ui/Dialog.svelte";
  import EmptyState from "../components/ui/EmptyState.svelte";
  import IosSwitch from "../components/ui/IosSwitch.svelte";
  import SelectControl from "../components/ui/SelectControl.svelte";
  import { renderMarkdown } from "../markdown";
  import { loadDesktopSkillDetail, loadDesktopSkillFile } from "../api";
  import { captureRectMap, listFlip, listIn, listOut, playLayoutFlip } from "../motion/listMotion";
  import {
    consolidateManagedSkill,
    distributeManagedSkill,
    installManagedSkill,
    loadConsolidateCheck,
    loadPreflight,
    loadSkillManager,
    revealManagedSkill,
    saveSkillPlatforms,
    unlinkDistribution,
    skillManagerStore,
    toggleManagedSkill,
    uninstallManagedSkill,
    updateBuiltinSkill
  } from "../stores/skills.svelte";
  import type {
    DesktopDiscoveredSkill,
    DesktopSkillConsolidatePreflight,
    DesktopSkillConsolidateResult,
    DesktopSkillDistributeResult,
    DesktopSkillFileEntry,
    DesktopSkillInstallMethod,
    DesktopSkillManagerDetail,
    DesktopSkillManagerEntry,
    DesktopSkillManagerScope,
    DesktopSkillPlatform,
    DesktopSkillPreflightResult,
    DesktopSkillSourceKind
  } from "@molibot/desktop-contract";

  let { copy, serviceEndpoint, serviceReady }: {
    copy: Translation;
    serviceEndpoint: string | null;
    serviceReady: boolean;
  } = $props();

  type ManagerView = "installed" | "discovered" | "platforms";

  let loadedEndpoint = $state("");
  let query = $state("");
  let view = $state<ManagerView>("installed");
  /**
   * The source facet is the ownership-first split the catalogue needs: a
   * concrete Molibot root (global, an Agent workspace, a Molibot project) or an
   * external platform. It doubles as the group key, so the header and the filter
   * can never disagree.
   */
  let sourceFilter = $state("all");
  let selectedId = $state<string | null>(null);
  let gridEl = $state<HTMLElement | null>(null);

  let detail = $state<DesktopSkillManagerDetail | null>(null);
  let detailLoading = $state(false);
  let detailError = $state("");
  let detailSeq = 0;

  let selectedFile = $state("");
  let expandedDirs = $state<string[]>([]);
  let filePreview = $state<{ path: string; content: string } | null>(null);
  let fileTruncated = $state(false);
  let fileBinary = $state(false);
  let fileLoading = $state(false);
  let fileError = $state("");
  let fileSeq = 0;

  let copiedPath = $state(false);
  let diagnosticsOpen = $state(false);

  // ── Install sheet ────────────────────────────────────────────────────────
  let installOpen = $state(false);
  let installSourceKind = $state<"discovered" | "local" | "git">("discovered");
  let installDiscoveredId = $state("");
  let installLocalPath = $state("");
  let installGitRepo = $state("");
  let installGitRef = $state("");
  let installGitSubdir = $state("");
  let installMethod = $state<"copy" | "link">("copy");
  let installScope = $state<DesktopSkillManagerScope>("global");
  let installOwnerId = $state("");
  let installRename = $state("");
  let preflight = $state<DesktopSkillPreflightResult | null>(null);
  let preflightLoading = $state(false);
  let preflightError = $state("");
  let installing = $state(false);
  let installDone = $state(false);
  let installMessage = $state("");

  // ── Consolidate sheet ────────────────────────────────────────────────────
  let consolidateOpen = $state(false);
  let consolidateSourceKind = $state<"discovered" | "installation">("installation");
  let consolidateSourceId = $state("");
  let consolidateDestination = $state("molibot-global");
  let consolidateSourceAction = $state<"link" | "remove" | "keep">("link");
  let consolidateReplace = $state(false);
  let consolidatePreflight = $state<DesktopSkillConsolidatePreflight | null>(null);
  let consolidateLoading = $state(false);
  let consolidateBusy = $state(false);
  let consolidateError = $state("");
  let consolidateResult = $state<DesktopSkillConsolidateResult | null>(null);

  // ── Distribute sheet ─────────────────────────────────────────────────────
  let distributeOpen = $state(false);
  let distributeTargets = $state<string[]>([]);
  let distributeMethod = $state<"copy" | "link">("copy");
  let distributing = $state(false);
  let distributeResult = $state<DesktopSkillDistributeResult | null>(null);
  let distributeError = $state("");

  // ── Uninstall confirmation ───────────────────────────────────────────────
  let uninstallTarget = $state<DesktopSkillManagerEntry | null>(null);
  let uninstalling = $state(false);
  let uninstallError = $state("");

  // ── Platform editor ──────────────────────────────────────────────────────
  type PlatformDraft = { enabled: boolean; extraRoots: string; removedRoots: string[] };
  // Only the owner's edits live in state; the server row stays the base, so a
  // refresh cannot resurrect stale drafts or lose an unsaved edit.
  let platformEdits = $state<Record<string, Partial<PlatformDraft>>>({});
  let removedPlatforms = $state<string[]>([]);
  let editingRoots = $state<string[]>([]);
  let platformSaved = $state(false);
  let customOpen = $state(false);
  let customLabel = $state("");
  let customRoots = $state("");
  let customError = $state("");

  $effect(() => {
    if (serviceReady && serviceEndpoint && serviceEndpoint !== loadedEndpoint) {
      loadedEndpoint = serviceEndpoint;
      platformEdits = {};
      removedPlatforms = [];
      void loadSkillManager(serviceEndpoint);
    }
  });

  const summary = $derived(skillManagerStore.summary);
  const installedSkills = $derived(summary?.installed ?? []);
  const discoveredSkills = $derived(summary?.discovered ?? []);
  const platforms = $derived((summary?.platforms ?? []).filter((platform) => !removedPlatforms.includes(platform.id)));

  const detailOpen = $derived(selectedId !== null);
  const selectedEntry = $derived(installedSkills.find((skill) => skill.id === selectedId) ?? null);
  const selectedDiscovered = $derived(discoveredSkills.find((skill) => skill.id === selectedId) ?? null);

  let normalizedQuery = $derived(query.trim().toLowerCase());

  function installedSourceKey(skill: DesktopSkillManagerEntry): string {
    if (skill.id.startsWith("builtin:")) return "builtin";
    if (skill.scope === "global") return "molibot-global";
    return `${skill.scope}:${skill.ownerId}`;
  }

  function discoveredSourceKey(skill: DesktopDiscoveredSkill): string {
    return `platform:${skill.platformId}`;
  }

  function installedSourceLabel(key: string, skill?: DesktopSkillManagerEntry): string {
    if (key === "molibot-global") return copy.skillGroupMolibotGlobal;
    if (key === "builtin") return copy.skillGroupBuiltin;
    if (key.startsWith("agent:")) return copy.skillGroupAgent.replace("{name}", skill?.ownerLabel ?? key.slice(6));
    if (key.startsWith("project:")) return copy.skillGroupMolibotProject.replace("{name}", skill?.ownerLabel ?? key.slice(8));
    return copy.skillSourceAll;
  }

  function discoveredSourceLabel(key: string, skill?: DesktopDiscoveredSkill): string {
    return skill?.platformLabel ?? key.replace("platform:", "");
  }

  const filteredSkills = $derived(
    installedSkills.filter((skill) => {
      if (sourceFilter !== "all" && installedSourceKey(skill) !== sourceFilter) return false;
      if (!normalizedQuery) return true;
      return [skill.name, skill.description, skill.scope, skill.ownerLabel, skill.method, skill.source?.label ?? "", skill.readBy.join(" ")]
        .join("\n")
        .toLowerCase()
        .includes(normalizedQuery);
    })
  );
  const filteredDiscovered = $derived(
    discoveredSkills.filter((skill) => {
      if (sourceFilter !== "all" && discoveredSourceKey(skill) !== sourceFilter) return false;
      if (!normalizedQuery) return true;
      return [skill.name, skill.description, skill.platformLabel, skill.sharedWith.join(" "), skill.platformId]
        .join("\n")
        .toLowerCase()
        .includes(normalizedQuery);
    })
  );
  const filteredPlatforms = $derived(
    platforms.filter((platform) => {
      if (!normalizedQuery) return true;
      return [platform.label, platform.summary, platform.sharedWith.join(" ")].join("\n").toLowerCase().includes(normalizedQuery);
    })
  );

  const realSkills = $derived(installedSkills.filter((skill) => !skill.id.startsWith("builtin:")));

  /** Options carry their own counts so the filter answers "how many are here". */
  const sourceOptions = $derived.by(() => {
    if (view === "discovered") {
      const groups = new Map<string, { label: string; count: number }>();
      for (const skill of discoveredSkills) {
        const key = discoveredSourceKey(skill);
        const current = groups.get(key);
        groups.set(key, { label: discoveredSourceLabel(key, skill), count: (current?.count ?? 0) + 1 });
      }
      return [
        { value: "all", label: `${copy.skillSourceAll} (${discoveredSkills.length})` },
        ...[...groups.entries()]
          .sort((a, b) => a[1].label.localeCompare(b[1].label))
          .map(([value, group]) => ({ value, label: `${group.label} (${group.count})` }))
      ];
    }
    const groups = new Map<string, { label: string; count: number }>();
    for (const skill of installedSkills) {
      const key = installedSourceKey(skill);
      const current = groups.get(key);
      groups.set(key, { label: installedSourceLabel(key, skill), count: (current?.count ?? 0) + 1 });
    }
    const rank = (key: string): number => key === "molibot-global" ? 0 : key.startsWith("agent:") ? 1 : key.startsWith("project:") ? 2 : 3;
    return [
      { value: "all", label: `${copy.skillSourceAll} (${installedSkills.length})` },
      ...[...groups.entries()]
        .sort((a, b) => rank(a[0]) - rank(b[0]) || a[1].label.localeCompare(b[1].label))
        .map(([value, group]) => ({ value, label: `${group.label} (${group.count})` }))
    ];
  });

  const installedGroups = $derived.by(() => {
    const groups = new Map<string, { id: string; label: string; items: DesktopSkillManagerEntry[] }>();
    for (const skill of filteredSkills) {
      const key = installedSourceKey(skill);
      const group = groups.get(key) ?? { id: key, label: installedSourceLabel(key, skill), items: [] };
      group.items.push(skill);
      groups.set(key, group);
    }
    const rank = (key: string): number => key === "molibot-global" ? 0 : key.startsWith("agent:") ? 1 : key.startsWith("project:") ? 2 : 3;
    return [...groups.values()].sort((a, b) => rank(a.id) - rank(b.id) || a.label.localeCompare(b.label));
  });

  const discoveredGroups = $derived.by(() => {
    const groups = new Map<string, { id: string; label: string; items: DesktopDiscoveredSkill[] }>();
    for (const skill of filteredDiscovered) {
      const key = discoveredSourceKey(skill);
      const group = groups.get(key) ?? { id: key, label: discoveredSourceLabel(key, skill), items: [] };
      group.items.push(skill);
      groups.set(key, group);
    }
    return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
  });

  const viewCounts = $derived.by(() => ({
    installed: realSkills.length,
    discovered: discoveredSkills.length,
    platforms: platforms.length
  }));

  const platformsDirty = $derived.by(() => {
    if (!summary) return false;
    if (removedPlatforms.length > 0) return true;
    return summary.platforms.some((platform) => {
      const draft = draftFor(platform);
      return draft.enabled !== platform.enabled || draft.extraRoots.trim() !== "" || draft.removedRoots.length > 0;
    });
  });

  const previewHtml = $derived(filePreview && isMarkdown(filePreview.path) ? renderMarkdown(stripFrontmatter(filePreview.content), copy.copyCode) : "");
  const activeDistributions = $derived((detail?.distributions ?? []).filter((distribution) => distribution.status === "active"));

  interface SkillFileRow {
    path: string;
    name: string;
    kind: "file" | "dir";
    size: number;
    depth: number;
    expanded: boolean;
  }

  /**
   * A real tree, not a flat dump: directories start collapsed and reveal their
   * children on click. `detail.files` is a complete listing, so the tree is built
   * from parent paths instead of asking the server for another shape.
   */
  function buildFileRows(files: DesktopSkillFileEntry[], expanded: string[]): SkillFileRow[] {
    const byPath = new Map(files.map((entry) => [entry.path, entry]));
    const children = new Map<string, string[]>();
    for (const entry of files) {
      const slash = entry.path.lastIndexOf("/");
      const parent = slash < 0 ? "" : entry.path.slice(0, slash);
      const list = children.get(parent) ?? [];
      list.push(entry.path);
      children.set(parent, list);
    }
    for (const list of children.values()) {
      list.sort((a, b) => {
        const left = byPath.get(a);
        const right = byPath.get(b);
        if (!left || !right) return 0;
        if (left.kind !== right.kind) return left.kind === "dir" ? -1 : 1;
        return left.path.localeCompare(right.path);
      });
    }

    const rows: SkillFileRow[] = [];
    const walk = (parent: string, depth: number): void => {
      for (const path of children.get(parent) ?? []) {
        const entry = byPath.get(path);
        if (!entry) continue;
        const isExpanded = entry.kind === "dir" && expanded.includes(path);
        rows.push({
          path,
          name: path.split("/").pop() ?? path,
          kind: entry.kind,
          size: entry.size,
          depth,
          expanded: isExpanded
        });
        if (isExpanded) walk(path, depth + 1);
      }
    };
    walk("", 0);
    return rows;
  }

  const fileRows = $derived(buildFileRows(detail?.files ?? [], expandedDirs));

  function toggleDirectory(path: string): void {
    expandedDirs = expandedDirs.includes(path)
      ? expandedDirs.filter((entry) => entry !== path)
      : [...expandedDirs, path];
  }

  const scopeOptions = $derived.by(() => {
    const targets = summary?.targets ?? [];
    const options: Array<{ value: string; label: string }> = [{ value: "global", label: copy.skillScopeGlobal }];
    for (const target of targets) {
      if (target.kind === "project") options.push({ value: `project:${target.id}`, label: `${copy.skillScopeProject} · ${target.label}` });
    }
    for (const agent of summary?.agents ?? []) {
      options.push({ value: `agent:${agent.id}`, label: `${copy.skillScopeAgent} · ${agent.label}` });
    }
    return options;
  });

  function scopeLabel(scope: string, ownerLabel: string): string {
    if (scope === "agent") return ownerLabel ? `${copy.skillScopeAgent} · ${ownerLabel}` : copy.skillScopeAgent;
    if (scope === "project") return ownerLabel ? `${copy.skillScopeProject} · ${ownerLabel}` : copy.skillScopeProject;
    return copy.skillScopeGlobal;
  }

  function methodLabel(method: DesktopSkillInstallMethod): string {
    if (method === "link") return copy.skillMethodLink;
    if (method === "external") return copy.skillMethodExternal;
    return copy.skillMethodCopy;
  }

  const noticeText = $derived(
    skillManagerStore.notice === "installed" ? copy.skillNoticeInstalled
      : skillManagerStore.notice === "replaced" ? copy.skillNoticeReplaced
        : skillManagerStore.notice === "removed" ? copy.skillNoticeRemoved
          : skillManagerStore.notice === "builtin" ? copy.skillNoticeBuiltin
            : ""
  );

  /** One plural-aware template read, so counts never read "1 files". */
  function countText(template: string, oneTemplate: string, value: number): string {
    return (value === 1 ? oneTemplate : template).replace("{count}", String(value));
  }

  function runtimeText(reason: string): string {
    if (reason === "loaded") return copy.skillDetailRuntimeLoaded;
    if (reason === "disabled") return copy.skillDetailRuntimeDisabled;
    if (reason === "duplicate_name") return copy.skillDetailRuntimeDuplicate;
    if (reason === "invalid") return copy.skillDetailRuntimeInvalid;
    if (reason === "missing") return copy.skillDetailRuntimeMissing;
    if (reason === "no_workspace") return copy.skillDetailRuntimeNoWorkspace;
    return copy.skillDetailRuntimeNotLoaded;
  }

  function conflictText(code: string, fallback: string): string {
    if (code === "external_content") return copy.skillConflictExternal;
    if (code === "invalid_name") return copy.skillConflictInvalidName;
    if (code === "symlink_escape") return copy.skillConflictLinkEscape;
    if (code === "symlink_loop") return copy.skillConflictLinkLoop;
    if (code === "too_many_files") return copy.skillConflictTooMany;
    if (code === "total_too_large") return copy.skillConflictTooLarge;
    if (code === "file_too_large") return copy.skillConflictFileTooLarge;
    if (code === "link_rename_unsupported") return copy.skillConflictLinkRename;
    if (code === "link_unsupported") return copy.skillConflictLinkUnsupported;
    if (code === "missing_frontmatter" || code === "missing_name" || code === "missing_description" || code === "unreadable") return copy.skillConflictInvalidSkill;
    if (code === "invalid_target") return copy.skillConflictInvalidTarget;
    return fallback;
  }

  function healthLabel(health: string): string {
    if (health === "missing") return copy.skillHealthMissing;
    if (health === "broken") return copy.skillHealthBroken;
    if (health === "invalid") return copy.skillHealthInvalid;
    if (health === "unmanaged") return copy.skillHealthUnmanaged;
    if (health === "disabled") return copy.providerDisabled;
    return "";
  }

  function isMarkdown(path: string): boolean {
    const lower = path.toLowerCase();
    return lower.endsWith(".md") || lower.endsWith(".markdown");
  }

  function stripFrontmatter(content: string): string {
    return content.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/, "");
  }

  function formatBytes(size: number): string {
    if (!size) return "";
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }

  function formatModified(iso: string): string {
    if (!iso) return "—";
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
  }

  function flipCards(mutate: () => void): void {
    const cards = gridEl ? Array.from(gridEl.querySelectorAll<HTMLElement>(".installed-skill-card")) : [];
    const before = captureRectMap(cards);
    mutate();
    flushSync();
    playLayoutFlip(before);
  }

  function openSkill(skillId: string): void {
    if (selectedId === skillId) return;
    if (selectedId === null) flipCards(() => { selectedId = skillId; });
    else selectedId = skillId;
    void loadDetail(skillId);
  }

  function openSkillFromEvent(skillId: string, event: MouseEvent): void {
    if ((event.target as HTMLElement | null)?.closest("button, label, input, a")) return;
    openSkill(skillId);
  }

  function skillCardKeydown(skillId: string, event: KeyboardEvent): void {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openSkill(skillId);
    }
  }

  function closeSkill(): void {
    if (selectedId === null) return;
    flipCards(() => { selectedId = null; });
    detailSeq += 1;
    fileSeq += 1;
    detail = null;
    expandedDirs = [];
    detailError = "";
    selectedFile = "";
    filePreview = null;
    fileError = "";
    fileTruncated = false;
    fileBinary = false;
    detailLoading = false;
    fileLoading = false;
  }

  function switchView(next: ManagerView): void {
    if (view === next) return;
    closeSkill();
    view = next;
    sourceFilter = "all";
  }

  async function loadDetail(skillId: string): Promise<void> {
    const endpoint = serviceEndpoint;
    if (!endpoint) return;
    const seq = ++detailSeq;
    detailLoading = true;
    detailError = "";
    try {
      const next = await loadDesktopSkillDetail(endpoint, skillId);
      if (seq !== detailSeq) return;
      detail = next;
      expandedDirs = [];
      const skillFile = next.files.find((entry) => entry.kind === "file" && entry.path.toLowerCase() === "skill.md")
        ?? next.files.find((entry) => entry.kind === "file");
      selectedFile = skillFile?.path ?? "";
      if (selectedFile) void loadPreview(selectedFile);
    } catch (cause) {
      if (seq === detailSeq) {
        detail = null;
        detailError = cause instanceof Error ? cause.message : String(cause);
      }
    } finally {
      if (seq === detailSeq) detailLoading = false;
    }
  }

  async function loadPreview(path: string): Promise<void> {
    const endpoint = serviceEndpoint;
    const id = selectedId;
    if (!endpoint || !id || !path) return;
    const seq = ++fileSeq;
    fileLoading = true;
    fileError = "";
    try {
      const next = await loadDesktopSkillFile(endpoint, id, path);
      if (seq !== fileSeq) return;
      filePreview = { path: next.path, content: next.content };
      fileTruncated = next.truncated;
      fileBinary = next.binary;
    } catch (cause) {
      if (seq === fileSeq) {
        filePreview = null;
        fileError = cause instanceof Error ? cause.message : String(cause);
      }
    } finally {
      if (seq === fileSeq) fileLoading = false;
    }
  }

  function selectFile(entry: { path: string; kind: "file" | "dir" }): void {
    if (entry.kind !== "file" || entry.path === selectedFile) return;
    selectedFile = entry.path;
    void loadPreview(entry.path);
  }

  async function copyPath(): Promise<void> {
    if (!detail) return;
    try {
      await navigator.clipboard.writeText(detail.baseDir);
      copiedPath = true;
      setTimeout(() => (copiedPath = false), 1400);
    } catch {
      detailError = copy.skillDetailFileFailed;
    }
  }

  async function revealDir(): Promise<void> {
    if (!selectedId) return;
    await revealManagedSkill(selectedId);
  }

  function getSkillVisual(skill: { id: string; name: string }): {
    icon: typeof Code;
    tone: "code" | "doc" | "design" | "agent" | "default";
  } {
    const text = `${skill.id} ${skill.name}`.toLowerCase();
    if (/code|git|review|refactor|terminal|bash|debug|lint|branch|test/.test(text)) return { icon: Code, tone: "code" };
    if (/doc|prose|markdown|reading|book|writing|standards|audit|trim/.test(text)) return { icon: FileText, tone: "doc" };
    if (/design|taste|ui|theme|css|style|frontend|minimalist|color|visual/.test(text)) return { icon: Palette, tone: "design" };
    if (/agent|runtime|subagent|workflow|schedule|cron|steer|co-founder/.test(text)) return { icon: Cpu, tone: "agent" };
    return { icon: MagicWand, tone: "default" };
  }

  // ── Install flow ─────────────────────────────────────────────────────────

  function openInstallFor(skill?: DesktopDiscoveredSkill): void {
    installOpen = true;
    installDone = false;
    installMessage = "";
    preflight = null;
    preflightError = "";
    installSourceKind = skill ? "discovered" : "discovered";
    installDiscoveredId = skill?.id ?? firstDiscoveredId();
    installLocalPath = "";
    installGitRepo = "";
    installGitRef = "";
    installGitSubdir = "";
    installMethod = "copy";
    installScope = "global";
    installOwnerId = "";
    installRename = "";
    if (installDiscoveredId) void runPreflight();
  }

  function firstDiscoveredId(): string {
    return discoveredSkills[0]?.id ?? "";
  }

  function installRequest() {
    if (installSourceKind === "discovered") {
      if (!installDiscoveredId) throw new Error(copy.skillInstallSourceRequired);
      return {
        source: { kind: "discovered" as const, id: installDiscoveredId },
        method: installMethod,
        scope: installScope,
        ownerId: installScope === "global" ? undefined : installOwnerId,
        rename: installMethod === "copy" ? installRename.trim() || undefined : undefined
      };
    }
    if (installSourceKind === "local") {
      if (!installLocalPath.trim()) throw new Error(copy.skillInstallSourceRequired);
      return {
        source: { kind: "local" as const, path: installLocalPath.trim() },
        method: installMethod,
        scope: installScope,
        ownerId: installScope === "global" ? undefined : installOwnerId,
        rename: installMethod === "copy" ? installRename.trim() || undefined : undefined
      };
    }
    if (!installGitRepo.trim() || !installGitSubdir.trim()) throw new Error(copy.skillInstallSourceRequired);
    return {
      source: {
        kind: "git" as const,
        repository: installGitRepo.trim(),
        ref: installGitRef.trim() || undefined,
        subdirectory: installGitSubdir.trim()
      },
      method: installMethod,
      scope: installScope,
      ownerId: installScope === "global" ? undefined : installOwnerId,
      rename: installMethod === "copy" ? installRename.trim() || undefined : undefined
    };
  }

  async function runPreflight(): Promise<void> {
    preflightLoading = true;
    preflightError = "";
    installDone = false;
    try {
      preflight = await loadPreflight(installRequest());
    } catch (cause) {
      preflight = null;
      preflightError = cause instanceof Error ? cause.message : String(cause);
    } finally {
      preflightLoading = false;
    }
  }

  async function confirmInstall(): Promise<void> {
    if (!preflight) return;
    installing = true;
    installMessage = "";
    try {
      const result = await installManagedSkill({
        ...installRequest(),
        token: preflight.token,
        replace: preflight.requiresReplace
      });
      if (result.ok) {
        installDone = true;
        installMessage = result.message;
      } else {
        installMessage = result.status === "stale" ? copy.skillInstallStale : result.message;
        if (result.status === "stale") await runPreflight();
      }
    } catch (cause) {
      installMessage = cause instanceof Error ? cause.message : String(cause);
    } finally {
      installing = false;
    }
  }

  function sourceValue(): string {
    if (installSourceKind === "discovered") return installDiscoveredId;
    if (installSourceKind === "local") return installLocalPath;
    return installGitRepo;
  }

  // ── Distribute / uninstall ───────────────────────────────────────────────

  function consolidateDestinationOptions(): Array<{ value: string; label: string }> {
    const options: Array<{ value: string; label: string }> = [{ value: "molibot-global", label: copy.skillConsolidateGlobal }];
    for (const target of summary?.targets ?? []) {
      if (target.kind !== "project") continue;
      options.push({
        value: target.id,
        label: copy.skillConsolidateProject.replace("{name}", target.label)
      });
    }
    return options;
  }

  function consolidateRequest() {
    const destination = consolidateDestination === "molibot-global"
      ? { kind: "molibot-global" as const }
      : { kind: "project" as const, ownerId: consolidateDestination };
    return {
      sourceKind: consolidateSourceKind,
      id: consolidateSourceId,
      destination,
      sourceAction: consolidateSourceAction,
      replaceDestination: consolidateReplace
    };
  }

  async function runConsolidatePreflight(): Promise<void> {
    consolidateLoading = true;
    consolidateError = "";
    consolidateResult = null;
    consolidatePreflight = null;
    try {
      consolidatePreflight = await loadConsolidateCheck(consolidateRequest());
    } catch (cause) {
      consolidateError = cause instanceof Error ? cause.message : String(cause);
    } finally {
      consolidateLoading = false;
    }
  }

  function openConsolidate(): void {
    if (!detail || detail.id.startsWith("builtin:")) return;
    consolidateOpen = true;
    consolidateSourceKind = detail.kind === "discovered" ? "discovered" : "installation";
    consolidateSourceId = detail.id;
    consolidateDestination = "molibot-global";
    consolidateSourceAction = "link";
    consolidateReplace = false;
    consolidateError = "";
    consolidateResult = null;
    avoidStaleConsolidate();
  }

  function avoidStaleConsolidate(): void {
    consolidatePreflight = null;
    void runConsolidatePreflight();
  }

  async function confirmConsolidate(): Promise<void> {
    if (!consolidatePreflight) return;
    consolidateBusy = true;
    consolidateError = "";
    try {
      const result = await consolidateManagedSkill({ ...consolidateRequest(), token: consolidatePreflight.token });
      if (result.ok) {
        consolidateResult = result;
        // A consolidated external Skill is no longer a discovered row: its
        // content now lives in the canonical copy. Leaving an empty detail pane
        // open would strand the reader on a stale selection.
        if (consolidateSourceKind === "discovered") closeSkill();
        else void loadDetail(result.id);
      } else {
        consolidateError = result.status === "stale" ? copy.skillInstallStale : result.message;
        if (result.status === "stale") await runConsolidatePreflight();
      }
    } catch (cause) {
      consolidateError = cause instanceof Error ? cause.message : String(cause);
    } finally {
      consolidateBusy = false;
    }
  }

  function openDistribute(): void {
    distributeOpen = true;
    distributeResult = null;
    distributeError = "";
    distributeMethod = detail?.method === "link" ? "link" : "copy";
    distributeTargets = (summary?.targets ?? []).filter((target) => target.writable).map((target) => `${target.kind}:${target.id}`);
  }

  function targetKey(target: { kind: string; id: string }): string {
    return `${target.kind}:${target.id}`;
  }

  function toggleDistributeTarget(key: string): void {
    distributeTargets = distributeTargets.includes(key)
      ? distributeTargets.filter((item) => item !== key)
      : [...distributeTargets, key];
  }

  async function confirmDistribute(): Promise<void> {
    if (!detail) return;
    distributing = true;
    distributeError = "";
    try {
      distributeResult = await distributeManagedSkill({
        installationId: detail.id,
        method: distributeMethod,
        targets: distributeTargets.map((key) => {
          const [kind, ...rest] = key.split(":");
          return { kind: kind === "project" ? "project" as const : "platform" as const, id: rest.join(":") };
        })
      });
    } catch (cause) {
      distributeError = cause instanceof Error ? cause.message : String(cause);
    } finally {
      distributing = false;
    }
  }

  async function confirmUninstall(): Promise<void> {
    if (!uninstallTarget) return;
    uninstalling = true;
    uninstallError = "";
    try {
      const result = await uninstallManagedSkill(uninstallTarget.id);
      if (result.ok) {
        if (detail?.id === uninstallTarget.id) closeSkill();
        uninstallTarget = null;
      } else {
        uninstallError = result.blockedBy.length
          ? `${result.message}: ${result.blockedBy.map((entry) => entry.targetPath).join(", ")}`
          : result.message;
      }
    } catch (cause) {
      uninstallError = cause instanceof Error ? cause.message : String(cause);
    } finally {
      uninstalling = false;
    }
  }

  // ── Platforms ────────────────────────────────────────────────────────────

  function draftFor(platform: DesktopSkillPlatform): PlatformDraft {
    const base: PlatformDraft = { enabled: platform.enabled, extraRoots: "", removedRoots: [] };
    return { ...base, ...platformEdits[platform.id] };
  }

  function setDraft(platform: DesktopSkillPlatform, patch: Partial<PlatformDraft>): void {
    platformEdits = { ...platformEdits, [platform.id]: { ...draftFor(platform), ...patch } };
    platformSaved = false;
  }

  function toggleRemovedRoot(platform: DesktopSkillPlatform, path: string): void {
    const draft = draftFor(platform);
    const removedRoots = draft.removedRoots.includes(path)
      ? draft.removedRoots.filter((item) => item !== path)
      : [...draft.removedRoots, path];
    setDraft(platform, { removedRoots });
  }

  async function savePlatforms(): Promise<void> {
    if (!summary) return;
    const rows = summary.platforms
      .filter((platform) => !removedPlatforms.includes(platform.id))
      .map((platform) => {
        const draft = draftFor(platform);
        return {
          id: platform.id,
          kind: platform.kind,
          label: platform.label,
          enabled: draft.enabled,
          extraRoots: draft.extraRoots.split("\n").map((line) => line.trim()).filter(Boolean),
          removedRoots: draft.removedRoots
        };
      });
    const ok = await saveSkillPlatforms({ platforms: rows, removed: removedPlatforms });
    if (ok) {
      platformSaved = true;
      platformEdits = {};
      removedPlatforms = [];
      setTimeout(() => (platformSaved = false), 4000);
    }
  }

  async function addCustomPlatform(): Promise<void> {
    const label = customLabel.trim();
    const roots = customRoots.split("\n").map((line) => line.trim()).filter(Boolean);
    if (!label || roots.length === 0) {
      customError = copy.skillPlatformNoRoots;
      return;
    }
    const id = `custom:${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "platform"}`;
    const ok = await saveSkillPlatforms({
      platforms: [{ id, kind: "custom", label, enabled: true, extraRoots: roots, removedRoots: [] }]
    });
    if (ok) {
      customOpen = false;
      customLabel = "";
      customRoots = "";
      customError = "";
    }
  }

  function removeCustomPlatform(id: string): void {
    removedPlatforms = [...removedPlatforms, id];
    platformSaved = false;
  }
</script>

{#snippet headerActions()}
  <div class="workspace-header-tools">
    <WorkspaceSearch value={query} label={copy.skillsFilter} placeholder={copy.skillsFilterHint} closeLabel={copy.closeSearch} onInput={(value) => (query = value)} />
    <Button variant="icon" title={copy.skillInstallCta} onclick={() => openInstallFor()}>
      <AddSquare size={17} aria-hidden="true" />
    </Button>
  </div>
{/snippet}
<ChatHeader title={copy.skillsSquare} actions={headerActions} />
<div class="skills-shell">
  <p class="workspace-description" title={copy.skillsSquareHint}>{copy.skillManagerDescription}</p>

  {#if summary}
    <div class="skills-device" aria-label={copy.skillManagerDeviceServer}>
      <span class="skills-device-dot" data-health={summary.counts.anomalies > 0 ? "warn" : "ok"} aria-hidden="true"></span>
      <div class="skills-device-copy">
        <strong>{summary.device.label}</strong>
        <span>{copy.skillManagerDeviceServer} · {copy.skillLastScan.replace("{time}", new Date(summary.device.scannedAt).toLocaleTimeString())}</span>
      </div>
      <button
        class="skills-device-link"
        type="button"
        aria-expanded={diagnosticsOpen}
        onclick={() => (diagnosticsOpen = !diagnosticsOpen)}
      >
        {#if summary.diagnostics.length}<Warning size={13} aria-hidden="true" />{/if}
        {copy.skillManagerDiagnostics}
        {#if summary.diagnostics.length}<span class="skills-device-count">{summary.diagnostics.length}</span>{/if}
      </button>
      <Button variant="icon" title={copy.skillManagerDeviceRefresh} onclick={() => serviceEndpoint && void loadSkillManager(serviceEndpoint)}>
        <ArrowsRotate size={14} aria-hidden="true" />
      </Button>
    </div>
    {#if diagnosticsOpen}
      <div class="skills-diagnostics" role="region" aria-label={copy.skillManagerDiagnostics}>
        {#if summary.diagnostics.length === 0}
          <p>{copy.skillManagerDiagnosticsEmpty}</p>
        {:else}
          <ul>
            {#each summary.diagnostics as diagnostic}
              <li><code translate="no">{diagnostic.platformId || "scan"}</code><span>{diagnostic.message}</span></li>
            {/each}
          </ul>
        {/if}
      </div>
    {/if}
  {/if}

  <div class="workspace-filterbar">
    <div class="segmented workspace-skill-filters" role="group" aria-label={copy.skillsSquare}>
      {#each [
        { value: "installed", label: copy.skillViewInstalled, count: viewCounts.installed },
        { value: "discovered", label: copy.skillViewDiscovered, count: viewCounts.discovered },
        { value: "platforms", label: copy.skillViewPlatforms, count: viewCounts.platforms }
      ] as category (category.value)}
        <Button class={`segmented-item${view === category.value ? " active" : ""}`} aria-pressed={view === category.value} onclick={() => switchView(category.value as ManagerView)}>{category.label} <span class="workspace-category-count">{category.count}</span></Button>
      {/each}
    </div>
    {#if view === "platforms"}
      <span class="workspace-filter-summary">{copy.skillPlatformsHint}</span>
    {:else}
      <div class="skills-source-filter">
        <SelectControl
          value={sourceFilter}
          ariaLabel={copy.skillSourceLabel}
          options={sourceOptions}
          onChange={(value) => { sourceFilter = value; closeSkill(); }}
        />
      </div>
      <span class="workspace-filter-summary">
        {view === "discovered" ? copy.skillDiscoveredHint : copy.skillMolibotHint}
      </span>
    {/if}
  </div>

  {#if skillManagerStore.actionError}<p class="workspace-inline-warning" role="alert">{skillManagerStore.actionError}</p>{/if}
  {#if noticeText}<p class="workspace-inline-status" role="status">{noticeText}</p>{/if}
  {#if platformSaved}<p class="workspace-inline-status" role="status">{copy.skillPlatformSaved}</p>{/if}

  {#if !serviceReady}
    <div class="workspace-empty"><p>{copy.skillsUnavailable}</p></div>
  {:else if skillManagerStore.loading}
    <div class="workspace-empty"><p>{copy.loading}</p></div>
  {:else if skillManagerStore.error && !summary}
    <div class="workspace-empty" role="alert"><p>{copy.workspaceLoadFailed}</p><small>{skillManagerStore.error}</small><button class="secondary-button" type="button" onclick={() => serviceEndpoint && void loadSkillManager(serviceEndpoint)}>{copy.retryLoading}</button></div>
  {:else if !summary}
    <div class="workspace-empty"><p>{copy.loading}</p></div>
  {:else if view === "installed"}
    {#if installedSkills.length === 0}
      <div class="workspace-empty"><EmptyState title={copy.skillsEmpty} icon="sparkle" /></div>
    {:else if filteredSkills.length === 0}
      <div class="workspace-empty compact"><EmptyState title={copy.skillsNoMatches} icon="sparkle" /></div>
    {:else}
      <div class="skills-workspace" class:detail-open={detailOpen}>
        <div class="skills-rail" aria-label={copy.skillsSquare}>
          <div class="installed-skills-grid" class:list-mode={detailOpen} bind:this={gridEl}>
            {#each installedGroups as group (group.id)}
              {#if installedGroups.length > 0}
                <h3 class="skills-group-head"><span>{group.label}</span><span class="skills-group-count">{group.items.length}</span></h3>
              {/if}
              {#each group.items as skill (skill.id)}
              {@const visual = getSkillVisual(skill)}
              {@const Icon = visual.icon}
              {@const anomaly = skill.health !== "ok" && skill.health !== "unmanaged"}
              <!-- Selection is a click/Enter surface, not a control: the card hosts
                   real buttons (switch, actions), so role="button" would be the
                   actual nesting violation. Keyboard opens via the keydown handler. -->
              <!-- svelte-ignore a11y_no_noninteractive_element_interactions, a11y_no_noninteractive_tabindex -->
              <article
                class="installed-skill-card"
                in:listIn={{ disabled: Boolean(normalizedQuery) }}
                out:listOut={{ disabled: Boolean(normalizedQuery) }}
                animate:listFlip={{ disabled: Boolean(normalizedQuery) }}
                class:disabled={!skill.enabled}
                class:selected={selectedId === skill.id}
                class:anomaly={anomaly && !skill.id.startsWith("builtin:")}
                tabindex="0"
                onclick={(event) => openSkillFromEvent(skill.id, event)}
                onkeydown={(event) => skillCardKeydown(skill.id, event)}
              >
                <div class="installed-skill-header">
                  <div class="installed-skill-icon" data-tone={visual.tone} aria-hidden="true">
                    <Icon weight="Filled" size={18} />
                  </div>
                  <div class="installed-skill-header-info">
                    <div class="installed-skill-title">
                      <strong>{skill.name}</strong>
                      {#if anomaly}<span class="skills-health-tag" data-health={skill.health}>{healthLabel(skill.health)}</span>{/if}
                    </div>
                  </div>
                </div>

                <div class="installed-skill-copy">
                  {#if skill.description}
                    <p>{skill.description}</p>
                  {/if}
                </div>

                <div class="installed-skill-foot">
                  <div class="installed-skill-meta">
                    <span class="installed-skill-meta-pill">{scopeLabel(skill.scope, skill.ownerLabel)}</span>
                    {#if !skill.builtin}<span class="installed-skill-meta-pill">{methodLabel(skill.method)}</span>{/if}
                    {#if skill.builtin}<span class="installed-skill-meta-pill builtin">{copy.skillBuiltins}</span>{/if}
                    {#if skill.readBy.length}<span class="installed-skill-meta-pill">{copy.skillSharedPill.replace("{list}", skill.readBy.join(", "))}</span>{/if}
                    {#if skill.activeDistributions > 0}<span class="installed-skill-meta-pill">{copy.skillDetailDistributions} {skill.activeDistributions}</span>{/if}
                  </div>
                  {#if skill.health !== "missing" && skill.health !== "broken"}
                    <div class="installed-skill-header-controls">
                      <IosSwitch
                        checked={skill.enabled}
                        ariaLabel={`${skill.name}: ${skill.enabled ? copy.providerEnabled : copy.providerDisabled}`}
                        disabled={skillManagerStore.busyId === skill.id}
                        onCheckedChange={(checked) => void toggleManagedSkill(skill.id, checked)}
                      />
                    </div>
                  {:else}
                    <span class="installed-skill-state">{skill.id.startsWith("builtin:") ? copy.skillBuiltinRemoved : healthLabel(skill.health)}</span>
                  {/if}
                  <div class="installed-skill-actions">
                    {#if skill.builtin && (!skill.builtin.installed || skill.builtin.updateAvailable || skill.builtin.modified)}
                      <Button
                        variant="primary"
                        class="compact"
                        disabled={skillManagerStore.busyId === `builtin:${skill.builtin.id}`}
                        onclick={() => void updateBuiltinSkill(skill.builtin?.id ?? "")}
                      >
                        {skillManagerStore.busyId === `builtin:${skill.builtin.id}` ? copy.agentTemplateUpdating : !skill.builtin.installed ? copy.agentTemplateInstall : copy.agentTemplateUpdate}
                      </Button>
                    {/if}
                  </div>
                </div>
              </article>
              {/each}
            {/each}
          </div>
        </div>
        {#if detailOpen}{@render skillDetail()}{/if}
      </div>
    {/if}
  {:else if view === "discovered"}
    {#if discoveredSkills.length === 0}
      <div class="workspace-empty"><EmptyState title={copy.skillDiscoveredEmpty} icon="sparkle" /><p class="skills-empty-hint">{copy.skillDiscoveredHint}</p></div>
    {:else if filteredDiscovered.length === 0}
      <div class="workspace-empty compact"><EmptyState title={copy.skillsNoMatches} icon="sparkle" /></div>
    {:else}
      <div class="skills-workspace" class:detail-open={detailOpen}>
        <div class="skills-rail" aria-label={copy.skillViewDiscovered}>
          <div class="installed-skills-grid discovered-grid" class:list-mode={detailOpen} bind:this={gridEl}>
            {#each discoveredGroups as group (group.id)}
              {#if discoveredGroups.length > 0}
                <h3 class="skills-group-head"><span>{group.label}</span><span class="skills-group-count">{group.items.length}</span></h3>
              {/if}
              {#each group.items as skill (skill.id)}
              {@const visual = getSkillVisual(skill)}
              {@const Icon = visual.icon}
              <!-- svelte-ignore a11y_no_noninteractive_element_interactions, a11y_no_noninteractive_tabindex -->
              <article
                class="installed-skill-card discovered-card"
                in:listIn={{ disabled: Boolean(normalizedQuery) }}
                out:listOut={{ disabled: Boolean(normalizedQuery) }}
                animate:listFlip={{ disabled: Boolean(normalizedQuery) }}
                class:selected={selectedId === skill.id}
                class:anomaly={skill.health !== "ok"}
                tabindex="0"
                onclick={(event) => openSkillFromEvent(skill.id, event)}
                onkeydown={(event) => skillCardKeydown(skill.id, event)}
              >
                <div class="installed-skill-header">
                  <div class="installed-skill-icon" data-tone={visual.tone} aria-hidden="true">
                    <Icon weight="Filled" size={18} />
                  </div>
                  <div class="installed-skill-header-info">
                    <div class="installed-skill-title">
                      <strong>{skill.name}</strong>
                    </div>
                    <span class="skills-source-line">{skill.platformLabel}{#if skill.sharedWith.length} · {countText(copy.skillSharedRead, copy.skillSharedReadOne, skill.sharedWith.length)}{/if}</span>
                  </div>
                </div>
                <div class="installed-skill-copy">
                  {#if skill.description}<p>{skill.description}</p>{/if}
                </div>
                <div class="installed-skill-foot">
                  <div class="installed-skill-meta">
                    {#if skill.conflict}<span class="installed-skill-meta-pill warning">{copy.skillNameExists}</span>{/if}
                    <span class="installed-skill-meta-pill">{countText(copy.skillEntryCount, copy.skillEntryCountOne, skill.entryCount)}</span>
                  </div>
                  <div class="installed-skill-actions">
                    {#if skill.installed}
                      <span class="installed-skill-state">{copy.skillDiscoveredInstalled}</span>
                    {:else}
                      <Button variant="secondary" class="compact" onclick={() => openInstallFor(skill)}><AddSquare size={13} aria-hidden="true" />{copy.skillDiscoveredInstall}</Button>
                    {/if}
                  </div>
                </div>
              </article>
              {/each}
            {/each}
          </div>
        </div>
        {#if detailOpen}{@render skillDetail()}{/if}
      </div>
    {/if}
  {:else}
    {#if filteredPlatforms.length === 0}
      <div class="workspace-empty compact"><EmptyState title={copy.skillsNoMatches} icon="sparkle" /></div>
    {:else}
      <div class="skills-platforms" role="list" aria-label={copy.skillViewPlatforms}>
        {#each filteredPlatforms as platform (platform.id)}
          {@const draft = draftFor(platform)}
          <article class="skills-platform-row" role="listitem" class:disabled={!draft.enabled}>
            <div class="skills-platform-main">
              <div class="skills-platform-head">
                <strong>{platform.label}</strong>
                <span class="skills-platform-badge" data-verified={platform.verified}>{platform.verified ? copy.skillPlatformVerified : copy.skillPlatformUnverified}</span>
                {#if platform.kind === "custom"}<span class="skills-platform-badge">{copy.skillPlatformAdd}</span>{/if}
              </div>
              <p class="skills-platform-summary">{platform.summary}</p>
              {#if platform.sharedWith.length}
                <p class="skills-platform-shared">{copy.skillPlatformShared.replace("{list}", platform.sharedWith.join(", "))}</p>
              {/if}
              <ul class="skills-platform-roots">
                {#each platform.roots as root (root.path)}
                  {@const removed = draft.removedRoots.includes(root.path)}
                  <li class:removed class:missing={!root.exists}>
                    <code translate="no">{root.path}</code>
                    {#if root.ownerLabel}<span class="skills-platform-owner">{root.ownerLabel}</span>{/if}
                    <span class="skills-platform-count">{countText(copy.skillPlatformSkillCount, copy.skillPlatformSkillCountOne, root.skillCount)}</span>
                    <button
                      type="button"
                      class="skills-platform-root-toggle"
                      aria-pressed={removed}
                      title={removed ? copy.skillCancel : copy.skillPlatformRemove}
                      aria-label={`${removed ? copy.skillCancel : copy.skillPlatformRemove}: ${root.path}`}
                      onclick={() => toggleRemovedRoot(platform, root.path)}
                    >
                      {#if removed}<Check size={12} aria-hidden="true" />{:else}<X size={12} aria-hidden="true" />{/if}
                    </button>
                  </li>
                {/each}
              </ul>
              {#if platform.roots.length === 0}<p class="skills-platform-empty">{copy.skillPlatformNoRoots}</p>{/if}
              {#if editingRoots.includes(platform.id) || draft.extraRoots}
                <label class="skills-platform-extra">
                  <span>{copy.skillPlatformRootsHint}</span>
                  <textarea
                    rows="2"
                    spellcheck="false"
                    placeholder={copy.skillPlatformRootsHint}
                    value={draft.extraRoots}
                    oninput={(event) => setDraft(platform, { extraRoots: event.currentTarget.value })}
                  ></textarea>
                </label>
              {:else}
                <button type="button" class="skills-platform-add-root" title={copy.skillPlatformAddRoot} onclick={() => (editingRoots = [...editingRoots, platform.id])}>
                  <AddSquare size={13} aria-hidden="true" />{copy.skillPlatformAddRoot}
                </button>
              {/if}
            </div>
            <div class="skills-platform-side">
              <IosSwitch
                checked={draft.enabled}
                ariaLabel={`${platform.label}: ${copy.skillPlatformEnabled}`}
                onCheckedChange={(checked) => setDraft(platform, { enabled: checked })}
              />
              {#if platform.kind === "custom"}
                <button type="button" class="skills-platform-remove" onclick={() => removeCustomPlatform(platform.id)}>{copy.skillPlatformRemove}</button>
              {/if}
              {#if platform.errorCount > 0}<span class="skills-platform-errors">{platform.errorCount}</span>{/if}
            </div>
          </article>
        {/each}
        <div class="skills-platform-add">
          <Button variant="icon" title={copy.skillPlatformAdd} onclick={() => (customOpen = true)}><AddSquare size={16} aria-hidden="true" /></Button>
        </div>
      </div>
    {/if}
    {#if platformsDirty}
      <footer class="skills-footbar">
        <span class="settings-footbar-label">{copy.settingsUnsaved}</span>
        <div class="settings-footbar-actions">
          <button class="secondary-button" type="button" onclick={() => { platformEdits = {}; removedPlatforms = []; }}>{copy.discardChanges}</button>
          <button class="primary-button" type="button" onclick={() => void savePlatforms()}>{copy.skillPlatformSave}</button>
        </div>
      </footer>
    {/if}
  {/if}
</div>

{#snippet skillDetail()}
  <section class="skills-detail" aria-label={detail?.name ?? selectedEntry?.name ?? copy.skillsSquare}>
    <header class="skills-detail-head">
      <Button variant="icon" class="skills-detail-back" title={copy.skillDetailBack} onclick={closeSkill}><ArrowLeft size={15} aria-hidden="true" /></Button>
      <div class="skills-detail-title">
        <div class="skills-detail-title-row">
          <h2>
            {detail?.name ?? selectedEntry?.name ?? selectedDiscovered?.name ?? ""}
            {#if detail}
            <span
              class="skills-runtime-badge"
              class:is-ready={detail.runtime.loaded}
              role="img"
              aria-label={`${copy.skillDetailRuntime}: ${runtimeText(detail.runtime.reason)}. ${detail.runtime.message}`}
              title={`${runtimeText(detail.runtime.reason)}\n${detail.runtime.message}`}
            >
                {#if detail.runtime.loaded}<CheckCircle size={15} aria-hidden="true" />{:else}<Warning size={15} aria-hidden="true" />{/if}
              </span>
            {/if}
          </h2>
          {#if detail?.kind === "discovered"}
            <button
              type="button"
              class="skills-install-fab"
              title={copy.skillDiscoveredInstall}
              aria-label={copy.skillDiscoveredInstall}
              onclick={() => selectedDiscovered && openInstallFor(selectedDiscovered)}
            >
              <Download size={15} aria-hidden="true" />
            </button>
          {/if}
        </div>
        <p class="installed-skill-id-badge" translate="no">{detail?.baseDir ?? ""}</p>
      </div>
      <div class="skills-detail-head-actions">
        {#if detail && !detail.id.startsWith("builtin:")}
          <Button variant="icon" title={copy.skillConsolidateCta} onclick={openConsolidate}><Reorder size={16} aria-hidden="true" /></Button>
        {/if}
        {#if detail?.kind === "installed" && detail.managed}
          <Button variant="secondary" class="compact" onclick={openDistribute}><ArrowUpRight size={13} aria-hidden="true" />{copy.skillDetailDistribute}</Button>
        {/if}
        <Button variant="icon" title={copiedPath ? copy.skillCopyPathDone : copy.skillDetailCopyPath} onclick={() => void copyPath()}><Copy size={15} aria-hidden="true" /></Button>
        <Button variant="icon" title={copy.skillDetailReveal} onclick={() => void revealDir()}><FolderOpenIcon size={15} aria-hidden="true" /></Button>
        <Button variant="icon" title={copy.dialogClose} ariaLabel={copy.dialogClose} onclick={closeSkill}><X size={15} aria-hidden="true" /></Button>
      </div>
    </header>

    {#if detailLoading && !detail}
      <div class="skills-detail-state" role="status"><Magnifier size={16} aria-hidden="true" />{copy.skillDetailLoading}</div>
    {:else if detailError && !detail}
      <div class="skills-detail-state" role="alert"><p>{copy.skillDetailLoadFailed}</p><small>{detailError}</small></div>
    {:else if detail}
      <div class="skills-detail-body">
        <div class="skills-detail-main">
          {#if detail.kind === "installed" && detail.health !== "ok" && detail.health !== "disabled" && detail.health !== "unmanaged"}
            <div class="skills-notice" data-tone="danger" role="status">
              <Warning size={14} aria-hidden="true" />
              <span>{healthLabel(detail.health)}</span>
            </div>
          {/if}

          <div class="skills-meta-line">
            <span class="skills-chip">{detail.scope === "external" ? detail.ownerLabel : scopeLabel(detail.scope, detail.ownerLabel)}</span>
            {#if detail.scope !== "external"}<span class="skills-chip">{methodLabel(detail.method)}</span>{/if}
            {#if detail.version}<span class="skills-chip">v{detail.version}</span>{/if}
            {#if detail.source && detail.scope !== "external"}<span class="skills-chip" title={detail.source.path}>{detail.source.label}</span>{/if}
            {#if detail.readBy.length}<span class="skills-chip">{copy.skillSharedPill.replace("{list}", detail.readBy.join(", "))}</span>{/if}
            {#if activeDistributions.length}
              <span class="skills-chip" title={activeDistributions.map((distribution) => distribution.targetPath).join("\n")}>
                {copy.skillDetailDistributions} {activeDistributions.length}
              </span>
            {/if}
            {#if detail.installation?.localChanges}<span class="skills-chip">{copy.skillDetailLocalChanges}</span>{/if}
            {#if detail.method === "link"}<span class="skills-chip">{copy.skillDetailLinkLive}</span>{/if}
            <span class="skills-chip muted">{formatModified(detail.updatedAt)}</span>
          </div>

          {#if detail.description}
            <p class="skills-detail-summary" title={detail.description}>{detail.description}</p>
          {/if}

          <section class="skills-detail-section skills-detail-content">
            <h3>{copy.skillDetailContent}<span class="skills-detail-content-path" translate="no">{selectedFile}</span></h3>
            {#if detail.frontmatter.length > 0 && selectedFile.toLowerCase().endsWith("skill.md")}
              <section class="skills-detail-metadata" aria-label={copy.skillDetailMetadata}>
                <h4>{copy.skillDetailMetadata}</h4>
                <table class="skills-meta-table">
                  <tbody>
                    {#each detail.frontmatter as row (row.key)}
                      <tr>
                        <th scope="row" translate="no">{row.key}</th>
                        <td translate="no">{row.value}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </section>
            {/if}
            {#if fileLoading && !filePreview}
              <p class="skills-detail-muted" role="status">{copy.skillDetailLoading}</p>
            {:else if fileError}
              <p class="skills-detail-muted" role="alert">{copy.skillDetailFileFailed}: {fileError}</p>
            {:else if fileBinary}
              <p class="skills-detail-muted">{copy.skillDetailBinary}</p>
            {:else if filePreview}
              {#if fileTruncated}<p class="skills-detail-muted">{copy.skillDetailTruncated}</p>{/if}
              {#if previewHtml}
                <div class="markdown-body skills-detail-markdown">{@html previewHtml}</div>
              {:else}
                <pre class="skills-detail-code" translate="no">{filePreview.content}</pre>
              {/if}
            {:else}
              <p class="skills-detail-muted">{copy.skillDetailEmpty}</p>
            {/if}
          </section>

          <details class="technical-detail skills-detail-tech">
            <summary>{copy.skillDetailDetails}</summary>
            <div class="skills-detail-facts">
              <div class="skills-detail-fact">
                <span>{copy.skillDetailPath}</span>
                <code translate="no">{detail.filePath}</code>
              </div>
              {#if detail.linked && detail.realDir !== detail.baseDir}
                <div class="skills-detail-fact">
                  <span>{copy.skillDetailLocalPath}</span>
                  <code translate="no">{detail.realDir}</code>
                </div>
              {/if}
              {#if detail.scope === "external"}
                <div class="skills-detail-fact"><span>{copy.skillDetailPlatform}</span><strong>{detail.ownerLabel}</strong></div>
              {:else}
                <div class="skills-detail-fact"><span>{copy.hostBashColScope}</span><strong>{scopeLabel(detail.scope, detail.ownerLabel)}</strong></div>
                <div class="skills-detail-fact"><span>{copy.skillDetailMethod}</span><strong>{methodLabel(detail.method)}</strong></div>
              {/if}
              <div class="skills-detail-fact"><span>{copy.skillDetailVersion}</span><strong>{detail.version || "—"}</strong></div>
              <div class="skills-detail-fact"><span>{copy.skillDetailUpdatedAt}</span><strong>{formatModified(detail.updatedAt)}</strong></div>
              {#if detail.readBy.length}
                <div class="skills-detail-fact"><span>{copy.skillDetailReadBy}</span><strong>{detail.readBy.join(", ")}</strong></div>
              {/if}
              {#if detail.installation}
                <div class="skills-detail-fact">
                  <span>{copy.skillDetailBaseline}</span>
                  <strong translate="no">{detail.installation.baselineHash.slice(0, 8) || "—"} → {detail.installation.observedHash.slice(0, 8) || "—"}</strong>
                </div>
              {/if}
              {#if detail.distributions.length}
                <div class="skills-detail-fact">
                  <span>{copy.skillDetailDistributions}</span>
                  <div class="skills-distribution-list">
                    {#each detail.distributions as distribution (distribution.id)}
                      <div class="skills-distribution-row">
                        <span class="skills-distribution" translate="no">{distribution.targetLabel} · {distribution.targetPath}</span>
                        {#if distribution.status === "active"}
                          <button
                            type="button"
                            class="skills-platform-root-toggle is-visible"
                            title={copy.skillUninstallConfirm}
                            aria-label={`${copy.skillUninstallConfirm}: ${distribution.targetPath}`}
                            disabled={skillManagerStore.busyId === `distribution:${distribution.id}`}
                            onclick={() => void unlinkDistribution(distribution.id, true).then(() => void loadDetail(detail?.id ?? ""))}
                          ><X size={12} aria-hidden="true" /></button>
                        {:else}
                          <span class="skills-distribution-status">{copy.skillDistributeSkipped}</span>
                        {/if}
                      </div>
                    {/each}
                  </div>
                </div>
              {/if}
              {#if detail.mcpServers.length}
                <div class="skills-detail-fact"><span>{copy.skillMcpServers}</span><strong translate="no">{detail.mcpServers.join(", ")}</strong></div>
              {/if}
            </div>

            {#if detail.treeProblems.length}
              <section class="skills-detail-section">
                <h3>{copy.skillDetailTreeProblems}</h3>
                <ul class="skills-problem-list">
                  {#each detail.treeProblems as problem}
                    <li><code translate="no">{problem.code}</code><span>{problem.message}</span></li>
                  {/each}
                </ul>
              </section>
            {/if}
          </details>

          {#if detail.builtin}
            <div class="skills-detail-builtin">
              <div class="skills-detail-builtin-facts">
                <span>{copy.skillBuiltins} <strong>v{detail.builtin.version}</strong></span>
                <span>{copy.agentTemplateInstalledVersion} <strong>{detail.builtin.installedVersion ? `v${detail.builtin.installedVersion}` : copy.skillBuiltinRemoved}</strong></span>
                {#if detail.builtin.modified}<span class="skills-detail-modified">{copy.agentTemplateModified}</span>{/if}
              </div>
              {#if !detail.builtin.installed || detail.builtin.updateAvailable || detail.builtin.modified}
                <Button variant="primary" disabled={skillManagerStore.busyId === `builtin:${detail.builtin.id}`} onclick={() => void updateBuiltinSkill(detail?.builtin?.id ?? "")}>
                  {skillManagerStore.busyId === `builtin:${detail.builtin.id}` ? copy.agentTemplateUpdating : !detail.builtin.installed ? copy.agentTemplateInstall : copy.agentTemplateUpdate}
                </Button>
              {/if}
            </div>
          {/if}

          {#if detail.kind === "installed" && detail.managed}
            <div class="skills-danger-zone">
              <Button variant="secondary" danger onclick={() => { uninstallTarget = selectedEntry; uninstallError = ""; }}>{copy.skillDetailUninstall}</Button>
            </div>
          {/if}
        </div>

        <aside class="skills-detail-files" aria-label={copy.skillDetailFiles}>
          <h3>{copy.skillDetailFiles}<span class="skills-detail-files-count">{countText(copy.skillDetailFilesCount, copy.skillDetailFilesCountOne, detail.files.length)}</span></h3>
          {#if detail.files.length === 0}
            <p class="skills-detail-muted">{copy.skillDetailNoFiles}</p>
          {:else}
            <ul class="skills-file-list" role="tree" aria-label={copy.skillDetailFiles}>
              {#each fileRows as entry (entry.path)}
                <li role="none">
                  <button
                    type="button"
                    role="treeitem"
                    class="skills-file-row"
                    class:is-dir={entry.kind === "dir"}
                    class:active={entry.kind === "file" && entry.path === selectedFile}
                    style={`--skills-file-depth:${entry.depth}`}
                    aria-expanded={entry.kind === "dir" ? entry.expanded : undefined}
                    aria-selected={entry.kind === "file" ? entry.path === selectedFile : undefined}
                    onclick={() => entry.kind === "dir" ? toggleDirectory(entry.path) : selectFile(entry)}
                  >
                    <span class="skills-file-chevron" class:is-collapsed={entry.kind === "dir" && !entry.expanded} aria-hidden="true">
                      {#if entry.kind === "dir"}<AngleDown size={12} />{/if}
                    </span>
                    <span class="skills-file-icon" aria-hidden="true">
                      {#if entry.kind === "dir"}<FolderOpen size={15} weight="Filled" />
                      {:else}<FileText size={15} weight="Filled" />{/if}
                    </span>
                    <span class="skills-file-name" translate="no">{entry.name}</span>
                    {#if entry.kind === "file"}<span class="skills-file-size">{formatBytes(entry.size)}</span>{/if}
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </aside>
      </div>
    {/if}
  </section>
{/snippet}

<Dialog open={installOpen} busy={installing} contentClass="skills-install-dialog" labelledBy="skills-install-title" onOpenChange={(next) => (installOpen = next)}>
  <div class="skills-sheet">
    <header class="skills-sheet-head">
      <div>
        <h2 id="skills-install-title">{copy.skillInstallTitle}</h2>
        <p>{copy.skillInstallIntro}</p>
      </div>
      <Button variant="icon" title={copy.skillClose} onclick={() => (installOpen = false)}><X size={15} aria-hidden="true" /></Button>
    </header>

    {#if installDone}
      <div class="skills-sheet-success" role="status">
        <Check size={18} aria-hidden="true" />
        <div>
          <strong>{copy.skillInstallDone}</strong>
          <p>{installMessage}</p>
        </div>
      </div>
      <footer class="skills-sheet-foot">
        <Button variant="primary" onclick={() => (installOpen = false)}>{copy.skillClose}</Button>
      </footer>
    {:else}
      <div class="skills-sheet-body">
        <div class="segmented skills-source-tabs" role="group" aria-label={copy.skillInstallMethod}>
          {#each [
            { value: "discovered", label: copy.skillInstallSourceDiscovered },
            { value: "local", label: copy.skillInstallSourceLocal },
            { value: "git", label: copy.skillInstallSourceGit }
          ] as source (source.value)}
            <Button class={`segmented-item${installSourceKind === source.value ? " active" : ""}`} aria-pressed={installSourceKind === source.value} onclick={() => { installSourceKind = source.value as "discovered" | "local" | "git"; preflight = null; }}>{source.label}</Button>
          {/each}
        </div>

        {#if installSourceKind === "discovered"}
          <label class="skills-field">
            <span>{copy.skillViewDiscovered}</span>
            <SelectControl
              value={installDiscoveredId}
              ariaLabel={copy.skillViewDiscovered}
              options={discoveredSkills.map((skill) => ({ value: skill.id, label: `${skill.name} · ${skill.platformLabel}` }))}
              onChange={(value) => { installDiscoveredId = value; preflight = null; }}
            />
          </label>
        {:else if installSourceKind === "local"}
          <label class="skills-field">
            <span>{copy.skillInstallSourceLocal}</span>
            <input type="text" spellcheck="false" placeholder={copy.skillInstallLocalHint} value={installLocalPath} oninput={(event) => { installLocalPath = event.currentTarget.value; preflight = null; }} />
          </label>
        {:else}
          <label class="skills-field">
            <span>{copy.skillInstallGitRepo}</span>
            <input type="text" spellcheck="false" placeholder="/path/to/repository" value={installGitRepo} oninput={(event) => { installGitRepo = event.currentTarget.value; preflight = null; }} />
          </label>
          <div class="skills-field-row">
            <label class="skills-field">
              <span>{copy.skillInstallGitRef}</span>
              <input type="text" spellcheck="false" placeholder="main" value={installGitRef} oninput={(event) => { installGitRef = event.currentTarget.value; preflight = null; }} />
            </label>
            <label class="skills-field">
              <span>{copy.skillInstallGitSubdir}</span>
              <input type="text" spellcheck="false" placeholder="skills/pdf" value={installGitSubdir} oninput={(event) => { installGitSubdir = event.currentTarget.value; preflight = null; }} />
            </label>
          </div>
        {/if}

        <div class="skills-field-row">
          <label class="skills-field">
            <span>{copy.skillInstallScope}</span>
            <SelectControl
              value={installScope === "global" ? "global" : `${installScope}:${installOwnerId}`}
              ariaLabel={copy.skillInstallScope}
              options={scopeOptions}
              onChange={(value) => {
                if (value === "global") { installScope = "global"; installOwnerId = ""; }
                else {
                  const [scope, ...rest] = value.split(":");
                  installScope = scope as DesktopSkillManagerScope;
                  installOwnerId = rest.join(":");
                }
                preflight = null;
              }}
            />
          </label>
          <label class="skills-field">
            <span>{copy.skillInstallName}</span>
            <input type="text" spellcheck="false" placeholder={copy.skillInstallNameHint} value={installRename} disabled={installMethod === "link"} oninput={(event) => { installRename = event.currentTarget.value; preflight = null; }} />
          </label>
        </div>

        <div class="skills-method">
          <div class="segmented" role="group" aria-label={copy.skillInstallMethod}>
            <Button class={`segmented-item${installMethod === "copy" ? " active" : ""}`} aria-pressed={installMethod === "copy"} onclick={() => { installMethod = "copy"; preflight = null; }}>{copy.skillMethodCopy}</Button>
            <Button class={`segmented-item${installMethod === "link" ? " active" : ""}`} aria-pressed={installMethod === "link"} onclick={() => { installMethod = "link"; preflight = null; }}>{copy.skillMethodLink}</Button>
          </div>
          <p>{installMethod === "copy" ? copy.skillInstallMethodCopyHint : copy.skillInstallMethodLinkHint}</p>
        </div>

        {#if preflightError}<p class="skills-sheet-error" role="alert">{preflightError}</p>{/if}
        {#if installMessage}<p class="skills-sheet-error" role="alert">{installMessage}</p>{/if}

        {#if preflight}
          <div class="skills-preflight" aria-live="polite">
            <div class="skills-preflight-head">
              <strong>{preflight.source.name}</strong>
              <span>{preflight.source.label}{#if preflight.source.commit} · <code translate="no">{preflight.source.commit.slice(0, 8)}</code>{/if}</span>
            </div>
            {#if preflight.source.description}<p class="skills-preflight-description">{preflight.source.description}</p>{/if}
            <div class="skills-preflight-flow">
              <div>
                <span>{copy.skillDetailSource}</span>
                <code translate="no">{preflight.source.path}</code>
              </div>
              <ArrowRight size={14} aria-hidden="true" />
              <div>
                <span>{copy.skillInstallTarget}</span>
                <code translate="no">{preflight.target.path}</code>
              </div>
            </div>
            <div class="skills-preflight-plan">
              <span>{copy.skillInstallPlan}</span>
              <ul>
                <li>{countText(copy.skillInstallPlanFiles, copy.skillInstallPlanFilesOne, preflight.plan.files)}</li>
                {#if preflight.plan.links}<li>{countText(copy.skillInstallPlanLinks, copy.skillInstallPlanLinksOne, preflight.plan.links)}</li>{/if}
                {#if preflight.plan.executables}<li>{countText(copy.skillInstallPlanExec, copy.skillInstallPlanExecOne, preflight.plan.executables)}</li>{/if}
                <li>{formatBytes(preflight.plan.bytes)}</li>
              </ul>
            </div>
            {#if preflight.conflicts.length}
              <div class="skills-preflight-block" data-tone="danger">
                <strong>{copy.skillInstallConflicts}</strong>
                <ul>
                  {#each preflight.conflicts as conflict}
                    <li><span>{conflictText(conflict.code, conflict.message)}</span>{#if conflict.path}<code translate="no">{conflict.path}</code>{/if}</li>
                  {/each}
                </ul>
              </div>
            {:else}
              <p class="skills-preflight-ok"><Check size={13} aria-hidden="true" />{copy.skillInstallNoConflicts}</p>
            {/if}
            {#if preflight.requiresReplace}
              <p class="skills-preflight-note"><Warning size={13} aria-hidden="true" />{copy.skillInstallBackup}</p>
            {/if}
            {#if preflight.sharedConsumers.length}
              <p class="skills-preflight-note">{copy.skillInstallSharedWith.replace("{list}", preflight.sharedConsumers.map((consumer) => consumer.label).join(", "))}</p>
            {/if}
            {#if preflight.warnings.length}
              <div class="skills-preflight-block" data-tone="info">
                <strong>{copy.skillInstallWarnings}</strong>
                <ul>{#each preflight.warnings as warning}<li><span>{warning}</span></li>{/each}</ul>
              </div>
            {/if}
          </div>
        {/if}
      </div>

      <footer class="skills-sheet-foot">
        <Button variant="secondary" onclick={() => (installOpen = false)}>{copy.skillCancel}</Button>
        {#if preflight}
          <Button variant="primary" disabled={installing || !preflight.installable} onclick={() => void confirmInstall()}>
            {installing ? copy.agentTemplateUpdating : preflight.requiresReplace ? copy.skillInstallReplace : copy.skillInstallConfirm}
          </Button>
        {:else}
          <Button variant="primary" disabled={preflightLoading || !sourceValue()} onclick={() => void runPreflight()}>
            {preflightLoading ? copy.skillInstallChecking : copy.skillInstallCheck}
          </Button>
        {/if}
      </footer>
    {/if}
  </div>
</Dialog>

<Dialog open={consolidateOpen} busy={consolidateBusy} contentClass="skills-install-dialog" labelledBy="skills-consolidate-title" onOpenChange={(next) => (consolidateOpen = next)}>
  <div class="skills-sheet">
    <header class="skills-sheet-head">
      <div>
        <h2 id="skills-consolidate-title">{copy.skillConsolidateTitle}</h2>
        <p>{copy.skillConsolidateIntro}</p>
      </div>
      <Button variant="icon" title={copy.skillClose} onclick={() => (consolidateOpen = false)}><X size={15} aria-hidden="true" /></Button>
    </header>

    {#if consolidateResult}
      <div class="skills-sheet-success" role="status">
        <Check size={18} aria-hidden="true" />
        <div>
          <strong>{copy.skillConsolidateDone}</strong>
          <p>{consolidateResult.message}</p>
        </div>
      </div>
      <footer class="skills-sheet-foot">
        <Button variant="primary" onclick={() => (consolidateOpen = false)}>{copy.skillClose}</Button>
      </footer>
    {:else}
      <div class="skills-sheet-body">
        <div class="skills-field-row">
          <label class="skills-field">
            <span>{copy.skillConsolidateDestination}</span>
            <SelectControl
              value={consolidateDestination}
              ariaLabel={copy.skillConsolidateDestination}
              options={consolidateDestinationOptions()}
              onChange={(value) => { consolidateDestination = value; consolidateReplace = false; avoidStaleConsolidate(); }}
            />
          </label>
        </div>

        <div class="skills-method">
          <div class="segmented" role="group" aria-label={copy.skillConsolidateSourceAction}>
            {#each [
              { value: "link", label: copy.skillConsolidateKeepLink },
              { value: "remove", label: copy.skillConsolidateRemove },
              { value: "keep", label: copy.skillConsolidateKeep }
            ] as action (action.value)}
              <Button
                class={`segmented-item${consolidateSourceAction === action.value ? " active" : ""}`}
                aria-pressed={consolidateSourceAction === action.value}
                onclick={() => { consolidateSourceAction = action.value as "link" | "remove" | "keep"; avoidStaleConsolidate(); }}
              >{action.label}</Button>
            {/each}
          </div>
          <p>{consolidateSourceAction === "link" ? copy.skillConsolidateKeepLinkHint : consolidateSourceAction === "remove" ? copy.skillConsolidateRemoveHint : copy.skillConsolidateKeepHint}</p>
        </div>

        {#if consolidateError}<p class="skills-sheet-error" role="alert">{consolidateError}</p>{/if}
        {#if consolidateLoading}<p class="skills-detail-muted" role="status">{copy.skillInstallChecking}</p>{/if}

        {#if consolidatePreflight}
          <div class="skills-preflight" aria-live="polite">
            <div class="skills-preflight-head">
              <strong>{consolidatePreflight.source.name}</strong>
              <span>{consolidatePreflight.source.platformLabel}</span>
            </div>
            <div class="skills-preflight-flow">
              <div>
                <span>{copy.skillConsolidateSourceAction}</span>
                <code translate="no">{consolidatePreflight.source.path}</code>
              </div>
              <ArrowRight size={14} aria-hidden="true" />
              <div>
                <span>{copy.skillConsolidateDestination}</span>
                <code translate="no">{consolidatePreflight.destination.path}</code>
              </div>
            </div>
            {#if consolidatePreflight.backLink}
              <div class="skills-preflight-flow">
                <div>
                  <span>{copy.skillConsolidateBackLink}</span>
                  <code translate="no">{consolidatePreflight.backLink.path}</code>
                </div>
              </div>
            {/if}
            <div class="skills-preflight-plan">
              <span>{copy.skillInstallPlan}</span>
              <ul>
                <li>{countText(copy.skillInstallPlanFiles, copy.skillInstallPlanFilesOne, consolidatePreflight.plan.files)}</li>
                <li>{formatBytes(consolidatePreflight.plan.bytes)}</li>
              </ul>
            </div>
            {#if consolidatePreflight.conflicts.length}
              <div class="skills-preflight-block" data-tone="danger">
                <strong>{copy.skillInstallConflicts}</strong>
                <ul>
                  {#each consolidatePreflight.conflicts as conflict}
                    <li><span>{conflictText(conflict.code, conflict.message)}</span>{#if conflict.path}<code translate="no">{conflict.path}</code>{/if}</li>
                  {/each}
                </ul>
              </div>
            {:else}
              <p class="skills-preflight-ok"><Check size={13} aria-hidden="true" />{copy.skillInstallNoConflicts}</p>
            {/if}
          </div>
        {/if}
      </div>
      <footer class="skills-sheet-foot">
        <Button variant="secondary" onclick={() => (consolidateOpen = false)}>{copy.skillCancel}</Button>
        <Button variant="primary" disabled={consolidateBusy || consolidateLoading || !consolidatePreflight || !consolidatePreflight.installable} onclick={() => void confirmConsolidate()}>
          {consolidateBusy ? copy.agentTemplateUpdating : copy.skillConsolidateConfirm}
        </Button>
      </footer>
    {/if}
  </div>
</Dialog>

<Dialog open={distributeOpen} busy={distributing} contentClass="skills-install-dialog" labelledBy="skills-distribute-title" onOpenChange={(next) => (distributeOpen = next)}>
  <div class="skills-sheet">
    <header class="skills-sheet-head">
      <div>
        <h2 id="skills-distribute-title">{copy.skillDistributeTitle}</h2>
        <p>{copy.skillDistributeHint}</p>
      </div>
      <Button variant="icon" title={copy.skillClose} onclick={() => (distributeOpen = false)}><X size={15} aria-hidden="true" /></Button>
    </header>
    <div class="skills-sheet-body">
      <div class="skills-method">
        <div class="segmented" role="group" aria-label={copy.skillInstallMethod}>
          <Button class={`segmented-item${distributeMethod === "copy" ? " active" : ""}`} aria-pressed={distributeMethod === "copy"} onclick={() => (distributeMethod = "copy")}>{copy.skillMethodCopy}</Button>
          <Button class={`segmented-item${distributeMethod === "link" ? " active" : ""}`} aria-pressed={distributeMethod === "link"} onclick={() => (distributeMethod = "link")}>{copy.skillMethodLink}</Button>
        </div>
      </div>
      <div class="skills-targets">
        <span>{copy.skillDistributeTargets}</span>
        {#if (summary?.targets ?? []).length === 0}
          <p class="skills-detail-muted">{copy.skillDistributeNone}</p>
        {:else}
          <ul>
            {#each summary?.targets ?? [] as target (targetKey(target))}
              <li>
                <label class:disabled={!target.writable}>
                  <input
                    type="checkbox"
                    checked={distributeTargets.includes(targetKey(target))}
                    disabled={!target.writable}
                    onchange={() => toggleDistributeTarget(targetKey(target))}
                  />
                  <span>{target.label}</span>
                  <small>{target.kind === "project" ? copy.skillScopeProject : copy.skillViewPlatforms}{#if target.reason} · {target.reason}{/if}</small>
                </label>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
      {#if distributeError}<p class="skills-sheet-error" role="alert">{distributeError}</p>{/if}
      {#if distributeResult}
        <ul class="skills-distribute-results">
          {#each distributeResult.results as result}
            <li data-status={result.status}>
              <strong>{result.targetLabel}</strong>
              <span>{result.status === "installed" ? copy.skillDistributeInstalled : result.status === "skipped" ? copy.skillDistributeSkipped : copy.skillDistributeFailed} · {result.message}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
    <footer class="skills-sheet-foot">
      <Button variant="secondary" onclick={() => (distributeOpen = false)}>{copy.skillClose}</Button>
      <Button variant="primary" disabled={distributing || distributeTargets.length === 0} onclick={() => void confirmDistribute()}>
        {distributing ? copy.agentTemplateUpdating : copy.skillDistributeConfirm}
      </Button>
    </footer>
  </div>
</Dialog>

<AlertDialog
  open={uninstallTarget !== null}
  busy={uninstalling}
  contentClass="skills-confirm-dialog"
  labelledBy="skills-uninstall-title"
  describedBy="skills-uninstall-body"
  onOpenChange={(next) => { if (!next) uninstallTarget = null; }}
>
  <div class="skills-confirm">
    <h2 id="skills-uninstall-title">{uninstallTarget?.method === "link" ? copy.skillUninstallLinkTitle : copy.skillUninstallCopyTitle}</h2>
    <p id="skills-uninstall-body">{uninstallTarget?.method === "link" ? copy.skillUninstallLinkBody : copy.skillUninstallCopyBody}</p>
    {#if uninstallTarget?.activeDistributions}
      <p class="skills-confirm-warning"><Warning size={13} aria-hidden="true" />{copy.skillUninstallBlocked}</p>
    {/if}
    {#if uninstallError}<p class="skills-sheet-error" role="alert">{uninstallError}</p>{/if}
    <footer class="skills-sheet-foot">
      <Button variant="secondary" onclick={() => (uninstallTarget = null)}>{copy.skillCancel}</Button>
      <Button variant="primary" danger disabled={uninstalling} onclick={() => void confirmUninstall()}>{uninstalling ? copy.agentTemplateUpdating : copy.skillUninstallConfirm}</Button>
    </footer>
  </div>
</AlertDialog>

<Dialog open={customOpen} contentClass="skills-confirm-dialog" labelledBy="skills-custom-title" onOpenChange={(next) => (customOpen = next)}>
  <div class="skills-confirm">
    <h2 id="skills-custom-title">{copy.skillPlatformAddTitle}</h2>
    <label class="skills-field">
      <span>{copy.skillPlatformLabel}</span>
      <input type="text" value={customLabel} oninput={(event) => (customLabel = event.currentTarget.value)} />
    </label>
    <label class="skills-field">
      <span>{copy.skillPlatformRootsHint}</span>
      <textarea rows="4" spellcheck="false" value={customRoots} oninput={(event) => (customRoots = event.currentTarget.value)}></textarea>
    </label>
    {#if customError}<p class="skills-sheet-error" role="alert">{customError}</p>{/if}
    <footer class="skills-sheet-foot">
      <Button variant="secondary" onclick={() => (customOpen = false)}>{copy.skillCancel}</Button>
      <Button variant="primary" onclick={() => void addCustomPlatform()}>{copy.skillPlatformAdd}</Button>
    </footer>
  </div>
</Dialog>
