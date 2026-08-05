import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  installBuiltInAgentTemplate,
  listBuiltInAgentTemplates,
  resolveBuiltInAgentTemplatesRoot,
  updateBuiltInAgentTemplate
} from "./builtInAgentTemplates";

function writeTemplate(root: string, id: string, metadata: {
  name?: string;
  description?: string;
  category?: string;
  version?: string;
  body?: string;
} = {}): void {
  const dir = path.join(root, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "AGENTS.md"), [
    "---",
    `name: \"${metadata.name ?? "测试角色"}\"`,
    `description: \"${metadata.description ?? "测试描述"}\"`,
    `category: \"${metadata.category ?? "测试分类"}\"`,
    "source: \"test\"",
    ...(metadata.version ? [`version: \"${metadata.version}\"`] : []),
    "---",
    "# AGENTS.md",
    "",
    metadata.body ?? "rules"
  ].join("\n"), "utf8");
  writeFileSync(path.join(dir, "SOUL.md"), "# SOUL.md\n\nsoul\n", "utf8");
  writeFileSync(path.join(dir, "IDENTITY.md"), "# IDENTITY.md\n\nidentity\n", "utf8");
}

function makeRoots(prefix: string): { root: string; templatesRoot: string; agentsRoot: string } {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix));
  const templatesRoot = path.join(root, "templates");
  const agentsRoot = path.join(root, "agents");
  mkdirSync(templatesRoot);
  mkdirSync(agentsRoot);
  return { root, templatesRoot, agentsRoot };
}

