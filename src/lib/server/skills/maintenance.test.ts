import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync, readFileSync, lstatSync, existsSync, realpathSync, symlinkSync, rmSync, renameSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test, { type TestContext } from "node:test";
import { SkillMaintenance, rollbackMaintenance } from "$lib/server/skills/maintenance.js";
import { SkillManager } from "$lib/server/skills/manager.js";
import { SkillManagerStore } from "$lib/server/skills/store.js";
import { skillBackupName } from "$lib/server/agent/skills/skillBackup.js";

function harness(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "skill-maintenance-"));
  const shared = join(root, "shared"), claude = join(root, "claude"), codex = join(root, "codex");
  for (const path of [shared, claude, codex]) mkdirSync(path);
  const store = new SkillManagerStore(join(root, "skills.sqlite"));
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  const service = new SkillMaintenance([shared, claude, codex].map((path) => ({ path, label: path === shared ? "Shared" : path === claude ? "Claude Code" : "Codex", scope: "global", destination: shared, writable: true })), store);
  const skill = (base: string, name: string, text = "body") => {
    const dir = join(base, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: test\n---\n${text}\n`);
    return dir;
  };
  const consolidate = (name: string, source: string) => {
    const group = service.scan().groups.find((group) => group.name === name)!;
    return { kind: "consolidate" as const, selections: [{ groupId: group.id, sourceId: group.entries.find((entry) => entry.path === source)!.id }] };
  };
  return { root, shared, claude, codex, service, store, skill, consolidate };
}

test("maintenance classifies copies, names and references, then consolidates a selected batch", (t) => {
  const h = harness(t);
  const source = h.skill(h.claude, "same");
  h.skill(h.codex, "same");
  h.skill(h.shared, "different", "left");
  h.skill(h.claude, "different", "right");
  const linked = h.skill(h.shared, "linked");
  symlinkSync(linked, join(h.claude, "linked"));
  const scan = h.service.scan();
  assert.equal(scan.groups.find((group) => group.name === "same")?.relation, "identical");
  assert.equal(scan.groups.find((group) => group.name === "different")?.relation, "different");
  assert.equal(scan.groups.find((group) => group.name === "linked")?.relation, "linked");
  assert.equal(scan.groups.find((group) => group.name === "linked")?.entries.length, 2);
  const request = h.consolidate("same", source);
  const plan = h.service.preflight(request);
  assert.equal(plan.executable, true);
  assert.equal(plan.changes.filter((change) => change.action === "link").length, 2);
  assert.equal(h.service.apply(plan.request, plan.token).ok, true);
  assert.equal(lstatSync(join(h.shared, "same")).isDirectory(), true);
  for (const path of [source, join(h.codex, "same")]) {
    assert.equal(lstatSync(path).isSymbolicLink(), true);
    assert.equal(realpathSync(path), realpathSync(join(h.shared, "same")));
  }
  assert.equal(h.service.scan().backups.length, 2);
  assert.equal(h.service.scan().groups.find((group) => group.name === "same")?.relation, "linked");
});

test("comparison includes support-file changes and preserves the selected version with backups", (t) => {
  const h = harness(t);
  const left = h.skill(h.shared, "different");
  const right = h.skill(h.claude, "different");
  writeFileSync(join(left, "helper.js"), "old");
  writeFileSync(join(right, "helper.js"), "new");
  writeFileSync(join(right, "binary.bin"), Buffer.from([0, 1]));
  const group = h.service.scan().groups[0];
  const comparison = h.service.compare(group.entries.find((entry) => entry.path === left)!.id, group.entries.find((entry) => entry.path === right)!.id);
  assert.equal(comparison.files.find((file) => file.path === "helper.js")?.left, "old");
  assert.equal(comparison.files.find((file) => file.path === "helper.js")?.right, "new");
  assert.equal(comparison.files.find((file) => file.path === "binary.bin")?.preview, "binary");
  const request = h.consolidate("different", right);
  const plan = h.service.preflight(request);
  assert.equal(h.service.apply(plan.request, plan.token).ok, true);
  assert.equal(readFileSync(join(left, "helper.js"), "utf8"), "new");
  assert.ok(h.service.scan().backups.some((backup) => readFileSync(join(backup.path, "helper.js"), "utf8") === "old"));
});

test("backup restore preserves the current version and deletion refuses referenced content", (t) => {
  const h = harness(t);
  const source = h.skill(h.claude, "restore", "before");
  const backup = join(h.claude, skillBackupName("restore"));
  renameSync(source, backup);
  h.skill(h.claude, "restore", "after");
  symlinkSync(backup, join(h.codex, "reference"));
  const item = h.service.scan().backups[0];
  assert.equal(item.references.length, 1);
  assert.equal(h.service.preflight({ kind: "delete-backup", id: item.id }).executable, false);
  const request = { kind: "restore" as const, id: item.id };
  const plan = h.service.preflight(request);
  assert.equal(h.service.apply(plan.request, plan.token).ok, true);
  assert.match(readFileSync(join(source, "SKILL.md"), "utf8"), /before/);
  assert.ok(h.service.scan().backups.some((entry) => readFileSync(join(entry.path, "SKILL.md"), "utf8").includes("after")));
  rmSync(join(h.codex, "reference"));
  const deletion = { kind: "delete-backup" as const, id: item.id };
  const deletionPlan = h.service.preflight(deletion);
  assert.equal(h.service.apply(deletionPlan.request, deletionPlan.token).ok, true);
  assert.equal(existsSync(backup), false);
  assert.equal(existsSync(source), true);
});

test("stale plans refuse edits, new references and invalid opaque ids", (t) => {
  const h = harness(t);
  const source = h.skill(h.claude, "stale");
  const request = h.consolidate("stale", source);
  const plan = h.service.preflight(request);
  h.skill(h.claude, "stale", "edited");
  assert.equal(h.service.apply(plan.request, plan.token).status, "stale");
  assert.equal(lstatSync(source).isDirectory(), true);
  assert.equal(h.service.preflight({ kind: "delete-backup", id: "../../outside" }).executable, false);
  assert.throws(() => h.service.preflight({ kind: "consolidate", selections: [] }));
});

test("broken links can be removed without touching their target and reject repaired links", (t) => {
  const h = harness(t);
  const path = join(h.claude, "broken");
  const target = join(h.root, "absent");
  symlinkSync(target, path);
  const link = h.service.scan().brokenLinks[0];
  assert.equal(link.target, target);
  const request = { kind: "remove-link" as const, id: link.id };
  const plan = h.service.preflight(request);
  mkdirSync(target);
  assert.equal(h.service.apply(plan.request, plan.token).status, "stale");
  rmSync(target, { recursive: true });
  const refreshed = h.service.preflight(request);
  assert.equal(h.service.apply(refreshed.request, refreshed.token).ok, true);
  assert.throws(() => lstatSync(path));
});

test("interrupted maintenance rollback restores moved originals and removes staging", (t) => {
  const h = harness(t);
  const source = h.skill(h.claude, "rollback", "original");
  const backup = join(h.claude, skillBackupName("rollback"));
  const target = join(h.shared, "rollback");
  const stage = join(h.shared, ".staging-test");
  mkdirSync(stage);
  renameSync(source, backup);
  h.skill(h.shared, "rollback", "new");
  symlinkSync(target, source);
  rollbackMaintenance({ moves: [{ path: target, backup: "" }, { path: source, backup }], stages: [{ path: stage }] });
  assert.match(readFileSync(join(source, "SKILL.md"), "utf8"), /original/);
  assert.equal(lstatSync(source).isDirectory(), true);
  assert.equal(existsSync(target), false);
  assert.equal(existsSync(stage), false);
});

test("a shared root alias does not replace the same physical entry twice", (t) => {
  const h = harness(t);
  rmSync(h.codex, { recursive: true });
  symlinkSync(h.shared, h.codex);
  const source = h.skill(h.claude, "alias");
  h.skill(h.shared, "alias");
  const request = h.consolidate("alias", source);
  const plan = h.service.preflight(request);
  assert.equal(h.service.apply(plan.request, plan.token).ok, true);
  assert.equal(lstatSync(join(h.shared, "alias")).isDirectory(), true);
  assert.equal(lstatSync(source).isSymbolicLink(), true);
});

test("backup cleanup refuses support-file links into retained content", (t) => {
  const h = harness(t);
  const archived = h.skill(h.claude, "archive");
  writeFileSync(join(archived, "helper.js"), "needed");
  const backup = join(h.claude, skillBackupName("archive"));
  renameSync(archived, backup);
  const active = h.skill(h.codex, "active");
  symlinkSync(join(backup, "helper.js"), join(active, "helper.js"));
  const item = h.service.scan().backups[0];
  assert.equal(item.references.includes(join(active, "helper.js")), true);
  const request = { kind: "delete-backup" as const, id: item.id };
  const plan = h.service.preflight(request);
  assert.equal(plan.executable, false);
  assert.equal(h.service.apply(plan.request, plan.token).ok, false);
  assert.equal(readFileSync(join(active, "helper.js"), "utf8"), "needed");
});

test("a backup symlink is retained when another entry points through it", (t) => {
  const h = harness(t);
  const content = h.skill(h.shared, "content");
  const backup = join(h.claude, skillBackupName("old-link"));
  symlinkSync(content, backup);
  symlinkSync(backup, join(h.codex, "consumer"));
  const item = h.service.scan().backups[0];
  assert.equal(item.references.includes(join(h.codex, "consumer")), true);
  assert.equal(h.service.preflight({ kind: "delete-backup", id: item.id }).executable, false);
});

test("read-only entries and project scopes cannot be silently consolidated together", (t) => {
  const h = harness(t);
  h.skill(h.claude, "scoped");
  h.skill(h.codex, "scoped", "different project");
  const service = new SkillMaintenance([
    { path: h.claude, label: "Global", scope: "global", destination: h.shared, writable: false },
    { path: h.codex, label: "Project", scope: "project:p1", destination: join(h.root, "project-shared"), writable: true }
  ], h.store);
  const scan = service.scan();
  assert.equal(scan.groups.length, 2);
  const group = scan.groups.find((group) => group.scope === "global")!;
  const request = { kind: "consolidate" as const, selections: [{ groupId: group.id, sourceId: group.entries[0].id }] };
  const plan = service.preflight(request);
  assert.equal(plan.executable, false);
  assert.equal(service.apply(plan.request, plan.token).ok, false);
  assert.equal(lstatSync(join(h.claude, "scoped")).isDirectory(), true);
});

test("a write failure rolls back canonical content and every replaced entry", (t) => {
  const h = harness(t);
  const source = h.skill(h.claude, "failure");
  const other = h.skill(h.codex, "failure");
  const request = h.consolidate("failure", source);
  const plan = h.service.preflight(request);
  const finish = h.store.finishOperation.bind(h.store);
  h.store.finishOperation = (id, status, patch) => {
    if (status === "committed") throw new Error("injected receipt write failure");
    finish(id, status, patch);
  };
  const result = h.service.apply(plan.request, plan.token);
  assert.equal(result.ok, false);
  assert.match(result.error, /injected/);
  assert.equal(lstatSync(source).isDirectory(), true);
  assert.equal(lstatSync(other).isDirectory(), true);
  assert.equal(existsSync(join(h.shared, "failure")), false);
  assert.equal(h.service.scan().backups.length, 0);
  assert.match(readFileSync(join(source, "SKILL.md"), "utf8"), /body/);
});

test("new backup references after preview prevent cleanup", (t) => {
  const h = harness(t);
  const source = h.skill(h.claude, "retained");
  const path = join(h.claude, skillBackupName("retained"));
  renameSync(source, path);
  const backup = h.service.scan().backups[0];
  const plan = h.service.preflight({ kind: "delete-backup", id: backup.id });
  assert.equal(plan.executable, true);
  symlinkSync(path, join(h.codex, "new-reference"));
  assert.equal(h.service.apply(plan.request, plan.token).status, "stale");
  assert.equal(existsSync(path), true);
});

test("a reopened manager recovers an interrupted maintenance receipt", (t) => {
  const h = harness(t);
  const source = h.skill(h.claude, "interrupted", "original");
  const backup = join(h.claude, skillBackupName("interrupted"));
  const target = join(h.shared, "interrupted");
  const stage = join(h.shared, ".staging-interrupted");
  const stamp = new Date().toISOString();
  h.store.beginOperation({ id: "interrupted-maintenance", kind: "maintenance", status: "pending", targetPath: target, stagingPath: "", backupPath: "", payload: { moves: [{ path: target, backup: "" }, { path: source, backup }], stages: [{ path: stage }] }, error: "", createdAt: stamp, updatedAt: stamp });
  renameSync(source, backup);
  h.skill(h.shared, "interrupted", "replacement");
  mkdirSync(stage);
  const reopened = new SkillManagerStore(join(h.root, "skills.sqlite"));
  try {
    const manager = new SkillManager({ store: reopened, dataDir: h.root, globalSkillsDir: h.shared, agentsDir: join(h.root, "sessions"), homeDir: h.root, projects: () => [], getDisabledPaths: () => [] });
    manager.ensureRecovered();
    assert.equal(reopened.listPendingOperations().length, 0);
    assert.match(readFileSync(join(source, "SKILL.md"), "utf8"), /original/);
    assert.equal(existsSync(target), false);
    assert.equal(existsSync(stage), false);
  } finally { reopened.close(); }
});

test("malformed backup names cannot restore over a configured root", (t) => {
  const h = harness(t);
  const malformed = join(h.claude, skillBackupName(""));
  mkdirSync(malformed);
  writeFileSync(join(malformed, "SKILL.md"), "---\nname: malformed\ndescription: unsafe backup\n---\nbody");
  const scan = h.service.scan();
  assert.equal(scan.backups.length, 0);
  assert.ok(scan.warnings.some((warning) => warning.code === "invalid-backup"));
  assert.equal(lstatSync(h.claude).isDirectory(), true);
});

test("managed installations retain identity and reflect links after maintenance", (t) => {
  const h = harness(t);
  const source = h.skill(h.claude, "managed");
  const manager = new SkillManager({ store: h.store, dataDir: h.root, globalSkillsDir: h.claude, agentsDir: join(h.root, "sessions"), homeDir: h.root, projects: () => [], getDisabledPaths: () => [] });
  const original = manager.getOverview().installed.find((entry) => entry.name === "managed")!;
  assert.equal(original.method, "copy");
  const maintenance = manager.maintenance();
  const group = maintenance.scan().groups.find((group) => group.name === "managed")!;
  const plan = maintenance.preflight({ kind: "consolidate", selections: [{ groupId: group.id, sourceId: group.entries[0].id }] });
  assert.equal(manager.applyMaintenance(plan.request, plan.token).ok, true);
  assert.equal(lstatSync(source).isSymbolicLink(), true);
  const updated = manager.getOverview().installed.find((entry) => entry.id === original.id)!;
  assert.equal(updated.method, "link");
  assert.equal(updated.health, "ok");
  assert.equal(h.store.getInstallation(original.id)?.method, "link");
});

test("a file at a configured root is a platform mistake, not an incomplete scan", (t) => {
  const h = harness(t);
  const alias = join(h.root, "alias-root");
  writeFileSync(alias, "macOS alias");
  const service = new SkillMaintenance([
    { path: alias, label: "Alias", scope: "global", destination: h.shared, writable: true }
  ], h.store);
  const scan = service.scan();
  assert.deepEqual(scan.warnings, []);
  assert.equal(scan.scanIncomplete, false);
});

test("unreadable directories warn once and gate backup deletion until acknowledged", (t) => {
  const h = harness(t);
  h.skill(h.claude, "cleanup");
  const backup = join(h.claude, skillBackupName("cleanup"));
  renameSync(join(h.claude, "cleanup"), backup);
  const blocked = join(h.claude, "blocked");
  mkdirSync(blocked);
  chmodSync(blocked, 0o000);
  try {
    const scan = h.service.scan();
    assert.equal(scan.scanIncomplete, true);
    assert.equal(scan.warnings.length, 1);
    const record = scan.backups.find((item) => item.path === backup);
    assert.ok(record);

    const blockedPlan = h.service.preflight({ kind: "delete-backup", id: record.id });
    assert.equal(blockedPlan.executable, false);
    assert.ok(blockedPlan.conflicts.some((conflict) => conflict.code === "incomplete_scan"));

    const accepted = h.service.preflight({ kind: "delete-backup", id: record.id, acknowledgeScan: true });
    assert.equal(accepted.executable, true);
    assert.equal(h.service.apply(accepted.request, accepted.token).ok, true);
    assert.equal(existsSync(backup), false);
  } finally {
    chmodSync(blocked, 0o755);
  }
});

test("a malformed backup name is reported without blocking unrelated cleanup", (t) => {
  const h = harness(t);
  h.skill(h.claude, "keep");
  const backup = join(h.claude, skillBackupName("keep"));
  renameSync(join(h.claude, "keep"), backup);
  mkdirSync(join(h.claude, skillBackupName("")));

  const scan = h.service.scan();
  assert.equal(scan.scanIncomplete, false);
  assert.ok(scan.warnings.some((warning) => warning.code === "invalid-backup"));
  const record = scan.backups.find((item) => item.path === backup);
  assert.ok(record);
  const plan = h.service.preflight({ kind: "delete-backup", id: record.id });
  assert.equal(plan.executable, true);
});
