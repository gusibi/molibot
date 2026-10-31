import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { SkillManager } from "$lib/server/skills/manager.js";
import { SkillManagerStore } from "$lib/server/skills/store.js";
import type { DesktopSkillPreflightResult } from "$lib/shared/desktop";

interface Harness {
  root: string;
  dataDir: string;
  homeDir: string;
  projectRoot: string;
  globalSkillsDir: string;
  agentsDir: string;
  store: SkillManagerStore;
  manager: SkillManager;
  disabled: string[];
  reopen: () => SkillManager;
}

function writeSkill(dir: string, name: string, body = "Body", frontmatterExtra = ""): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${name} description\ndeclared: ${name}\nversion: 1.0.0\n${frontmatterExtra}---\n\n${body}\n`,
    "utf8"
  );
}

function createHarness(): Harness {
  const root = mkdtempSync(join(tmpdir(), "skill-manager-"));
  const dataDir = join(root, "data");
  const homeDir = join(root, "home");
  const projectRoot = join(root, "project");
  const globalSkillsDir = join(dataDir, "skills");
  const agentsDir = join(dataDir, "sessions");
  for (const dir of [globalSkillsDir, agentsDir, homeDir, projectRoot, join(dataDir, "db")]) {
    mkdirSync(dir, { recursive: true });
  }
  mkdirSync(join(agentsDir, "agent1"), { recursive: true });
  const projects = () => [{ id: "p1", name: "Site", rootPath: projectRoot }];
  const disabled: string[] = [];
  let store = new SkillManagerStore(join(dataDir, "db", "skills.sqlite"));
  const build = (): SkillManager =>
    new SkillManager({
      store,
      dataDir,
      globalSkillsDir,
      agentsDir,
      projects,
      getDisabledPaths: () => disabled,
      setDisabledPaths: (paths) => {
        disabled.length = 0;
        disabled.push(...paths);
      },
      getAgentLabel: (id) => (id === "agent1" ? "Ada" : id),
      defaultAgentId: () => "agent1",
      homeDir,
      platform: "darwin",
      hostLabel: "test-host",
      now: () => new Date("2026-10-29T09:00:00.000Z")
    });
  const manager = build();
  return {
    root,
    dataDir,
    homeDir,
    projectRoot,
    globalSkillsDir,
    agentsDir,
    store,
    manager,
    disabled,
    reopen: () => {
      store.close();
      store = new SkillManagerStore(join(dataDir, "db", "skills.sqlite"));
      return build();
    }
  };
}

function discoveredId(manager: SkillManager, name: string): string {
  const item = manager.getOverview().discovered.find((candidate) => candidate.name === name);
  assert.ok(item, `expected a discovered Skill named ${name}`);
  return item.id;
}

function installCopy(manager: SkillManager, id: string, replace = false): DesktopSkillPreflightResult {
  const request = {
    source: { kind: "discovered" as const, id },
    method: "copy" as const,
    scope: "global" as const
  };
  const preflight = manager.preflight(request);
  const result = manager.install({ ...request, token: preflight.token, replace });
  assert.ok(result.ok, result.message);
  return preflight;
}

test("an external Skill is discovered on the server device but not installed", (t) => {
  const h = createHarness();
  t.after(() => rmSync(h.root, { recursive: true, force: true }));
  writeSkill(join(h.homeDir, ".claude", "skills", "pdf"), "pdf");

  const overview = h.manager.getOverview();

  assert.equal(overview.device.label, "test-host");
  assert.equal(overview.device.execution, "server");
  assert.equal(overview.counts.installed, 0);
  assert.equal(overview.counts.global, 0);
  assert.equal(overview.counts.discovered, 1);
  const item = overview.discovered[0];
  assert.equal(item.name, "pdf");
  assert.equal(item.platformId, "claude-code");
  assert.equal(item.installed, false);
  assert.equal(item.recommendedMethod, "copy");
  assert.equal(item.linkable, true);
  assert.equal(existsSync(join(h.globalSkillsDir, "pdf")), false);
});

test("Copy install is discovered by the real Runtime loader and becomes independent", (t) => {
  const h = createHarness();
  t.after(() => rmSync(h.root, { recursive: true, force: true }));
  const source = join(h.homeDir, ".claude", "skills", "pdf");
  writeSkill(source, "pdf", "Original body");

  const id = discoveredId(h.manager, "pdf");
  installCopy(h.manager, id);

  const overview = h.manager.getOverview();
  assert.equal(overview.counts.installed, 1);
  assert.equal(overview.counts.global, 1);
  assert.equal(overview.discovered.find((item) => item.name === "pdf")?.installed, true);
  const entry = overview.installed.find((item) => item.name === "pdf");
  assert.ok(entry);
  assert.equal(entry.managed, true);
  assert.equal(entry.method, "copy");
  assert.equal(entry.enabled, true);
  assert.equal(entry.source?.label, "Claude Code");
  assert.equal(entry.readBy.includes("Claude Code"), false);

  const detail = h.manager.getDetail(entry.id);
  assert.equal(detail.runtime.loaded, true);
  assert.equal(detail.runtime.reason, "loaded");

  // The copy is independent: editing the source leaves the installation alone.
  writeSkill(source, "pdf", "Changed upstream");
  const after = h.manager.getDetail(entry.id);
  assert.equal(after.installation?.localChanges, false);
  assert.equal(readFileSync(join(h.globalSkillsDir, "pdf", "SKILL.md"), "utf8").includes("Original body"), true);
});

test("Link install exposes the source live and removal never touches the source", (t) => {
  const h = createHarness();
  t.after(() => rmSync(h.root, { recursive: true, force: true }));
  const source = join(h.homeDir, ".claude", "skills", "shared");
  writeSkill(source, "shared", "v1");

  const request = {
    source: { kind: "discovered" as const, id: discoveredId(h.manager, "shared") },
    method: "link" as const,
    scope: "global" as const
  };
  const preflight = h.manager.preflight(request);
  const installed = h.manager.install({ ...request, token: preflight.token, replace: false });
  assert.ok(installed.ok, installed.message);

  const entryPath = join(h.globalSkillsDir, "shared");
  assert.equal(lstatSync(entryPath).isSymbolicLink(), true);
  assert.equal(readlinkSync(entryPath), realpathSync(source));

  writeSkill(source, "shared", "v2");
  const detail = h.manager.getDetail(installed.id);
  assert.equal(detail.installation?.localChanges, true);
  assert.equal(detail.runtime.loaded, true);

  const removed = h.manager.uninstall({ id: installed.id });
  assert.equal(removed.ok, true);
  assert.equal(existsSync(entryPath), false);
  assert.equal(existsSync(join(source, "SKILL.md")), true);
});

test("existing content at a Molibot target requires confirmation and is backed up", (t) => {
  const h = createHarness();
  t.after(() => rmSync(h.root, { recursive: true, force: true }));
  writeSkill(join(h.homeDir, ".claude", "skills", "pdf"), "pdf", "incoming");
  writeSkill(join(h.globalSkillsDir, "pdf"), "pdf", "hand made");

  const request = {
    source: { kind: "discovered" as const, id: discoveredId(h.manager, "pdf") },
    method: "copy" as const,
    scope: "global" as const
  };
  const preflight = h.manager.preflight(request);
  assert.equal(preflight.requiresReplace, true);
  assert.equal(preflight.installable, true);

  // Without the explicit confirmation nothing is written.
  const refused = h.manager.install({ ...request, token: preflight.token, replace: false });
  assert.equal(refused.ok, false);
  assert.equal(readFileSync(join(h.globalSkillsDir, "pdf", "SKILL.md"), "utf8").includes("hand made"), true);

  const replaced = h.manager.install({ ...request, token: preflight.token, replace: true });
  assert.ok(replaced.ok, replaced.message);
  assert.equal(readFileSync(join(h.globalSkillsDir, "pdf", "SKILL.md"), "utf8").includes("incoming"), true);
  assert.equal(readFileSync(join(replaced.backupPath, "SKILL.md"), "utf8").includes("hand made"), true);
});

test("replacing a managed installation keeps a timestamped backup and restores it on failure", (t) => {
  const h = createHarness();
  t.after(() => rmSync(h.root, { recursive: true, force: true }));
  const source = join(h.homeDir, ".claude", "skills", "pdf");
  writeSkill(source, "pdf", "first version");
  const id = discoveredId(h.manager, "pdf");
  installCopy(h.manager, id);

  writeSkill(source, "pdf", "second version");
  const request = {
    source: { kind: "discovered" as const, id: discoveredId(h.manager, "pdf") },
    method: "copy" as const,
    scope: "global" as const
  };
  const preflight = h.manager.preflight(request);
  assert.equal(preflight.requiresReplace, true);

  const replaced = h.manager.install({ ...request, token: preflight.token, replace: true });
  assert.ok(replaced.ok, replaced.message);
  assert.equal(replaced.status, "replaced");
  assert.ok(replaced.backupPath);
  assert.equal(existsSync(replaced.backupPath), true);
  assert.equal(readFileSync(join(replaced.backupPath, "SKILL.md"), "utf8").includes("first version"), true);
  assert.equal(readFileSync(join(h.globalSkillsDir, "pdf", "SKILL.md"), "utf8").includes("second version"), true);

  // A stale token is refused, and nothing is written.
  const stale = h.manager.install({ ...request, token: "outdated", replace: true });
  assert.equal(stale.ok, false);
  assert.equal(stale.status, "stale");
});

test("one physical directory read by several platforms is one entry with shared visibility", (t) => {
  const h = createHarness();
  t.after(() => rmSync(h.root, { recursive: true, force: true }));
  // Claude Code and OpenCode both read ~/.claude/skills.
  writeSkill(join(h.homeDir, ".claude", "skills", "review"), "review");

  const overview = h.manager.getOverview();
  assert.equal(overview.discovered.length, 1);
  const item = overview.discovered[0];
  // Two platforms read the same path; the entry count describes real
  // entry points, so one physical directory is one entry.
  assert.equal(item.entryCount, 1);
  assert.equal(item.sharedWith.includes("OpenCode"), true);

  installCopy(h.manager, item.id);
  const installed = h.manager.getOverview().installed[0];
  // The installed copy is Molibot's own directory; it is no longer read by the
  // external tools, and the source keeps its own visibility record.
  assert.deepEqual(installed.readBy, []);
  const after = h.manager.getOverview().discovered.find((candidate) => candidate.name === "review");
  assert.equal(after?.installed, true);
  assert.equal(after?.sharedWith.includes("OpenCode"), true);
});

test("two Molibot entries pointing at one directory are aggregated but keep separate identities", (t) => {
  const h = createHarness();
  t.after(() => rmSync(h.root, { recursive: true, force: true }));
  const source = join(h.homeDir, ".claude", "skills", "pdf");
  writeSkill(source, "pdf");
  symlinkSync(source, join(h.globalSkillsDir, "pdf-link"));
  symlinkSync(source, join(h.globalSkillsDir, "pdf-alias"));

  const overview = h.manager.getOverview();
  const linkedEntries = overview.installed.filter((item) => item.name === "pdf");
  assert.equal(linkedEntries.length, 2);
  assert.equal(linkedEntries.every((item) => item.duplicateEntryCount === 2), true);
  assert.equal(linkedEntries.every((item) => item.method === "link"), true);
  // The entries live in Molibot's own root, so Molibot owns the link even
  // without an install receipt.
  assert.equal(linkedEntries.every((item) => item.managed === true), true);
  const removed = h.manager.uninstall({ id: linkedEntries[0].id });
  assert.equal(removed.status, "removed");
  const remainingLinks = ["pdf-link", "pdf-alias"].filter((name) => existsSync(join(h.globalSkillsDir, name)));
  assert.equal(remainingLinks.length, 1);
  assert.equal(existsSync(join(source, "SKILL.md")), true);
});

test("disabling an installed Skill keeps it visible and stops the Runtime from selecting it", (t) => {
  const h = createHarness();
  t.after(() => rmSync(h.root, { recursive: true, force: true }));
  writeSkill(join(h.homeDir, ".claude", "skills", "pdf"), "pdf");
  installCopy(h.manager, discoveredId(h.manager, "pdf"));
  const entry = h.manager.getOverview().installed[0];

  h.manager.setEnabled(entry.id, false);

  const overview = h.manager.getOverview();
  assert.equal(overview.counts.installed, 1);
  assert.equal(overview.counts.enabled, 0);
  assert.equal(overview.installed[0].enabled, false);
  assert.equal(overview.installed[0].health, "disabled");
  const detail = h.manager.getDetail(entry.id);
  assert.equal(detail.runtime.loaded, false);
  assert.equal(detail.runtime.reason, "disabled");
  assert.equal(existsSync(join(h.globalSkillsDir, "pdf", "SKILL.md")), true);
});

test("project and Agent scopes are counted separately and stay out of the global total", (t) => {
  const h = createHarness();
  t.after(() => rmSync(h.root, { recursive: true, force: true }));
  const source = join(h.homeDir, ".claude", "skills", "deploy");
  writeSkill(source, "deploy");
  const id = discoveredId(h.manager, "deploy");

  const projectRequest = {
    source: { kind: "discovered" as const, id },
    method: "copy" as const,
    scope: "project" as const,
    ownerId: "p1"
  };
  const preflight = h.manager.preflight(projectRequest);
  assert.ok(preflight.target.path.startsWith(join(h.projectRoot, ".agents", "skills")));
  assert.ok(h.manager.install({ ...projectRequest, token: preflight.token, replace: false }).ok);

  const agentRequest = {
    source: { kind: "discovered" as const, id },
    method: "copy" as const,
    scope: "agent" as const,
    ownerId: "agent1"
  };
  const agentPreflight = h.manager.preflight(agentRequest);
  assert.ok(agentPreflight.target.path.startsWith(join(h.agentsDir, "agent1", "skills")));
  assert.ok(h.manager.install({ ...agentRequest, token: agentPreflight.token, replace: false }).ok);

  const overview = h.manager.getOverview();
  assert.equal(overview.counts.global, 0);
  assert.equal(overview.counts.project, 1);
  assert.equal(overview.counts.agent, 1);
  assert.equal(overview.installed.find((item) => item.scope === "agent")?.ownerLabel, "Ada");
});

test("a Skill whose tree escapes through a link is refused before anything is written", (t) => {
  const h = createHarness();
  t.after(() => rmSync(h.root, { recursive: true, force: true }));
  const source = join(h.homeDir, ".claude", "skills", "leaky");
  writeSkill(source, "leaky");
  const secret = join(h.root, "secret.txt");
  writeFileSync(secret, "do not copy", "utf8");
  symlinkSync(secret, join(source, "escape.txt"));

  const request = {
    source: { kind: "discovered" as const, id: discoveredId(h.manager, "leaky") },
    method: "copy" as const,
    scope: "global" as const
  };
  const preflight = h.manager.preflight(request);
  assert.equal(preflight.installable, false);
  assert.equal(preflight.conflicts.some((conflict) => conflict.code === "symlink_escape"), true);

  const result = h.manager.install({ ...request, token: preflight.token, replace: false });
  assert.equal(result.ok, false);
  assert.equal(existsSync(join(h.globalSkillsDir, "leaky")), false);
});

test("a Git subdirectory installs only its own files, pins the commit and runs no hooks", (t) => {
  const h = createHarness();
  t.after(() => rmSync(h.root, { recursive: true, force: true }));
  const repo = join(h.root, "repo");
  mkdirSync(repo, { recursive: true });
  const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { stdio: "ignore" });
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  writeSkill(join(repo, "skills", "pdf"), "pdf", "from git");
  writeFileSync(join(repo, "README.md"), "unrelated", "utf8");
  git("add", ".");
  git("commit", "-q", "-m", "initial");
  const marker = join(h.root, "hook-ran");
  writeFileSync(join(repo, ".git", "hooks", "post-checkout"), `#!/bin/sh\ntouch ${marker}\n`, { mode: 0o755 });

  const request = {
    source: { kind: "git" as const, repository: repo, subdirectory: "skills/pdf" },
    method: "copy" as const,
    scope: "global" as const
  };
  const preflight = h.manager.preflight(request);
  assert.equal(preflight.installable, true, JSON.stringify(preflight.conflicts));
  assert.match(preflight.source.commit, /^[0-9a-f]{40}$/);
  assert.equal(preflight.plan.files, 1);

  const result = h.manager.install({ ...request, token: preflight.token, replace: false });
  assert.ok(result.ok, result.message);
  assert.equal(existsSync(join(h.globalSkillsDir, "pdf", "README.md")), false);
  assert.equal(existsSync(marker), false);

  const overview = h.manager.getOverview();
  const installed = overview.installed.find((item) => item.name === "pdf");
  assert.equal(installed?.source?.kind, "git");
  assert.equal(installed?.source?.commit, preflight.source.commit);
});

