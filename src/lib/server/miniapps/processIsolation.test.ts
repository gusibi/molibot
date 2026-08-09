import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createMiniAppHost } from "$lib/server/miniapps/host.js";

const HARNESS_ENV = "MOLIBOT_MINIAPP_CRASH_HARNESS";

function installCrashFixture(root: string, mode: "exit" | "loop"): { codeRoot: string; dataRoot: string } {
  const codeRoot = join(root, "apps");
  const dataRoot = join(root, "data");
  const appRoot = join(codeRoot, "crasher");
  mkdirSync(join(appRoot, "server"), { recursive: true });
  mkdirSync(join(appRoot, "ui"), { recursive: true });
  mkdirSync(dataRoot, { recursive: true });
  writeFileSync(join(appRoot, "ui", "index.html"), "<!doctype html>", "utf8");
  writeFileSync(join(appRoot, "server", "index.mjs"), `
    import fs from "node:fs";
    import path from "node:path";
    export default function (context) {
      const marker = path.join(context.dataDir, "faulted-once");
      return {
        tools: { crash: async () => {
          if (!fs.existsSync(marker)) {
            fs.writeFileSync(marker, "1");
            ${mode === "exit" ? "process.exit(73);" : "while (true) {}"}
          }
          return { content: [{ type: "text", text: "recovered" }] };
        } },
        handleHttp: async () => ({ body: null })
      };
    }
  `, "utf8");
  writeFileSync(join(appRoot, "manifest.json"), JSON.stringify({
    manifestVersion: 1,
    id: "crasher",
    name: "Crash fixture",
    version: "1.0.0",
    description: "Exits its own process.",
    engines: { molibot: ">=0.0.1" },
    runtime: { entry: "server/index.mjs" },
    ui: { entry: "ui/index.html" },
    data: { schemaVersion: 1 },
    tools: [{
      name: "crash",
      description: "Crash",
      inputSchema: { type: "object", properties: {}, additionalProperties: false }
    }]
  }), "utf8");
  return { codeRoot, dataRoot };
}

async function runCrashHarness(mode: "exit" | "loop"): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "molibot-miniapp-crash-"));
  try {
    const paths = installCrashFixture(root, mode);
    const host = createMiniAppHost({
      ...paths,
      getEnablement: () => ({}),
      setEnablement: () => undefined,
      processCallTimeoutMs: 100
    });
    await assert.rejects(
      host.invokeTool("miniapp__crasher__crash", {}, { toolCallId: "crash-1" }),
      /process|exited|crash/i
    );
    const recovered = await host.invokeTool("miniapp__crasher__crash", {}, { toolCallId: "crash-2" });
    assert.equal(recovered.content[0]?.text, "recovered");
    await host.uninstall("crasher", { deleteData: true });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const harnessMode = process.env[HARNESS_ENV];
if (harnessMode === "exit" || harnessMode === "loop") {
  await runCrashHarness(harnessMode);
} else {
  async function runIsolatedHarness(mode: "exit" | "loop"): Promise<void> {
    const testFile = fileURLToPath(import.meta.url);
    const repoRoot = dirname(dirname(dirname(dirname(dirname(testFile)))));
    const child = spawn(process.execPath, [
      "--import", join(repoRoot, "scripts", "register-loader.js"),
      "--import", "tsx",
      testFile
    ], {
      cwd: repoRoot,
      env: { ...process.env, [HARNESS_ENV]: mode },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    assert.deepEqual(result, { code: 0, signal: null }, stderr);
  }

  test("a Mini App process exit is contained and reported without killing its host", async () => {
    await runIsolatedHarness("exit");
  });

  test("a synchronous Mini App infinite loop is killed at the process deadline", async () => {
    await runIsolatedHarness("loop");
  });
}
