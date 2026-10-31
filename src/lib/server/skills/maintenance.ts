import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { inspectSkillEntry, scanSkillRoot, isIgnoredScanDirectory } from "$lib/server/agent/skills/skillScan.js";
import { isSkillBackupDirectory, skillBackupName } from "$lib/server/agent/skills/skillBackup.js";
import { inspectSkillTree, copySkillTree, isValidSkillName } from "$lib/server/skills/tree.js";
import type { SkillTreeInspection } from "$lib/server/skills/tree.js";
import type { SkillManagerStore } from "$lib/server/skills/store.js";
import type { DesktopSkillMaintenanceScan, DesktopSkillMaintenanceEntry, DesktopSkillMaintenanceRequest, DesktopSkillMaintenancePlan, DesktopSkillMaintenanceResult, DesktopSkillMaintenanceComparison } from "$lib/shared/desktop";

export interface MaintenanceRoot {
  path: string;
  label: string;
  scope: string;
  destination: string;
  writable: boolean;
}

const digest = (value: unknown): string => createHash("sha256").update(JSON.stringify(value) ?? "null").digest("hex");
const inside = (root: string, path: string): boolean => path === root || path.startsWith(root + sep);
function present(path: string): boolean { try { lstatSync(path); return true; } catch { return false; } }
function real(path: string): string { try { return realpathSync(path); } catch { return resolve(path); } }
function removeEntry(path: string): void {
  if (!present(path)) return;
  if (lstatSync(path).isSymbolicLink()) unlinkSync(path);
  else rmSync(path, { recursive: true });
}

/** Explicit, uncached inspection. Mutations resolve opaque ids again and bind the
 * entire affected tree, link topology and backup names to the reviewed plan.
 * Only configured roots are inspected; references outside them remain unknown. */
export class SkillMaintenance {
  constructor(private roots: MaintenanceRoot[], private store: SkillManagerStore) {}