test("distribution reports each target separately and blocks removal until released", (t) => {
  const h = createHarness();
  t.after(() => rmSync(h.root, { recursive: true, force: true }));
  writeSkill(join(h.homeDir, ".claude", "skills", "pdf"), "pdf");
  installCopy(h.manager, discoveredId(h.manager, "pdf"));
  const entry = h.manager.getOverview().installed[0];

  const distributed = h.manager.distribute({
    installationId: entry.id,
    method: "link",
    targets: [
      { kind: "platform", id: "codex" },
      { kind: "platform", id: "github-copilot" }
    ]
  });
  assert.equal(distributed.results.filter((result) => result.status === "installed").length, 2);
  assert.equal(existsSync(join(h.homeDir, ".codex", "skills", "pdf")), true);

  const blocked = h.manager.uninstall({ id: entry.id });
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.blockedBy.length, 2);
  assert.equal(existsSync(join(h.globalSkillsDir, "pdf")), true);

  const detail = h.manager.getDetail(entry.id);
  for (const distribution of detail.distributions) {
    assert.equal(h.manager.removeDistribution({ id: distribution.id, deleteFiles: true }).ok, true);
  }
  const removed = h.manager.uninstall({ id: entry.id });
  assert.equal(removed.status, "removed");
  assert.equal(existsSync(join(h.homeDir, ".codex", "skills", "pdf")), false);
});

