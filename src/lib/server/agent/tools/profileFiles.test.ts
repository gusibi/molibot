import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import type { RuntimeSettings } from "$lib/server/settings/index.js";
import { createProfileFilesTool } from "./profileFiles.js";

let tmpRoot: string;
let originalDataDir: string;

const workspaceDir = () => join(tmpRoot, "moli-w", "bots", "default");
const globalPath = (file: string) => join(tmpRoot, file);
const botPath = (file: string) => join(workspaceDir(), file);

const settings = (agentId = ""): RuntimeSettings =>
  ({ channels: { web: { instances: [{ id: "default", agentId }] } } }) as unknown as RuntimeSettings;

function makeTool(agentId = "") {
  return createProfileFilesTool({
    channel: "web",
    workspaceDir: workspaceDir(),
    getSettings: () => settings(agentId)
  });
}

async function run(tool: ReturnType<typeof makeTool>, params: Record<string, unknown>) {
  const result = await tool.execute("call-1", params as never);
  return result.content?.[0] && "text" in result.content[0] ? (result.content[0].text as string) : "";
}

beforeEach(() => {
  originalDataDir = storagePaths.dataDir;
  tmpRoot = mkdtempSync(join(tmpdir(), "molibot-profile-"));
  storagePaths.dataDir = tmpRoot;
});

afterEach(() => {
  storagePaths.dataDir = originalDataDir;
  rmSync(tmpRoot, { recursive: true, force: true });
});

test("write defaults to bot scope (unchanged behavior)", async () => {
  const text = await run(makeTool(), { label: "x", action: "write", file: "IDENTITY.md", content: "# IDENTITY.md\n\n- Moli" });
  assert.match(text, /at bot scope/);
  assert.ok(existsSync(botPath("IDENTITY.md")), "bot file should be written");
  assert.ok(!existsSync(globalPath("IDENTITY.md")), "global file must not be written for bot scope");
});

test("write with scope 'global' targets the workspace-root profile, not the bot", async () => {
  const text = await run(makeTool(), {
    label: "x",
    action: "write",
    file: "IDENTITY.md",
    scope: "global",
    content: "# IDENTITY.md\n\n- Moli global"
  });
  assert.match(text, /at global scope/);
  assert.ok(existsSync(globalPath("IDENTITY.md")), "global file should be written");
  assert.ok(!existsSync(botPath("IDENTITY.md")), "bot file must not be created for global scope");
  assert.match(readFileSync(globalPath("IDENTITY.md"), "utf8"), /Moli global/);
});

test("BOT.md maps to AGENTS.md at global scope", async () => {
  await run(makeTool(), { label: "x", action: "write", file: "BOT.md", scope: "global", content: "# AGENTS.md\n\n- rule" });
  assert.ok(existsSync(globalPath("AGENTS.md")), "BOT.md should map to global AGENTS.md");
});

test("read with scope 'global' reports the global source", async () => {
  await run(makeTool(), { label: "x", action: "write", file: "USER.md", scope: "global", content: "# USER.md\n\n- 老大" });
  const text = await run(makeTool(), { label: "x", action: "read", file: "USER.md", scope: "global" });
  assert.match(text, /source: global:/);
  assert.match(text, /老大/);
});

test("agent scope without a bound agent is rejected", async () => {
  await assert.rejects(
    () => run(makeTool(""), { label: "x", action: "write", file: "SOUL.md", scope: "agent", content: "# SOUL.md\n\n- voice" }),
    /agent scope is unavailable|agent is bound/i
  );
});
