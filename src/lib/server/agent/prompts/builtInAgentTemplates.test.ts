import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { installBuiltInAgentTemplate, listBuiltInAgentTemplates } from "./builtInAgentTemplates";

function writeTemplate(root: string, id: string, metadata: { name?: string; description?: string; category?: string } = {}): void {
  const dir = path.join(root, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "AGENTS.md"), [
    "---",
    `name: \"${metadata.name ?? "测试角色"}\"`,
    `description: \"${metadata.description ?? "测试描述"}\"`,
    `category: \"${metadata.category ?? "测试分类"}\"`,
    "source: \"test\"",
    "---",
    "# AGENTS.md",
    "",
    "rules"
  ].join("\n"), "utf8");
  writeFileSync(path.join(dir, "SOUL.md"), "# SOUL.md\n\nsoul\n", "utf8");
  writeFileSync(path.join(dir, "IDENTITY.md"), "# IDENTITY.md\n\nidentity\n", "utf8");
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

test("real template directory exposes the curated templates from YAML metadata", () => {
  const agentsRoot = mkdtempSync(path.join(os.tmpdir(), "molibot-empty-agents-"));
  try {
    const templates = listBuiltInAgentTemplates({ agentsRoot });
    const ids = templates.map((template) => template.id);
    for (const id of ["product-manager", "business-strategist", "value-investment-researcher"]) {
      assert.ok(ids.includes(id), `missing ${id}`);
    }
    assert.ok(templates.length >= 13);
  } finally {
    rmSync(agentsRoot, { recursive: true, force: true });
  }
});