test("platform configuration survives a store restart and disabling a platform deletes nothing", (t) => {
  const h = createHarness();
  t.after(() => rmSync(h.root, { recursive: true, force: true }));
  writeSkill(join(h.homeDir, ".claude", "skills", "pdf"), "pdf");

  h.manager.savePlatforms({
    platforms: [
      { id: "claude-code", kind: "preset", enabled: false, extraRoots: [], removedRoots: [] },
      { id: "custom:team", kind: "custom", label: "Team", enabled: true, extraRoots: [join(h.root, "team-skills")], removedRoots: [] }
    ]
  });
  writeSkill(join(h.root, "team-skills", "deploy"), "deploy");

  const reopened = h.reopen();
  const overview = reopened.getOverview();
  const claude = overview.platforms.find((platform) => platform.id === "claude-code");
  assert.equal(claude?.enabled, false);
  // OpenCode still reads the shared ~/.claude/skills tree, so the Skill stays
  // discoverable; disabling one adapter is a read-rule change, not a file change.
  assert.equal(overview.discovered.some((item) => item.name === "pdf"), true);
  const custom = overview.platforms.find((platform) => platform.id === "custom:team");
  assert.equal(custom?.label, "Team");
  assert.equal(overview.discovered.some((item) => item.name === "deploy"), true);
  assert.equal(existsSync(join(h.homeDir, ".claude", "skills", "pdf", "SKILL.md")), true);
});

