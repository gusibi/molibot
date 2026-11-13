import { SkillMaintenance, rollbackMaintenance, type MaintenanceRoot } from "$lib/server/skills/maintenance.js";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { homedir, hostname } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type {
  DesktopDiscoveredSkill,
  DesktopSkillAvailabilityView,
  DesktopSkillCheckUpdateRequest,
  DesktopSkillCheckUpdateResult,
  DesktopSkillConsolidatePreflight,
  DesktopSkillConsolidateRequest,
  DesktopSkillConsolidateResult,
  DesktopSkillDependency,
  DesktopSkillDiagnostic,
  DesktopSkillDistributeResult,
  DesktopSkillInstallResult,
  DesktopSkillLocation,
  DesktopSkillManagerDetail,
  DesktopSkillManagerEntry,
  DesktopSkillManagerScope,
  DesktopSkillManagerSummary,
  DesktopSkillMaintenanceRequest,
  DesktopSkillOperationView,
  DesktopSkillPlatform,
  DesktopSkillPlatformSaveRequest,
  DesktopSkillPreflightRequest,
  DesktopSkillPreflightResult,
  DesktopSkillRemoveDiscoveredRequest,
  DesktopSkillRemoveDiscoveredResult,
  DesktopSkillSourceView,
  DesktopSkillTriggerView,
  DesktopSkillUninstallResult,
  DesktopSkillUpdatePreview,
  DesktopSkillUsageStats
} from "$lib/shared/desktop.js";
import { isSkillBackupDirectory, skillBackupName } from "$lib/server/agent/skills/skillBackup.js";
import { inspectSkillEntry, scanSkillRoot, type ScannedSkillEntry } from "$lib/server/agent/skills/skillScan.js";
import { loadSkillsFromWorkspace, parseSkillTriggerInfo } from "$lib/server/agent/skills/skills.js";
import type { TraceFactRecord } from "$lib/server/agent/hooks/traceStore.js";
import { listBuiltinSkillStates } from "$lib/server/agent/skills/bootstrap.js";
import { parseSkillFrontmatter } from "$lib/server/agent/skills/skillFrontmatter.js";
import { readGitSkill, type GitSkillSnapshot } from "$lib/server/skills/gitSource.js";
import {
  PLATFORM_PRESETS,
  findPlatformPreset,
  resolvePlatformRoots,
  type PlatformScanContext
} from "$lib/server/skills/platforms.js";
import { flattenSkillFrontmatter } from "$lib/server/skills/frontmatterView.js";
import { listSkillDirectory, readSkillFileContent } from "$lib/server/skills/preview.js";
import type { SkillManagerStore } from "$lib/server/skills/store.js";
import {
  assertInsideRoot,
  copySkillTree,
  inspectSkillTree,
  isValidSkillName,
  type SkillTreeInspection
} from "$lib/server/skills/tree.js";
import type {
  SkillHealth,
  SkillInstallMethod,
  SkillInstallationRecord,
  SkillScopeKind
} from "$lib/server/skills/types.js";

export interface SkillProjectRef {
  id: string;
  name: string;
  rootPath: string;
}

export interface SkillManagerOptions {
  store: SkillManagerStore;
  dataDir: string;
  globalSkillsDir: string;
  /** Directory holding one workspace per Agent (`<dataDir>/sessions`). */
  agentsDir: string;
  projects: () => SkillProjectRef[];
  getDisabledPaths: () => string[];
  setDisabledPaths?: (paths: string[]) => void;
  getAgentLabel?: (id: string) => string;
  defaultAgentId?: () => string;
  homeDir?: string;
  platform?: NodeJS.Platform;
  hostLabel?: string;
  now?: () => Date;
  /** Skill-usage facts for the trailing window, used by the capability view. */
  traceStore?: {
    listFactsByTypeSince(factType: "skill_usage", sinceIso: string, limit?: number): TraceFactRecord[];
  };
  /** Configured MCP servers, so a card can say whether a declared dependency exists. */
  getMcpServers?: () => Array<{ id: string; enabled: boolean }>;
  /** Whether a CLI binary declared in `signals.cli` resolves on the host. */
  hasCommand?: (binary: string) => boolean;
}

interface ManagedRoot {
  root: string;
  scope: SkillScopeKind;
  ownerId: string;
  ownerLabel: string;
}

interface ManagedEntry {
  entry: ScannedSkillEntry;
  root: ManagedRoot;
}

interface ScanBucket {
  root: string;
  entries: ScannedSkillEntry[];
  diagnostics: Array<{ code: string; message: string; path: string }>;
  truncated: boolean;
}

interface SourceResolution {
  kind: "discovered" | "local" | "git";
  label: string;
  platformId: string;
  name: string;
  description: string;
  /** Directory whose content is installed (a real path). */
  contentDir: string;
  /** Path shown in preflight: where the content was found. */
  originPath: string;
  commit: string;
  subdirectory: string;
  tree: SkillTreeInspection | null;
  git: GitSkillSnapshot | null;
  cleanup: (() => void) | null;
}