test("template discovery reads directories and AGENTS.md frontmatter without a registry", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "molibot-agent-templates-"));
  const agentsRoot = path.join(root, "installed");
  try {
    writeTemplate(root, "product-manager", { name: "产品经理", category: "产品" });
    mkdirSync(path.join(root, "incomplete"));
    const templates = listBuiltInAgentTemplates({ templatesRoot: root, agentsRoot });
    assert.deepEqual(templates.map((template) => template.id), ["product-manager"]);
    assert.equal(templates[0].name, "产品经理");
    assert.equal(templates[0].category, "产品");
    assert.equal(templates[0].installed, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("install copies only supported profile files and refuses overwrite", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "molibot-agent-install-"));
  const templatesRoot = path.join(root, "templates");
  const agentsRoot = path.join(root, "agents");
  mkdirSync(templatesRoot);
  mkdirSync(agentsRoot);
  try {
    writeTemplate(templatesRoot, "product-manager");
    writeFileSync(path.join(templatesRoot, "product-manager", "README.txt"), "ignore", "utf8");
    const installed = installBuiltInAgentTemplate("product-manager", { templatesRoot, agentsRoot });
    assert.equal(installed.template.installed, true);
    assert.equal(readFileSync(path.join(installed.agentDir, "AGENTS.md"), "utf8").includes("测试角色"), true);
    assert.equal(existsSync(path.join(installed.agentDir, "README.txt")), false);
    assert.throws(
      () => installBuiltInAgentTemplate("product-manager", { templatesRoot, agentsRoot }),
      /already exists/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// Before this, an installed Agent was frozen forever: the templates live in the
// app bundle, the copy lives in the workspace, and nothing connected the two, so
// a fix shipped in a new Molibot reached only people who had never installed it.
test("an installed Agent reports the shipped version and updates to it on request", () => {
  const { root, templatesRoot, agentsRoot } = makeRoots("molibot-agent-update-");
  try {
    writeTemplate(templatesRoot, "product-manager", { version: "1.0.0", body: "old rules" });
    installBuiltInAgentTemplate("product-manager", { templatesRoot, agentsRoot });

    // Freshly installed: current, unmodified, nothing to do.
    let listed = listBuiltInAgentTemplates({ templatesRoot, agentsRoot })[0];
    assert.equal(listed.version, "1.0.0");
    assert.equal(listed.installedVersion, "1.0.0");
    assert.equal(listed.updateAvailable, false);
    assert.equal(listed.modified, false);

    // A newer build ships new content behind a new version.
    writeTemplate(templatesRoot, "product-manager", { version: "1.1.0", body: "new rules", name: "产品经理 2" });
    listed = listBuiltInAgentTemplates({ templatesRoot, agentsRoot })[0];
    assert.equal(listed.updateAvailable, true);
    assert.equal(listed.installedVersion, "1.0.0");

    const updated = updateBuiltInAgentTemplate("product-manager", { templatesRoot, agentsRoot });
    assert.equal(updated.from, "1.0.0");
    assert.equal(updated.to, "1.1.0");
    // An untouched copy is replaced in place: no backup clutter.
    assert.equal(updated.backupDir, undefined);
    assert.match(readFileSync(path.join(agentsRoot, "product-manager", "AGENTS.md"), "utf8"), /new rules/);
    assert.equal(listBuiltInAgentTemplates({ templatesRoot, agentsRoot })[0].updateAvailable, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// The owner edits these prompts — that is the point of copying them into the
// workspace. An update may step over an edit, but must never destroy it.
test("updating an edited Agent keeps a backup and carries owner-added files across", () => {
  const { root, templatesRoot, agentsRoot } = makeRoots("molibot-agent-update-edited-");
  try {
    writeTemplate(templatesRoot, "product-manager", { version: "1.0.0", body: "old rules" });
    installBuiltInAgentTemplate("product-manager", { templatesRoot, agentsRoot });
    const agentDir = path.join(agentsRoot, "product-manager");
    writeFileSync(path.join(agentDir, "SOUL.md"), "# SOUL.md\n\nmy own soul\n", "utf8");
    writeFileSync(path.join(agentDir, "NOTES.md"), "my notes\n", "utf8");

    // An edited copy is reported as such even at the current version, which is
    // what lets Settings offer "re-apply" rather than a dead button.
    const beforeUpdate = listBuiltInAgentTemplates({ templatesRoot, agentsRoot })[0];
    assert.equal(beforeUpdate.modified, true);
    assert.equal(beforeUpdate.updateAvailable, false);

    writeTemplate(templatesRoot, "product-manager", { version: "1.1.0", body: "new rules" });
    const updated = updateBuiltInAgentTemplate("product-manager", { templatesRoot, agentsRoot });

    assert.ok(updated.backupDir, "an edited copy must be preserved");
    assert.match(readFileSync(path.join(updated.backupDir!, "SOUL.md"), "utf8"), /my own soul/);
    assert.match(readFileSync(path.join(agentDir, "AGENTS.md"), "utf8"), /new rules/);
    assert.match(readFileSync(path.join(agentDir, "SOUL.md"), "utf8"), /soul/);
    // Files the owner added are theirs and travel with the live directory.
    assert.equal(readFileSync(path.join(agentDir, "NOTES.md"), "utf8"), "my notes\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// Every copy installed before version tracking existed is by definition older
// than what this build ships. Reporting it as current would hide the one update
// the owner actually needs.
test("an Agent installed before the ledger existed is offered the update", () => {
  const { root, templatesRoot, agentsRoot } = makeRoots("molibot-agent-legacy-");
  try {
    writeTemplate(templatesRoot, "product-manager", { version: "1.0.0" });
    const agentDir = path.join(agentsRoot, "product-manager");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(path.join(agentDir, "AGENTS.md"), "hand-installed\n", "utf8");

    const listed = listBuiltInAgentTemplates({ templatesRoot, agentsRoot })[0];
    assert.equal(listed.installed, true);
    assert.equal(listed.installedVersion, "");
    assert.equal(listed.updateAvailable, true);
    // Unknown provenance counts as diverged, so the update keeps a backup.
    assert.equal(listed.modified, true);
    const updated = updateBuiltInAgentTemplate("product-manager", { templatesRoot, agentsRoot });
    assert.ok(updated.backupDir);
    assert.match(readFileSync(path.join(updated.backupDir!, "AGENTS.md"), "utf8"), /hand-installed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("update refuses a template that is not installed", () => {
  const { root, templatesRoot, agentsRoot } = makeRoots("molibot-agent-update-missing-");
  try {
    writeTemplate(templatesRoot, "product-manager");
    assert.throws(
      () => updateBuiltInAgentTemplate("product-manager", { templatesRoot, agentsRoot }),
      /not installed/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("real template directory exposes the curated templates from YAML metadata", () => {
  const agentsRoot = mkdtempSync(path.join(os.tmpdir(), "molibot-empty-agents-"));
  try {
    const templates = listBuiltInAgentTemplates({ agentsRoot });
    const ids = templates.map((template) => template.id);
    for (const id of ["product-manager", "business-strategist", "value-investment-researcher", "workplace-english-coach"]) {
      assert.ok(ids.includes(id), `missing ${id}`);
    }
    const coach = templates.find((template) => template.id === "workplace-english-coach");
    assert.equal(coach?.name, "工作英语教练");
    assert.equal(coach?.category, "学习与沟通");
    const coachDir = path.join(resolveBuiltInAgentTemplatesRoot(), "workplace-english-coach");
    const agents = readFileSync(path.join(coachDir, "AGENTS.md"), "utf8");
    assert.match(agents, /自然语言自动识别/);
    assert.match(agents, /会议前准备/);
    assert.match(agents, /会议后复盘/);
    assert.match(agents, /\/polish/);
    assert.match(agents, /Mastered/);
    assert.ok(templates.length >= 14);
  } finally {
    rmSync(agentsRoot, { recursive: true, force: true });
  }
});