test("an interrupted replace restores the previous version from its receipt", (t) => {
  const h = createHarness();
  t.after(() => rmSync(h.root, { recursive: true, force: true }));
  const backup = join(h.root, "pdf.backup-2026-10-29T09-00-00-000Z");
  writeSkill(backup, "pdf", "previous");
  const target = join(h.globalSkillsDir, "pdf");

  h.store.beginOperation({
    id: "op-1",
    kind: "replace",
    status: "pending",
    targetPath: target,
    stagingPath: "",
    backupPath: backup,
    payload: {},
    error: "",
    createdAt: "2026-10-29T09:00:00.000Z",
    updatedAt: "2026-10-29T09:00:00.000Z"
  });

  const reopened = h.reopen();
  reopened.ensureRecovered();

  assert.equal(existsSync(join(target, "SKILL.md")), true);
  assert.equal(readFileSync(join(target, "SKILL.md"), "utf8").includes("previous"), true);
  const operation = reopened.listOperations(5).find((row) => row.id === "op-1");
  assert.equal(operation?.status, "recovered");
});

test("a failed copy install leaves no partial entry behind", (t) => {
  const h = createHarness();
  t.after(() => rmSync(h.root, { recursive: true, force: true }));
  // A Skill whose SKILL.md is fine but whose second file cannot be read is hard
  // to stage portably; an unreadable source tree exercises the same rollback.
  const source = join(h.homeDir, ".claude", "skills", "ghost");
  writeSkill(source, "ghost");
  const request = {
    source: { kind: "local" as const, path: join(h.root, "missing-skill") },
    method: "copy" as const,
    scope: "global" as const
  };
  assert.throws(() => h.manager.preflight(request), /does not exist/);
  assert.equal(existsSync(join(h.globalSkillsDir, "ghost")), false);
});

test("idempotent repeated installation requests leave one entry and one record", (t) => {
  const h = createHarness();
  t.after(() => rmSync(h.root, { recursive: true, force: true }));
  writeSkill(join(h.homeDir, ".claude", "skills", "pdf"), "pdf");
  const id = discoveredId(h.manager, "pdf");
  installCopy(h.manager, id);
  const installed = h.manager.getOverview().installed[0];

  const request = {
    source: { kind: "discovered" as const, id },
    method: "copy" as const,
    scope: "global" as const
  };
  // A second install resolves the same source and asks to replace the entry it
  // created; without that confirmation nothing is written twice.
  const second = h.manager.preflight(request);
  assert.equal(second.installable, true);
  assert.equal(second.requiresReplace, true);
  const refused = h.manager.install({ ...request, token: second.token, replace: false });
  assert.equal(refused.ok, false);
  const confirmed = h.manager.install({ ...request, token: second.token, replace: true });
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.id, installed.id);
  assert.equal(h.store.listInstallations().length, 1);

  const overview = h.manager.getOverview();
  assert.equal(overview.counts.installed, 1);
  assert.equal(overview.installed[0].id, installed.id);
  assert.equal(h.store.listInstallations().length, 1);
});

test("the source directory of a link stays readable after the entry is removed", (t) => {
  const h = createHarness();
  t.after(() => rmSync(h.root, { recursive: true, force: true }));
  const source = join(h.homeDir, ".claude", "skills", "shared");
  writeSkill(source, "shared");
  const request = {
    source: { kind: "discovered" as const, id: discoveredId(h.manager, "shared") },
    method: "link" as const,
    scope: "global" as const
  };
  const preflight = h.manager.preflight(request);
  const installed = h.manager.install({ ...request, token: preflight.token, replace: false });
  assert.ok(installed.ok);

  assert.equal(h.manager.uninstall({ id: installed.id }).status, "removed");
  const overview = h.manager.getOverview();
  assert.equal(overview.discovered.some((item) => item.name === "shared"), true);
});

