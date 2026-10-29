/**
 * Skill Manager domain types.
 *
 * The vocabulary is deliberate and mirrors the spec: a *Source* is where content
 * came from, an *Installation* is one physical entry plus the scope it serves,
 * and an *Operation* is a durable receipt for a filesystem mutation. A platform
 * is a *read rule*; it never becomes the unit of installation.
 */

export type SkillPlatformKind = "preset" | "custom";

export type SkillInstallMethod = "copy" | "link" | "external";

export type SkillScopeKind = "global" | "agent" | "project";

export type SkillSourceKind = "builtin" | "git" | "registry" | "local" | "unknown";

export type SkillHealth = "ok" | "disabled" | "missing" | "broken" | "invalid" | "unmanaged";

export type SkillOperationKind =
  | "install"
  | "replace"
  | "distribute"
  | "uninstall"
  | "restore"
  | "toggle"
  | "platform"
  | "consolidate";

export type SkillOperationStatus = "pending" | "committed" | "failed" | "recovered";

export interface SkillSourceLocator {
  /** Directory the content was copied from, when it is a local path. */
  path?: string;
  /** Platform whose scan produced the source. */
  platformId?: string;
  /** Git remote or local repository path. */
  remote?: string;
  /** Resolved commit the content was pinned to. */
  commit?: string;
  /** Repository-relative Skill directory. */
  subdir?: string;
  /** Ref or branch that was resolved, when the user tracked one. */
  ref?: string;
}

export interface SkillSourceRecord {
  id: string;
  kind: SkillSourceKind;
  label: string;
  locator: SkillSourceLocator;
  createdAt: string;
}

export interface SkillInstallationRecord {
  id: string;
  /** Frontmatter name at install time. */
  skillName: string;
  /** Entry path (the SKILL.md path as reached, not its resolved target). */
  entryPath: string;
  /** Directory of the entry. */
  entryDir: string;
  /** Formatting identity of the physical entry. */
  method: SkillInstallMethod;
  scope: SkillScopeKind;
  /** Agent or project id; empty for global installations. */
  ownerId: string;
  /** True when Molibot wrote this entry. Unknown external content stays false. */
  managed: boolean;
  sourceId: string | null;
  status: SkillHealth;
  /** Content hash captured when the install completed. */
  baselineHash: string;
  /** Content hash observed by the most recent scan. */
  observedHash: string;
  /** Number of files in the baseline, for a readable receipt. */
  fileCount: number;
  installedAt: string;
  updatedAt: string;
}

export interface SkillDistributionRecord {
  id: string;
  /** Installation whose content is distributed. */
  installationId: string;
  targetPath: string;
  targetLabel: string;
  platformId: string;
  method: SkillInstallMethod;
  status: "active" | "removed" | "failed";
  createdAt: string;
  updatedAt: string;
}

export interface SkillOperationRecord {
  id: string;
  kind: SkillOperationKind;
  status: SkillOperationStatus;
  targetPath: string;
  stagingPath: string;
  backupPath: string;
  payload: Record<string, unknown>;
  error: string;
  createdAt: string;
  updatedAt: string;
}

export interface SkillPlatformConfigRecord {
  id: string;
  kind: SkillPlatformKind;
  label: string;
  enabled: boolean;
  /** Extra scan roots for a preset, or the complete root list for a custom platform. */
  extraRoots: string[];
  /** Preset root paths the user removed. */
  removedRoots: string[];
  writable: boolean;
  verified: boolean;
  updatedAt: string;
}

export interface ResolvedPlatformRoot {
  path: string;
  scope: SkillScopeKind;
  /** Registered project that owns a project-scoped root. */
  ownerId: string;
  ownerLabel: string;
}

export interface SkillPlatformView {
  id: string;
  kind: SkillPlatformKind;
  label: string;
  enabled: boolean;
  writable: boolean;
  verified: boolean;
  /** One line describing what the platform reads, safe for the list view. */
  summary: string;
  roots: Array<{
    path: string;
    scope: SkillScopeKind;
    ownerLabel: string;
    exists: boolean;
    skillCount: number;
  }>;
  /** Platforms that read an identical physical root, by label. */
  sharedWith: string[];
  errorCount: number;
}
