import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createMiniAppManageTool } from "$lib/server/agent/tools/miniAppManage.js";

const HARNESS_ENV = "MOLIBOT_MINIAPP_MANAGE_EXIT_HARNESS";

function writeExitFixture(appRoot: string): void {
  mkdirSync(path.join(appRoot, "server"), { recursive: true });
  mkdirSync(path.join(appRoot, "ui"), { recursive: true });
  writeFileSync(path.join(appRoot, "ui", "index.html"), "<!doctype html>", "utf8");
  writeFileSync(path.join(appRoot, "server", "index.mjs"), `
    process.exit(73);
    export default function () {
      return { tools: { noop: async () => ({ content: [] }) }, async handleHttp() { return { body: null }; } };
    }
  `, "utf8");
  writeFileSync(path.join(appRoot, "manifest.json"), JSON.stringify({
    manifestVersion: 1,
    id: "exit-during-validation",
    name: "Exit during validation",
    version: "1.0.0",
    description: "Regression fixture for the Agent install boundary.",
    engines: { molibot: ">=0.0.1" },
    runtime: { entry: "server/index.mjs" },
    ui: { entry: "ui/index.html" },
    data: { schemaVersion: 1 },
    tools: [{
      name: "noop",
      description: "No operation.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false }
    }]
  }), "utf8");
}

async function runHarness(): Promise<void> {
  const root = mkdtempSync(path.join(tmpdir(), "molibot-miniapp-manage-exit-"));
  try {
    const workspaceDir = path.join(root, "workspace");
    const cwd = path.join(workspaceDir, "scratch");
    const build = path.join(cwd, "exit-during-validation");
    mkdirSync(cwd, { recursive: true });
    writeExitFixture(build);
    const tool = createMiniAppManageTool({
      cwd,
      workspaceDir,
      codeRoot: path.join(root, "installed")
    });

    await assert.rejects(
      () => tool.execute("validate-exit", { action: "validate", path: build }),
      /process exited unexpectedly.*code 73/i
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

if (process.env[HARNESS_ENV] === "1") {
  await runHarness();
} else {
  test("miniAppManage contains a candidate process exit during validation", async () => {
    const testFile = fileURLToPath(import.meta.url);
    const repoRoot = path.resolve(path.dirname(testFile), "../../../../..");
    const child = spawn(process.execPath, [
      "--import", path.join(repoRoot, "scripts", "register-loader.js"),
      "--import", "tsx",
      testFile
    ], {
      cwd: repoRoot,
      env: { ...process.env, [HARNESS_ENV]: "1" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    assert.deepEqual(result, { code: 0, signal: null }, stderr);
  });
}