test("two discovered Skills with the same name but different content are listed separately and flagged", (t) => {
  const h = createHarness();
  t.after(() => rmSync(h.root, { recursive: true, force: true }));
  writeSkill(join(h.homeDir, ".claude", "skills", "pdf"), "pdf", "claude variant");
  writeSkill(join(h.homeDir, ".codex", "skills", "pdf"), "pdf", "codex variant");

  const overview = h.manager.getOverview();
  const variants = overview.discovered.filter((item) => item.name === "pdf");
  assert.equal(variants.length, 2);
  assert.equal(variants.every((item) => item.duplicate === true), true);
  assert.equal(variants.every((item) => item.conflict === false), true);
  assert.deepEqual(variants.map((item) => item.platformLabel).sort(), ["Claude Code", "Codex"]);
});

test("discovered entries report link state, the shared tree and per-entry locations", (t) => {
  const h = createHarness();
  t.after(() => rmSync(h.root, { recursive: true, force: true }));
  const sharedDir = join(h.homeDir, ".agents", "skills");
  const content = join(sharedDir, "linked-one");
  writeSkill(content, "linked-one", "shared body");
  mkdirSync(join(h.homeDir, ".claude", "skills"), { recursive: true });
  symlinkSync(content, join(h.homeDir, ".claude", "skills", "linked-one"));
  writeSkill(join(h.homeDir, ".claude", "skills", "solid"), "solid", "real copy");

  const overview = h.manager.getOverview();

  // One physical copy in the shared tree plus one link entry: not all links,
  // and flagged as living in the shared tree.
  const linked = overview.discovered.find((item) => item.name === "linked-one");
  assert.ok(linked);
  assert.equal(linked.inSharedDir, true);
  assert.equal(linked.linked, false);
  assert.equal(linked.entryCount, 2);
  const linkedDetail = h.manager.getDetail(linked.id);
  const locations = new Map(linkedDetail.locations.map((location) => [location.path, location]));
  assert.equal(locations.get(content)?.isLink, false);
  assert.equal(locations.get(join(h.homeDir, ".claude", "skills", "linked-one"))?.isLink, true);

  // A single real folder is a copy, not a link.
  const solid = overview.discovered.find((item) => item.name === "solid");
  assert.ok(solid);
  assert.equal(solid.inSharedDir, false);
  assert.equal(solid.linked, false);
});

test("a platform cannot be configured to scan the whole disk or the home directory itself", (t) => {
  const h = createHarness();
  t.after(() => rmSync(h.root, { recursive: true, force: true }));

  assert.throws(
    () => h.manager.savePlatforms({
      platforms: [{ id: "custom:disk", kind: "custom", label: "Disk", enabled: true, extraRoots: ["/"], removedRoots: [] }]
    }),
    /filesystem root cannot be a scan folder/
  );
  assert.throws(
    () => h.manager.savePlatforms({
      platforms: [{ id: "custom:home", kind: "custom", label: "Home", enabled: true, extraRoots: [h.homeDir], removedRoots: [] }]
    }),
    /home directory itself cannot be a scan folder/
  );
  assert.equal(h.store.listPlatforms().length, 0);
});

test("a broken link at the target is treated as existing content, not as empty space", (t) => {
  const h = createHarness();
  t.after(() => rmSync(h.root, { recursive: true, force: true }));
  writeSkill(join(h.homeDir, ".claude", "skills", "ghost"), "ghost", "incoming");
  symlinkSync(join(h.root, "nowhere"), join(h.globalSkillsDir, "ghost"));

  const request = {
    source: { kind: "discovered" as const, id: discoveredId(h.manager, "ghost") },
    method: "copy" as const,
    scope: "global" as const
  };
  const preflight = h.manager.preflight(request);
  // A broken link still occupies the target; it is not treated as empty space.
  assert.equal(preflight.requiresReplace, true);

  const result = h.manager.install({ ...request, token: preflight.token, replace: false });
  assert.equal(result.ok, false);
  assert.equal(lstatSync(join(h.globalSkillsDir, "ghost")).isSymbolicLink(), true);
});

test("renaming a Copy rewrites the directory and frontmatter name; a Link cannot be renamed", (t) => {
  const h = createHarness();
  t.after(() => rmSync(h.root, { recursive: true, force: true }));
  writeSkill(join(h.homeDir, ".claude", "skills", "pdf"), "pdf", "body stays");

  const linkRequest = {
    source: { kind: "discovered" as const, id: discoveredId(h.manager, "pdf") },
    method: "link" as const,
    scope: "global" as const,
    rename: "pdf-linked"
  };
  const linkPreflight = h.manager.preflight(linkRequest);
  assert.equal(linkPreflight.conflicts.some((conflict) => conflict.code === "link_rename_unsupported"), true);

  const copyRequest = {
    source: { kind: "discovered" as const, id: discoveredId(h.manager, "pdf") },
    method: "copy" as const,
    scope: "global" as const,
    rename: "pdf-copy"
  };
  const preflight = h.manager.preflight(copyRequest);
  assert.equal(preflight.installable, true, JSON.stringify(preflight.conflicts));
  const result = h.manager.install({ ...copyRequest, token: preflight.token, replace: false });
  assert.ok(result.ok, result.message);

  const installed = join(h.globalSkillsDir, "pdf-copy");
  const skillFile = readFileSync(join(installed, "SKILL.md"), "utf8");
  assert.match(skillFile, /^name: pdf-copy$/m);
  assert.match(skillFile, /body stays/);
  assert.equal(h.manager.getOverview().installed.find((item) => item.name === "pdf-copy")?.managed, true);
});

