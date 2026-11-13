<script lang="ts">
  import { flushSync } from "svelte";
  import { Popover } from "bits-ui";
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
  import LinkIcon from "reicon-svelte/icons/Link";
  import Reorder from "reicon-svelte/icons/Reorder";
  import Refresh from "reicon-svelte/icons/Refresh";
  import FolderOpenIcon from "reicon-svelte/icons/FolderOpen";
  import Magnifier from "reicon-svelte/icons/Magnifier";
  import Trash from "reicon-svelte/icons/Trash";
  import Warning from "reicon-svelte/icons/Warning";
  import X from "reicon-svelte/icons/X";
  import type { Translation } from "../i18n";
  import ChatHeader from "./ChatHeader.svelte";
  import SkillMaintenance from "./SkillMaintenance.svelte";
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
    checkManagedSkillUpdate,
    consolidateManagedSkill,
    createManagedSkill,
    listManagedSkillBackups,
    previewManagedSkillUpdate,
    restoreManagedSkillBackup,
    saveManagedSkillContent,
    distributeManagedSkill,
    installManagedSkill,
    loadConsolidateCheck,
    loadPreflight,
    loadSkillManager,
    removeDiscoveredSkill,
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
    DesktopSkillBackup,
    DesktopSkillCheckUpdateResult,
    DesktopSkillConsolidatePreflight,
    DesktopSkillConsolidateResult,
    DesktopSkillDistributeResult,
    DesktopSkillFileEntry,
    DesktopSkillInstallMethod,
    DesktopSkillLocation,
    DesktopSkillOperationView,
    DesktopSkillManagerDetail,
    DesktopSkillManagerEntry,
    DesktopSkillManagerScope,
    DesktopSkillPlatform,
    DesktopSkillPreflightResult,
    DesktopSkillSourceKind,
    DesktopSkillUpdatePreview
  } from "@molibot/desktop-contract";

  let { copy, serviceEndpoint, serviceReady, onTrySkill }: {
    copy: Translation;
    serviceEndpoint: string | null;
    serviceReady: boolean;
    /** Hosts the composer, so the pane can offer a real invocation instead of a copy hint. */
    onTrySkill?: (skill: { id: string; name: string; aliases: string[] }) => void;
  } = $props();

  type ManagerView = "installed" | "discovered" | "platforms";

  let loadedEndpoint = $state("");
  let query = $state("");
  let view = $state<ManagerView>("installed");
  let sortMode = $state<"name" | "usage" | "health">("name");
  let selectionMode = $state(false);
  let selectedIds = $state<string[]>([]);
  let batchBusy = $state(false);
  let batchNotice = $state("");

  // ── Create / edit ───────────────────────────────────────────────────────
  let createOpen = $state(false);
  let createName = $state("");
  let createDescription = $state("");
  let createBody = $state("");
  /** Localised up-front check; the server error stays a fallback, not the primary copy. */
  const SKILL_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  let createScope = $state<DesktopSkillManagerScope>("global");
  let createOwnerId = $state("");
  let createError = $state("");
  let creating = $state(false);
  let editOpen = $state(false);
  let editContent = $state("");
  let editError = $state("");
  let editSaving = $state(false);
  let backups = $state<DesktopSkillBackup[]>([]);
  let backupBusy = $state("");
  let backupNotice = $state("");
  let updateScan = $state<Array<{ id: string; name: string; result: DesktopSkillCheckUpdateResult }>>([]);
  let scanningUpdates = $state(false);
  let updatingAll = $state(false);
  let batchUpdateNotice = $state("");
  /**
   * The source facet is the ownership-first split the catalogue needs: a
   * concrete Molibot root (global, an Agent workspace, a Molibot project) or an
   * external platform. It doubles as the group key, so the header and the filter
   * can never disagree.
   */
  let sourceFilter = $state("all");
  /** Discovered-only facet: where the content lives and how entries are wired. */
  let statusFilter = $state("all");
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
  let consolidateName = $state("");
  let consolidateReady = $state(false);
  let consolidateCheckVersion = 0;
  let consolidateReturnFocus: HTMLElement | null = null;
  let consolidateSourceId = $state("");
  let consolidateSourceAction = $state<"link" | "remove" | "keep">("link");
  let consolidateReplace = $state(false);
  let consolidatePreflight = $state<DesktopSkillConsolidatePreflight | null>(null);
  let consolidateLoading = $state(false);
  let consolidateBusy = $state(false);
  let consolidateError = $state("");
  let consolidateResult = $state<DesktopSkillConsolidateResult | null>(null);

  // ── Discovered removal ───────────────────────────────────────────────────
  let removeTarget = $state<{ id: string; name: string; entries: DesktopSkillLocation[]; whole: boolean } | null>(null);
  let removing = $state(false);
  let removeError = $state("");

  // ── Git update check ─────────────────────────────────────────────────────
  let updateCheck = $state<DesktopSkillCheckUpdateResult | null>(null);
  let updateCheckId = $state("");
  let updatePreview = $state<DesktopSkillUpdatePreview | null>(null);
  let updatePreviewId = $state("");
  let updatePreviewError = $state("");

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
  // Platform folders are configuration, not the default reading surface: each
  // platform opens on demand.
  let expandedPlatforms = $state<string[]>([]);
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
    if (key === "platform:agents") return copy.skillScopeGlobal;
    return skill?.platformLabel ?? key.replace("platform:", "");
  }

  /** The shared `~/.agents/skills` tree is the owner's global pile, not a vendor. */
  function discoveredPlatformName(skill: DesktopDiscoveredSkill): string {
    return skill.platformId === "agents" ? copy.skillScopeGlobal : skill.platformLabel;
  }

  function externalPlatformName(label: string): string {
    return label === "Global" ? copy.skillScopeGlobal : label;
  }

  const filteredSkills = $derived.by(() => {
    const list = installedSkills.filter((skill) => {
      if (sourceFilter !== "all" && installedSourceKey(skill) !== sourceFilter) return false;
      if (!normalizedQuery) return true;
      return [
        skill.name,
        skill.description,
        skill.scope,
        skill.ownerLabel,
        skill.method,
        skill.source?.label ?? "",
        skill.readBy.join(" "),
        skill.aliases.join(" "),
        [...skill.signals.cli, ...skill.signals.mcp, ...skill.signals.tools].join(" ")
      ]
        .join("\n")
        .toLowerCase()
        .includes(normalizedQuery);
    });
    const healthRank = (skill: DesktopSkillManagerEntry): number => {
      if (skill.availability.state === "available") return 0;
      if (skill.availability.state === "blocked") return 1;
      if (skill.availability.state === "disabled") return 2;
      return 3;
    };
    return list.sort((left, right) => {
      if (sortMode === "usage") {
        const last = (right.usage?.lastAt ?? "").localeCompare(left.usage?.lastAt ?? "");
        if (last !== 0) return last;
        const calls = (right.usage?.calls ?? 0) - (left.usage?.calls ?? 0);
        if (calls !== 0) return calls;
      }
      if (sortMode === "health") {
        const rank = healthRank(left) - healthRank(right);
        if (rank !== 0) return rank;
      }
      return left.name.localeCompare(right.name);
    });
  });
  const filteredDiscovered = $derived(
    discoveredSkills.filter((skill) => {
      if (sourceFilter !== "all" && discoveredSourceKey(skill) !== sourceFilter) return false;
      if (statusFilter === "shared" && !skill.inSharedDir) return false;
      if (statusFilter === "duplicate" && !skill.duplicate && !skill.conflict) return false;
      if (statusFilter === "link" && !skill.linked) return false;
      if (statusFilter === "copy" && skill.linked) return false;
      if (!normalizedQuery) return true;
      return [skill.name, skill.description, skill.platformLabel, discoveredPlatformName(skill), skill.sharedWith.join(" "), skill.platformId]
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

  /** Discovered-only status facet: shared tree, duplicates, link vs copy. */
  const statusOptions = $derived.by(() => {
    const count = (predicate: (skill: DesktopDiscoveredSkill) => boolean): number => discoveredSkills.filter(predicate).length;
    return [
      { value: "all", label: `${copy.skillStatusAll} (${discoveredSkills.length})` },
      { value: "shared", label: `${copy.skillStatusShared} (${count((skill) => skill.inSharedDir)})` },
      { value: "duplicate", label: `${copy.skillStatusDuplicate} (${count((skill) => skill.duplicate || skill.conflict)})` },
      { value: "link", label: `${copy.skillStatusLink} (${count((skill) => skill.linked)})` },
      { value: "copy", label: `${copy.skillStatusCopy} (${count((skill) => !skill.linked)})` }
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
    if (code === "shared_entry_remove") return copy.skillConsolidateSharedRemove;
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

  function availabilityLabel(view: DesktopSkillManagerEntry["availability"]): string {
    if (view.state === "available") return copy.skillAvailabilityAvailable;
    if (view.state === "disabled") return copy.skillAvailabilityDisabled;
    if (view.state === "blocked") return copy.skillAvailabilityBlocked;
    return copy.skillAvailabilityUnavailable;
  }

  function availabilityReason(reason: DesktopSkillManagerEntry["availability"]["reason"]): string {
    if (reason === "duplicate_name") return copy.skillAvailabilityReasonDuplicate;
    if (reason === "invalid") return copy.skillAvailabilityReasonInvalid;
    if (reason === "missing") return copy.skillAvailabilityReasonMissing;
    if (reason === "broken") return copy.skillAvailabilityReasonBroken;
    if (reason === "no_workspace") return copy.skillAvailabilityReasonNoWorkspace;
    if (reason === "dependencies") return copy.skillAvailabilityReasonDependencies;
    if (reason === "not_loaded") return copy.skillAvailabilityReasonNotLoaded;
    return "";
  }

  /** Operations are scanned from the left; the last segment is the useful name. */
  function operationTarget(path: string): string {
    const trimmed = String(path ?? "").replace(/[\\/]+$/, "");
    return trimmed.split(/[\\/]/).pop() || trimmed;
  }

  function operationKindLabel(kind: DesktopSkillOperationView["kind"]): string {
    if (kind === "install") return copy.skillOperationInstall;
    if (kind === "replace") return copy.skillOperationReplace;
    if (kind === "distribute") return copy.skillOperationDistribute;
    if (kind === "uninstall") return copy.skillOperationUninstall;
    if (kind === "restore") return copy.skillOperationRestore;
    if (kind === "toggle") return copy.skillOperationToggle;
    if (kind === "platform") return copy.skillOperationPlatform;
    if (kind === "consolidate") return copy.skillOperationConsolidate;
    return copy.skillOperationMaintenance;
  }

  function operationStatusLabel(status: DesktopSkillOperationView["status"]): string {
    if (status === "pending") return copy.skillOperationPending;
    if (status === "failed") return copy.skillOperationFailed;
    if (status === "recovered") return copy.skillOperationRecovered;
    return copy.skillOperationCommitted;
  }

  function usageLabel(usage: DesktopSkillManagerEntry["usage"]): string {
    if (!usage || usage.calls === 0) return copy.skillUsageNever;
    return copy.skillUsageSummary
      .replace("{executed}", String(usage.executed))
      .replace("{triggered}", String(usage.triggered));
  }

  function usageShortLabel(usage: DesktopSkillManagerEntry["usage"]): string {
    if (!usage || usage.calls === 0) return copy.skillUsageShortNever;
    return copy.skillUsageShort.replace("{count}", String(usage.executed || usage.calls));
  }

  function lastUsedLabel(usage: DesktopSkillManagerEntry["usage"]): string {
    return usage?.lastAt ? copy.skillUsageLast.replace("{time}", formatModified(usage.lastAt)) : "";
  }

  function trySkill(skill: { id: string; name: string; aliases: string[] }): void {
    onTrySkill?.({ id: skill.id, name: skill.name, aliases: skill.aliases });
  }

  function toggleSelectionMode(): void {
    selectionMode = !selectionMode;
    selectedIds = [];
    batchNotice = "";
  }

  function toggleSelected(id: string): void {
    selectedIds = selectedIds.includes(id)
      ? selectedIds.filter((candidate) => candidate !== id)
      : [...selectedIds, id];
  }

  /**
   * Batch state changes reuse the single-entry action so every toggle still
   * goes through the manager's own write path and the summary stays truthful.
   */
  async function applyBatch(enabled: boolean): Promise<void> {
    if (batchBusy || selectedIds.length === 0) return;
    batchBusy = true;
    batchNotice = copy.skillBatchWorking;
    const ids = selectedIds;
    try {
      for (const id of ids) await toggleManagedSkill(id, enabled);
      batchNotice = copy.skillBatchDone.replace("{count}", String(ids.length));
      selectedIds = [];
    } catch {
      batchNotice = copy.skillBatchFailed;
    } finally {
      batchBusy = false;
    }
  }

  const projectTargets = $derived((summary?.targets ?? []).filter((target) => target.kind === "project" && target.writable));

  function defaultOwnerFor(scope: DesktopSkillManagerScope): string {
    if (scope === "agent") return summary?.agents[0]?.id ?? "";
    if (scope === "project") return projectTargets[0]?.id ?? "";
    return "";
  }

  function openCreate(): void {
    createOpen = true;
    createName = "";
    createDescription = "";
    createBody = "";
    createScope = "global";
    createOwnerId = "";
    createError = "";
  }

  function changeCreateScope(scope: DesktopSkillManagerScope): void {
    createScope = scope;
    createOwnerId = defaultOwnerFor(scope);
  }

  async function confirmCreate(): Promise<void> {
    if (creating) return;
    if (!SKILL_SLUG.test(createName.trim())) {
      createError = copy.skillCreateNameInvalid;
      return;
    }
    const duplicate = installedSkills.some((skill) =>
      skill.name === createName.trim()
      && skill.scope === createScope
      && (createScope === "global" || skill.ownerId === createOwnerId)
    );
    if (duplicate) {
      createError = copy.skillCreateNameExists;
      return;
    }
    creating = true;
    createError = "";
    try {
      const created = await createManagedSkill({
        name: createName,
        description: createDescription,
        body: createBody,
        scope: createScope,
        ownerId: createOwnerId
      });
      createOpen = false;
      if (serviceEndpoint) await loadSkillManager(serviceEndpoint);
      openSkill(created.id);
    } catch (cause) {
      createError = copy.skillCreateFailed;
      console.error(cause);
    } finally {
      creating = false;
    }
  }

  async function openEdit(): Promise<void> {
    if (!detail || detail.kind !== "installed") return;
    editOpen = true;
    editError = "";
    if (filePreview?.path.toLowerCase().endsWith("skill.md")) {
      editContent = filePreview.content;
      return;
    }
    editContent = "";
    await loadPreview("SKILL.md");
    if (filePreview) editContent = filePreview.content;
  }

  async function confirmEdit(): Promise<void> {
    const current = detail;
    if (!current || current.kind !== "installed" || editSaving) return;
    editSaving = true;
    editError = "";
    try {
      await saveManagedSkillContent({ id: current.id, content: editContent });
      editOpen = false;
      await loadDetail(current.id);
      if (selectedFile) await loadPreview(selectedFile);
    } catch (cause) {
      editError = copy.skillEditFailed;
      console.error(cause);
    } finally {
      editSaving = false;
    }
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
    backups = [];
    backupBusy = "";
    backupNotice = "";
    updatePreview = null;
    updatePreviewId = "";
    updatePreviewError = "";
  }

  function switchView(next: ManagerView): void {
    if (view === next) return;
    closeSkill();
    view = next;
    sourceFilter = "all";
    statusFilter = "all";
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
      updateCheck = null;
      updateCheckId = "";
      updatePreview = null;
      updatePreviewId = "";
      updatePreviewError = "";
      expandedDirs = [];
      const skillFile = next.files.find((entry) => entry.kind === "file" && entry.path.toLowerCase() === "skill.md")
        ?? next.files.find((entry) => entry.kind === "file");
      selectedFile = skillFile?.path ?? "";
      backups = [];
      backupNotice = "";
      if (selectedFile) void loadPreview(selectedFile);
      void loadBackups(next.id);
    } catch (cause) {
      if (seq === detailSeq) {
        detail = null;
        detailError = cause instanceof Error ? cause.message : String(cause);
      }
    } finally {
      if (seq === detailSeq) detailLoading = false;
    }
  }

  async function loadBackups(id: string): Promise<void> {
    backups = await listManagedSkillBackups(id);
    if (!backups.length) backupNotice = "";
  }

  async function restoreBackup(path: string): Promise<void> {
    const current = detail;
    if (!current || current.kind !== "installed" || backupBusy) return;
    backupBusy = path;
    backupNotice = "";
    try {
      const result = await restoreManagedSkillBackup({ id: current.id, backupPath: path });
      backupNotice = result.ok ? copy.skillBackupRestored : copy.skillBackupRestoreFailed;
      if (result.ok) {
        await loadDetail(current.id);
      }
    } catch {
      backupNotice = copy.skillBackupRestoreFailed;
    } finally {
      backupBusy = "";
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

  function consolidateRequest() {
    return {
      sourceKind: "discovered" as const,
      id: consolidateSourceId,
      sourceAction: consolidateSourceAction,
      replaceDestination: consolidateReplace
    };
  }

  async function runConsolidatePreflight(): Promise<void> {
    const version = ++consolidateCheckVersion;
    const request = consolidateRequest();
    consolidateLoading = true;
    consolidateReady = false;
    consolidateError = "";
    consolidateResult = null;
    try {
      const preview = await loadConsolidateCheck(request);
      if (version !== consolidateCheckVersion || !consolidateOpen) return;
      consolidatePreflight = preview;
      consolidateReady = true;
    } catch (cause) {
      if (version !== consolidateCheckVersion || !consolidateOpen) return;
      consolidateError = cause instanceof Error ? cause.message : String(cause);
    } finally {
      if (version === consolidateCheckVersion) consolidateLoading = false;
    }
  }

  function consolidatePath(path: string): string {
    const root = consolidatePreflight?.destination.root ?? "";
    const home = root.endsWith("/.agents/skills") ? root.slice(0, -"/.agents/skills".length) : "";
    return home && path.startsWith(home + "/") ? "~" + path.slice(home.length) : path;
  }

  function openConsolidate(event?: MouseEvent): void {
    if (!detail || detail.kind !== "discovered") return;
    consolidateReturnFocus = event?.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    consolidateOpen = true;
    consolidateName = detail.name;
    consolidatePreflight = null;
    consolidateSourceId = detail.id;
    consolidateSourceAction = "link";
    consolidateReplace = false;
    consolidateError = "";
    consolidateResult = null;
    avoidStaleConsolidate();
  }

  function avoidStaleConsolidate(): void {
    void runConsolidatePreflight();
  }

  /** The only blocker is an existing destination copy, which the owner may confirm replacing. */
  const consolidateReplaceOnly = $derived(
    Boolean(
      consolidatePreflight
        && consolidatePreflight.conflicts.length > 0
        && consolidatePreflight.conflicts.every((conflict) => conflict.code === "replace_required")
    )
  );

  async function confirmConsolidate(): Promise<void> {
    if (!consolidatePreflight || !consolidateReady || consolidateLoading || consolidateBusy) return;
    consolidateBusy = true;
    consolidateError = "";
    try {
      // The replace confirmation is the button itself: a plan that only blocks
      // on an existing destination copy is re-confirmed with
      // replaceDestination, which changes the preflight token, so the fresh
      // plan is fetched before the write.
      let token = consolidatePreflight.token;
      if (consolidateReplaceOnly && !consolidateReplace) {
        consolidateReplace = true;
        const confirmed = await loadConsolidateCheck({ ...consolidateRequest(), replaceDestination: true });
        consolidatePreflight = confirmed;
        if (!confirmed.installable) {
          consolidateError = confirmed.conflicts[0]?.message ?? copy.skillInstallStale;
          return;
        }
        token = confirmed.token;
      }
      const result = await consolidateManagedSkill({ ...consolidateRequest(), replaceDestination: consolidateReplace, token });
      if (result.ok) {
        consolidateResult = result;
        // The discovered row now describes the shared copy; leaving an empty
        // detail pane open would strand the reader on a stale selection.
        closeSkill();
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

  // ── Discovered removal ───────────────────────────────────────────────────

  function openRemoveDiscovered(id: string, name: string): void {
    removeTarget = { id, name, entries: [], whole: true };
    removeError = "";
  }

  function openRemoveEntry(location: DesktopSkillLocation): void {
    if (!detail) return;
    removeTarget = { id: detail.id, name: detail.name, entries: [location], whole: false };
    removeError = "";
  }

  async function confirmRemoveDiscovered(): Promise<void> {
    if (!removeTarget) return;
    removing = true;
    removeError = "";
    const target = removeTarget;
    try {
      const result = await removeDiscoveredSkill(
        target.id,
        target.whole ? undefined : target.entries[0]?.path
      );
      if (result.ok) {
        removeTarget = null;
        closeSkill();
      } else {
        removeError = result.message;
      }
    } catch (cause) {
      removeError = cause instanceof Error ? cause.message : String(cause);
    } finally {
      removing = false;
    }
  }

  // ── Git update check ─────────────────────────────────────────────────────

  async function runUpdateCheck(): Promise<void> {
    if (!detail || detail.kind !== "installed") return;
    const id = detail.id;
    updateCheckId = id;
    try {
      updateCheck = await checkManagedSkillUpdate(id);
    } catch (cause) {
      updateCheck = null;
      skillManagerStore.actionError = cause instanceof Error ? cause.message : String(cause);
    } finally {
      if (updateCheckId === id) updateCheckId = "";
    }
  }

  const updatableScan = $derived(updateScan.filter((item) => item.result.ok && item.result.hasUpdate));

  async function scanAllUpdates(): Promise<void> {
    if (scanningUpdates || updatingAll) return;
    scanningUpdates = true;
    batchUpdateNotice = "";
    try {
      const candidates = installedSkills.filter((skill) => skill.source?.kind === "git" && skill.method !== "link");
      const results: Array<{ id: string; name: string; result: DesktopSkillCheckUpdateResult }> = [];
      for (const skill of candidates) {
        try {
          results.push({ id: skill.id, name: skill.name, result: await checkManagedSkillUpdate(skill.id) });
        } catch {
          // One broken source must not abort the scan for the others.
        }
      }
      updateScan = results;
    } finally {
      scanningUpdates = false;
    }
  }

  async function updateAllScanned(): Promise<void> {
    if (updatingAll || scanningUpdates) return;
    updatingAll = true;
    batchUpdateNotice = "";
    let done = 0;
    let failed = 0;
    try {
      for (const item of updatableScan) {
        const skill = installedSkills.find((candidate) => candidate.id === item.id);
        if (!skill) continue;
        const request = {
          source: {
            kind: "git" as const,
            repository: item.result.repository,
            subdirectory: item.result.subdirectory
          },
          method: skill.method === "link" ? "link" as const : "copy" as const,
          scope: skill.scope,
          ownerId: skill.ownerId
        };
        try {
          const preflight = await loadPreflight(request);
          await installManagedSkill({ ...request, token: preflight.token, replace: true });
          done += 1;
        } catch {
          failed += 1;
        }
      }
      batchUpdateNotice = copy.skillBatchUpdateDone
        .replace("{done}", String(done))
        .replace("{failed}", String(failed));
      updateScan = [];
    } finally {
      updatingAll = false;
    }
    if (serviceEndpoint) await loadSkillManager(serviceEndpoint);
  }

  async function runUpdatePreview(): Promise<void> {
    if (!detail || detail.kind !== "installed") return;
    const id = detail.id;
    updatePreviewId = id;
    updatePreviewError = "";
    try {
      updatePreview = await previewManagedSkillUpdate(id);
    } catch (cause) {
      updatePreview = null;
      updatePreviewError = cause instanceof Error ? cause.message : String(cause);
    } finally {
      if (updatePreviewId === id) updatePreviewId = "";
    }
  }

  /** Reinstall from the same Git source at HEAD; the replace flow keeps a backup. */
  function startGitUpdate(): void {
    if (!detail?.source) return;
    installOpen = true;
    installDone = false;
    installMessage = "";
    installSourceKind = "git";
    installGitRepo = detail.source.path;
    installGitRef = "";
    installGitSubdir = detail.source.subdirectory;
    installMethod = detail.method === "link" ? "link" : "copy";
    installScope = detail.scope === "external" ? "global" : detail.scope;
    installOwnerId = detail.ownerId;
    installRename = "";
    preflight = null;
    preflightError = "";
    updateCheck = null;
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

  /** Opening the field is the whole point of the click, so it takes focus. */
  function focusField(node: HTMLTextAreaElement): void {
    node.focus();
  }

  function togglePlatformExpanded(id: string): void {
    expandedPlatforms = expandedPlatforms.includes(id)
      ? expandedPlatforms.filter((item) => item !== id)
      : [...expandedPlatforms, id];
  }

  /** Every row is on the same machine, so the home prefix costs a line of noise. */
  function homeRelativePath(path: string): string {
    const home = (summary?.device.homeDir ?? "").replace(/\/+$/, "");
    if (!home) return path;
    if (path === home) return "~";
    return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
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
      editingRoots = [];
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
      expandedPlatforms = [...expandedPlatforms, id];
    }
  }

  function removeCustomPlatform(id: string): void {
    removedPlatforms = [...removedPlatforms, id];
    platformSaved = false;
  }
</script>

{#snippet headerActions()}
  <div class="workspace-header-tools">
    <SkillMaintenance {copy} endpoint={serviceEndpoint ?? ""} />
    <WorkspaceSearch value={query} label={copy.skillsFilter} placeholder={copy.skillsFilterHint} closeLabel={copy.closeSearch} onInput={(value) => (query = value)} />
    <Button variant="icon" title={copy.skillManagerDeviceRefresh} ariaLabel={copy.skillManagerDeviceRefresh} onclick={() => serviceEndpoint && void loadSkillManager(serviceEndpoint)}>
      <ArrowsRotate size={17} aria-hidden="true" />
    </Button>
    {#if view === "installed"}
      <Button variant="icon" title={selectionMode ? copy.skillBatchExit : copy.skillBatchSelect} ariaLabel={selectionMode ? copy.skillBatchExit : copy.skillBatchSelect} onclick={toggleSelectionMode}>
        <Check size={17} aria-hidden="true" />
      </Button>
    {/if}
    <Button variant="icon" title={copy.skillCreateCta} ariaLabel={copy.skillCreateCta} onclick={openCreate}>
      <FileText size={17} aria-hidden="true" />
    </Button>
    <Button variant="icon" title={copy.skillInstallCta} onclick={() => openInstallFor()}>
      <AddSquare size={17} aria-hidden="true" />
    </Button>
  </div>
{/snippet}
<ChatHeader title={copy.skillsSquare} actions={headerActions} />
<div class="skills-shell">
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
    {#if view !== "platforms"}
      <div class="skills-source-filter">
        <SelectControl
          value={sourceFilter}
          ariaLabel={copy.skillSourceLabel}
          options={sourceOptions}
          onChange={(value) => { sourceFilter = value; closeSkill(); }}
        />
      </div>
      {#if view === "discovered"}
        <div class="skills-source-filter">
          <SelectControl
            value={statusFilter}
            ariaLabel={copy.skillStatusLabel}
            options={statusOptions}
            onChange={(value) => { statusFilter = value; closeSkill(); }}
          />
        </div>
      {:else}
        <div class="skills-source-filter">
          <SelectControl
            value={sortMode}
            ariaLabel={copy.skillSortLabel}
            options={[
              { value: "name", label: copy.skillSortName },
              { value: "usage", label: copy.skillSortUsage },
              { value: "health", label: copy.skillSortHealth }
            ]}
            onChange={(value) => { sortMode = value as typeof sortMode; closeSkill(); }}
          />
        </div>
      {/if}
    {/if}
  </div>

  {#if selectionMode && view === "installed"}
    <div class="skills-batch-bar" role="region" aria-label={copy.skillBatchSelect}>
      <strong>{copy.skillBatchSelected.replace("{count}", String(selectedIds.length))}</strong>
      <Button variant="secondary" class="compact" disabled={batchBusy || selectedIds.length === 0} onclick={() => void applyBatch(true)}>{copy.skillBatchEnable}</Button>
      <Button variant="secondary" class="compact" disabled={batchBusy || selectedIds.length === 0} onclick={() => void applyBatch(false)}>{copy.skillBatchDisable}</Button>
      <Button variant="icon" title={copy.skillBatchExit} ariaLabel={copy.skillBatchExit} onclick={toggleSelectionMode}><X size={15} aria-hidden="true" /></Button>
    </div>
  {/if}
  {#if batchNotice}<p class="workspace-inline-status" role="status">{batchNotice}</p>{/if}
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
                class:selection-mode={selectionMode}
                class:batch-selected={selectedIds.includes(skill.id)}
                tabindex="0"
                onclick={(event) => selectionMode ? toggleSelected(skill.id) : openSkillFromEvent(skill.id, event)}
                onkeydown={(event) => selectionMode ? (event.key === "Enter" || event.key === " " ? (event.preventDefault(), toggleSelected(skill.id)) : undefined) : skillCardKeydown(skill.id, event)}
              >
                <div class="installed-skill-header">
                  <div class="installed-skill-icon" data-tone={visual.tone} aria-hidden="true">
                    <Icon weight="Filled" size={18} />
                  </div>
                  <div class="installed-skill-header-info">
                    <div class="installed-skill-title">
                      <strong>{skill.name}</strong>
                    </div>
                  </div>
                  {#if selectionMode}
                    <span class="skills-select-mark" data-on={selectedIds.includes(skill.id)} aria-hidden="true">
                      {#if selectedIds.includes(skill.id)}<Check size={13} />{/if}
                    </span>
                  {/if}
                </div>

                <div class="installed-skill-copy">
                  {#if skill.description}
                    <p>{skill.description}</p>
                  {/if}
                </div>

                <div class="installed-skill-foot">
                  <div class="installed-skill-meta">
                    {#if skill.availability.state !== "available"}
                      <span
                        class="installed-skill-meta-pill availability"
                        data-state={skill.availability.state}
                        title={skill.availability.message}
                      >
                        {availabilityLabel(skill.availability)}{#if skill.availability.state !== "blocked" && availabilityReason(skill.availability.reason)} · {availabilityReason(skill.availability.reason)}{/if}
                      </span>
                    {/if}
                    {#if skill.usage && skill.usage.calls > 0}
                      <span class="installed-skill-meta-pill usage" title={lastUsedLabel(skill.usage)}>
                        {usageShortLabel(skill.usage)}
                      </span>
                    {/if}
                    {#if skill.dependencies.some((dependency) => !dependency.ready)}
                      <span class="installed-skill-meta-pill dependency" data-state="missing" title={skill.dependencies.filter((dependency) => !dependency.ready).map((dependency) => dependency.id).join(", ")}>
                        {copy.skillDependencyMissing}
                      </span>
                    {/if}
                    {#if skill.readBy.length}
                      <span class="installed-skill-meta-pill" title={copy.skillSharedPill.replace("{list}", skill.readBy.join(", "))} aria-label={copy.skillSharedPill.replace("{list}", skill.readBy.join(", "))}>
                        <LinkIcon size={11} aria-hidden="true" />{skill.readBy.length}
                      </span>
                    {/if}
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
                    {#if onTrySkill && skill.availability.state !== "unavailable"}
                      <Button
                        variant="icon"
                        class="compact"
                        title={copy.skillTryInChat}
                        ariaLabel={`${copy.skillTryInChat}: ${skill.name}`}
                        onclick={() => trySkill(skill)}
                      >
                        <MagicWand size={13} aria-hidden="true" />
                      </Button>
                    {/if}
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
                data-skill-name={skill.name}
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
                    <span class="skills-source-line">{discoveredPlatformName(skill)}{#if skill.sharedWith.length} · {countText(copy.skillSharedRead, copy.skillSharedReadOne, skill.sharedWith.length)}{/if}</span>
                  </div>
                </div>
                <div class="installed-skill-copy">
                  {#if skill.description}<p>{skill.description}</p>{/if}
                </div>
                <div class="installed-skill-foot">
                  <div class="installed-skill-meta">
                    {#if skill.duplicate || skill.conflict}<span class="installed-skill-meta-pill warning" title={skill.duplicate ? copy.skillDuplicateHint : copy.skillNameExists} role="img" aria-label={skill.duplicate ? copy.skillDuplicateHint : copy.skillNameExists}><Warning size={12} aria-hidden="true" /></span>{/if}
                    {#if skill.linked}<span class="installed-skill-meta-pill" title={copy.skillLinkedHint} role="img" aria-label={copy.skillLinkedHint}><LinkIcon size={12} aria-hidden="true" /></span>{/if}
                    {#if skill.inSharedDir}<span class="installed-skill-meta-pill" title={copy.skillStatusSharedHint}>{copy.skillStatusSharedShort}</span>{/if}
                    <span class="installed-skill-meta-pill">{countText(copy.skillEntryCount, copy.skillEntryCountOne, skill.entryCount)}</span>
                  </div>
                  <div class="installed-skill-actions">
                    {#if skill.installed}
                      <span class="installed-skill-state" title={copy.skillDiscoveredInstalled} role="img" aria-label={copy.skillDiscoveredInstalled}><Check size={14} aria-hidden="true" /></span>
                    {:else}
                      <Button variant="icon" title={copy.skillDiscoveredInstall} ariaLabel={copy.skillDiscoveredInstall} onclick={() => openInstallFor(skill)}><AddSquare size={14} aria-hidden="true" /></Button>
                    {/if}
                    <Button variant="icon" title={copy.skillRemoveCta} ariaLabel={copy.skillRemoveCta} onclick={() => openRemoveDiscovered(skill.id, skill.name)}><Trash size={14} aria-hidden="true" /></Button>
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
    <div class="skills-advanced">
      <div class="skills-advanced-inner">
        <section class="skills-advanced-section">
          <div class="skills-advanced-head">
            <h2>{copy.skillSectionPlatforms}</h2>
            <button type="button" class="skills-advanced-action" onclick={() => (customOpen = true)}>
              <AddSquare size={13} aria-hidden="true" />{copy.skillPlatformAdd}
            </button>
          </div>
          {#if filteredPlatforms.length === 0}
            <div class="workspace-empty compact"><EmptyState title={copy.skillsNoMatches} icon="sparkle" /></div>
          {:else}
            <div class="skills-platforms" role="list" aria-label={copy.skillViewPlatforms}>
              {#each filteredPlatforms as platform (platform.id)}
                {@const draft = draftFor(platform)}
                {@const expanded = expandedPlatforms.includes(platform.id)}
                <article class="skills-platform" role="listitem" class:disabled={!draft.enabled}>
                  <div class="skills-platform-head">
                    <button
                      type="button"
                      class="skills-platform-toggle"
                      aria-expanded={expanded}
                      onclick={() => togglePlatformExpanded(platform.id)}
                    >
                      <AngleDown size={12} class="skills-platform-caret" aria-hidden="true" />
                      <span class="skills-platform-name">{platform.label}</span>
                      <span class="skills-platform-meta">{countText(copy.skillPlatformLocations, copy.skillPlatformLocationsOne, platform.roots.length)}</span>
                      {#if !platform.verified}
                        <span class="skills-platform-dot" role="img" aria-label={copy.skillPlatformUnverified} title={copy.skillPlatformUnverified}></span>
                      {/if}
                      {#if platform.errorCount > 0}
                        <span class="skills-platform-errors" role="img" title={copy.skillManagerDiagnostics} aria-label={`${copy.skillManagerDiagnostics}: ${platform.errorCount}`}>
                          <Warning size={12} aria-hidden="true" />{platform.errorCount}
                        </span>
                      {/if}
                    </button>
                    <IosSwitch
                      checked={draft.enabled}
                      ariaLabel={`${platform.label}: ${copy.skillPlatformEnabled}`}
                      onCheckedChange={(checked) => setDraft(platform, { enabled: checked })}
                    />
                  </div>
                  {#if expanded}
                    <ul class="skills-platform-roots">
                      {#each platform.roots as root (root.path)}
                        {@const removed = draft.removedRoots.includes(root.path)}
                        <li class:removed class:missing={!root.exists}>
                          <code translate="no" title={root.path}>{homeRelativePath(root.path)}</code>
                          {#if !root.exists}<span class="skills-platform-missing">{copy.skillPlatformRootMissing}</span>{/if}
                          <span
                            class="skills-platform-count"
                            title={countText(copy.skillPlatformSkillCount, copy.skillPlatformSkillCountOne, root.skillCount)}
                            aria-label={countText(copy.skillPlatformSkillCount, copy.skillPlatformSkillCountOne, root.skillCount)}
                          >{root.skillCount}</span>
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
                    <div class="skills-platform-actions">
                      {#if editingRoots.includes(platform.id) || draft.extraRoots}
                        <textarea
                          use:focusField
                          rows="2"
                          spellcheck="false"
                          aria-label={`${platform.label}: ${copy.skillPlatformRootsPlaceholder}`}
                          placeholder={copy.skillPlatformRootsPlaceholder}
                          value={draft.extraRoots}
                          oninput={(event) => setDraft(platform, { extraRoots: event.currentTarget.value })}
                        ></textarea>
                      {:else}
                        <button type="button" class="skills-platform-add-root" onclick={() => (editingRoots = [...editingRoots, platform.id])}>
                          <AddSquare size={12} aria-hidden="true" />{copy.skillPlatformAddRoot}
                        </button>
                        {#if platform.kind === "custom"}
                          <button type="button" class="skills-platform-remove" onclick={() => removeCustomPlatform(platform.id)}>{copy.skillPlatformRemove}</button>
                        {/if}
                      {/if}
                    </div>
                  {/if}
                </article>
              {/each}
            </div>
          {/if}
        </section>

        {#if installedSkills.some((skill) => skill.source?.kind === "git" && skill.method !== "link")}
          <section class="skills-advanced-section" aria-label={copy.skillBatchUpdateTitle}>
            <div class="skills-advanced-head">
              <h2>{copy.skillBatchUpdateTitle}</h2>
              <Button variant="secondary" class="compact" disabled={scanningUpdates || updatingAll} onclick={() => void scanAllUpdates()}>
                {scanningUpdates ? copy.skillUpdateChecking : copy.skillBatchCheckAll}
              </Button>
              {#if updatableScan.length > 0}
                <Button variant="primary" class="compact" disabled={updatingAll || scanningUpdates} onclick={() => void updateAllScanned()}>
                  {updatingAll ? copy.skillBatchWorking : `${copy.skillBatchUpdateApply} ${updatableScan.length}`}
                </Button>
              {/if}
            </div>
            {#if batchUpdateNotice}<p class="skills-advanced-status" role="status">{batchUpdateNotice}</p>{/if}
            {#if updateScan.length > 0}
              <ul class="skills-update-files">
                {#each updateScan as item (item.id)}
                  <li>
                    <span translate="no">{item.name}</span>
                    <span>{item.result.ok ? (item.result.hasUpdate ? `${item.result.currentCommit.slice(0, 8)} → ${item.result.latestCommit.slice(0, 8)}` : copy.skillBatchUpdateCurrent) : item.result.message}</span>
                  </li>
                {/each}
              </ul>
            {/if}
          </section>
        {/if}

        {#if summary?.operations?.length}
          <section class="skills-advanced-section" aria-label={copy.skillOperationsTitle}>
            <div class="skills-advanced-head"><h2>{copy.skillOperationsTitle}</h2></div>
            <ul class="skills-operation-list">
              {#each summary.operations.slice(0, 8) as operation (operation.id)}
                <li>
                  <span class="skills-operation-kind">{operationKindLabel(operation.kind)}</span>
                  <span class="skills-operation-target" title={operation.targetPath}>
                    <span>{operationTarget(operation.targetPath)}</span>
                    {#if operation.error}<Warning size={12} class="skills-operation-error" aria-label={operation.error} />{/if}
                  </span>
                  <span class="skills-operation-status" data-status={operation.status}>{operationStatusLabel(operation.status)}</span>
                  <time>{formatModified(operation.updatedAt)}</time>
                </li>
              {/each}
            </ul>
          </section>
        {/if}

        {#if summary && summary.diagnostics.length > 0}
          <section class="skills-advanced-section" aria-label={copy.skillManagerDiagnostics}>
            <details class="skills-diagnostics-details">
              <summary>
                <AngleDown size={12} class="skills-advanced-caret" aria-hidden="true" />
                <span>{copy.skillManagerDiagnostics}</span>
                <span class="skills-advanced-count" data-health={summary.counts.anomalies > 0 ? "warn" : "ok"}>{summary.diagnostics.length}</span>
                <span class="skills-advanced-meta">{summary.device.label}</span>
              </summary>
              <ul class="skills-diagnostics">
                {#each summary.diagnostics as diagnostic}
                  <li><code translate="no">{diagnostic.platformId || "scan"}</code><span>{diagnostic.message}</span></li>
                {/each}
              </ul>
            </details>
          </section>
        {/if}
      </div>
    </div>
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
        {#if detail && detail.kind === "installed"}
          {@const installedDetail = detail}
          <IosSwitch
            checked={installedDetail.enabled}
            ariaLabel={`${installedDetail.name}: ${installedDetail.enabled ? copy.providerEnabled : copy.providerDisabled}`}
            disabled={skillManagerStore.busyId === installedDetail.id}
            onCheckedChange={(checked) => void toggleManagedSkill(installedDetail.id, checked).then(() => void loadDetail(installedDetail.id))}
          />
        {/if}
        {#if detail?.kind === "discovered"}
          <Button variant="icon" title={copy.skillConsolidateCta} onclick={openConsolidate}><Reorder size={16} aria-hidden="true" /></Button>
        {/if}
        {#if onTrySkill && detail && detail.kind === "installed" && detail.enabled && detail.runtime.loaded}
          {@const loadedDetail = detail}
          <Button variant="secondary" class="compact" title={copy.skillTryInChatHint} onclick={() => trySkill({ id: loadedDetail.id, name: loadedDetail.name, aliases: loadedDetail.trigger.aliases })}>
            <MagicWand size={13} aria-hidden="true" />{copy.skillTryInChat}
          </Button>
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
            <span class="skills-chip">{detail.scope === "external" ? externalPlatformName(detail.ownerLabel) : scopeLabel(detail.scope, detail.ownerLabel)}</span>
            {#if detail.scope !== "external"}<span class="skills-chip">{methodLabel(detail.method)}</span>{/if}
            {#if detail.version}<span class="skills-chip">v{detail.version}</span>{/if}
            {#if detail.source && detail.scope !== "external"}<span class="skills-chip" title={detail.source.path}>{detail.source.label}</span>{/if}
            {#if detail.locations.length}
              <Popover.Root>
                <Popover.Trigger class="skills-chip skills-chip-button" title={copy.skillLocationsHint}>
                  {detail.readBy.length ? copy.skillSharedPill.replace("{list}", detail.readBy.join(", ")) : copy.skillLocationsCta}
                  <AngleDown size={11} aria-hidden="true" />
                </Popover.Trigger>
                <Popover.Portal>
                  <Popover.Content class="skills-locations-popover" align="start" sideOffset={6}>
                    <h4>{copy.skillLocationsTitle}</h4>
                    <ul>
                      {#each detail.locations as location (location.path)}
                        <li>
                          <span class="skills-locations-platform">{location.platformLabel}</span>
                          <code translate="no">{location.path}</code>
                          <span class="skills-locations-kind" data-link={location.isLink} data-broken={location.status === "broken"}>
                            {#if location.status === "broken"}{copy.skillLocationBroken}{:else if location.isLink}<LinkIcon size={11} aria-hidden="true" />{copy.skillLocationLink}{:else}<Copy size={11} aria-hidden="true" />{copy.skillLocationCopy}{/if}
                          </span>
                        </li>
                      {/each}
                    </ul>
                  </Popover.Content>
                </Popover.Portal>
              </Popover.Root>
            {/if}
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

          <section class="skills-detail-section skills-capability" aria-label={copy.skillTriggerTitle}>
            <div class="skills-capability-grid">
              <div class="skills-capability-card">
                <h3>{copy.skillUsageTitle}</h3>
                <p>{usageLabel(detail.usage)}</p>
                {#if detail.usage?.lastAt}
                  <p class="skills-capability-muted">{lastUsedLabel(detail.usage)}</p>
                {/if}
              </div>
              <div class="skills-capability-card">
                <h3>{copy.skillTriggerTitle}</h3>
                <p class="skills-capability-muted">
                  {detail.trigger.disableModelInvocation ? copy.skillTriggerModelHidden : copy.skillTriggerModelVisible}
                </p>
                {#if detail.trigger.aliases.length}
                  <div class="skills-capability-chips">
                    {#each detail.trigger.aliases as alias (alias)}
                      <code class="skills-capability-chip" translate="no">/{alias}</code>
                    {/each}
                  </div>
                {/if}
                {#if detail.trigger.signals.cli.length || detail.trigger.signals.mcp.length || detail.trigger.signals.tools.length}
                  <ul class="skills-capability-list">
                    {#if detail.trigger.signals.cli.length}<li><span>{copy.skillTriggerCli}</span><code translate="no">{detail.trigger.signals.cli.join(", ")}</code></li>{/if}
                    {#if detail.trigger.signals.mcp.length}<li><span>{copy.skillTriggerMcp}</span><code translate="no">{detail.trigger.signals.mcp.join(", ")}</code></li>{/if}
                    {#if detail.trigger.signals.tools.length}<li><span>{copy.skillTriggerTools}</span><code translate="no">{detail.trigger.signals.tools.join(", ")}</code></li>{/if}
                  </ul>
                {/if}
                {#if detail.trigger.allowedTools.length}
                  <p class="skills-capability-muted">{copy.skillTriggerAllowedTools}: <code translate="no">{detail.trigger.allowedTools.join(", ")}</code></p>
                {/if}
              </div>
              <div class="skills-capability-card">
                <h3>{copy.skillDependenciesTitle}</h3>
                {#if detail.dependencies.length}
                  <ul class="skills-capability-list">
                    {#each detail.dependencies as dependency (`${dependency.kind}:${dependency.id}`)}
                      <li>
                        <span>{dependency.kind === "mcp" ? copy.skillTriggerMcp : copy.skillTriggerCli}</span>
                        <code translate="no">{dependency.id}</code>
                        <strong class="skills-dependency-state" data-ready={dependency.ready}>
                          {dependency.ready ? copy.skillDependencyReady : copy.skillDependencyMissing}
                        </strong>
                      </li>
                    {/each}
                  </ul>
                {:else}
                  <p class="skills-capability-muted">{copy.skillDependencyEmpty}</p>
                {/if}
              </div>
            </div>
          </section>

          {#if detail.kind === "installed" && backups.length > 0}
            <section class="skills-detail-section" aria-label={copy.skillBackupsTitle}>
              <h3>{copy.skillBackupsTitle}</h3>
              <ul class="skills-backup-list">
                {#each backups as backup (backup.path)}
                  <li>
                    <div class="skills-backup-copy">
                      <code translate="no">{backup.name}</code>
                      <span>{formatModified(backup.createdAt)} · {countText(copy.skillBackupFiles, copy.skillBackupFilesOne, backup.fileCount)}</span>
                    </div>
                    <Button variant="secondary" class="compact" disabled={backupBusy === backup.path} onclick={() => void restoreBackup(backup.path)}>
                      {copy.skillBackupRestore}
                    </Button>
                  </li>
                {/each}
              </ul>
              {#if backupNotice}<p class="skills-capability-muted" role="status">{backupNotice}</p>{/if}
            </section>
          {/if}

          {#if detail.kind === "installed" && detail.source && (detail.source.kind === "git" || detail.source.kind === "local") && !detail.builtin && detail.source.path}
            <section class="skills-detail-section skills-update-panel" aria-label={copy.skillUpdateTitle}>
              <div class="skills-update-row">
                <div class="skills-update-facts">
                  <h3>{copy.skillUpdateTitle}</h3>
                  <p>
                    {#if detail.method === "link"}{copy.skillUpdateLinkHint}{:else if detail.source.kind === "local"}{copy.skillUpdateLocalHint}{:else}
                      <code translate="no">{detail.source.commit.slice(0, 8) || "—"}</code>{copy.skillUpdateCommitHint}
                    {/if}
                  </p>
                </div>
                {#if detail.method !== "link" && detail.source.kind === "git"}
                  <Button variant="secondary" class="compact" disabled={updateCheckId === detail.id} onclick={() => void runUpdateCheck()}>
                    <Refresh size={13} aria-hidden="true" />{updateCheckId === detail.id ? copy.skillUpdateChecking : copy.skillUpdateCheck}
                  </Button>
                {/if}
              </div>
              {#if updateCheck && updateCheckId !== detail.id}
                <div class="skills-update-result" data-tone={updateCheck.ok ? (updateCheck.hasUpdate ? "update" : "ok") : "danger"} role="status">
                  <p>{updateCheck.message}</p>
                  {#if updateCheck.ok && updateCheck.hasUpdate}
                    <p class="skills-update-commits"><code translate="no">{updateCheck.currentCommit.slice(0, 8)}</code> → <code translate="no">{updateCheck.latestCommit.slice(0, 8)}</code></p>
                    {#if updateCheck.localChanges}<p class="skills-update-warning"><Warning size={12} aria-hidden="true" />{copy.skillUpdateLocalChanges}</p>{/if}
                    <div class="skills-update-actions">
                      <Button variant="secondary" class="compact" disabled={updatePreviewId === detail.id} onclick={() => void runUpdatePreview()}>
                        {updatePreviewId === detail.id ? copy.skillUpdatePreviewLoading : copy.skillUpdatePreview}
                      </Button>
                      <Button variant="primary" class="compact" onclick={startGitUpdate}>{copy.skillUpdateApply}</Button>
                    </div>
                    {#if updatePreviewError}<p class="skills-update-warning" role="alert">{copy.skillUpdatePreviewFailed}: {updatePreviewError}</p>{/if}
                    {#if updatePreview}
                      {#if updatePreview.files.length}
                        <ul class="skills-update-files">
                          {#each updatePreview.files as file (file.path)}
                            <li data-status={file.status}><code translate="no">{file.path}</code><span>{file.status}</span></li>
                          {/each}
                        </ul>
                      {:else}
                        <p class="skills-update-warning">{copy.skillUpdatePreviewEmpty}</p>
                      {/if}
                      {#if updatePreview.patch}<pre class="skills-update-patch" translate="no">{updatePreview.patch}</pre>{/if}
                      {#if updatePreview.truncated}<p class="skills-update-warning">{copy.skillUpdatePreviewTruncated}</p>{/if}
                    {/if}
                  {/if}
                </div>
              {/if}
            </section>
          {/if}

          <section class="skills-detail-section skills-detail-content">
            <div class="skills-detail-content-head">
              <h3>{copy.skillDetailContent}<span class="skills-detail-content-path" translate="no">{selectedFile}</span></h3>
              {#if detail.kind === "installed" && selectedFile.toLowerCase().endsWith("skill.md")}
                <Button variant="icon" class="compact" title={copy.skillEditCta} ariaLabel={copy.skillEditCta} onclick={() => void openEdit()}>
                  <Code size={14} aria-hidden="true" />
                </Button>
              {/if}
            </div>
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
                <div class="skills-detail-fact"><span>{copy.skillDetailPlatform}</span><strong>{externalPlatformName(detail.ownerLabel)}</strong></div>
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

          {#if detail.kind === "discovered"}
            <section class="skills-detail-section" aria-label={copy.skillLocationsTitle}>
              <h3>{copy.skillLocationsTitle}<span class="skills-detail-files-count">{detail.locations.length}</span></h3>
              <p class="skills-detail-muted">{copy.skillLocationsManageHint}</p>
              <ul class="skills-locations-list">
                {#each detail.locations as location (location.path)}
                  <li class="skills-locations-row">
                    <span class="skills-locations-platform">{location.platformLabel}</span>
                    <code class="skills-locations-path" translate="no">{location.path}</code>
                    <span class="skills-locations-kind" data-link={location.isLink} data-broken={location.status === "broken"}>
                      {#if location.status === "broken"}{copy.skillLocationBroken}{:else if location.isLink}<LinkIcon size={11} aria-hidden="true" />{copy.skillLocationLink}{:else}<Copy size={11} aria-hidden="true" />{copy.skillLocationCopy}{/if}
                    </span>
                    <Button variant="icon" title={copy.skillRemoveEntryCta} ariaLabel={`${copy.skillRemoveEntryCta}: ${location.path}`} onclick={() => openRemoveEntry(location)}><Trash size={13} aria-hidden="true" /></Button>
                  </li>
                {/each}
              </ul>
              <div class="skills-danger-zone">
                <Button variant="secondary" danger onclick={() => { if (detail) openRemoveDiscovered(detail.id, detail.name); }}>{copy.skillRemoveAllCta}</Button>
              </div>
            </section>
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
              options={discoveredSkills.map((skill) => ({ value: skill.id, label: `${skill.name} · ${discoveredPlatformName(skill)}` }))}
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

<Dialog open={consolidateOpen} busy={consolidateBusy} contentClass="skills-install-dialog skill-consolidate-dialog" labelledBy="skills-consolidate-title" describedBy="skills-consolidate-description" onCloseAutoFocus={(event) => {
  const target = consolidateReturnFocus?.isConnected ? consolidateReturnFocus
    : gridEl?.querySelector<HTMLElement>(`[data-skill-name="${CSS.escape(consolidateName)}"]`) ?? gridEl?.querySelector<HTMLElement>('[tabindex="0"]');
  if (target) { event.preventDefault(); target.focus({ preventScroll: true }); }
}} onOpenChange={(next) => (consolidateOpen = next)}>
  <div class="skills-sheet consolidate-shell">
    <header class="skills-sheet-head consolidate-head">
      <div>
        <div class="consolidate-eyebrow"><Reorder size={14} aria-hidden="true" /><span>{copy.skillConsolidateLibrary}</span></div>
        <h2 id="skills-consolidate-title">{copy.skillConsolidateTitle}</h2>
        <p id="skills-consolidate-description">{copy.skillConsolidateIntro}</p>
      </div>
      <Button variant="icon" title={copy.skillClose} disabled={consolidateBusy} onclick={() => (consolidateOpen = false)}><X size={16} aria-hidden="true" /></Button>
    </header>
    <div class="skills-sheet-body consolidate-body">
      <div class="consolidate-identity"><span class="consolidate-skill-icon"><FileText size={20} aria-hidden="true" /></span><div><strong>{consolidateName}</strong><span>{externalPlatformName(consolidatePreflight?.source.platformLabel ?? copy.skillConsolidateChecking)}</span></div></div>
      {#if consolidateResult}
        <div class="consolidate-success" role="status">
          <span class="consolidate-success-mark"><Check size={26} aria-hidden="true" /></span>
          <strong>{consolidateResult.status === "already_shared" ? copy.skillConsolidateAlreadyShared : copy.skillConsolidateDone}</strong>
          <p>{consolidateResult.status === "already_shared" ? copy.skillConsolidateAlreadySharedHint : copy.skillConsolidateDoneHint}</p>
          <code translate="no">{consolidatePath(consolidateResult.destinationPath)}</code>
          {#if consolidateResult.backupPath}<p>{copy.skillConsolidateRecovery}</p><code translate="no">{consolidatePath(consolidateResult.backupPath)}</code>{/if}
        </div>
      {:else}
        <section class="consolidate-choice" aria-label={copy.skillConsolidateSourceAction}>
          <div class="consolidate-section-label">{copy.skillConsolidateSourceAction}</div>
          <div class="segmented consolidate-actions" data-action={consolidateSourceAction} role="group" aria-label={copy.skillConsolidateSourceAction}>
            <span class="consolidate-selection" aria-hidden="true"></span>
            {#each [
              { value: "link", label: copy.skillConsolidateKeepLink, short: copy.skillConsolidateLinkShort },
              { value: "remove", label: copy.skillConsolidateRemove, short: copy.skillConsolidateRemoveShort },
              { value: "keep", label: copy.skillConsolidateKeep, short: copy.skillConsolidateKeepShort }
            ] as action (action.value)}
              <Button variant="text" class="segmented-item" ariaLabel={action.label} aria-pressed={consolidateSourceAction === action.value} disabled={consolidateBusy} onclick={() => { if (consolidateSourceAction !== action.value) { consolidateSourceAction = action.value as "link" | "remove" | "keep"; avoidStaleConsolidate(); } }}>{action.short}</Button>
            {/each}
          </div>
          <div class="consolidate-choice-description">
            {#key consolidateSourceAction}<p class="consolidate-state-enter">{consolidatePreflight?.alreadyShared && consolidateSourceAction !== "remove" ? copy.skillConsolidateSharedChoice : consolidateSourceAction === "link" ? copy.skillConsolidateKeepLinkHint : consolidateSourceAction === "remove" ? copy.skillConsolidateRemoveHint : copy.skillConsolidateKeepHint}</p>{/key}
          </div>
        </section>
        <section class="consolidate-preview" aria-label={copy.skillConsolidatePreview} aria-busy={consolidateLoading} data-pending={consolidateLoading && !!consolidatePreflight}>
          {#if consolidatePreflight}
            <div class="consolidate-route">
              <div><span><FolderOpenIcon size={14} aria-hidden="true" />{copy.skillConsolidateSourceAction}</span><code title={consolidatePreflight.source.path} translate="no">{consolidatePath(consolidatePreflight.source.path)}</code></div>
              <div><span><ArrowRight size={14} aria-hidden="true" />{copy.skillConsolidateDestination}</span><code title={consolidatePreflight.destination.path} translate="no">{consolidatePath(consolidatePreflight.destination.path)}</code></div>
            </div>
            <details class="consolidate-path-details">
              <summary aria-label={consolidatePreflight.parentLink ? copy.skillConsolidateParentLink : copy.skillConsolidatePaths}>{consolidatePreflight.parentLink ? copy.skillConsolidateParentLink : copy.skillConsolidatePaths}</summary>
              <dl>
                <div><dt>{copy.skillConsolidateSourceAction}</dt><dd><code translate="no">{consolidatePreflight.source.path}</code></dd></div>
                <div><dt>{copy.skillConsolidateDestination}</dt><dd><code translate="no">{consolidatePreflight.destination.root}</code><code translate="no">{consolidatePreflight.destination.path}</code></dd></div>
                {#if consolidatePreflight.parentLink}<div><dt>{copy.skillConsolidateParentLink}</dt><dd><code translate="no">{consolidatePreflight.parentLink.path} → {consolidatePreflight.parentLink.target}</code></dd></div>{/if}
              </dl>
            </details>
          {:else}
            <div class="consolidate-skeleton" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
          {/if}
        </section>
        <div class="consolidate-feedback" aria-live="polite">
          {#if consolidateError}
            <div class="consolidate-feedback-row" data-tone="error"><Warning size={18} aria-hidden="true" /><div><strong>{copy.skillConsolidateCheckFailed}</strong><p role="alert">{consolidateError}</p><Button variant="text" onclick={() => void runConsolidatePreflight()}>{copy.skillConsolidateRetry}</Button></div></div>
          {:else if consolidateLoading}
            <div class="consolidate-feedback-row" role="status"><ArrowsRotate class="consolidate-checking" size={18} aria-hidden="true" /><div><strong>{copy.skillConsolidateChecking}</strong><p>{copy.skillConsolidateCheckingHint}</p></div></div>
          {:else if consolidatePreflight}
            <div class="consolidate-state-enter">
              {#if consolidatePreflight.conflicts.length}
                <div class="consolidate-feedback-row" data-tone={consolidateReplaceOnly ? "warning" : "error"}><Warning size={18} aria-hidden="true" /><div><strong>{consolidateReplaceOnly ? copy.skillConsolidateReplaceTitle : copy.skillInstallConflicts}</strong>{#each consolidatePreflight.conflicts as conflict}<p>{conflictText(conflict.code, conflict.message)}</p>{/each}{#if consolidateReplaceOnly}<p>{copy.skillConsolidateReplaceNote}</p>{/if}</div></div>
              {:else}
                <div class="consolidate-feedback-row" data-tone="success" role="status"><Check size={18} aria-hidden="true" /><div><strong>{consolidatePreflight.alreadyShared ? copy.skillConsolidateAlreadyShared : copy.skillConsolidateReady}</strong><p>{consolidatePreflight.alreadyShared ? copy.skillConsolidateNoChanges : `${countText(copy.skillInstallPlanFiles, copy.skillInstallPlanFilesOne, consolidatePreflight.plan.files)} · ${formatBytes(consolidatePreflight.plan.bytes)}`}</p></div></div>
              {/if}
            </div>
          {/if}
        </div>
      {/if}
    </div>
    <footer class="skills-sheet-foot consolidate-foot">
      <span class="consolidate-foot-note">{#if consolidateResult}<Check size={13} aria-hidden="true" />{consolidateResult.status === "already_shared" ? copy.skillConsolidateAlreadyShared : consolidateResult.backupPath ? copy.skillConsolidateRecoveryShort : copy.skillConsolidateDone}{:else}<LinkIcon size={13} aria-hidden="true" />{copy.skillConsolidateFootnote}{/if}</span>
      {#if consolidateResult}
        <Button variant="primary" onclick={() => (consolidateOpen = false)}>{copy.skillClose}</Button>
      {:else}
        <Button variant="secondary" disabled={consolidateBusy} onclick={() => (consolidateOpen = false)}>{copy.skillCancel}</Button>
        <Button variant="primary" disabled={consolidateBusy || consolidateLoading || !consolidateReady || !consolidatePreflight || (!consolidatePreflight.installable && !consolidateReplaceOnly)} onclick={() => void confirmConsolidate()}>{consolidateBusy ? copy.agentTemplateUpdating : consolidatePreflight?.alreadyShared ? copy.skillConsolidateAcknowledge : consolidateReplaceOnly ? copy.skillConsolidateReplaceConfirm : copy.skillConsolidateConfirm}</Button>
      {/if}
    </footer>
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

<AlertDialog
  open={removeTarget !== null}
  busy={removing}
  contentClass="skills-confirm-dialog"
  labelledBy="skills-remove-title"
  describedBy="skills-remove-body"
  onOpenChange={(next) => { if (!next) removeTarget = null; }}
>
  <div class="skills-confirm">
    <h2 id="skills-remove-title">{removeTarget?.whole ? copy.skillRemoveTitle.replace("{name}", removeTarget?.name ?? "") : copy.skillRemoveEntryTitle}</h2>
    <p id="skills-remove-body">{removeTarget?.whole ? copy.skillRemoveBody.replace("{name}", removeTarget?.name ?? "") : copy.skillRemoveEntryBody}</p>
    {#if removeTarget && removeTarget.entries.length}
      <ul class="skills-remove-paths">
        {#each removeTarget.entries as entry (entry.path)}
          <li><code translate="no">{entry.path}</code><span>{entry.isLink ? copy.skillLocationLink : copy.skillLocationCopy}</span></li>
        {/each}
      </ul>
    {/if}
    <p class="skills-confirm-note">{copy.skillRemoveBackupNote}</p>
    {#if removeError}<p class="skills-sheet-error" role="alert">{removeError}</p>{/if}
    <footer class="skills-sheet-foot">
      <Button variant="secondary" onclick={() => (removeTarget = null)}>{copy.skillCancel}</Button>
      <Button variant="primary" danger disabled={removing} onclick={() => void confirmRemoveDiscovered()}>{removing ? copy.agentTemplateUpdating : copy.skillRemoveConfirm}</Button>
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
      <span>{copy.skillPlatformRoots}</span>
      <textarea rows="4" spellcheck="false" placeholder={copy.skillPlatformRootsPlaceholder} value={customRoots} oninput={(event) => (customRoots = event.currentTarget.value)}></textarea>
    </label>
    {#if customError}<p class="skills-sheet-error" role="alert">{customError}</p>{/if}
    <footer class="skills-sheet-foot">
      <Button variant="secondary" onclick={() => (customOpen = false)}>{copy.skillCancel}</Button>
      <Button variant="primary" onclick={() => void addCustomPlatform()}>{copy.skillPlatformAdd}</Button>
    </footer>
  </div>
</Dialog>

<Dialog open={createOpen} contentClass="skills-form-dialog" labelledBy="skills-create-title" onOpenChange={(next) => (createOpen = next)}>
  <form class="skills-form" onsubmit={(event) => { event.preventDefault(); void confirmCreate(); }}>
    <header class="skills-form-head">
      <h2 id="skills-create-title">{copy.skillCreateTitle}</h2>
    </header>
    <div class="skills-form-body">
      <div class="skills-form-row">
        <label class="skills-field">
          <span>{copy.skillCreateName}</span>
          <input
            type="text"
            spellcheck="false"
            autocomplete="off"
            placeholder={copy.skillCreateNamePlaceholder}
            value={createName}
            oninput={(event) => { createName = event.currentTarget.value; createError = ""; }}
          />
        </label>
        <label class="skills-field skills-field-scope">
          <span>{copy.skillCreateScope}</span>
          <SelectControl
            value={createScope}
            ariaLabel={copy.skillCreateScope}
            options={[
              { value: "global", label: copy.skillScopeGlobal },
              { value: "agent", label: copy.skillScopeAgent },
              { value: "project", label: copy.skillScopeProject }
            ]}
            onChange={(value) => changeCreateScope(value as DesktopSkillManagerScope)}
          />
        </label>
      </div>
      {#if createScope === "agent"}
        <label class="skills-field">
          <span>{copy.skillCreateAgent}</span>
          <SelectControl value={createOwnerId} ariaLabel={copy.skillCreateAgent} options={(summary?.agents ?? []).map((agent) => ({ value: agent.id, label: agent.label }))} onChange={(value) => (createOwnerId = value)} />
        </label>
      {/if}
      {#if createScope === "project"}
        <label class="skills-field">
          <span>{copy.skillCreateProject}</span>
          <SelectControl value={createOwnerId} ariaLabel={copy.skillCreateProject} options={projectTargets.map((target) => ({ value: target.id, label: target.label }))} onChange={(value) => (createOwnerId = value)} />
        </label>
      {/if}
      <label class="skills-field">
        <span>{copy.skillCreateDescription}</span>
        <input type="text" spellcheck="false" autocomplete="off" value={createDescription} oninput={(event) => (createDescription = event.currentTarget.value)} />
      </label>
      <label class="skills-field skills-field-editor">
        <span>{copy.skillCreateBody}</span>
        <textarea class="skills-editor" spellcheck="false" value={createBody} oninput={(event) => (createBody = event.currentTarget.value)}></textarea>
      </label>
      {#if createError}<p class="skills-sheet-error" role="alert">{createError}</p>{/if}
    </div>
    <footer class="skills-sheet-foot">
      <Button variant="secondary" onclick={() => (createOpen = false)}>{copy.skillCancel}</Button>
      <Button type="submit" variant="primary" disabled={creating || !createName.trim() || !createDescription.trim() || !createBody.trim()}>
        {creating ? copy.agentTemplateUpdating : copy.skillCreateConfirm}
      </Button>
    </footer>
  </form>
</Dialog>

<Dialog open={editOpen} contentClass="skills-form-dialog" labelledBy="skills-edit-title" onOpenChange={(next) => (editOpen = next)}>
  <form class="skills-form" onsubmit={(event) => { event.preventDefault(); void confirmEdit(); }}>
    <header class="skills-form-head">
      <h2 id="skills-edit-title">{copy.skillEditTitle}</h2>
      <span class="skills-form-file" translate="no">{selectedFile.split("/").pop() ?? ""}</span>
    </header>
    <div class="skills-form-body">
      <textarea class="skills-editor skills-editor-full" spellcheck="false" aria-label={copy.skillEditTitle} value={editContent} oninput={(event) => (editContent = event.currentTarget.value)}></textarea>
      {#if editError}<p class="skills-sheet-error" role="alert">{editError}</p>{/if}
    </div>
    <footer class="skills-sheet-foot">
      <Button variant="secondary" onclick={() => (editOpen = false)}>{copy.skillCancel}</Button>
      <Button type="submit" variant="primary" disabled={editSaving || !editContent.trim()}>
        {editSaving ? copy.agentTemplateUpdating : copy.skillEditConfirm}
      </Button>
    </footer>
  </form>
</Dialog>