function hashId(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/**
 * `~/.agents/skills` is a cross-tool shared tree, not one vendor's private
 * directory. Discovery groups it as "Global" even though OpenCode and OpenClaw
 * also read it; `sharedWith` still reports those readers.
 */
const SHARED_SKILLS_PLATFORM_ID = "agents";
const SHARED_SKILLS_PLATFORM_LABEL = "Global";

function platformLabel(id: string): string {
  if (id === SHARED_SKILLS_PLATFORM_ID) return SHARED_SKILLS_PLATFORM_LABEL;
  return findPlatformPreset(id)?.label ?? id;
}

/**
 * `existsSync` follows links, so a broken link reads as "nothing here" and the
 * next write collides with it. Installation targets must be checked without
 * following the final entry.
 */
function existsNoFollow(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function isWithin(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}/`);
}

function safeRealPath(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

/** Parent aliases identify the same entry; a link at the entry itself is separate. */
function sameDirectoryEntry(left: string, right: string): boolean {
  return basename(left) === basename(right)
    && (safeRealPath(dirname(left)) ?? dirname(left)) === (safeRealPath(dirname(right)) ?? dirname(right));
}

/**
 * The unified Skill Manager.
 *
 * One service owns discovery, provenance, installation records and file
 * lifecycle; Runtime keeps owning *effective* selection, loading and tool
 * permissions. The transport layer only projects what this service returns, so
 * Web and Desktop cannot drift into two different installation behaviours.
 */
export class SkillManager {
  private readonly options: SkillManagerOptions;
  private recovered = false;
  private scanCache = new Map<string, ScanBucket>();
  /** path→name for the Runtime loader, memoized per workspace within one read. */
  private runtimeCache = new Map<string, Map<string, string>>();

  constructor(options: SkillManagerOptions) {
    this.options = options;
  }

  private get store(): SkillManagerStore {
    return this.options.store;
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private iso(): string {
    return this.now().toISOString();
  }

  /**
   * Usage is the one fact the catalogue never had: the trace recorder already
   * knows which Skills were triggered, loaded and executed. Aggregating it here
   * keeps the projection honest and lets the UI answer "is this Skill doing
   * anything?" without a second client-side join.
   */
  private usageIndex(): Map<string, DesktopSkillUsageStats> {
    const out = new Map<string, DesktopSkillUsageStats>();
    const store = this.options.traceStore;
    if (!store) return out;
    const since = new Date(this.now().getTime() - 30 * 86400000).toISOString();
    let facts: TraceFactRecord[] = [];
    try {
      facts = store.listFactsByTypeSince("skill_usage", since);
    } catch {
      return out;
    }
    const buckets = new Map<string, { stats: DesktopSkillUsageStats; runs: Set<string> }>();
    for (const fact of facts) {
      const payload = fact.payload ?? {};
      const level = String(payload.level ?? "");
      const filePath = String(payload.filePath ?? "").trim();
      const name = String(payload.name ?? fact.name ?? "").trim();
      const keys = [
        filePath ? `path:${resolve(filePath)}` : "",
        name ? `name:${name.toLowerCase()}` : ""
      ].filter(Boolean);
      if (keys.length === 0) continue;
      const at = fact.finishedAt ?? fact.updatedAt ?? fact.createdAt;
      const evidence = String(payload.evidenceCsv ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      for (const key of keys) {
        const bucket = buckets.get(key) ?? {
          stats: { calls: 0, triggered: 0, loaded: 0, executed: 0, runs: 0, lastAt: "", evidence: [] },
          runs: new Set<string>()
        };
        bucket.stats.calls += 1;
        if (level === "triggered" || level === "loaded" || level === "executed") bucket.stats[level] += 1;
        if (at && at > bucket.stats.lastAt) bucket.stats.lastAt = at;
        for (const item of evidence) {
          if (!bucket.stats.evidence.includes(item)) bucket.stats.evidence.push(item);
        }
        bucket.runs.add(fact.runId);
        buckets.set(key, bucket);
      }
    }
    for (const [key, bucket] of buckets) {
      out.set(key, { ...bucket.stats, runs: bucket.runs.size });
    }
    return out;
  }

  private operationView(row: {
    id: string;
    kind: DesktopSkillOperationView["kind"];
    status: DesktopSkillOperationView["status"];
    targetPath: string;
    error: string;
    createdAt: string;
    updatedAt: string;
  }): DesktopSkillOperationView {
    return {
      id: row.id,
      kind: row.kind,
      status: row.status,
      targetPath: row.targetPath,
      error: row.error,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }

  private usageFor(
    index: Map<string, DesktopSkillUsageStats>,
    entryPath: string,
    name: string
  ): DesktopSkillUsageStats | null {
    return index.get(`path:${resolve(entryPath)}`) ?? index.get(`name:${name.toLowerCase()}`) ?? null;
  }

  private dependenciesFor(
    trigger: DesktopSkillTriggerView,
    mcpServers: string[]
  ): DesktopSkillDependency[] {
    const configured = new Map(
      (this.options.getMcpServers?.() ?? []).map((server) => [server.id.toLowerCase(), server.enabled])
    );
    const mcp = Array.from(new Set([...trigger.signals.mcp, ...mcpServers].map((id) => id.trim()).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b));
    const cli = Array.from(new Set(trigger.signals.cli.map((id) => id.trim()).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b));
    return [
      ...mcp.map((id) => ({
        kind: "mcp" as const,
        id,
        ready: this.options.getMcpServers ? configured.get(id.toLowerCase()) === true : true
      })),
      ...cli.map((id) => ({
        kind: "cli" as const,
        id,
        ready: this.options.hasCommand ? this.options.hasCommand(id) : true
      }))
    ];
  }

  private triggerFor(entryDir: string, manifest: { name: string; frontmatter: Record<string, string>; raw: string }): DesktopSkillTriggerView {
    const trigger = parseSkillTriggerInfo(manifest.raw, manifest.frontmatter, manifest.name, join(entryDir, "SKILL.md"));
    return {
      aliases: trigger.aliases,
      signals: trigger.signals,
      allowedTools: trigger.allowedTools,
      disableModelInvocation: trigger.disableModelInvocation
    };
  }

  private workspaceForScope(scope: SkillScopeKind, ownerId: string): { workspace: string; projectRoot?: string } | null {
    if (scope === "agent") return { workspace: join(this.options.agentsDir, ownerId) };
    if (scope === "project") {
      const project = this.options.projects().find((candidate) => candidate.id === ownerId);
      return project ? { workspace: project.rootPath, projectRoot: project.rootPath } : null;
    }
    const defaultId = this.options.defaultAgentId?.() ?? this.listAgentIds()[0];
    return defaultId ? { workspace: join(this.options.agentsDir, defaultId) } : null;
  }

  private runtimeSnapshot(
    workspace: string,
    projectRoot: string | undefined,
    disabled: Set<string>
  ): Map<string, string> {
    const key = `${workspace}\0${projectRoot ?? ""}\0${[...disabled].sort().join("|")}`;
    const cached = this.runtimeCache.get(key);
    if (cached) return cached;
    const paths = new Map<string, string>();
    try {
      const { skills } = loadSkillsFromWorkspace(workspace, undefined, {
        disabledSkillPaths: [...disabled],
        projectRoot
      });
      for (const skill of skills) paths.set(skill.filePath, skill.name);
    } catch {
      // A broken workspace must not fail the whole catalogue; the entry simply
      // reports that the loader did not reach it.
    }
    this.runtimeCache.set(key, paths);
    return paths;
  }

  private availabilityOf(params: {
    entryPath: string;
    name: string;
    scope: SkillScopeKind;
    ownerId: string;
    health: SkillHealth;
    enabled: boolean;
    disabled: Set<string>;
    dependencies: DesktopSkillDependency[];
  }): DesktopSkillAvailabilityView {
    if (!params.enabled) {
      return { state: "disabled", reason: "disabled", message: "Disabled for Molibot; the file is untouched." };
    }
    if (params.health === "missing") {
      return { state: "unavailable", reason: "missing", message: "The entry is missing from disk." };
    }
    if (params.health === "broken") {
      return { state: "unavailable", reason: "broken", message: "The link target is missing." };
    }
    if (params.health === "invalid") {
      return { state: "unavailable", reason: "invalid", message: "The Skill cannot be parsed." };
    }
    const scope = this.workspaceForScope(params.scope, params.ownerId);
    if (!scope) {
      return {
        state: "unavailable",
        reason: "no_workspace",
        message: "No Agent workspace is registered, so no runtime context can load Skills."
      };
    }
    const loaded = this.runtimeSnapshot(scope.workspace, scope.projectRoot, params.disabled);
    if (!loaded.has(params.entryPath)) {
      const duplicate = [...loaded.values()].some((name) => name === params.name);
      return duplicate
        ? {
            state: "unavailable",
            reason: "duplicate_name",
            message: `Another entry named "${params.name}" wins the duplicate-name rule.`
          }
        : {
            state: "unavailable",
            reason: "not_loaded",
            message: "The loader does not reach this entry from its workspace."
          };
    }
    const missing = params.dependencies.filter((dependency) => !dependency.ready);
    if (missing.length > 0) {
      return {
        state: "blocked",
        reason: "dependencies",
        message: `Missing ${missing.map((item) => `${item.kind}:${item.id}`).join(", ")}.`
      };
    }
    return { state: "available", reason: "loaded", message: "The Runtime loader selects this entry in its own context." };
  }

  private scanContext(): PlatformScanContext {
    return {
      homeDir: this.options.homeDir ?? homedir(),
      dataDir: this.options.dataDir,
      projects: this.options.projects()
    };
  }

  /**
   * The cross-tool shared Skill tree. Molibot never loads it (Runtime has its
   * own roots), but it is the canonical consolidation target: one copy that
   * Claude Code, OpenCode, OpenClaw and friends all read.
   */
  private get sharedSkillsDir(): string {
    return join(this.options.homeDir ?? homedir(), ".agents", "skills");
  }

  private isInSharedDir(realPath: string): boolean {
    const root = safeRealPath(this.sharedSkillsDir) ?? this.sharedSkillsDir;
    return isWithin(root, realPath);
  }

  // ── Platform configuration ────────────────────────────────────────────────

  private effectivePlatforms() {
    const stored = new Map(this.store.listPlatforms().map((row) => [row.id, row]));
    const platforms = PLATFORM_PRESETS.map((preset) => {
      const row = stored.get(preset.id);
      return row ?? {
        id: preset.id,
        kind: "preset" as const,
        label: preset.label,
        enabled: true,
        extraRoots: [],
        removedRoots: [],
        writable: preset.writable,
        verified: preset.verified,
        updatedAt: ""
      };
    });
    for (const row of stored.values()) {
      if (row.kind === "custom") platforms.push(row);
    }
    return platforms;
  }

  /** Entity-level platform save: only the rows the client sent are written. */
  savePlatforms(request: DesktopSkillPlatformSaveRequest): void {
    this.scanCache.clear();
    const stamp = this.iso();
    const operationId = randomUUID();
    this.store.beginOperation({
      id: operationId,
      kind: "platform",
      status: "pending",
      targetPath: "",
      stagingPath: "",
      backupPath: "",
      payload: {
        platforms: request.platforms.map((row) => ({ id: row.id, enabled: row.enabled })),
        removed: request.removed ?? []
      },
      error: "",
      createdAt: stamp,
      updatedAt: stamp
    });
    const rows = request.platforms
      .filter((row) => row.kind === "preset" || row.kind === "custom")
      .map((row) => {
        const preset = row.kind === "preset" ? findPlatformPreset(row.id) : null;
        if (row.kind === "preset" && !preset) throw new Error(`Unknown platform: ${row.id}`);
        const label = String(row.label ?? preset?.label ?? row.id).trim() || row.id;
        return {
          id: row.id,
          kind: row.kind,
          label,
          enabled: row.enabled,
          extraRoots: (row.extraRoots ?? []).map((path) => this.sanitizeScanRoot(path)),
          removedRoots: (row.removedRoots ?? []).map((path) => this.sanitizeScanRoot(path)),
          writable: preset ? preset.writable : true,
          verified: preset ? preset.verified : false,
          updatedAt: stamp
        };
      });
    if (rows.length > 0) this.store.savePlatforms(rows);
    for (const id of request.removed ?? []) {
      // Removing a platform removes its read rule only. Nothing on disk is
      // touched, and no installation that lives in its roots is deleted.
      this.store.deletePlatform(id);
    }
    this.store.finishOperation(operationId, "committed");
  }

  /**
   * A custom scan root is an explicit authorization, not an arbitrary
   * filesystem API: it must be an absolute directory that is neither the
   * filesystem root nor the home directory itself.
   */
  private sanitizeScanRoot(input: unknown): string {
    const raw = String(input ?? "").trim();
    if (!raw) throw new Error("A scan folder cannot be empty");
    const absolute = resolve(raw);
    if (absolute === "/" || /^[a-zA-Z]:\\?$/.test(absolute)) {
      throw new Error("The filesystem root cannot be a scan folder");
    }
    const home = this.options.homeDir ?? homedir();
    if (absolute === resolve(home)) {
      throw new Error("The home directory itself cannot be a scan folder; add a specific folder instead");
    }
    if (absolute === resolve(this.options.dataDir)) {
      throw new Error("The Molibot data directory cannot be a custom scan folder");
    }
    return absolute;
  }

  // ── Scanning ─────────────────────────────────────────────────────────────

  private scan(root: string): ScanBucket {
    const cached = this.scanCache.get(root);
    if (cached) return cached;
    const result = scanSkillRoot(root);
    const bucket: ScanBucket = {
      root,
      entries: result.entries,
      diagnostics: result.diagnostics.map((diagnostic) => ({
        code: diagnostic.code,
        message: diagnostic.message,
        path: diagnostic.path
      })),
      truncated: result.truncated
    };
    this.scanCache.set(root, bucket);
    return bucket;
  }

  private managedRoots(): ManagedRoot[] {
    const roots: ManagedRoot[] = [
      { root: this.options.globalSkillsDir, scope: "global", ownerId: "", ownerLabel: "" }
    ];
    for (const id of this.listAgentIds()) {
      roots.push({
        root: join(this.options.agentsDir, id, "skills"),
        scope: "agent",
        ownerId: id,
        ownerLabel: this.options.getAgentLabel?.(id) ?? id
      });
    }
    for (const project of this.options.projects()) {
      roots.push({
        root: join(project.rootPath, ".agents", "skills"),
        scope: "project",
        ownerId: project.id,
        ownerLabel: project.name
      });
    }
    return roots;
  }

  private listAgentIds(): string[] {
    try {
      return readdirSync(this.options.agentsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .map((entry) => entry.name);
    } catch {
      return [];
    }
  }

  private collectManaged(): ManagedEntry[] {
    const entries: ManagedEntry[] = [];
    const seen = new Set<string>();
    for (const root of this.managedRoots()) {
      const bucket = this.scan(root.root);
      for (const entry of bucket.entries) {
        const key = `${entry.entryDir}\0${root.scope}\0${root.ownerId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        entries.push({ entry, root });
      }
    }
    return entries;
  }

  /**
   * Physical directory → platforms that read it. This is what turns "one
   * directory, three tools" into a visibility note instead of three fake
   * installations.
   */
  private readership(): Map<string, Set<string>> {
    const map = new Map<string, Set<string>>();
    for (const platform of this.effectivePlatforms()) {
      for (const root of resolvePlatformRoots(platform, this.scanContext())) {
        const bucket = this.scan(root.path);
        for (const entry of bucket.entries) {
          const set = map.get(entry.realDir) ?? new Set<string>();
          set.add(platform.id);
          map.set(entry.realDir, set);
        }
      }
    }
    // Molibot also reads Agent scope, which is not a platform root.
    for (const managed of this.collectManaged()) {
      const set = map.get(managed.entry.realDir) ?? new Set<string>();
      set.add("molibot");
      map.set(managed.entry.realDir, set);
    }
    return map;
  }

  private readBy(realDir: string, readership: Map<string, Set<string>>): string[] {
    return Array.from(readership.get(realDir) ?? new Set<string>())
      .filter((id) => id !== "molibot")
      .map(platformLabel)
      .sort((a, b) => a.localeCompare(b));
  }

  /**
   * Every filesystem entry that resolves to one physical Skill directory,
   * across all configured tools. Shared roots mean the same path can serve
   * several platforms, so entries are deduplicated by path.
   */
  private collectLocations(realDir: string, extraEntry?: string): DesktopSkillLocation[] {
    const locations = new Map<string, DesktopSkillLocation>();
    const add = (platformLabel: string, path: string): void => {
      if (locations.has(path)) return;
      let isLink = false;
      let status: DesktopSkillLocation["status"] = "ok";
      try {
        isLink = lstatSync(path).isSymbolicLink();
        status = existsSync(path) ? "ok" : "broken";
      } catch {
        status = "broken";
      }
      locations.set(path, { platformLabel, path, isLink, status });
    };
    for (const platform of this.effectivePlatforms()) {
      const label = platform.kind === "preset" ? platformLabel(platform.id) : platform.label;
      for (const root of resolvePlatformRoots(platform, this.scanContext())) {
        for (const entry of this.scan(root.path).entries) {
          if (entry.realDir !== realDir) continue;
          add(label, entry.entryDir);
        }
      }
    }
    if (extraEntry) add("Molibot", extraEntry);
    return [...locations.values()].sort((a, b) => a.path.localeCompare(b.path));
  }

  // ── Overview ─────────────────────────────────────────────────────────────

  ensureRecovered(): void {
    if (this.recovered) return;
    this.recovered = true;
    this.recoverIncompleteOperations();
  }

  getOverview(): DesktopSkillManagerSummary {
    this.ensureRecovered();
    this.scanCache.clear();
    this.runtimeCache.clear();
    const usageIndex = this.usageIndex();

    const managed = this.collectManaged();
    const readership = this.readership();
    const disabled = new Set(this.options.getDisabledPaths());
    const records = new Map(this.store.listInstallations().map((record) => [record.entryPath, record]));
    const builtins = listBuiltinSkillStates({ skillsRoot: this.options.globalSkillsDir });

    const diagnostics: DesktopSkillDiagnostic[] = [];
    const platformViews: DesktopSkillPlatform[] = [];

    for (const platform of this.effectivePlatforms()) {
      const roots = resolvePlatformRoots(platform, this.scanContext());
      const labels = platform.kind === "preset" ? platformLabel(platform.id) : platform.label;
      let errorCount = 0;
      const rootViews = roots.map((root) => {
        const bucket = this.scan(root.path);
        for (const diagnostic of bucket.diagnostics) {
          errorCount += 1;
          diagnostics.push({ code: diagnostic.code, message: diagnostic.message, platformId: platform.id });
        }
        return {
          ...root,
          exists: existsSync(root.path),
          skillCount: new Set(bucket.entries.map((entry) => entry.realDir)).size
        };
      });
      const sharedWith = PLATFORM_PRESETS.filter((preset) => {
        if (preset.id === platform.id) return false;
        const otherRoots = preset.globalRoots(this.scanContext());
        return roots.some((root) => otherRoots.includes(root.path));
      }).map((preset) => preset.label);
      platformViews.push({
        id: platform.id,
        kind: platform.kind,
        label: labels,
        enabled: platform.enabled,
        writable: platform.writable,
        verified: platform.verified,
        summary: findPlatformPreset(platform.id)?.summary ?? roots.map((root) => root.path).join(" · "),
        roots: rootViews.map((root) => ({
          path: root.path,
          scope: root.scope,
          ownerLabel: root.ownerLabel,
          exists: root.exists,
          skillCount: root.skillCount
        })),
        sharedWith,
        errorCount
      });
    }

    const duplicateCounts = new Map<string, number>();
    for (const item of managed) {
      duplicateCounts.set(item.entry.realDir, (duplicateCounts.get(item.entry.realDir) ?? 0) + 1);
    }

    const installed: DesktopSkillManagerEntry[] = [];
    const managedRealDirs = new Set<string>();
    const namesInScope = new Set<string>();
    const liveBuiltinIds = new Set<string>();
    // A Copy keeps its source in place, so discovery must say "already
    // installed from here" instead of offering a second identical install.
    const installedSourcePaths = new Set<string>();
    for (const record of this.store.listInstallations()) {
      if (!record.sourceId) continue;
      const source = this.store.getSource(record.sourceId);
      const path = source?.locator.path;
      if (path) installedSourcePaths.add(safeRealPath(path) ?? path);
    }

    for (const item of managed) {
      managedRealDirs.add(item.entry.realDir);
      const manifest = inspectSkillEntry(item.entry.entryDir);
      const name = manifest.ok ? manifest.name : basename(item.entry.entryDir);
      namesInScope.add(name);
      const record = this.reconcileManaged(records.get(item.entry.filePath) ?? this.adopt(item));
      const health = this.healthOf(item.entry, record, manifest.ok, disabled.has(item.entry.filePath));
      // The catalogue list must stay O(entries): hashing every file of every
      // Skill here made each overview a full-tree walk of the whole library.
      // Freshness (observedHash/localChanges/fileCount) is the detail view's
      // job — installedDetail re-hashes the one Skill the owner opened.
      const builtin = record.scope === "global"
        ? builtins.find((candidate) => join(this.options.globalSkillsDir, candidate.id) === item.entry.entryDir) ?? null
        : null;
      if (builtin) liveBuiltinIds.add(builtin.id);
      const enabled = !disabled.has(item.entry.filePath);
      const trigger: DesktopSkillTriggerView = manifest.ok
        ? this.triggerFor(item.entry.entryDir, manifest)
        : { aliases: [], signals: { cli: [], mcp: [], tools: [] }, allowedTools: [], disableModelInvocation: false };
      const dependencies = manifest.ok
        ? this.dependenciesFor(trigger, this.mcpListFromFrontmatter(manifest.frontmatter))
        : [];
      installed.push({
        id: record.id,
        name,
        description: manifest.ok ? manifest.description : "",
        scope: item.root.scope,
        ownerId: item.root.ownerId,
        ownerLabel: item.root.ownerLabel,
        enabled,
        method: record.method,
        managed: record.managed,
        health,
        mcpServerCount: manifest.ok ? this.mcpCount(manifest.frontmatter) : 0,
        fileCount: record.fileCount,
        updatedAt: this.modifiedAt(item.entry.filePath),
        duplicateEntryCount: duplicateCounts.get(item.entry.realDir) ?? 1,
        readBy: this.readBy(item.entry.realDir, readership),
        activeDistributions: this.store.listDistributions(record.id).filter((row) => row.status === "active").length,
        source: this.sourceView(record.sourceId),
        builtin: builtin ? { ...builtin, skillId: record.id } : null,
        usage: this.usageFor(usageIndex, item.entry.filePath, name),
        availability: this.availabilityOf({
          entryPath: item.entry.filePath,
          name,
          scope: record.scope,
          ownerId: record.ownerId,
          health,
          enabled,
          disabled,
          dependencies
        }),
        dependencies,
        aliases: trigger.aliases,
        signals: trigger.signals
      });
    }

    // Records whose files vanished stay visible when Molibot owns them: the
    // difference between "installed" and "present" must never be guessed.
    for (const record of this.store.listInstallations()) {
      if (managed.some((item) => item.entry.filePath === record.entryPath)) continue;
      if (!record.managed) continue;
      // A vanished bundled Skill is represented by its recoverable placeholder
      // below; rendering the stale receipt as a second card would duplicate it.
      if (record.scope === "global" && builtins.some((builtin) => join(this.options.globalSkillsDir, builtin.id) === record.entryDir)) continue;
      installed.push({
        id: record.id,
        name: record.skillName,
        description: "",
        scope: record.scope,
        ownerId: record.ownerId,
        ownerLabel: record.scope === "project"
          ? this.options.projects().find((project) => project.id === record.ownerId)?.name ?? record.ownerId
          : record.ownerId,
        enabled: false,
        method: record.method,
        managed: true,
        health: record.method === "link" ? "broken" : "missing",
        mcpServerCount: 0,
        fileCount: record.fileCount,
        updatedAt: record.updatedAt,
        duplicateEntryCount: 1,
        readBy: [],
        activeDistributions: this.store.listDistributions(record.id).filter((row) => row.status === "active").length,
        source: this.sourceView(record.sourceId),
        builtin: null,
        usage: this.usageFor(usageIndex, record.entryPath, record.skillName),
        availability: {
          state: "unavailable",
          reason: record.method === "link" ? "broken" : "missing",
          message: "The entry is missing from disk."
        },
        dependencies: [],
        aliases: [],
        signals: { cli: [], mcp: [], tools: [] }
      });
    }

    // A bundled Skill whose copy was deleted must keep a recoverable entry: the
    // catalogue is the only place the owner can install it again.
    for (const builtin of builtins) {
      // The ledger alone is not proof: a deleted directory must still surface a
      // recoverable card, and a live entry must never be duplicated by one.
      if (liveBuiltinIds.has(builtin.id)) continue;
      installed.push({
        id: `builtin:${builtin.id}`,
        name: builtin.id,
        description: "",
        scope: "global",
        ownerId: "",
        ownerLabel: "",
        enabled: false,
        method: "external",
        managed: false,
        health: "missing",
        mcpServerCount: 0,
        fileCount: 0,
        updatedAt: "",
        duplicateEntryCount: 1,
        readBy: [],
        activeDistributions: 0,
        source: null,
        builtin: { ...builtin, skillId: `builtin:${builtin.id}` },
        usage: this.usageFor(usageIndex, "", builtin.id),
        availability: {
          state: "unavailable",
          reason: "missing",
          message: "Not installed yet; install it to make the bundled Skill available."
        },
        dependencies: [],
        aliases: [],
        signals: { cli: [], mcp: [], tools: [] }
      });
    }

    const discovered = this.collectDiscovered(managedRealDirs, namesInScope, installedSourcePaths, readership, diagnostics);

    installed.sort((a, b) => {
      // Recoverable bundled placeholders are an offer, not an installation:
      // they always follow the entries that actually exist.
      const placeholderRank = (item: DesktopSkillManagerEntry): number => (item.id.startsWith("builtin:") ? 1 : 0);
      if (placeholderRank(a) !== placeholderRank(b)) return placeholderRank(a) - placeholderRank(b);
      const scopeRank: Record<SkillScopeKind, number> = { global: 0, agent: 1, project: 2 };
      if (a.scope !== b.scope) return scopeRank[a.scope] - scopeRank[b.scope];
      return a.name.localeCompare(b.name);
    });

    // Placeholders are not installations; counting them would overstate the
    // global total, which must only cover valid entries under the real root.
    const realInstallations = installed.filter((item) => !item.id.startsWith("builtin:"));
    const recent = this.store.listOperations(1)[0] ?? null;
    // Broken links never become catalogue rows, but they are anomalies the
    // owner must see, so they count toward the same total the device strip shows.
    const brokenLinkCount = diagnostics.filter((diagnostic) => diagnostic.code === "broken_link").length;
    const anomalies = realInstallations.filter((item) => item.health !== "ok" && item.health !== "unmanaged").length
      + discovered.filter((item) => item.health !== "ok").length
      + brokenLinkCount;

    return {
      device: {
        label: this.options.hostLabel ?? hostname(),
        execution: "server",
        platform: this.options.platform ?? process.platform,
        homeDir: this.options.homeDir ?? homedir(),
        scannedAt: this.iso(),
        note: "Scanned on the server that hosts Molibot. Paths describe that machine, not the client."
      },
      counts: {
        installed: realInstallations.length,
        enabled: realInstallations.filter((item) => item.enabled).length,
        global: realInstallations.filter((item) => item.scope === "global").length,
        agent: realInstallations.filter((item) => item.scope === "agent").length,
        project: realInstallations.filter((item) => item.scope === "project").length,
        discovered: discovered.length,
        anomalies,
        distributed: realInstallations.reduce((total, item) => total + item.activeDistributions, 0)
      },
      installed,
      discovered,
      platforms: platformViews,
      diagnostics: diagnostics.slice(0, 40),
      recentOperation: recent ? this.operationView(recent) : null,
      operations: this.store.listOperations(20).map((row) => this.operationView(row)),
      capabilities: {
        gitInstall: this.hasGit(),
        localInstall: true,
        distribute: true,
        uninstall: true,
        gitUpdate: this.hasGit()
      },
      targets: this.distributionTargets(),
      agents: this.listAgentIds().map((id) => ({
        id,
        label: this.options.getAgentLabel?.(id) ?? id
      }))
    };
  }

  private collectDiscovered(
    managedRealDirs: Set<string>,
    namesInScope: Set<string>,
    installedSourcePaths: Set<string>,
    readership: Map<string, Set<string>>,
    diagnostics: DesktopSkillDiagnostic[]
  ): DesktopDiscoveredSkill[] {
    const grouped = new Map<string, {
      realDir: string;
      platforms: Set<string>;
      entryDirs: Set<string>;
      linkCount: number;
      name: string;
      description: string;
      health: "ok" | "invalid";
      updatedAt: string;
    }>();

    for (const platform of this.effectivePlatforms()) {
      if (platform.id === "molibot" || !platform.enabled) continue;
      for (const root of resolvePlatformRoots(platform, this.scanContext())) {
        const bucket = this.scan(root.path);
        for (const diagnostic of bucket.diagnostics) {
          if (diagnostic.code === "broken_link") {
            diagnostics.push({ code: diagnostic.code, message: diagnostic.message, platformId: platform.id });
          }
        }
        for (const entry of bucket.entries) {
          if (managedRealDirs.has(entry.realDir)) continue;
          const manifest = inspectSkillEntry(entry.entryDir);
          const key = entry.realDir;
          const current = grouped.get(key);
          if (current) {
            current.platforms.add(platform.id);
            // Shared roots mean several platforms read the same path; the
            // counts must describe real entry points, not platform views.
            if (!current.entryDirs.has(entry.entryDir)) {
              current.entryDirs.add(entry.entryDir);
              if (this.isLinkEntry(entry.entryDir)) current.linkCount += 1;
            }
            if (!current.description && manifest.ok) current.description = manifest.description;
            continue;
          }
          grouped.set(key, {
            realDir: entry.realDir,
            platforms: new Set([platform.id]),
            entryDirs: new Set([entry.entryDir]),
            linkCount: this.isLinkEntry(entry.entryDir) ? 1 : 0,
            name: manifest.ok ? manifest.name : basename(entry.entryDir),
            description: manifest.ok ? manifest.description : "",
            health: manifest.ok ? "ok" : "invalid",
            updatedAt: this.modifiedAt(entry.filePath)
          });
        }
      }
    }

    const discovered: DesktopDiscoveredSkill[] = [];
    for (const group of grouped.values()) {
      const shared = this.isInSharedDir(group.realDir);
      const platformId = shared ? SHARED_SKILLS_PLATFORM_ID : [...group.platforms].sort()[0] ?? "";
      const label = platformLabel(platformId);
      discovered.push({
        id: `discovered:${hashId(group.realDir)}`,
        name: group.name,
        description: group.description,
        platformId,
        platformLabel: label,
        recommendedMethod: "copy",
        linkable: this.options.platform !== "win32",
        installed: installedSourcePaths.has(safeRealPath(group.realDir) ?? group.realDir),
        sharedWith: this.readBy(group.realDir, readership).filter((candidate) => candidate !== label),
        nameExists: namesInScope.has(group.name),
        conflict: namesInScope.has(group.name),
        duplicate: false,
        linked: group.linkCount === group.entryDirs.size,
        inSharedDir: this.isInSharedDir(group.realDir),
        entryCount: group.entryDirs.size,
        health: group.health,
        updatedAt: group.updatedAt
      });
    }
    // Same name, different physical directory is a duplicate the owner must
    // resolve by comparing content, not a reason to hide one of them.
    const nameGroups = new Map<string, number>();
    for (const item of discovered) nameGroups.set(item.name, (nameGroups.get(item.name) ?? 0) + 1);
    for (const item of discovered) {
      if ((nameGroups.get(item.name) ?? 0) > 1) item.duplicate = true;
    }
    return discovered.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Older records were adopted as unmanaged even inside Molibot's own roots.
   * They are ours to manage, so upgrade them in place instead of leaving a
   * "not installed by Molibot" label on a directory Molibot owns.
   */
  private reconcileManaged(record: SkillInstallationRecord): SkillInstallationRecord {
    if (record.managed) return record;
    const real = safeRealPath(record.entryDir) ?? record.entryDir;
    if (!this.isManagedLocation(real)) return record;
    const upgraded: SkillInstallationRecord = {
      ...record,
      managed: true,
      status: "ok",
      method: this.isLinkEntry(record.entryDir) ? "link" : "copy",
      updatedAt: this.iso()
    };
    this.store.upsertInstallation(upgraded);
    return upgraded;
  }

  private adopt(item: ManagedEntry): SkillInstallationRecord {
    const manifest = inspectSkillEntry(item.entry.entryDir);
    const tree = inspectSkillTree(item.entry.entryDir, { maxFiles: 600, maxTotalBytes: 24 * 1024 * 1024 });
    const isLink = this.isLinkEntry(item.entry.entryDir);
    const record: SkillInstallationRecord = {
      id: hashId(`installation:${item.entry.entryDir}`),
      skillName: manifest.ok ? manifest.name : basename(item.entry.entryDir),
      entryPath: item.entry.filePath,
      entryDir: item.entry.entryDir,
      method: isLink ? "link" : "copy",
      scope: item.root.scope,
      ownerId: item.root.ownerId,
      // The entry sits inside a Molibot root, so Molibot owns the directory even
      // though it has no install receipt. Recording it as managed is what lets
      // the owner disable, replace or remove it with a backup; "unmanaged" is
      // reserved for entries outside our roots.
      managed: true,
      sourceId: null,
      status: "ok",
      baselineHash: tree.hash,
      observedHash: tree.hash,
      fileCount: tree.fileCount,
      installedAt: this.iso(),
      updatedAt: this.iso()
    };
    this.store.upsertInstallation(record);
    return record;
  }

  private healthOf(
    entry: ScannedSkillEntry,
    record: SkillInstallationRecord,
    manifestOk: boolean,
    disabled: boolean
  ): SkillHealth {
    if (!existsSync(entry.filePath)) return this.isLinkEntry(entry.entryDir) ? "broken" : "missing";
    if (!manifestOk) return "invalid";
    if (!record.managed) return "unmanaged";
    if (disabled) return "disabled";
    return "ok";
  }

  private isLinkEntry(entryDir: string): boolean {
    try {
      return lstatSync(entryDir).isSymbolicLink();
    } catch {
      return false;
    }
  }

  private modifiedAt(filePath: string): string {
    try {
      return lstatSync(filePath).mtime.toISOString();
    } catch {
      return "";
    }
  }

  private mcpList(rows: Array<{ key: string; value: string }>): string[] {
    return this.parseMcpRaw(rows.find((row) => row.key === "mcpServers" || row.key === "mcp_servers")?.value ?? "");
  }

  private mcpListFromFrontmatter(frontmatter: Record<string, string>): string[] {
    return this.parseMcpRaw(frontmatter.mcpServers ?? frontmatter.mcp_servers ?? "");
  }

  private parseMcpRaw(value: string): string[] {
    const raw = String(value ?? "").trim();
    if (!raw) return [];
    if (raw.startsWith("[")) {
      try {
        const parsed = JSON.parse(raw) as unknown;
        return Array.isArray(parsed) ? parsed.map((item) => String(item).trim()).filter(Boolean) : [];
      } catch {
        return [];
      }
    }
    return raw.split(",").map((item) => item.trim()).filter(Boolean);
  }

  private mcpCount(frontmatter: Record<string, string>): number {
    return this.mcpListFromFrontmatter(frontmatter).length;
  }

  private sourceView(sourceId: string | null): DesktopSkillSourceView | null {
    if (!sourceId) return null;
    const source = this.store.getSource(sourceId);
    if (!source) return null;
    return {
      kind: source.kind,
      label: source.label,
      commit: source.locator.commit ?? "",
      subdirectory: source.locator.subdir ?? "",
      path: source.locator.path ?? source.locator.remote ?? ""
    };
  }

  private hasGit(): boolean {
    try {
      execFileSync("git", ["--version"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }

  private distributionTargets(): DesktopSkillManagerSummary["targets"] {
    const targets: DesktopSkillManagerSummary["targets"] = [];
    for (const platform of this.effectivePlatforms()) {
      if (platform.id === "molibot") continue;
      const preset = platform.kind === "preset" ? findPlatformPreset(platform.id) : null;
      const writable = Boolean(preset?.writable) && platform.enabled;
      targets.push({
        id: platform.id,
        label: preset?.label ?? platform.label,
        kind: "platform",
        writable,
        reason: writable ? "" : platform.enabled ? "Adapter is not writable" : "Scanning is disabled"
      });
    }
    for (const project of this.options.projects()) {
      targets.push({
        id: project.id,
        label: project.name,
        kind: "project",
        writable: existsSync(project.rootPath),
        reason: existsSync(project.rootPath) ? "" : "Project directory is missing"
      });
    }
    return targets;
  }

  // ── Detail ────────────────────────────────────────────────────────────────

  getDetail(id: string): DesktopSkillManagerDetail {
    const record = this.store.getInstallation(id);
    if (record) return this.installedDetail(record);
    if (id.startsWith("builtin:")) return this.builtinPlaceholderDetail(id.slice("builtin:".length));

    if (id.startsWith("discovered:")) {
      // Locate the entry directly: opening one external Skill must not pay for
      // a full catalogue rescan of every configured platform root.
      const entryDir = this.findDiscoveredDir(id);
      if (!entryDir) throw new Error("Unknown Skill");
      return this.discoveredDetail(id, entryDir);
    }
    throw new Error("Unknown Skill");
  }

  private builtinPlaceholderDetail(builtinId: string): DesktopSkillManagerDetail {
    const builtin = listBuiltinSkillStates({ skillsRoot: this.options.globalSkillsDir })
      .find((candidate) => candidate.id === builtinId);
    if (!builtin) throw new Error("Unknown built-in Skill");
    return {
      kind: "installed",
      id: `builtin:${builtin.id}`,
      name: builtin.id,
      description: "",
      scope: "global",
      ownerId: "",
      ownerLabel: "",
      enabled: false,
      method: "external",
      managed: false,
      health: "missing",
      filePath: "",
      baseDir: join(this.options.globalSkillsDir, builtin.id),
      realDir: join(this.options.globalSkillsDir, builtin.id),
      linked: false,
      frontmatter: [],
      files: [],
      mcpServers: [],
      version: builtin.version,
      updatedAt: "",
      liveContent: false,
      source: { kind: "builtin", label: "Molibot", commit: "", subdirectory: "", path: "" },
      installation: null,
      distributions: [],
      builtin: { ...builtin, skillId: `builtin:${builtin.id}` },
      treeProblems: [],
      readBy: [],
      locations: [],
      usage: this.usageFor(this.usageIndex(), "", builtin.id),
      trigger: { aliases: [], signals: { cli: [], mcp: [], tools: [] }, allowedTools: [], disableModelInvocation: false },
      dependencies: [],
      runtime: {
        loaded: false,
        reason: "missing",
        message: "This bundled Skill is not installed in the global root yet."
      }
    };
  }

  private baseFiles(baseDir: string): Array<{ path: string; kind: "file" | "dir"; size: number }> {
    return listSkillDirectory(baseDir);
  }

  private frontmatterRows(entryDir: string): {
    ok: boolean;
    name: string;
    description: string;
    version: string;
    rows: Array<{ key: string; value: string }>;
  } {
    const manifest = inspectSkillEntry(entryDir);
    if (!manifest.ok) return { ok: false, name: basename(entryDir), description: "", version: "", rows: [] };
    const rows = flattenSkillFrontmatter(manifest.frontmatter);
    return {
      ok: true,
      name: manifest.name,
      description: manifest.description,
      version: String(manifest.frontmatter.version ?? "").trim(),
      rows
    };
  }

  private installedDetail(sourceRecord: SkillInstallationRecord): DesktopSkillManagerDetail {
    const record = this.reconcileManaged(sourceRecord);
    const frontmatter = this.frontmatterRows(record.entryDir);
    const exists = existsSync(record.entryDir);
    const tree = exists ? inspectSkillTree(record.entryDir) : null;
    const disabled = new Set(this.options.getDisabledPaths());
    const distributions = this.store.listDistributions(record.id);
    const realDir = safeRealPath(record.entryDir) ?? record.entryDir;
    const builtin = record.scope === "global"
      ? listBuiltinSkillStates({ skillsRoot: this.options.globalSkillsDir })
          .find((candidate) => join(this.options.globalSkillsDir, candidate.id) === record.entryDir) ?? null
      : null;
    const manifest = inspectSkillEntry(record.entryDir);
    const trigger: DesktopSkillTriggerView = manifest.ok
      ? this.triggerFor(record.entryDir, manifest)
      : { aliases: [], signals: { cli: [], mcp: [], tools: [] }, allowedTools: [], disableModelInvocation: false };
    const dependencies = manifest.ok
      ? this.dependenciesFor(trigger, this.mcpListFromFrontmatter(manifest.frontmatter))
      : [];

    return {
      kind: "installed",
      id: record.id,
      name: frontmatter.name,
      description: frontmatter.description,
      scope: record.scope,
      ownerId: record.ownerId,
      ownerLabel: record.scope === "project"
        ? this.options.projects().find((project) => project.id === record.ownerId)?.name ?? record.ownerId
        : this.options.getAgentLabel?.(record.ownerId) ?? record.ownerId,
      enabled: !disabled.has(record.entryPath),
      method: record.method,
      managed: record.managed,
      health: !exists
        ? this.isLinkEntry(record.entryDir) ? "broken" : "missing"
        : !frontmatter.ok
          ? "invalid"
          : !record.managed
            ? "unmanaged"
            : disabled.has(record.entryPath)
              ? "disabled"
              : "ok",
      filePath: record.entryPath,
      baseDir: record.entryDir,
      realDir,
      linked: this.isLinkEntry(record.entryDir),
      frontmatter: frontmatter.rows,
      files: exists ? this.baseFiles(record.entryDir) : [],
      mcpServers: this.mcpList(frontmatter.rows),
      version: frontmatter.version,
      updatedAt: this.modifiedAt(record.entryPath),
      liveContent: record.method === "link",
      source: this.sourceView(record.sourceId),
      installation: {
        id: record.id,
        managed: record.managed,
        method: record.method,
        baselineHash: record.baselineHash,
        observedHash: tree?.hash ?? record.observedHash,
        localChanges: Boolean(tree?.hash && record.baselineHash && tree.hash !== record.baselineHash),
        fileCount: tree?.fileCount ?? record.fileCount,
        installedAt: record.installedAt,
        linkTarget: record.method === "link" ? realDir : ""
      },
      distributions: distributions.map((row) => ({
        id: row.id,
        targetPath: row.targetPath,
        targetLabel: row.targetLabel,
        method: row.method,
        status: row.status
      })),
      builtin: builtin ? { ...builtin, skillId: record.id } : null,
      treeProblems: (tree?.problems ?? []).map((problem) => ({
        code: problem.code,
        message: problem.message,
        path: problem.path
      })),
      readBy: this.readBy(realDir, this.readership()),
      locations: this.collectLocations(realDir, record.entryDir),
      usage: this.usageFor(this.usageIndex(), record.entryPath, frontmatter.name),
      trigger,
      dependencies,
      runtime: this.runtimeCheck(record)
    };
  }

  private discoveredDetail(id: string, entryDir: string): DesktopSkillManagerDetail {
    const frontmatter = this.frontmatterRows(entryDir);
    const tree = inspectSkillTree(entryDir);
    const realDir = safeRealPath(entryDir) ?? entryDir;
    const platform = this.discoveredPlatform(entryDir);
    const manifest = inspectSkillEntry(entryDir);
    const trigger: DesktopSkillTriggerView = manifest.ok
      ? this.triggerFor(entryDir, manifest)
      : { aliases: [], signals: { cli: [], mcp: [], tools: [] }, allowedTools: [], disableModelInvocation: false };
    const dependencies = manifest.ok
      ? this.dependenciesFor(trigger, this.mcpListFromFrontmatter(manifest.frontmatter))
      : [];
    return {
      kind: "discovered",
      id,
      name: frontmatter.name,
      description: frontmatter.description,
      scope: "external",
      ownerId: "",
      ownerLabel: platform.label,
      enabled: false,
      method: "external",
      managed: false,
      health: frontmatter.ok ? "ok" : "invalid",
      filePath: join(entryDir, "SKILL.md"),
      baseDir: entryDir,
      realDir,
      linked: this.isLinkEntry(entryDir),
      frontmatter: frontmatter.rows,
      files: this.baseFiles(entryDir),
      mcpServers: this.mcpList(frontmatter.rows),
      version: frontmatter.version,
      updatedAt: this.modifiedAt(join(entryDir, "SKILL.md")),
      liveContent: true,
      source: {
        kind: "local",
        label: platform.label,
        commit: "",
        subdirectory: "",
        path: realDir
      },
      installation: null,
      distributions: [],
      builtin: null,
      treeProblems: tree.problems.map((problem) => ({
        code: problem.code,
        message: problem.message,
        path: problem.path
      })),
      readBy: this.readBy(realDir, this.readership()),
      locations: this.collectLocations(realDir),
      usage: this.usageFor(this.usageIndex(), join(entryDir, "SKILL.md"), frontmatter.name),
      trigger,
      dependencies,
      runtime: {
        loaded: false,
        reason: "not_loaded",
        message: "Not installed into a Molibot Skill root, so the Runtime cannot select it."
      }
    };
  }

  private findDiscoveredEntries(id: string): Array<{ entryDir: string; realDir: string }> {
    const wanted = id.replace(/^discovered:/, "");
    const found: Array<{ entryDir: string; realDir: string }> = [];
    const seen = new Set<string>();
    for (const platform of this.effectivePlatforms()) {
      if (platform.id === "molibot" || !platform.enabled) continue;
      for (const root of resolvePlatformRoots(platform, this.scanContext())) {
        for (const entry of this.scan(root.path).entries) {
          if (hashId(entry.realDir) !== wanted || seen.has(entry.entryDir)) continue;
          seen.add(entry.entryDir);
          found.push({ entryDir: entry.entryDir, realDir: entry.realDir });
        }
      }
    }
    return found;
  }

  private findDiscoveredDir(id: string): string | null {
    return this.findDiscoveredEntries(id)[0]?.entryDir ?? null;
  }

  /**
   * Ask the *real* loader whether this entry is usable in its own context.
   * A directory existing is not the same claim as a Skill being loaded.
   */
  private runtimeCheck(record: SkillInstallationRecord): DesktopSkillManagerDetail["runtime"] {
    const disabled = this.options.getDisabledPaths();
    if (disabled.includes(record.entryPath)) {
      return { loaded: false, reason: "disabled", message: "Disabled for Molibot; the file is untouched." };
    }
    if (!existsSync(record.entryPath)) {
      return { loaded: false, reason: "missing", message: "The entry is missing from disk." };
    }
    const manifest = inspectSkillEntry(record.entryDir);
    if (!manifest.ok) {
      return { loaded: false, reason: "invalid", message: `The Skill cannot be parsed: ${manifest.message}.` };
    }
    const workspace = this.workspaceFor(record);
    if (!workspace) {
      return {
        loaded: false,
        reason: "no_workspace",
        message: "No Agent workspace is registered, so no runtime context can load Skills."
      };
    }
    const projectRoot = record.scope === "project"
      ? this.options.projects().find((project) => project.id === record.ownerId)?.rootPath
      : undefined;
    try {
      const { skills } = loadSkillsFromWorkspace(workspace, undefined, {
        disabledSkillPaths: disabled,
        projectRoot
      });
      const loaded = skills.some((skill) => skill.filePath === record.entryPath);
      if (loaded) {
        return {
          loaded: true,
          reason: "loaded",
          message: "The Runtime loader selects this entry in its own context."
        };
      }
      const duplicate = skills.find((skill) => skill.name === manifest.name);
      return duplicate
        ? {
            loaded: false,
            reason: "duplicate_name",
            message: `Another entry named "${manifest.name}" wins the duplicate-name rule.`
          }
        : {
            loaded: false,
            reason: "not_loaded",
            message: "The loader does not reach this entry from its workspace."
          };
    } catch (cause) {
      return {
        loaded: false,
        reason: "not_loaded",
        message: cause instanceof Error ? cause.message : String(cause)
      };
    }
  }

  private workspaceFor(record: SkillInstallationRecord): string | null {
    if (record.scope === "agent") return join(this.options.agentsDir, record.ownerId);
    if (record.scope === "project") {
      const project = this.options.projects().find((candidate) => candidate.id === record.ownerId);
      return project?.rootPath ?? null;
    }
    const defaultId = this.options.defaultAgentId?.() ?? this.listAgentIds()[0];
    return defaultId ? join(this.options.agentsDir, defaultId) : null;
  }

  // ── Preflight ─────────────────────────────────────────────────────────────

  preflight(request: DesktopSkillPreflightRequest): DesktopSkillPreflightResult {
    const source = this.resolveSource(request.source);
    try {
      return this.buildPreflight(request, source);
    } finally {
      source.cleanup?.();
    }
  }

  private buildPreflight(
    request: DesktopSkillPreflightRequest,
    source: SourceResolution
  ): DesktopSkillPreflightResult {
    const tree = source.tree;
    if (!tree) throw new Error("The source Skill could not be inspected");
    const conflicts: DesktopSkillPreflightResult["conflicts"] = [];
    const warnings: string[] = [];

    if (tree.problems.length > 0) {
      for (const problem of tree.problems) {
        conflicts.push({ code: problem.code, message: problem.message, path: problem.path });
      }
    }

    const manifest = inspectSkillEntry(source.contentDir);
    if (!manifest.ok) {
      conflicts.push({
        code: manifest.code,
        message: `${manifest.message}. Install the Skill itself, not its parent directory.`,
        path: source.contentDir
      });
    }

    const sourceName = manifest.ok ? manifest.name : source.name;
    const rename = String(request.rename ?? "").trim();
    if (rename && request.method === "link") {
      conflicts.push({
        code: "link_rename_unsupported",
        message: "A link cannot be renamed; install a Copy to use a different name.",
        path: ""
      });
    }
    const dirName = rename || sourceName;
    if (rename && !isValidSkillName(rename)) {
      conflicts.push({
        code: "invalid_name",
        message: "A Skill name must be lowercase letters, digits and single hyphens, up to 64 characters.",
        path: ""
      });
    } else if (!isValidSkillName(dirName)) {
      warnings.push(
        `"${dirName}" is not a lowercase-hyphen Skill name. Other tools may refuse to load it; a renamed Copy fixes this.`
      );
    }

    const target = this.resolveTarget(request.scope, request.ownerId ?? "");
    let targetPath = "";
    try {
      targetPath = assertInsideRoot(target.root, join(target.root, dirName));
    } catch (cause) {
      conflicts.push({
        code: "invalid_target",
        message: cause instanceof Error ? cause.message : String(cause),
        path: ""
      });
    }

    const existing = existsNoFollow(targetPath) ? lstatSync(targetPath) : null;
    const record = targetPath ? this.store.getInstallationByEntry(join(targetPath, "SKILL.md")) : null;
    let requiresReplace = false;
    if (existing) {
      if (record && !record.managed) {
        conflicts.push({
          code: "external_content",
          message: "Something Molibot does not manage already exists at this target.",
          path: targetPath
        });
      } else {
        // Install targets are always inside Molibot's own roots, so an existing
        // entry there can be replaced after an explicit confirmation; the
        // previous content is kept as a timestamped sibling backup first.
        requiresReplace = true;
        warnings.push("Replacing keeps the previous content as a timestamped sibling backup.");
      }
    }

    if (request.method === "link" && this.options.platform === "win32") {
      conflicts.push({
        code: "link_unsupported",
        message: "Links are not supported on this server platform.",
        path: ""
      });
    }

    const sharedConsumers = this.consumersOf(source.contentDir === source.originPath ? source.contentDir : source.originPath);

    const token = fingerprint({
      source: source.originPath,
      hash: tree.hash,
      method: request.method,
      scope: request.scope,
      ownerId: request.ownerId ?? "",
      rename,
      targetPath,
      conflicts: conflicts.map((conflict) => conflict.code).sort()
    });

    return {
      ok: true,
      token,
      source: {
        kind: source.kind,
        label: source.label,
        name: sourceName,
        description: manifest.ok ? manifest.description : "",
        path: source.originPath,
        realDir: source.contentDir,
        commit: source.commit,
        subdirectory: source.subdirectory,
        hash: tree.hash,
        fileCount: tree.fileCount,
        totalBytes: tree.totalBytes,
        linkable: this.options.platform !== "win32"
      },
      target: {
        path: targetPath,
        dirName,
        scope: request.scope,
        ownerLabel: target.ownerLabel,
        root: target.root
      },
      method: request.method,
      plan: {
        files: tree.entries.filter((entry) => entry.kind !== "dir").length,
        directories: tree.entries.filter((entry) => entry.kind === "dir").length,
        links: tree.entries.filter((entry) => entry.kind === "symlink").length,
        executables: tree.entries.filter((entry) => entry.kind === "file" && entry.executable).length,
        bytes: tree.totalBytes
      },
      conflicts,
      requiresReplace,
      backup: {
        required: requiresReplace,
        description: requiresReplace
          ? `The current entry is renamed to ${skillBackupName(dirName)} before anything new is written.`
          : ""
      },
      sharedConsumers,
      warnings,
      installable: conflicts.length === 0
    };
  }

  private consumersOf(path: string): Array<{ platformId: string; label: string }> {
    const real = safeRealPath(path);
    if (!real) return [];
    const consumers: Array<{ platformId: string; label: string }> = [];
    for (const platform of this.effectivePlatforms()) {
      for (const root of resolvePlatformRoots(platform, this.scanContext())) {
        const parent = safeRealPath(root.path);
        if (parent && (real === parent || real.startsWith(`${parent}/`) || dirname(real) === parent)) {
          consumers.push({
            platformId: platform.id,
            label: platform.kind === "preset" ? platformLabel(platform.id) : platform.label
          });
          break;
        }
      }
    }
    return consumers;
  }

  private resolveTarget(scope: DesktopSkillManagerScope, ownerId: string): { root: string; ownerLabel: string } {
    if (scope === "global") {
      return { root: this.options.globalSkillsDir, ownerLabel: "" };
    }
    if (scope === "agent") {
      const id = String(ownerId ?? "").trim();
      if (!id || !/^[a-zA-Z0-9._-]+$/.test(id) || id === "." || id === "..") {
        throw new Error("Select an Agent for an Agent-scoped installation");
      }
      if (!this.listAgentIds().includes(id)) throw new Error("Unknown Agent");
      return { root: join(this.options.agentsDir, id, "skills"), ownerLabel: this.options.getAgentLabel?.(id) ?? id };
    }
    const project = this.options.projects().find((candidate) => candidate.id === ownerId);
    if (!project) throw new Error("Select a registered project for a project-scoped installation");
    return { root: join(project.rootPath, ".agents", "skills"), ownerLabel: project.name };
  }

  private resolveSource(request: DesktopSkillPreflightRequest["source"]): SourceResolution {
    if (request.kind === "discovered") {
      const entryDir = this.findDiscoveredDir(request.id);
      if (!entryDir) throw new Error("The discovered Skill is no longer present");
      const real = safeRealPath(entryDir) ?? entryDir;
      const tree = inspectSkillTree(entryDir);
      const manifest = inspectSkillEntry(entryDir);
      const discoveredPlatform = this.discoveredPlatform(entryDir);
      return {
        kind: "discovered",
        label: discoveredPlatform.label,
        platformId: discoveredPlatform.id,
        name: manifest.ok ? manifest.name : basename(entryDir),
        description: manifest.ok ? manifest.description : "",
        contentDir: entryDir,
        originPath: real,
        commit: "",
        subdirectory: "",
        tree,
        git: null,
        cleanup: null
      };
    }

    if (request.kind === "local") {
      const input = String(request.path ?? "").trim();
      if (!input) throw new Error("A local Skill directory is required");
      const absolute = resolve(input);
      const real = safeRealPath(absolute);
      if (!real) throw new Error("The local Skill directory does not exist");
      if (!lstatSync(real).isDirectory()) throw new Error("The local Skill path is not a directory");
      const tree = inspectSkillTree(absolute);
      const manifest = inspectSkillEntry(absolute);
      return {
        kind: "local",
        label: "Local folder",
        platformId: "",
        name: manifest.ok ? manifest.name : basename(absolute),
        description: manifest.ok ? manifest.description : "",
        contentDir: absolute,
        originPath: absolute,
        commit: "",
        subdirectory: "",
        tree,
        git: null,
        cleanup: null
      };
    }

    if (!this.hasGit()) throw new Error("Git is not available on this server");
    const snapshot = readGitSkill({
      repository: String(request.repository ?? ""),
      ref: request.ref,
      subdirectory: String(request.subdirectory ?? "")
    });
    const staging = this.materializeGit(snapshot);
    const tree = inspectSkillTree(staging);
    const manifest = inspectSkillEntry(staging);
    return {
      kind: "git",
      label: "Git repository",
      platformId: "",
      name: manifest.ok ? manifest.name : basename(staging),
      description: manifest.ok ? manifest.description : "",
      contentDir: staging,
      originPath: resolve(String(request.repository ?? "")),
      commit: snapshot.commit,
      subdirectory: String(request.subdirectory ?? ""),
      tree,
      git: snapshot,
      cleanup: () => {
        rmSync(staging, { recursive: true, force: true });
      }
    };
  }

  private discoveredPlatform(entryDir: string): { id: string; label: string } {
    const dir = safeRealPath(entryDir);
    if (dir && this.isInSharedDir(dir)) {
      return { id: SHARED_SKILLS_PLATFORM_ID, label: SHARED_SKILLS_PLATFORM_LABEL };
    }
    for (const platform of this.effectivePlatforms()) {
      if (platform.id === "molibot") continue;
      for (const root of resolvePlatformRoots(platform, this.scanContext())) {
        const realRoot = safeRealPath(root.path) ?? root.path;
        if (dir && isWithin(realRoot, dir)) {
          return {
            id: platform.id,
            label: platform.kind === "preset" ? platformLabel(platform.id) : platform.label
          };
        }
      }
    }
    return { id: "", label: "External" };
  }

  /**
   * A Git Link must point at a directory Molibot keeps, never at a download
   * staging area: the link would break the moment the install finished.
   */
  private persistGitSource(snapshot: GitSkillSnapshot): string {
    const library = join(this.options.dataDir, "skills-manager", "library", snapshot.commit.slice(0, 12));
    const existing = safeRealPath(library);
    if (existing) return existing;
    mkdirSync(library, { recursive: true });
    for (const file of snapshot.files) {
      const target = join(library, ...file.path.split("/"));
      assertInsideRoot(library, target);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, file.content, { mode: file.mode & 0o777 });
    }
    return library;
  }

  private materializeGit(snapshot: GitSkillSnapshot): string {
    const staging = join(this.options.dataDir, "skills-manager", "staging", `git-${randomUUID()}`);
    mkdirSync(staging, { recursive: true });
    for (const file of snapshot.files) {
      assertInsideRoot(staging, join(staging, ...file.path.split("/")));
      const target = join(staging, ...file.path.split("/"));
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, file.content, { mode: file.mode & 0o777 });
    }
    return staging;
  }

  // ── Install ───────────────────────────────────────────────────────────────

  install(request: DesktopSkillPreflightRequest & { token: string; replace: boolean }): DesktopSkillInstallResult {
    this.scanCache.clear();
    const source = this.resolveSource(request.source);
    try {
      return this.executeInstall(request, source, this.buildPreflight(request, source));
    } finally {
      source.cleanup?.();
    }
  }

  private executeInstall(
    request: DesktopSkillPreflightRequest & { token: string; replace: boolean },
    source: SourceResolution,
    preflight: DesktopSkillPreflightResult
  ): DesktopSkillInstallResult {
    if (preflight.token !== request.token) {
      return {
        ok: false,
        status: "stale",
        message: "The source or target changed since the preview. Review the plan again.",
        id: "",
        targetPath: preflight.target.path,
        method: request.method,
        backupPath: ""
      };
    }
    if (!preflight.installable) {
      return {
        ok: false,
        status: "failed",
        message: preflight.conflicts[0]?.message ?? "This installation has conflicts",
        id: "",
        targetPath: preflight.target.path,
        method: request.method,
        backupPath: ""
      };
    }
    if (preflight.requiresReplace && !request.replace) {
      return {
        ok: false,
        status: "failed",
        message: "Replacing an existing installation has to be confirmed first.",
        id: "",
        targetPath: preflight.target.path,
        method: request.method,
        backupPath: ""
      };
    }

    const targetPath = preflight.target.path;
    const targetRoot = preflight.target.root;
    mkdirSync(targetRoot, { recursive: true });
    const existing = this.store.getInstallationByEntry(join(targetPath, "SKILL.md"));
    const operationId = randomUUID();
    const stagingPath = join(targetRoot, `.staging-${operationId}`);
    let backupPath = "";

    this.store.beginOperation({
      id: operationId,
      kind: existing ? "replace" : "install",
      status: "pending",
      targetPath,
      stagingPath: request.method === "copy" ? stagingPath : "",
      backupPath: "",
      payload: {
        source: preflight.source.path,
        method: request.method,
        scope: preflight.target.scope,
        ownerId: request.ownerId ?? "",
        name: preflight.target.dirName
      },
      error: "",
      createdAt: this.iso(),
      updatedAt: this.iso()
    });

    // Only content this request actually wrote may be removed during rollback:
    // a concurrent install that won the same target must never be deleted by
    // the loser's cleanup.
    let wroteTarget = false;
    try {
      if (existsNoFollow(targetPath)) {
        backupPath = join(dirname(targetPath), skillBackupName(basename(targetPath)));
        renameSync(targetPath, backupPath);
      }

      if (request.method === "link") {
        const linkTarget = source.kind === "git" && source.git
          ? this.persistGitSource(source.git)
          : safeRealPath(source.contentDir) ?? source.contentDir;
        symlinkSync(linkTarget, targetPath);
        wroteTarget = true;
      } else {
        copySkillTree({
          sourceDir: source.contentDir,
          targetDir: stagingPath,
          inspection: source.tree as SkillTreeInspection,
          renameTo: request.rename?.trim() || undefined
        });
        renameSync(stagingPath, targetPath);
        wroteTarget = true;
      }

      const verification = inspectSkillEntry(targetPath);
      if (!verification.ok) throw new Error(`Installed Skill is not readable: ${verification.message}`);
      const written = inspectSkillTree(targetPath);

      if (written.problems.some((problem) => problem.code === "symlink_escape" || problem.code === "symlink_loop")) {
        throw new Error("Installed Skill contains a link that escapes its directory");
      }

      const record = this.recordInstallation({
        previous: existing,
        targetPath,
        method: request.method,
        scope: preflight.target.scope,
        ownerId: request.ownerId ?? "",
        name: verification.name,
        hash: written.hash,
        fileCount: written.fileCount,
        source
      });

      this.store.finishOperation(operationId, "committed", { backupPath });
      return {
        ok: true,
        status: backupPath ? "replaced" : "installed",
        message: backupPath
          ? `Installed ${verification.name}. The previous content is kept at the backup path.`
          : `Installed ${verification.name}.`,
        id: record.id,
        targetPath,
        method: request.method,
        backupPath
      };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      rmSync(stagingPath, { recursive: true, force: true });
      try {
        if (wroteTarget && existsNoFollow(targetPath)) {
          if (this.isLinkEntry(targetPath)) unlinkSync(targetPath);
          else rmSync(targetPath, { recursive: true, force: true });
        }
        if (backupPath && existsNoFollow(backupPath) && !existsNoFollow(targetPath)) {
          renameSync(backupPath, targetPath);
        }
      } catch (rollbackError) {
        // Keep every recoverable material and say so; deleting the last copy of
        // the previous content would turn a failed install into data loss.
        this.store.finishOperation(operationId, "failed", {
          error: `${message}; rollback also failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`
        });
        return {
          ok: false,
          status: "failed",
          message: `${message}. The previous content could not be restored automatically; recovery material is kept.`,
          id: "",
          targetPath,
          method: request.method,
          backupPath
        };
      }
      this.store.finishOperation(operationId, "failed", { error: message });
      return {
        ok: false,
        status: "failed",
        message: backupPath ? `${message}. The previous content was restored.` : message,
        id: "",
        targetPath,
        method: request.method,
        backupPath
      };
    }
  }

  private recordInstallation(input: {
    previous: SkillInstallationRecord | null;
    targetPath: string;
    method: SkillInstallMethod;
    scope: SkillScopeKind;
    ownerId: string;
    name: string;
    hash: string;
    fileCount: number;
    source: SourceResolution;
  }): SkillInstallationRecord {
    const sourceRecordId = this.recordSource(input.source);
    const record: SkillInstallationRecord = {
      id: input.previous?.id ?? randomUUID(),
      skillName: input.name,
      entryPath: join(input.targetPath, "SKILL.md"),
      entryDir: input.targetPath,
      method: input.method,
      scope: input.scope,
      ownerId: input.ownerId,
      managed: true,
      sourceId: sourceRecordId,
      status: "ok",
      baselineHash: input.hash,
      observedHash: input.hash,
      fileCount: input.fileCount,
      installedAt: input.previous?.installedAt ?? this.iso(),
      updatedAt: this.iso()
    };
    this.store.upsertInstallation(record);
    return record;
  }

  private recordSource(source: SourceResolution): string {
    const locator = {
      path: source.kind === "git" ? undefined : source.originPath,
      platformId: source.platformId || undefined,
      remote: source.kind === "git" ? source.originPath : undefined,
      commit: source.commit || undefined,
      subdir: source.subdirectory || undefined
    };
    const id = hashId(`source:${source.kind}:${source.originPath}:${source.commit}:${source.subdirectory}`);
    this.store.upsertSource({
      id,
      kind: source.kind === "git" ? "git" : "local",
      label: source.label,
      locator,
      createdAt: this.iso()
    });
    return id;
  }

  // ── Consolidate ───────────────────────────────────────────────────────────

  /**
   * One canonical copy plus links back into the places that used to own the
   * Skill. This is the explicit "move it into the shared library and leave a
   * link where it was" workflow: it never runs automatically, and every write
   * into an external tool's folder is confirmed through this preflight.
   */
  preflightConsolidate(request: DesktopSkillConsolidateRequest): DesktopSkillConsolidatePreflight {
    const source = this.resolveConsolidateSource(request.id);
    const destination = this.resolveConsolidateDestination();
    const conflicts: DesktopSkillConsolidatePreflight["conflicts"] = [];

    if (source.tree.problems.length > 0) {
      for (const problem of source.tree.problems) {
        conflicts.push({ code: problem.code, message: problem.message, path: problem.path });
      }
    }
    const manifest = inspectSkillEntry(source.entryDir);
    if (!manifest.ok) {
      conflicts.push({ code: manifest.code, message: manifest.message, path: source.entryDir });
    }

    let destinationPath = "";
    try {
      destinationPath = assertInsideRoot(destination.root, join(destination.root, source.name));
    } catch (cause) {
      conflicts.push({ code: "invalid_target", message: cause instanceof Error ? cause.message : String(cause), path: "" });
    }

    const destinationExists = destinationPath ? existsNoFollow(destinationPath) : false;
    const destinationTree = destinationExists ? inspectSkillTree(destinationPath) : null;
    const identical = Boolean(destinationTree && destinationTree.problems.length === 0
      && destinationTree.hash === source.tree.hash);
    const sameEntry = Boolean(destinationPath && sameDirectoryEntry(source.entryDir, destinationPath));
    const alreadyShared = destinationExists && sameEntry && !this.isLinkEntry(destinationPath);
    if (sameEntry && request.sourceAction === "remove") {
      conflicts.push({ code: "shared_entry_remove", message: "The original path is the shared entry itself, reached directly or through a parent link; removing it would remove the shared content.", path: source.entryDir });
    } else if (destinationExists && !identical && !request.replaceDestination) {
      conflicts.push({ code: "replace_required", message: "The destination already holds content; confirm replacing it.", path: destinationPath });
    }
    const backLink: DesktopSkillConsolidatePreflight["backLink"] = request.sourceAction === "link" && !sameEntry
      ? { path: source.entryDir, label: source.platformLabel } : null;
    const parentPath = dirname(source.entryDir);
    const parentLink = this.isLinkEntry(parentPath)
      ? { path: parentPath, target: safeRealPath(parentPath) ?? parentPath } : null;

    const token = fingerprint({
      source: source.realDir,
      sourceEntry: source.entryDir,
      sourceParent: safeRealPath(parentPath),
      hash: source.tree.hash,
      destination: destinationPath,
      destinationRealDir: destinationExists ? safeRealPath(destinationPath) : null,
      destinationHash: destinationTree?.hash ?? null,
      destinationProblems: destinationTree?.problems ?? [],
      destinationIsLink: destinationExists && this.isLinkEntry(destinationPath),
      sourceAction: request.sourceAction,
      replaceDestination: request.replaceDestination
    });

    return {
      ok: true,
      token,
      alreadyShared,
      parentLink,
      source: {
        name: source.name,
        path: source.entryDir,
        realDir: source.realDir,
        platformId: source.platformId,
        platformLabel: source.platformLabel,
        hash: source.tree.hash,
        fileCount: source.tree.fileCount,
        totalBytes: source.tree.totalBytes
      },
      destination: {
        label: destination.label,
        root: destination.root,
        path: destinationPath,
        exists: destinationExists
      },
      backLink,
      conflicts,
      plan: {
        files: source.tree.entries.filter((entry) => entry.kind !== "dir").length,
        directories: source.tree.entries.filter((entry) => entry.kind === "dir").length,
        executables: source.tree.entries.filter((entry) => entry.kind === "file" && entry.executable).length,
        bytes: source.tree.totalBytes
      },
      installable: conflicts.length === 0 || (conflicts.every((conflict) => conflict.code === "replace_required") && request.replaceDestination)
    };
  }

  consolidate(request: DesktopSkillConsolidateRequest & { token: string }): DesktopSkillConsolidateResult {
    this.scanCache.clear();
    const preflight = this.preflightConsolidate(request);
    if (preflight.token !== request.token) {
      return {
        ok: false,
        status: "stale",
        message: "The source or destination changed after the preview. Review it again.",
        destinationPath: preflight.destination.path,
        backupPath: ""
      };
    }
    if (!preflight.installable) {
      return {
        ok: false,
        status: "failed",
        message: preflight.conflicts[0]?.message ?? "This consolidation has conflicts",
        destinationPath: preflight.destination.path,
        backupPath: ""
      };
    }

    if (preflight.alreadyShared) {
      return { ok: true, status: "already_shared", message: "This entry already reads the single shared copy. No files were moved or replaced.", destinationPath: preflight.destination.path, backupPath: "" };
    }

    const source = this.resolveConsolidateSource(request.id);
    const destination = this.resolveConsolidateDestination();
    const destinationPath = preflight.destination.path;
    const operationId = randomUUID();
    const stagingPath = join(destination.root, `.staging-${operationId}`);
    let destinationBackup = "";
    let sourceBackup = "";
    let destinationWritten = false;
    const reuseDestination = existsNoFollow(destinationPath)
      && !this.isLinkEntry(destinationPath)
      && inspectSkillTree(destinationPath).hash === source.tree.hash;

    this.store.beginOperation({
      id: operationId,
      kind: "consolidate",
      status: "pending",
      targetPath: destinationPath,
      stagingPath,
      backupPath: "",
      payload: {
        sourceEntryPath: source.entryDir,
        sourceRealDir: source.realDir,
        sourceAction: request.sourceAction,
        name: source.name
      },
      error: "",
      createdAt: this.iso(),
      updatedAt: this.iso()
    });

    const restore = (): void => {
      rmSync(stagingPath, { recursive: true, force: true });
      if (sourceBackup && existsNoFollow(sourceBackup)) {
        if (existsNoFollow(source.entryDir)) {
          if (this.isLinkEntry(source.entryDir)) unlinkSync(source.entryDir);
          else rmSync(source.entryDir, { recursive: true, force: true });
        }
        renameSync(sourceBackup, source.entryDir);
      }
      if (destinationWritten && existsNoFollow(destinationPath) && !destinationBackup) {
        if (this.isLinkEntry(destinationPath)) unlinkSync(destinationPath);
        else rmSync(destinationPath, { recursive: true, force: true });
      }
      if (destinationBackup && existsNoFollow(destinationBackup)) {
        if (existsNoFollow(destinationPath)) rmSync(destinationPath, { recursive: true, force: true });
        renameSync(destinationBackup, destinationPath);
      }
    };

    try {
      if (!reuseDestination) {
        // Read first: the destination may be a link back to the source.
        copySkillTree({ sourceDir: source.entryDir, targetDir: stagingPath, inspection: source.tree });
        if (existsNoFollow(destinationPath)) {
          destinationBackup = join(dirname(destinationPath), skillBackupName(basename(destinationPath)));
          renameSync(destinationPath, destinationBackup);
        }
        renameSync(stagingPath, destinationPath);
        destinationWritten = true;
      }
      const verification = inspectSkillEntry(destinationPath);
      if (!verification.ok) throw new Error(`The consolidated copy is not readable: ${verification.message}`);

      if (request.sourceAction !== "keep" && !sameDirectoryEntry(source.entryDir, destinationPath)) {
        sourceBackup = join(dirname(source.entryDir), skillBackupName(basename(source.entryDir)));
        renameSync(source.entryDir, sourceBackup);
        if (request.sourceAction === "link") {
          symlinkSync(safeRealPath(destinationPath) ?? destinationPath, source.entryDir);
        }
      }

      this.store.finishOperation(operationId, "committed", {
        backupPath: destinationBackup || sourceBackup,
        stagingPath: ""
      });
      return {
        ok: true,
        status: "consolidated",
        message: request.sourceAction === "link"
          ? `Moved ${verification.name} into ${destination.label} and linked the original entry to it.`
          : request.sourceAction === "remove"
            ? `Moved ${verification.name} into ${destination.label}. The original entry was removed (a backup is kept).`
            : `Copied ${verification.name} into ${destination.label}. The original entry was left as its own copy.`,
        destinationPath,
        backupPath: destinationBackup || sourceBackup
      };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      try {
        restore();
        this.store.finishOperation(operationId, "failed", { error: message, backupPath: destinationBackup || sourceBackup });
        return {
          ok: false,
          status: "failed",
          message: `${message}. The original entry was restored.`,
          destinationPath,
          backupPath: ""
        };
      } catch (rollbackError) {
        this.store.finishOperation(operationId, "failed", {
          error: `${message}; rollback also failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
          backupPath: destinationBackup || sourceBackup
        });
        return {
          ok: false,
          status: "failed",
          message: `${message}. Recovery material was kept; the original entry may still need attention.`,
          destinationPath,
          backupPath: destinationBackup || sourceBackup
        };
      }
    }
  }

  private resolveConsolidateSource(id: string): {
    entryDir: string;
    realDir: string;
    tree: SkillTreeInspection;
    name: string;
    platformId: string;
    platformLabel: string;
  } {
    const entries = this.findDiscoveredEntries(id);
    const entryDir = entries.find((entry) => !this.isLinkEntry(entry.entryDir))?.entryDir
      ?? entries[0]?.entryDir;
    if (!entryDir) throw new Error("The discovered Skill is no longer present");
    const tree = inspectSkillTree(entryDir);
    const manifest = inspectSkillEntry(entryDir);
    const platform = this.discoveredPlatform(entryDir);
    return {
      entryDir,
      realDir: safeRealPath(entryDir) ?? entryDir,
      tree,
      name: manifest.ok ? manifest.name : basename(entryDir),
      platformId: platform.id || "external",
      platformLabel: platform.label
    };
  }

  /**
   * The one consolidation target: the cross-tool shared tree. Molibot-owned
   * scopes are deliberately not targets — pushing a Skill to a specific tool
   * is what distribute does.
   */
  private resolveConsolidateDestination(): { root: string; label: string } {
    return { root: this.sharedSkillsDir, label: "the shared skills folder (~/.agents/skills)" };
  }

  maintenance(): SkillMaintenance {
    this.recoverIncompleteOperations();
    const roots: MaintenanceRoot[] = [];
    for (const platform of this.effectivePlatforms()) {
      for (const root of resolvePlatformRoots(platform, this.scanContext())) {
        const project = this.options.projects().find((project) => project.id === root.ownerId);
        roots.push({ path: root.path, label: platform.label,
          scope: root.scope === "project" ? `project:${root.ownerId}` : "global",
          destination: project ? join(project.rootPath, ".agents", "skills") : this.sharedSkillsDir,
          writable: platform.writable });
      }
    }
    for (const root of this.managedRoots()) {
      roots.push({ path: root.root, label: root.ownerLabel || "Molibot", scope: root.scope === "global" ? "global" : `${root.scope}:${root.ownerId}`,
        destination: root.scope === "global" ? this.sharedSkillsDir : root.scope === "project" ? root.root : "", writable: true });
    }
    return new SkillMaintenance(roots, this.store);
  }

  applyMaintenance(request: DesktopSkillMaintenanceRequest, token: string) {
    const result = this.maintenance().apply(request, token);
    this.scanCache.clear();
    if (result.ok) {
      for (const installation of this.store.listInstallations()) {
        if (!existsSync(installation.entryDir)) continue;
        const method = this.isLinkEntry(installation.entryDir) ? "link" : "copy";
        if (method !== installation.method) this.store.upsertInstallation({ ...installation, method, updatedAt: this.iso() });
      }
    }
    return result;
  }

  // ── Enable / disable ──────────────────────────────────────────────────────

  setEnabled(id: string, enabled: boolean): void {
    const record = this.store.getInstallation(id);
    if (!record) throw new Error("Unknown Skill");
    if (!this.options.setDisabledPaths) throw new Error("Skill settings are read-only here");
    const disabled = new Set(this.options.getDisabledPaths());
    if (enabled) disabled.delete(record.entryPath);
    else disabled.add(record.entryPath);
    this.options.setDisabledPaths([...disabled]);
    const operationId = randomUUID();
    const stamp = this.iso();
    this.store.beginOperation({
      id: operationId,
      kind: "toggle",
      status: "pending",
      targetPath: record.entryPath,
      stagingPath: "",
      backupPath: "",
      payload: { enabled, name: record.skillName },
      error: "",
      createdAt: stamp,
      updatedAt: stamp
    });
    this.store.finishOperation(operationId, "committed");
  }

  // ── Distribute ────────────────────────────────────────────────────────────

  distribute(request: {
    installationId: string;
    targets: Array<{ kind: "platform" | "project"; id: string }>;
    method: "copy" | "link";
  }): DesktopSkillDistributeResult {
    this.scanCache.clear();
    const record = this.store.getInstallation(request.installationId);
    if (!record) throw new Error("Unknown Skill");
    if (!record.managed) throw new Error("Only Skills Molibot installed can be distributed");
    if (!existsSync(record.entryDir)) throw new Error("The installed Skill is missing from disk");

    const sourceDir = record.entryDir;
    const links = this.isLinkEntry(sourceDir);
    const contentDir = links ? safeRealPath(sourceDir) ?? sourceDir : sourceDir;
    const method = request.method;
    const tree = method === "copy" ? inspectSkillTree(sourceDir) : null;
    if (tree && tree.problems.length > 0) {
      throw new Error(`The Skill cannot be copied: ${tree.problems[0]?.message ?? "unreadable tree"}`);
    }

    const results: DesktopSkillDistributeResult["results"] = [];
    const seen = new Set<string>();

    for (const target of request.targets) {
      let root = "";
      let label = "";
      let platformId = "";
      if (target.kind === "platform") {
        const platform = this.effectivePlatforms().find((candidate) => candidate.id === target.id);
        const preset = platform?.kind === "preset" ? findPlatformPreset(platform.id) : null;
        if (!platform || !preset || !platform.enabled || !preset.writable) {
          results.push({ targetLabel: target.id, targetPath: "", status: "skipped", message: "This platform is not writable." });
          continue;
        }
        root = preset.globalRoots(this.scanContext())[0] ?? "";
        label = preset.label;
        platformId = preset.id;
      } else {
        const project = this.options.projects().find((candidate) => candidate.id === target.id);
        if (!project || !existsSync(project.rootPath)) {
          results.push({ targetLabel: target.id, targetPath: "", status: "skipped", message: "This project is not available." });
          continue;
        }
        root = join(project.rootPath, ".agents", "skills");
        label = project.name;
        platformId = `project:${project.id}`;
      }
      if (!root) {
        results.push({ targetLabel: label || target.id, targetPath: "", status: "skipped", message: "No write root." });
        continue;
      }
      const dirName = record.skillName;
      const targetPath = join(root, dirName);
      if (seen.has(targetPath)) continue;
      seen.add(targetPath);

      if (existsNoFollow(targetPath)) {
        results.push({
          targetLabel: label,
          targetPath,
          status: "skipped",
          message: "An entry already exists at this target; nothing was overwritten."
        });
        continue;
      }

      try {
        mkdirSync(root, { recursive: true });
        if (method === "link") {
          symlinkSync(contentDir, targetPath);
        } else {
          const staging = join(root, `.staging-${randomUUID()}`);
          copySkillTree({
            sourceDir,
            targetDir: staging,
            inspection: tree as SkillTreeInspection
          });
          renameSync(staging, targetPath);
        }
        this.store.upsertDistribution({
          id: randomUUID(),
          installationId: record.id,
          targetPath,
          targetLabel: label,
          platformId,
          method,
          status: "active",
          createdAt: this.iso(),
          updatedAt: this.iso()
        });
        results.push({ targetLabel: label, targetPath, status: "installed", message: "Installed." });
      } catch (cause) {
        results.push({
          targetLabel: label,
          targetPath,
          status: "failed",
          message: cause instanceof Error ? cause.message : String(cause)
        });
      }
    }

    return { ok: results.every((result) => result.status !== "failed"), results };
  }

  /**
   * Stop tracking one distributed entry, optionally deleting the entry Molibot
   * wrote there. This is the separate, explicit step required before removing
   * content that still backs another target.
   */
  removeDistribution(request: { id: string; deleteFiles: boolean }): { ok: boolean; message: string } {
    const distribution = this.store.listDistributions().find((row) => row.id === request.id);
    if (!distribution) return { ok: false, message: "Unknown distribution" };
    if (distribution.status !== "active") return { ok: true, message: "This distribution is already inactive." };

    if (request.deleteFiles && existsSync(distribution.targetPath)) {
      try {
        if (this.isLinkEntry(distribution.targetPath)) unlinkSync(distribution.targetPath);
        else rmSync(distribution.targetPath, { recursive: true, force: true });
      } catch (cause) {
        return { ok: false, message: cause instanceof Error ? cause.message : String(cause) };
      }
    }
    this.store.upsertDistribution({
      ...distribution,
      status: "removed",
      updatedAt: this.iso()
    });
    this.scanCache.clear();
    return {
      ok: true,
      message: request.deleteFiles
        ? "The distributed entry was removed."
        : "Tracking stopped; the files at that target were left in place."
    };
  }

  // ── Uninstall ─────────────────────────────────────────────────────────────

  uninstall(request: { id: string }): DesktopSkillUninstallResult {
    this.scanCache.clear();
    const record = this.store.getInstallation(request.id);
    if (!record) return { ok: false, status: "failed", message: "Unknown Skill", blockedBy: [] };
    if (!record.managed) {
      return {
        ok: false,
        status: "blocked",
        message: "This entry was not installed by Molibot. Remove it where it lives.",
        blockedBy: []
      };
    }

    const active = this.store.listDistributions(record.id).filter((row) => row.status === "active");
    if (active.length > 0) {
      return {
        ok: false,
        status: "blocked",
        message: "This Skill still backs external installations. Remove those first.",
        blockedBy: active.map((row) => ({ targetPath: row.targetPath, label: row.targetLabel }))
      };
    }

    const operationId = randomUUID();
    this.store.beginOperation({
      id: operationId,
      kind: "uninstall",
      status: "pending",
      targetPath: record.entryDir,
      stagingPath: "",
      backupPath: "",
      payload: { id: record.id, method: record.method },
      error: "",
      createdAt: this.iso(),
      updatedAt: this.iso()
    });

    try {
      if (record.method === "link") {
        // A link is an entry, not content: removing it must never touch the
        // directory it points at.
        if (!this.isLinkEntry(record.entryDir)) {
          throw new Error("The entry is no longer a link; refusing to delete a real directory");
        }
        unlinkSync(record.entryDir);
      } else {
        const real = safeRealPath(record.entryDir) ?? record.entryDir;
        if (!this.isManagedLocation(real)) {
          throw new Error("The entry is outside Molibot's Skill roots; refusing to delete it");
        }
        rmSync(record.entryDir, { recursive: true, force: true });
      }
      this.store.deleteInstallation(record.id);
      this.store.finishOperation(operationId, "committed");
      return {
        ok: true,
        status: "removed",
        message: record.method === "link"
          ? "Link removed. The source directory was not touched."
          : "Installed copy removed.",
        blockedBy: []
      };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      this.store.finishOperation(operationId, "failed", { error: message });
      return { ok: false, status: "failed", message, blockedBy: [] };
    }
  }

  private isManagedLocation(realPath: string): boolean {
    return this.managedRoots().some((root) => {
      const realRoot = safeRealPath(root.root);
      if (!realRoot) return false;
      return realPath === realRoot || realPath.startsWith(`${realRoot}/`);
    });
  }

  // ── Discovered entries ────────────────────────────────────────────────────

  /**
   * Remove where other tools read a discovered Skill. A link entry is only
   * unlinked, never its target; a real directory is renamed to a timestamped
   * backup in place, never hard-deleted. Links are removed before real
   * directories so nothing dangles mid-operation.
   */
  removeDiscovered(request: DesktopSkillRemoveDiscoveredRequest): DesktopSkillRemoveDiscoveredResult {
    this.scanCache.clear();
    const empty: DesktopSkillRemoveDiscoveredResult = { ok: false, message: "", removed: [], backups: [], brokenLinks: [] };
    const group = this.findDiscoveredEntries(request.id);
    if (group.length === 0) {
      return { ...empty, message: "The discovered Skill is no longer present." };
    }
    const targets = request.entryDir
      ? group.filter((entry) => entry.entryDir === request.entryDir)
      : group;
    if (targets.length === 0) {
      return { ...empty, message: "That entry does not belong to the discovered Skill." };
    }
    const targetEntries = new Set(targets.map((entry) => entry.entryDir));
    // Link vs copy is decided once, before any entry is removed: unlinking a
    // link changes what a second lstat would report about the same path.
    const plan = targets.map((entry) => ({ entryDir: entry.entryDir, isLink: this.isLinkEntry(entry.entryDir) }));
    const removedRealDirs = new Set(
      plan.filter((step) => !step.isLink).map((step) => group.find((entry) => entry.entryDir === step.entryDir)?.realDir ?? "").filter(Boolean)
    );
    // Sibling links in the same group that resolve into a removed real
    // directory cannot survive it; report them instead of failing the removal.
    const brokenLinks = group
      .filter((entry) => !targetEntries.has(entry.entryDir) && this.isLinkEntry(entry.entryDir) && removedRealDirs.has(entry.realDir))
      .map((entry) => entry.entryDir);

    const operationId = randomUUID();
    this.store.beginOperation({
      id: operationId,
      kind: "uninstall",
      status: "pending",
      targetPath: targets[0].entryDir,
      stagingPath: "",
      backupPath: "",
      payload: { discovered: true, entries: targets.map((entry) => entry.entryDir) },
      error: "",
      createdAt: this.iso(),
      updatedAt: this.iso()
    });

    const removed: DesktopSkillRemoveDiscoveredResult["removed"] = [];
    const backups: string[] = [];
    try {
      for (const step of plan) {
        if (!step.isLink) continue;
        unlinkSync(step.entryDir);
        removed.push({ path: step.entryDir, kind: "link" });
      }
      for (const step of plan) {
        if (step.isLink) continue;
        const backup = join(dirname(step.entryDir), skillBackupName(basename(step.entryDir)));
        renameSync(step.entryDir, backup);
        removed.push({ path: step.entryDir, kind: "copy" });
        backups.push(backup);
      }
      this.store.finishOperation(operationId, "committed", { backupPath: backups[0] ?? "" });
      const links = removed.filter((entry) => entry.kind === "link").length;
      const copies = removed.length - links;
      const parts = [
        links ? `${links} link${links === 1 ? "" : "s"} unlinked` : "",
        copies ? `${copies} folder${copies === 1 ? "" : "s"} backed up` : ""
      ].filter(Boolean);
      return {
        ok: true,
        message: `${parts.join(", ") || "Nothing to remove"}.${backups.length ? ` Backups: ${backups.join(", ")}` : ""}${
          brokenLinks.length ? ` ${brokenLinks.length} link(s) now point at removed content.` : ""
        }`,
        removed,
        backups,
        brokenLinks
      };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      this.store.finishOperation(operationId, "failed", { error: message, backupPath: backups[0] ?? "" });
      return { ...empty, message: `${message} Some entries may already have been removed; rescan to see the current state.` };
    }
  }

  // ── Updates ───────────────────────────────────────────────────────────────

  /**
   * Compare a Git-installed Skill against its source repository. The pinned
   * commit's tree for the Skill subdirectory is compared with the tree HEAD
   * points at now, so unrelated upstream commits do not read as an update.
   */
  checkUpdate(request: DesktopSkillCheckUpdateRequest): DesktopSkillCheckUpdateResult {
    const record = this.store.getInstallation(request.id);
    if (!record) throw new Error("Unknown Skill");
    const source = record.sourceId ? this.store.getSource(record.sourceId) : null;
    if (!source || source.kind !== "git" || !source.locator.remote || !source.locator.commit) {
      throw new Error("Only Skills installed from a Git repository can check for updates");
    }
    const repository = resolve(source.locator.remote);
    const subdirectory = source.locator.subdir ?? "";
    const localChanges = Boolean(
      existsSync(record.entryDir) && inspectSkillTree(record.entryDir).hash !== record.baselineHash
    );
    const revParse = (expr: string): string => {
      try {
        return execFileSync("git", ["-C", repository, "rev-parse", expr], {
          stdio: ["ignore", "pipe", "pipe"]
        }).toString("utf8").trim();
      } catch {
        return "";
      }
    };
    const currentCommit = source.locator.commit;
    const currentTree = revParse(`${currentCommit}:${subdirectory}`);
    const latestCommit = revParse("HEAD^{commit}");
    const latestTree = latestCommit ? revParse(`${latestCommit}:${subdirectory}`) : "";
    if (!currentTree || !latestCommit || !latestTree) {
      return {
        ok: false,
        message: "Could not read the source repository; it may have moved or the Skill subdirectory may be gone.",
        repository: source.locator.remote,
        subdirectory,
        currentCommit,
        latestCommit,
        hasUpdate: false,
        localChanges
      };
    }
    const hasUpdate = currentTree !== latestTree;
    return {
      ok: true,
      message: hasUpdate
        ? "An update is available in the source repository."
        : "The installed Skill matches the source repository.",
      repository: source.locator.remote,
      subdirectory,
      currentCommit,
      latestCommit,
      hasUpdate,
      localChanges
    };
  }

  /**
   * The update preview compares the pinned source commit with the repository
   * HEAD inside the Skill's subdirectory. It intentionally shows the upstream
   * change, not the local copy: local edits are reported separately by
   * `checkUpdate`.
   */
  previewUpdate(request: DesktopSkillCheckUpdateRequest): DesktopSkillUpdatePreview {
    const record = this.store.getInstallation(request.id);
    if (!record) throw new Error("Unknown Skill");
    const source = record.sourceId ? this.store.getSource(record.sourceId) : null;
    if (!source || source.kind !== "git" || !source.locator.remote || !source.locator.commit) {
      throw new Error("Only Skills installed from a Git repository can preview updates");
    }
    const repository = resolve(source.locator.remote);
    const subdirectory = source.locator.subdir ?? "";
    const range = `${source.locator.commit}..HEAD`;
    try {
      const nameStatus = execFileSync("git", ["-C", repository, "diff", "--name-status", range, "--", subdirectory || "."], {
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 8 * 1024 * 1024
      }).toString("utf8");
      const files = nameStatus
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [rawStatus, ...paths] = line.split(/\s+/);
          const code = rawStatus?.[0] ?? "";
          const status: "added" | "modified" | "deleted" | "renamed" | "other" =
            code === "A" ? "added" : code === "D" ? "deleted" : code === "R" ? "renamed" : code === "M" ? "modified" : "other";
          return { path: paths[paths.length - 1] ?? "", status };
        })
        .filter((file) => file.path);
      const fullPatch = execFileSync("git", ["-C", repository, "diff", range, "--", subdirectory || "."], {
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 8 * 1024 * 1024
      }).toString("utf8");
      const limit = 120_000;
      return {
        ok: true,
        message: files.length ? `${files.length} file(s) changed upstream.` : "No upstream file changes.",
        repository: source.locator.remote,
        subdirectory,
        files,
        patch: fullPatch.slice(0, limit),
        truncated: fullPatch.length > limit
      };
    } catch (cause) {
      return {
        ok: false,
        message: cause instanceof Error ? cause.message : String(cause),
        repository: source.locator.remote,
        subdirectory,
        files: [],
        patch: "",
        truncated: false
      };
    }
  }

  // ── Operations ────────────────────────────────────────────────────────────

  /**
   * Recover what an interrupted mutation left behind.
   *
   * The database and the filesystem cannot commit together, so the receipt is
   * the tie-breaker: a pending receipt with a backup and no target means the
   * replace stopped between the two renames, and the previous content is put
   * back rather than reported as a successful install.
   */
  recoverIncompleteOperations(): void {
    for (const operation of this.store.listPendingOperations()) {
      try {
        if (operation.kind === "maintenance") {
          rollbackMaintenance(operation.payload);
          this.store.finishOperation(operation.id, "recovered", { error: "Interrupted maintenance was recovered. Reversible changes were rolled back; backup cleanup may already have completed. Rescan before retrying." });
          continue;
        }
        if (operation.kind === "consolidate") {
          const sourceEntryPath = String(operation.payload.sourceEntryPath ?? "");
          const sourceBackup = sourceEntryPath
            ? join(dirname(sourceEntryPath), skillBackupName(basename(sourceEntryPath)))
            : "";
          if (sourceEntryPath && sourceBackup && !existsNoFollow(sourceEntryPath) && existsNoFollow(sourceBackup)) {
            rmSync(operation.stagingPath, { recursive: true, force: true });
            renameSync(sourceBackup, sourceEntryPath);
            this.store.finishOperation(operation.id, "recovered", {
              error: "Interrupted while moving the Skill; the original entry was restored."
            });
            continue;
          }
        }
        const targetExists = existsSync(operation.targetPath);
        const backupExists = Boolean(operation.backupPath) && existsSync(operation.backupPath);
        if (!targetExists && backupExists) {
          renameSync(operation.backupPath, operation.targetPath);
          this.store.finishOperation(operation.id, "recovered", {
            error: "Interrupted before the new content was in place; the previous version was restored."
          });
          continue;
        }
        if (operation.stagingPath) rmSync(operation.stagingPath, { recursive: true, force: true });
        this.store.finishOperation(operation.id, "recovered", {
          error: targetExists
            ? "Interrupted after the filesystem changed; the installation is present and was re-verified."
            : "Interrupted before anything was written."
        });
      } catch (cause) {
        this.store.finishOperation(operation.id, "failed", {
          error: cause instanceof Error ? cause.message : String(cause)
        });
      }
    }
  }

  listOperations(limit = 20) {
    return this.store.listOperations(limit);
  }

  // ── File preview ──────────────────────────────────────────────────────────

  /**
   * Resolve only the directory a Skill id points at. Previewing one file must
   * not build the full detail projection (tree hash, readership, locations),
   * and it must never trigger a whole-catalogue rescan.
   */
  private resolveSkillBaseDir(id: string): string {
    const record = this.store.getInstallation(id);
    if (record) return record.entryDir;
    if (id.startsWith("builtin:")) return join(this.options.globalSkillsDir, id.slice("builtin:".length));
    if (id.startsWith("discovered:")) {
      const entryDir = this.findDiscoveredDir(id);
      if (!entryDir) throw new Error("Unknown Skill");
      return entryDir;
    }
    throw new Error("Unknown Skill");
  }

  readFile(id: string, relativePath: string): { content: string; truncated: boolean; binary: boolean } {
    return readSkillFileContent(this.resolveSkillBaseDir(id), relativePath);
  }

  /** Write a new SKILL.md under a Molibot-owned root and adopt it immediately. */
  /** Timestamped siblings a replace/uninstall/consolidate left behind. */
  listBackups(id: string): Array<{ path: string; name: string; createdAt: string; fileCount: number }> {
    const record = this.store.getInstallation(id);
    if (!record) return [];
    const parent = dirname(record.entryDir);
    const baseName = basename(record.entryDir);
    const prefix = `${baseName}.backup-`;
    let names: string[] = [];
    try {
      names = readdirSync(parent, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
        .map((entry) => entry.name)
        .filter((name) => name.startsWith(prefix) && isSkillBackupDirectory(name));
    } catch {
      return [];
    }
    return names
      .sort((left, right) => right.localeCompare(left))
      .flatMap((name) => {
        const path = join(parent, name);
        if (!existsNoFollow(path) || !inspectSkillEntry(path).ok) return [];
        let createdAt = "";
        let fileCount = 0;
        try {
          createdAt = statSync(path).mtime.toISOString();
          fileCount = inspectSkillTree(path, { maxFiles: 600, maxTotalBytes: 24 * 1024 * 1024 }).fileCount;
        } catch {
          // A backup that cannot be read is not offered for restore.
          return [];
        }
        return [{ path, name, createdAt, fileCount }];
      });
  }

  restoreBackup(request: { id: string; backupPath: string }): {
    ok: boolean;
    status: "restored" | "blocked" | "failed";
    message: string;
    backupPath: string;
  } {
    const record = this.store.getInstallation(request.id);
    if (!record) return { ok: false, status: "blocked", message: "Unknown Skill", backupPath: "" };
    if (!record.managed) {
      return { ok: false, status: "blocked", message: "This entry is not managed by Molibot.", backupPath: "" };
    }
    const baseName = basename(record.entryDir);
    const backup = resolve(String(request.backupPath ?? ""));
    const parent = safeRealPath(dirname(record.entryDir)) ?? dirname(record.entryDir);
    const backupParent = safeRealPath(dirname(backup)) ?? dirname(backup);
    const name = basename(backup);
    if (parent !== backupParent || !name.startsWith(`${baseName}.backup-`) || !isSkillBackupDirectory(name)) {
      return { ok: false, status: "blocked", message: "That path is not a backup of this Skill.", backupPath: "" };
    }
    if (!existsNoFollow(backup) || !inspectSkillEntry(backup).ok) {
      return { ok: false, status: "blocked", message: "The backup is missing or unreadable.", backupPath: "" };
    }
    if (!this.isManagedLocation(safeRealPath(record.entryDir) ?? record.entryDir)) {
      return { ok: false, status: "blocked", message: "The Skill is outside Molibot's roots.", backupPath: "" };
    }
    // Sibling of the entry, never a cwd-relative name: renameSync would
    // otherwise move the Skill into whatever directory the service started in.
    const displaced = join(dirname(record.entryDir), skillBackupName(baseName));
    try {
      if (existsNoFollow(record.entryDir)) renameSync(record.entryDir, displaced);
      try {
        renameSync(backup, record.entryDir);
      } catch (cause) {
        if (existsNoFollow(displaced) && !existsNoFollow(record.entryDir)) renameSync(displaced, record.entryDir);
        throw cause;
      }
      const tree = inspectSkillTree(record.entryDir, { maxFiles: 600, maxTotalBytes: 24 * 1024 * 1024 });
      const manifest = inspectSkillEntry(record.entryDir);
      this.store.upsertInstallation({
        ...record,
        skillName: manifest.ok ? manifest.name : record.skillName,
        method: this.isLinkEntry(record.entryDir) ? "link" : "copy",
        baselineHash: tree.hash ?? record.baselineHash,
        observedHash: tree.hash ?? record.observedHash,
        fileCount: tree.fileCount,
        updatedAt: this.iso()
      });
      return { ok: true, status: "restored", message: "Backup restored; the previous content is kept as a new backup.", backupPath: displaced };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      return { ok: false, status: "failed", message, backupPath: "" };
    }
  }

  createSkill(request: {
    name: string;
    description: string;
    body: string;
    scope: SkillScopeKind;
    ownerId?: string;
  }): { id: string; filePath: string } {
    const name = String(request.name ?? "").trim();
    if (!isValidSkillName(name)) throw new Error("Use a lowercase Skill name with letters, numbers, dots, dashes or underscores");
    const description = String(request.description ?? "").trim();
    if (!description) throw new Error("A description is required");
    const ownerId = String(request.ownerId ?? "").trim();
    const root = this.writeRoot(request.scope, ownerId);
    const entryDir = join(root.root, name);
    if (existsNoFollow(entryDir)) throw new Error("A Skill with this name already exists");
    mkdirSync(entryDir, { recursive: true });
    const filePath = join(entryDir, "SKILL.md");
    const body = String(request.body ?? "").trim();
    const content = body.startsWith("---")
      ? body
      : [
          "---",
          `name: ${JSON.stringify(name)}`,
          `description: ${JSON.stringify(description)}`,
          "---",
          "",
          body,
          ""
        ].join("\n");
    const frontmatter = parseSkillFrontmatter(content);
    if (!frontmatter?.name?.trim() || !frontmatter.description?.trim()) {
      throw new Error("SKILL.md needs name and description frontmatter");
    }
    writeFileSync(filePath, content, "utf8");
    const record = this.adopt({
      entry: { filePath, entryDir, realDir: safeRealPath(entryDir) ?? entryDir, linked: false },
      root
    });
    return { id: record.id, filePath };
  }

  /** Replace one installed Skill's SKILL.md after re-validating its frontmatter. */
  saveSkillContent(request: { id: string; content: string }): { id: string; filePath: string } {
    const record = this.store.getInstallation(request.id);
    if (!record) throw new Error("Only installed Skills can be edited");
    const content = String(request.content ?? "");
    const frontmatter = parseSkillFrontmatter(content);
    if (!frontmatter?.name?.trim() || !frontmatter.description?.trim()) {
      throw new Error("SKILL.md needs name and description frontmatter");
    }
    const filePath = join(record.entryDir, "SKILL.md");
    assertInsideRoot(record.entryDir, filePath);
    writeFileSync(filePath, content, "utf8");
    const tree = inspectSkillTree(record.entryDir, { maxFiles: 600, maxTotalBytes: 24 * 1024 * 1024 });
    this.store.upsertInstallation({
      ...record,
      skillName: frontmatter.name.trim(),
      baselineHash: tree.hash ?? record.baselineHash,
      observedHash: tree.hash ?? record.observedHash,
      fileCount: tree.fileCount,
      updatedAt: this.iso()
    });
    return { id: record.id, filePath };
  }

  private writeRoot(scope: SkillScopeKind, ownerId: string): ManagedRoot {
    if (scope === "global") {
      return { root: this.options.globalSkillsDir, scope: "global", ownerId: "", ownerLabel: "" };
    }
    if (scope === "agent") {
      if (!ownerId || !/^[a-zA-Z0-9._-]+$/.test(ownerId) || ownerId === "." || ownerId === "..") {
        throw new Error("Choose an Agent workspace first");
      }
      return {
        root: join(this.options.agentsDir, ownerId, "skills"),
        scope: "agent",
        ownerId,
        ownerLabel: this.options.getAgentLabel?.(ownerId) ?? ownerId
      };
    }
    const project = this.options.projects().find((candidate) => candidate.id === ownerId);
    if (!project) throw new Error("Choose a project first");
    return {
      root: join(project.rootPath, ".agents", "skills"),
      scope: "project",
      ownerId,
      ownerLabel: project.name
    };
  }
}