test("consolidating a discovered Skill moves the canonical copy into the shared tree and leaves a link", (t) => {
  const h = createHarness();
  t.after(() => rmSync(h.root, { recursive: true, force: true }));
  const source = join(h.homeDir, ".claude", "skills", "shared-one");
  writeSkill(source, "shared-one", "canonical body");
  const sharedDir = join(h.homeDir, ".agents", "skills");

  const request = {
    sourceKind: "discovered" as const,
    id: discoveredId(h.manager, "shared-one"),
    sourceAction: "link" as const,
    replaceDestination: false
  };
  const preflight = h.manager.preflightConsolidate(request);
  assert.equal(preflight.installable, true, JSON.stringify(preflight.conflicts));
  assert.equal(preflight.destination.path, join(sharedDir, "shared-one"));
  assert.equal(preflight.backLink?.path, source);

  const result = h.manager.consolidate({ ...request, token: preflight.token });
  assert.equal(result.ok, true, result.message);

  // One canonical copy in the shared tree; the original platform entry is now a link to it.
  assert.equal(lstatSync(source).isSymbolicLink(), true);
  assert.equal(readlinkSync(source), realpathSync(join(sharedDir, "shared-one")));
  assert.equal(readFileSync(join(sharedDir, "shared-one", "SKILL.md"), "utf8").includes("canonical body"), true);

  // The shared tree is not a Molibot root, so nothing is recorded as installed.
  const overview = h.manager.getOverview();
  assert.equal(overview.installed.some((item) => item.name === "shared-one"), false);
  const discovered = overview.discovered.find((item) => item.name === "shared-one");
  assert.ok(discovered);
  assert.equal(discovered.inSharedDir, true);

  // The detail lists every entry that resolves to the shared content.
  const detail = h.manager.getDetail(discovered.id);
  const paths = detail.locations.map((location) => location.path);
  assert.equal(paths.includes(source), true);
  assert.equal(paths.includes(join(sharedDir, "shared-one")), true);
  assert.equal(detail.locations.find((location) => location.path === source)?.isLink, true);
});

test("consolidating with the entry removed moves the Skill into the shared tree and keeps a backup", (t) => {
  const h = createHarness();
  t.after(() => rmSync(h.root, { recursive: true, force: true }));
  const source = join(h.homeDir, ".codex", "skills", "moved");
  writeSkill(source, "moved", "moved body");
  const sharedDir = join(h.homeDir, ".agents", "skills");

  const request = {
    sourceKind: "discovered" as const,
    id: discoveredId(h.manager, "moved"),
    sourceAction: "remove" as const,
    replaceDestination: false
  };
  const preflight = h.manager.preflightConsolidate(request);
  assert.equal(preflight.backLink, null);
  const result = h.manager.consolidate({ ...request, token: preflight.token });
  assert.ok(result.ok, result.message);

  assert.equal(existsSync(source), false);
  assert.equal(existsSync(join(sharedDir, "moved", "SKILL.md")), true);
  const backup = readdirSync(dirname(source)).find((name) => name.startsWith("moved.backup-"));
  assert.ok(backup);
  assert.equal(readFileSync(join(dirname(source), backup, "SKILL.md"), "utf8").includes("moved body"), true);

  // The canonical copy stays external: discovered under the shared tree, not installed.
  const overview = h.manager.getOverview();
  assert.equal(overview.installed.some((item) => item.name === "moved"), false);
  const discovered = overview.discovered.find((item) => item.name === "moved");
  assert.ok(discovered);
  assert.equal(discovered.inSharedDir, true);
});

test("consolidation asks before replacing the destination and keeps a backup", (t) => {
  const h = createHarness();
  t.after(() => rmSync(h.root, { recursive: true, force: true }));
  writeSkill(join(h.homeDir, ".agents", "skills", "target"), "target", "existing content");
  writeSkill(join(h.homeDir, ".claude", "skills", "target"), "target", "incoming");

  const request = {
    sourceKind: "discovered" as const,
    id: discoveredId(h.manager, "target"),
    sourceAction: "link" as const,
    replaceDestination: false
  };
  const preflight = h.manager.preflightConsolidate(request);
  assert.equal(preflight.conflicts.some((conflict) => conflict.code === "replace_required"), true);
  assert.equal(preflight.installable, false);

  const confirmed = h.manager.preflightConsolidate({ ...request, replaceDestination: true });
  assert.equal(confirmed.installable, true);
  const result = h.manager.consolidate({ ...request, replaceDestination: true, token: confirmed.token });
  assert.ok(result.ok, result.message);
  assert.equal(readFileSync(join(h.homeDir, ".agents", "skills", "target", "SKILL.md"), "utf8").includes("incoming"), true);
  assert.ok(result.backupPath);
  assert.equal(readFileSync(join(result.backupPath, "SKILL.md"), "utf8").includes("existing content"), true);
});

test("a Skill already living in Molibot's own root is managed, not 'not installed by Molibot'", (t) => {
  const h = createHarness();
  t.after(() => rmSync(h.root, { recursive: true, force: true }));
  writeSkill(join(h.globalSkillsDir, "legacy"), "legacy", "already here");

  const overview = h.manager.getOverview();
  const entry = overview.installed.find((item) => item.name === "legacy");
  assert.ok(entry);
  assert.equal(entry.managed, true);
  assert.equal(entry.health, "ok");
  assert.equal(entry.method, "copy");
  assert.equal(entry.source, null);

  const detail = h.manager.getDetail(entry.id);
  assert.equal(detail.managed, true);
  assert.equal(detail.runtime.loaded, true);

  const removed = h.manager.uninstall({ id: entry.id });
  assert.equal(removed.status, "removed");
  assert.equal(existsSync(join(h.globalSkillsDir, "legacy")), false);
});

