import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createMiniAppManageTool } from "$lib/server/agent/tools/miniAppManage.js";
import { createMiniAppHost } from "$lib/server/miniapps/host.js";
import { createMiniAppInstaller } from "$lib/server/miniapps/install.js";

function writeBuild(dir: string, tableName: string, version = "1.0.0"): void {
  fs.mkdirSync(path.join(dir, "server"), { recursive: true });
  fs.mkdirSync(path.join(dir, "ui"), { recursive: true });
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({
    manifestVersion: 1,
    id: path.basename(dir),
    name: "Expense Tracker",
    version,
    engines: { molibot: ">=0.0.1" },
    runtime: { entry: "server/index.mjs" },
    ui: { entry: "ui/index.html" },
    data: { schemaVersion: 1 },
    tools: [{
      name: "list",
      description: "List expenses.",
      keywords: ["expense", "记账"],
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      readOnlyHint: true
    }]
  }, null, 2));
  fs.writeFileSync(path.join(dir, "ui", "index.html"), "<!doctype html><title>Expenses</title>");
  fs.writeFileSync(path.join(dir, "server", "index.mjs"), `
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
export default function create(context) {
  const db = new DatabaseSync(path.join(context.dataDir, "app.sqlite"));
  db.exec("CREATE TABLE IF NOT EXISTS ${tableName} (id TEXT PRIMARY KEY)");
  return {
    tools: { list: async () => ({ content: [{ type: "text", text: "ok" }] }) },
    async handleHttp() { return { body: {} }; },
    dispose() { db.close(); }
  };
}
`);
}

function harness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "molibot-miniapp-manage-"));
  const workspaceDir = path.join(root, "moli-w", "bots", "Web-miniapp");
  const cwd = path.join(workspaceDir, "web-user", "scratch");
  const codeRoot = path.join(root, "miniapps", "apps");
  const dataRoot = path.join(root, "miniapps", "data");
  fs.mkdirSync(cwd, { recursive: true });
  fs.mkdirSync(codeRoot, { recursive: true });
  const host = createMiniAppHost({
    codeRoot,
    dataRoot,
    getEnablement: () => ({}),
    setEnablement: () => undefined
  });
  const installer = createMiniAppInstaller({ codeRoot, recordSource: () => undefined });
  const tool = createMiniAppManageTool({ cwd, workspaceDir, codeRoot, host, installer });
  return { root, cwd, codeRoot, tool };
}

test("miniAppManage rejects a build whose runtime smoke hits invalid SQL", async () => {
  const fixture = harness();
  try {
    const build = path.join(fixture.cwd, "expense-tracker");
    writeBuild(build, "expense-tracker_records");

    await assert.rejects(
      () => fixture.tool.execute("validate-1", { action: "validate", path: build }),
      /near "-"|syntax error/i
    );
    assert.equal(fs.existsSync(path.join(fixture.codeRoot, "expense-tracker")), false);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("miniAppManage validates, atomically installs, and inspects an exact receipt", async () => {
  const fixture = harness();
  try {
    const build = path.join(fixture.cwd, "expense-tracker");
    writeBuild(build, "expense_tracker_records", "1.1.0");

    const validated = await fixture.tool.execute("validate-2", { action: "validate", path: build });
    assert.equal((validated.details as any).runtimeSmoke, "passed");
    assert.equal((validated.details as any).version, "1.1.0");

    const installed = await fixture.tool.execute("install-1", { action: "install", path: build });
    assert.equal((installed.details as any).restartRequired, true);
    assert.equal((installed.details as any).replaced, false);
    assert.equal((installed.details as any).version, "1.1.0");
    assert.ok((installed.details as any).manifestHash);

    const inspected = await fixture.tool.execute("inspect-1", { action: "inspect", appId: "expense-tracker" });
    assert.equal((inspected.details as any).manifestHash, (installed.details as any).manifestHash);
    assert.equal((inspected.details as any).version, "1.1.0");
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("miniAppManage rejects an inspect app id before resolving an installed path", async () => {
  const fixture = harness();
  try {
    await assert.rejects(
      () => fixture.tool.execute("inspect-escape", { action: "inspect", appId: "../../outside" }),
      /Invalid Mini App id/
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("miniAppManage follows symlinks before applying the workspace path guard", async () => {
  const fixture = harness();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "molibot-miniapp-outside-"));
  try {
    const build = path.join(outside, "expense-tracker");
    writeBuild(build, "expense_tracker_records");
    const linkedBuild = path.join(fixture.cwd, "expense-tracker");
    fs.symlinkSync(build, linkedBuild, "dir");

    await assert.rejects(
      () => fixture.tool.execute("validate-escape", { action: "validate", path: linkedBuild }),
      /Path outside allowed workspace roots/
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