  scan(): DesktopSkillMaintenanceScan {
    const entries = new Map<string, DesktopSkillMaintenanceEntry>();
    const backups = new Map<string, DesktopSkillMaintenanceScan["backups"][number]>();
    const broken = new Map<string, DesktopSkillMaintenanceScan["brokenLinks"][number]>();
    const warnings = new Set<string>();
    const treeCache = new Map<string, SkillTreeInspection>();
    const tree = (path: string): SkillTreeInspection => {
      const key = real(path);
      if (!treeCache.has(key)) treeCache.set(key, inspectSkillTree(path));
      return treeCache.get(key)!;
    };
    const rootMap = new Map<string, MaintenanceRoot>();
    for (const root of this.roots) {
      const key = resolve(root.path);
      const previous = rootMap.get(key);
      rootMap.set(key, previous ? { ...previous, label: `${previous.label}, ${root.label}`, writable: previous.writable && root.writable } : { ...root, path: key });
    }
    for (const root of rootMap.values()) {
      if (!present(root.path)) continue;
      const scan = scanSkillRoot(root.path);
      for (const diagnostic of scan.diagnostics) {
        if (diagnostic.code === "broken_link" && present(diagnostic.path) && lstatSync(diagnostic.path).isSymbolicLink()) {
          broken.set(diagnostic.path, { id: digest(diagnostic.path), path: diagnostic.path, target: resolve(dirname(diagnostic.path), readlinkSync(diagnostic.path)), platforms: [root.label], writable: root.writable && diagnostic.path !== root.path });
        } else warnings.add(`${diagnostic.path}: ${diagnostic.message}`);
      }
      for (const entry of scan.entries) {
        const previous = entries.get(entry.entryDir);
        if (previous) { previous.platforms.push(root.label); previous.writable &&= root.writable; continue; }
        const manifest = inspectSkillEntry(entry.entryDir);
        const inspection = tree(entry.entryDir);
        // Nested entries reached through a linked container are reference-only.
        const parent = real(dirname(entry.entryDir));
        const expectedParent = resolve(real(root.path), relative(root.path, dirname(entry.entryDir)));
        const writable = root.writable && parent === expectedParent && entry.entryDir !== root.path;
        entries.set(entry.entryDir, {
          id: digest(entry.entryDir), name: manifest.ok ? manifest.name : basename(entry.entryDir),
          path: entry.entryDir, realPath: entry.realDir, platforms: [root.label], scope: root.scope,
          isLink: lstatSync(entry.entryDir).isSymbolicLink(), writable, hash: inspection.hash, bytes: inspection.totalBytes,
          problems: [...inspection.problems.map((problem) => problem.code), ...(manifest.ok ? [] : [manifest.code])]
        });
      }
      let visited = 0;
      const collectBackups = (path: string, depth: number): void => {
        if (depth > 6 || ++visited > 4000) { warnings.add(`Backup scan limit: ${root.path}`); return; }
        let children;
        try { children = readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)); }
        catch { warnings.add(`Cannot read backups: ${path}`); return; }
        for (const child of children) {
          const childPath = join(path, child.name);
          if (isSkillBackupDirectory(child.name)) {
            const isLink = child.isSymbolicLink();
            const inspection = isLink ? null : tree(childPath);
            const originalName = child.name.slice(0, child.name.lastIndexOf(".backup-"));
            if (!originalName || originalName === "." || originalName === "..") { warnings.add(`Invalid backup name: ${childPath}`); continue; }
            const originalPath = join(path, originalName);
            backups.set(childPath, { id: digest(childPath), path: childPath, originalPath, createdAt: child.name.replace(/^.*\.backup-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, "$1T$2:$3:$4.$5Z"), bytes: inspection?.totalBytes ?? 0, isLink, references: [], writable: root.writable });
          } else if (child.isDirectory() && !isIgnoredScanDirectory(child.name) && !existsSync(join(childPath, "SKILL.md"))) collectBackups(childPath, depth + 1);
        }
      };
      collectBackups(root.path, 0);
    }
    const all = [...entries.values()];
    const internalReferences: Array<{ path: string; target: string }> = [];
    for (const entry of all) {
      const inspection = tree(entry.path);
      for (const link of inspection.entries.filter((item) => item.kind === "symlink")) {
        const path = join(entry.path, link.relativePath);
        internalReferences.push({ path, target: real(path) });
      }
      for (const problem of inspection.problems) {
        if (problem.code === "symlink_escape" || (problem.code === "unreadable" && present(problem.path) && lstatSync(problem.path).isSymbolicLink())) {
          internalReferences.push({ path: join(entry.path, relative(inspection.realRoot, problem.path)), target: existsSync(problem.path) ? real(problem.path) : resolve(dirname(problem.path), readlinkSync(problem.path)) });
        } else if (problem.code !== "symlink_loop") warnings.add(`${problem.path}: ${problem.message}`);
      }
    }
    const slotPath = (path: string): string => join(real(dirname(path)), basename(path));
    for (const backup of backups.values()) {
      const backupRoot = backup.isLink ? slotPath(backup.path) : real(backup.path);
      backup.references = all.filter((entry) => inside(backupRoot, entry.realPath)).map((entry) => entry.path);
      for (const entry of all) {
        if (entry.isLink) {
          const target = resolve(dirname(entry.path), readlinkSync(entry.path));
          if (inside(backupRoot, slotPath(target))) backup.references.push(entry.path);
        }
      }
      for (const link of [...broken.values(), ...internalReferences]) if (inside(backupRoot, slotPath(link.target))) backup.references.push(link.path);
      backup.references = [...new Set(backup.references)];
    }
    const groups = new Map<string, DesktopSkillMaintenanceScan["groups"][number]>();
    for (const entry of all) {
      const key = digest([entry.scope, entry.name]);
      if (!groups.has(key)) {
        const root = [...rootMap.values()].find((root) => root.scope === entry.scope && inside(root.path, entry.path));
        groups.set(key, { id: key, name: entry.name, scope: entry.scope, relation: "single", entries: [], destination: root?.destination ? join(root.destination, entry.name) : "", writable: false });
      }
      groups.get(key)!.entries.push(entry);
    }
    for (const group of groups.values()) {
      group.entries.sort((a, b) => a.path.localeCompare(b.path));
      const physical = new Set(group.entries.map((entry) => entry.realPath));
      const hashes = new Set(group.entries.map((entry) => entry.hash));
      group.relation = group.entries.length === 1 ? "single" : physical.size === 1 ? "linked" : hashes.size === 1 && group.entries.every((entry) => !entry.problems.length) ? "identical" : "different";
      group.writable = Boolean(group.destination) && group.entries.every((entry) => entry.writable && !entry.problems.length);
    }
    return { groups: [...groups.values()].sort((a, b) => a.name.localeCompare(b.name) || a.scope.localeCompare(b.scope)), backups: [...backups.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), brokenLinks: [...broken.values()], warnings: [...warnings], scannedAt: new Date().toISOString() };
  }

  compare(leftId: string, rightId: string): DesktopSkillMaintenanceComparison {
    const entries = this.scan().groups.flatMap((group) => group.entries);
    const left = entries.find((entry) => entry.id === leftId);
    const right = entries.find((entry) => entry.id === rightId);
    if (!left || !right) throw new Error("Skill entry is no longer present");
    if (left.problems.length || right.problems.length) throw new Error("Resolve unreadable or unsafe Skill files before comparing");
    const leftTree = inspectSkillTree(left.path);
    const rightTree = inspectSkillTree(right.path);
    const a = new Map(leftTree.entries.map((entry) => [entry.relativePath, entry]));
    const b = new Map(rightTree.entries.map((entry) => [entry.relativePath, entry]));
    const files: DesktopSkillMaintenanceComparison["files"] = [];
    let previewBytes = 0;
    for (const path of [...new Set([...a.keys(), ...b.keys()])].sort()) {
      const x = a.get(path), y = b.get(path);
      if (digest(x) === digest(y)) continue;
      let preview: DesktopSkillMaintenanceComparison["files"][number]["preview"] = "metadata";
      let leftText: string | null = null, rightText: string | null = null;
      if ((!x || x.kind === "file") && (!y || y.kind === "file")) {
        const bytes = (x?.kind === "file" ? x.size : 0) + (y?.kind === "file" ? y.size : 0);
        if (bytes > 128 * 1024 || previewBytes + bytes > 1024 * 1024) preview = "too-large";
        else {
          const leftBuffer = x ? readFileSync(join(left.path, path)) : null;
          const rightBuffer = y ? readFileSync(join(right.path, path)) : null;
          previewBytes += bytes;
          const decoder = new TextDecoder("utf-8", { fatal: true });
          try {
            if (leftBuffer?.includes(0) || rightBuffer?.includes(0)) throw new Error("binary");
            leftText = leftBuffer ? decoder.decode(leftBuffer) : null;
            rightText = rightBuffer ? decoder.decode(rightBuffer) : null;
            preview = "text";
          } catch { preview = "binary"; }
        }
      }
      files.push({ path, status: !x ? "added" : !y ? "removed" : "changed", left: leftText, right: rightText, preview });
    }
    return { left, right, files };
  }

  preflight(request: DesktopSkillMaintenanceRequest): DesktopSkillMaintenancePlan {
    const preparedAt = request.preparedAt ? new Date(request.preparedAt) : new Date();
    if (!Number.isFinite(preparedAt.getTime()) || preparedAt.getUTCFullYear() < 1 || preparedAt.getUTCFullYear() > 9999) throw new Error("Invalid preview timestamp");
    request = { ...request, preparedAt: preparedAt.toISOString() };
    const scan = this.scan();
    const changes: DesktopSkillMaintenancePlan["changes"] = [];
    const conflicts: DesktopSkillMaintenancePlan["conflicts"] = [];
    const snapshots: unknown[] = [];
    const snapshot = (path: string): unknown => {
      if (!present(path)) return { path, missing: true };
      const stat = lstatSync(path);
      return { path, real: real(path), link: stat.isSymbolicLink() ? readlinkSync(path) : null,
        hash: inspectSkillTree(path).hash, mtime: stat.mtimeMs, ino: stat.ino };
    };
    const backupFor = (path: string): string => {
      let offset = 0;
      let candidate = join(dirname(path), skillBackupName(basename(path), preparedAt));
      while (present(candidate)) candidate = join(dirname(path), skillBackupName(basename(path), new Date(preparedAt.getTime() + ++offset)));
      return candidate;
    };
    if (request.kind === "consolidate") {
      if (!Array.isArray(request.selections) || request.selections.length === 0 || request.selections.length > 100) throw new Error("Select between 1 and 100 Skill groups");
      const seen = new Set<string>();
      for (const selection of request.selections) {
        const group = scan.groups.find((group) => group.id === selection.groupId);
        const source = group?.entries.find((entry) => entry.id === selection.sourceId);
        if (!group || !source || seen.has(group.id)) { conflicts.push({ code: "invalid_selection", path: "" }); continue; }
        seen.add(group.id);
        if (!group.writable) { conflicts.push({ code: "unsafe", path: group.name }); continue; }
        snapshots.push(group);
        const target = group.destination;
        if (!isValidSkillName(group.name)) { conflicts.push({ code: "invalid_name", path: group.name }); continue; }
        snapshots.push(snapshot(target), { parent: real(dirname(target)) });
        const targetEntry = group.entries.find((entry) => entry.path === target);
        if (present(target) && !targetEntry) { conflicts.push({ code: "unknown_destination", path: target }); continue; }
        if (!targetEntry || targetEntry.isLink || targetEntry.hash !== source.hash) {
          changes.push({ path: target, action: "canonical", target: source.path, backupPath: present(target) ? backupFor(target) : "" });
        }
        const slots = new Set<string>([join(real(dirname(target)), basename(target))]);
        for (const entry of group.entries) {
          snapshots.push(snapshot(entry.path));
          const slot = join(real(dirname(entry.path)), basename(entry.path));
          if (slots.has(slot)) continue;
          slots.add(slot);
          if (entry.path === target || (entry.isLink && entry.realPath === real(target) && !changes.some((change) => change.path === target))) continue;
          changes.push({ path: entry.path, action: "link", target, backupPath: backupFor(entry.path) });
        }
      }
    } else if (request.kind === "restore" || request.kind === "delete-backup") {
      const backup = scan.backups.find((backup) => backup.id === request.id);
      if (!backup || !backup.writable) conflicts.push({ code: "backup_readonly", path: "" });
      else {
        snapshots.push(backup, snapshot(backup.path), snapshot(backup.originalPath), { parent: real(dirname(backup.path)) });
        if (request.kind === "delete-backup") {
          if (backup.references.length) conflicts.push({ code: "backup_referenced", path: backup.path });
          if (scan.warnings.length) conflicts.push({ code: "incomplete_scan", path: "" });
          changes.push({ path: backup.path, action: "delete", target: "", backupPath: "" });
        } else {
          if (!inspectSkillEntry(backup.path).ok || inspectSkillTree(backup.path).problems.length) conflicts.push({ code: "invalid_backup", path: backup.path });
          changes.push({ path: backup.originalPath, action: "restore", target: backup.path, backupPath: present(backup.originalPath) ? backupFor(backup.originalPath) : "" });
        }
      }
    } else if (request.kind === "remove-link") {
      const link = scan.brokenLinks.find((link) => link.id === request.id);
      if (!link || !link.writable) conflicts.push({ code: "link_readonly", path: "" });
      else { snapshots.push(link, snapshot(link.path)); changes.push({ path: link.path, action: "unlink", target: link.target, backupPath: "" }); }
    } else throw new Error("Unknown maintenance action");
    const slots = new Set<string>();
    for (const change of changes) {
      const slot = join(real(dirname(change.path)), basename(change.path));
      if (slots.has(slot)) conflicts.push({ code: "overlap", path: change.path });
      slots.add(slot);
    }
    for (const slot of slots) {
      for (let parent = dirname(slot); parent !== dirname(parent); parent = dirname(parent)) {
        if (slots.has(parent)) { conflicts.push({ code: "nested", path: slot }); break; }
      }
    }
    return { token: digest({ request, changes, snapshots, conflicts }), request, changes, conflicts, executable: conflicts.length === 0 && changes.length > 0 };
  }

  apply(request: DesktopSkillMaintenanceRequest, token: string): DesktopSkillMaintenanceResult {
    const plan = this.preflight(request);
    if (plan.token !== token) return { ok: false, status: "stale", error: "Files changed after preview. Review the plan again." };
    if (!plan.executable) return { ok: false, status: "failed", error: plan.conflicts.map((conflict) => `${conflict.code}: ${conflict.path}`).join("; ") || "Nothing to change" };
    const id = randomUUID();
    const stamp = new Date().toISOString();
    const moves = plan.changes.filter((change) => change.action !== "delete" && change.action !== "unlink").map((change) => ({ path: change.path, backup: change.backupPath }));
    const stages = plan.changes.filter((change) => change.action === "canonical" || change.action === "restore").map((change) => ({ path: join(dirname(change.path), `.staging-${id}-${digest(change.path).slice(0, 8)}`), target: change.path, source: change.target }));
    this.store.beginOperation({ id, kind: "maintenance", status: "pending", targetPath: plan.changes[0].path, stagingPath: "", backupPath: "", payload: { moves, stages, request }, error: "", createdAt: stamp, updatedAt: stamp });
    try {
      for (const stage of stages) {
        const inspection = inspectSkillTree(stage.source);
        if (inspection.problems.length) throw new Error("Source is no longer safe to copy");
        mkdirSync(dirname(stage.path), { recursive: true });
        copySkillTree({ sourceDir: stage.source, targetDir: stage.path, inspection });
        if (inspectSkillTree(stage.path).hash !== inspection.hash) throw new Error("Staged content does not match source");
      }
      for (const change of plan.changes) {
        if (change.action === "delete" || change.action === "unlink") { removeEntry(change.path); continue; }
        if (change.backupPath) renameSync(change.path, change.backupPath);
        if (change.action === "link") symlinkSync(change.target, change.path, "dir");
        else renameSync(stages.find((stage) => stage.target === change.path)!.path, change.path);
      }
      this.store.finishOperation(id, "committed");
      return { ok: true, status: "completed", error: "" };
    } catch (cause) {
      let error = cause instanceof Error ? cause.message : String(cause);
      try { rollbackMaintenance({ moves, stages }); }
      catch (rollbackError) { error += `; rollback failed: ${String(rollbackError)}`; }
      this.store.finishOperation(id, "failed", { error });
      return { ok: false, status: "failed", error };
    }
  }
}

/** Roll back only paths whose originals were moved, or were absent at preview.
 * The receipt is written before staging so process interruption is recoverable. */
export function rollbackMaintenance(payload: Record<string, unknown>): void {
  const moves = payload.moves as Array<{ path: string; backup: string }>;
  const stages = payload.stages as Array<{ path: string }>;
  for (const move of [...moves].reverse()) {
    if (move.backup && present(move.backup)) { removeEntry(move.path); renameSync(move.backup, move.path); }
    else if (!move.backup) removeEntry(move.path);
  }
  for (const stage of stages) removeEntry(stage.path);
}