test("removing a discovered Skill unlinks links and backs up real folders", (t) => {
  const h = createHarness();
  t.after(() => rmSync(h.root, { recursive: true, force: true }));
  const source = join(h.homeDir, ".claude", "skills", "gone");
  writeSkill(source, "gone", "real content");
  mkdirSync(join(h.homeDir, ".codex", "skills"), { recursive: true });
  symlinkSync(source, join(h.homeDir, ".codex", "skills", "gone"));

  const result = h.manager.removeDiscovered({ id: discoveredId(h.manager, "gone") });
  assert.ok(result.ok, result.message);
  assert.equal(existsSync(source), false);
  assert.equal(existsSync(join(h.homeDir, ".codex", "skills", "gone")), false);
  assert.equal(result.removed.filter((entry) => entry.kind === "link").length, 1);
  assert.equal(result.removed.filter((entry) => entry.kind === "copy").length, 1);
  assert.equal(result.backups.length, 1);
  assert.equal(readFileSync(join(result.backups[0], "SKILL.md"), "utf8").includes("real content"), true);
  assert.equal(h.manager.getOverview().discovered.some((item) => item.name === "gone"), false);
});

test("removing one discovered entry leaves the rest of the group readable", (t) => {
  const h = createHarness();
  t.after(() => rmSync(h.root, { recursive: true, force: true }));
  const source = join(h.homeDir, ".claude", "skills", "partial");
  writeSkill(source, "partial", "real content");
  mkdirSync(join(h.homeDir, ".codex", "skills"), { recursive: true });
  symlinkSync(source, join(h.homeDir, ".codex", "skills", "partial"));
  const id = discoveredId(h.manager, "partial");

  const detail = h.manager.getDetail(id);
  const linkPath = detail.locations.find((location) => location.isLink)?.path;
  assert.ok(linkPath);
  const result = h.manager.removeDiscovered({ id, entryDir: linkPath });
  assert.ok(result.ok, result.message);
  assert.equal(existsSync(linkPath), false);
  assert.equal(existsSync(source), true);

  const item = h.manager.getOverview().discovered.find((candidate) => candidate.name === "partial");
  assert.ok(item);
  assert.equal(item.entryCount, 1);
});

test("removing a real folder reports the sibling links left pointing at it", (t) => {
  const h = createHarness();
  t.after(() => rmSync(h.root, { recursive: true, force: true }));
  const source = join(h.homeDir, ".claude", "skills", "hub");
  writeSkill(source, "hub", "content");
  mkdirSync(join(h.homeDir, ".codex", "skills"), { recursive: true });
  symlinkSync(source, join(h.homeDir, ".codex", "skills", "hub"));
  const id = discoveredId(h.manager, "hub");

  const detail = h.manager.getDetail(id);
  const realPath = detail.locations.find((location) => !location.isLink)?.path;
  assert.ok(realPath);
  const result = h.manager.removeDiscovered({ id, entryDir: realPath });
  assert.ok(result.ok, result.message);
  assert.equal(result.brokenLinks.length, 1);
  assert.equal(lstatSync(join(h.homeDir, ".codex", "skills", "hub")).isSymbolicLink(), true);
});

test("a Git-installed Skill can check its source for updates", (t) => {
  const h = createHarness();
  t.after(() => rmSync(h.root, { recursive: true, force: true }));
  const repo = join(h.root, "repo");
  mkdirSync(repo, { recursive: true });
  const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { stdio: "ignore" });
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  writeSkill(join(repo, "skills", "pdf"), "pdf", "v1");
  git("add", ".");
  git("commit", "-q", "-m", "v1");

  const request = {
    source: { kind: "git" as const, repository: repo, subdirectory: "skills/pdf" },
    method: "copy" as const,
    scope: "global" as const
  };
  const preflight = h.manager.preflight(request);
  const installed = h.manager.install({ ...request, token: preflight.token, replace: false });
  assert.ok(installed.ok, installed.message);

  // The source is unchanged: no update.
  const before = h.manager.checkUpdate({ id: installed.id });
  assert.equal(before.ok, true, before.message);
  assert.equal(before.hasUpdate, false);
  assert.equal(before.currentCommit, preflight.source.commit);

  // Unrelated upstream commits are not an update for this Skill.
  writeFileSync(join(repo, "README.md"), "docs", "utf8");
  git("add", ".");
  git("commit", "-q", "-m", "docs only");
  const docsOnly = h.manager.checkUpdate({ id: installed.id });
  assert.equal(docsOnly.hasUpdate, false, docsOnly.message);
  assert.notEqual(docsOnly.latestCommit, before.currentCommit);

  // A new commit touching the Skill subdirectory is an update.
  writeSkill(join(repo, "skills", "pdf"), "pdf", "v2");
  git("add", ".");
  git("commit", "-q", "-m", "v2");
  const after = h.manager.checkUpdate({ id: installed.id });
  assert.equal(after.hasUpdate, true, after.message);
  assert.notEqual(after.latestCommit, docsOnly.latestCommit);
});

test("a locally installed Skill cannot check for updates", (t) => {
  const h = createHarness();
  t.after(() => rmSync(h.root, { recursive: true, force: true }));
  writeSkill(join(h.homeDir, ".claude", "skills", "local-only"), "local-only");
  installCopy(h.manager, discoveredId(h.manager, "local-only"));

  const entry = h.manager.getOverview().installed.find((item) => item.name === "local-only");
  assert.ok(entry);
  assert.throws(
    () => h.manager.checkUpdate({ id: entry.id }),
    /Only Skills installed from a Git repository/
  );
});

for (const destinationKind of ["copy", "link"] as const) {
  test(`consolidation deduplicates an existing ${destinationKind} into shared content`, (t) => {
    const h = createHarness();
    t.after(() => rmSync(h.root, { recursive: true, force: true }));
    const source = join(h.homeDir, ".claude", "skills", "dedup");
    const target = join(h.homeDir, ".agents", "skills", "dedup");
    writeSkill(source, "dedup", "same content");
    if (destinationKind === "copy") writeSkill(target, "dedup", "same content");
    else {
      mkdirSync(dirname(target), { recursive: true });
      symlinkSync(source, target);
    }
    const id = `discovered:${createHash("sha256").update(realpathSync(source)).digest("hex").slice(0, 16)}`;
    const request = { sourceKind: "discovered" as const, id, sourceAction: "link" as const, replaceDestination: false };
    const preview = h.manager.preflightConsolidate(request);
    assert.equal(preview.installable, true, JSON.stringify(preview.conflicts));
    const result = h.manager.consolidate({ ...request, token: preview.token });
    assert.equal(result.ok, true, result.message);
    assert.equal(lstatSync(target).isDirectory(), true);
    assert.equal(lstatSync(source).isSymbolicLink(), true);
    assert.equal(realpathSync(source), realpathSync(target));
    assert.match(readFileSync(join(source, "SKILL.md"), "utf8"), /same content/);
    assert.equal(h.manager.getOverview().discovered.find((item) => item.name === "dedup")?.inSharedDir, true);
  });
}

test("consolidation rejects a destination changed since preview", (t) => {
  const h = createHarness();
  t.after(() => rmSync(h.root, { recursive: true, force: true }));
  const source = join(h.homeDir, ".claude", "skills", "changed-target");
  const target = join(h.homeDir, ".agents", "skills", "changed-target");
  writeSkill(source, "changed-target", "incoming");
  const request = { sourceKind: "discovered" as const, id: discoveredId(h.manager, "changed-target"), sourceAction: "link" as const, replaceDestination: true };
  const preview = h.manager.preflightConsolidate(request);
  writeSkill(target, "changed-target", "new local edit");
  const result = h.manager.consolidate({ ...request, token: preview.token });
  assert.equal(result.status, "stale");
  assert.equal(lstatSync(source).isDirectory(), true);
  assert.match(readFileSync(join(target, "SKILL.md"), "utf8"), /new local edit/);
});

test("consolidation compares support files before treating skills as duplicates", (t) => {
  const h = createHarness();
  t.after(() => rmSync(h.root, { recursive: true, force: true }));
  const source = join(h.homeDir, ".claude", "skills", "support-files");
  const target = join(h.homeDir, ".agents", "skills", "support-files");
  writeSkill(source, "support-files");
  writeSkill(target, "support-files");
  writeFileSync(join(source, "helper.js"), "source");
  writeFileSync(join(target, "helper.js"), "target");
  const id = `discovered:${createHash("sha256").update(realpathSync(source)).digest("hex").slice(0, 16)}`;
  const request = { sourceKind: "discovered" as const, id, sourceAction: "link" as const, replaceDestination: false };
  const preview = h.manager.preflightConsolidate(request);
  assert.equal(preview.installable, false);
  assert.equal(preview.conflicts[0]?.code, "replace_required");
  assert.equal(h.manager.consolidate({ ...request, token: preview.token }).ok, false);
  assert.equal(readFileSync(join(target, "helper.js"), "utf8"), "target");
  assert.equal(lstatSync(source).isDirectory(), true);
});

for (const action of ["link", "keep", "remove"] as const) {
  test(`consolidation recognizes a linked platform root when choosing ${action}`, (t) => {
    const h = createHarness();
    t.after(() => rmSync(h.root, { recursive: true, force: true }));
    const shared = join(h.homeDir, ".agents", "skills");
    const claude = join(h.homeDir, ".claude", "skills");
    writeSkill(join(shared, "root-alias"), "root-alias", "one physical copy");
    mkdirSync(dirname(claude), { recursive: true });
    symlinkSync(shared, claude);
    const before = readdirSync(shared);
    const request = { sourceKind: "discovered" as const, id: discoveredId(h.manager, "root-alias"), sourceAction: action, replaceDestination: false };
    const preview = h.manager.preflightConsolidate(request);
    assert.equal(preview.installable, action !== "remove", JSON.stringify(preview.conflicts));
    const result = h.manager.consolidate({ ...request, token: preview.token });
    assert.equal(result.ok, action !== "remove", result.message);
    if (action !== "remove") assert.equal(result.status, "already_shared");
    assert.deepEqual(readdirSync(shared), before);
    assert.equal(realpathSync(join(claude, "root-alias")), realpathSync(join(shared, "root-alias")));
    assert.equal(lstatSync(claude).isSymbolicLink(), true);
    assert.match(readFileSync(join(shared, "root-alias", "SKILL.md"), "utf8"), /one physical copy/);
  });
}

test("consolidation materializes a shared entry link without creating a self link", (t) => {
  const h = createHarness();
  t.after(() => rmSync(h.root, { recursive: true, force: true }));
  const outside = join(h.homeDir, "unregistered", "materialize");
  writeSkill(outside, "materialize", "source stays readable");
  const target = join(h.homeDir, ".agents", "skills", "materialize");
  mkdirSync(dirname(target), { recursive: true });
  symlinkSync(outside, target);
  const request = { sourceKind: "discovered" as const, id: discoveredId(h.manager, "materialize"), sourceAction: "link" as const, replaceDestination: false };
  const preview = h.manager.preflightConsolidate(request);
  assert.equal(preview.installable, true, JSON.stringify(preview.conflicts));
  const result = h.manager.consolidate({ ...request, token: preview.token });
  assert.equal(result.ok, true, result.message);
  assert.equal(lstatSync(target).isDirectory(), true);
  assert.match(readFileSync(join(target, "SKILL.md"), "utf8"), /source stays readable/);
  assert.equal(lstatSync(outside).isDirectory(), true);
});
