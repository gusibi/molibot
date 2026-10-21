import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { defaultRuntimeSettings } from "../settings/defaults.js";
import type { RuntimeSettings } from "../settings/schema.js";
import {
  agentOfBot,
  botAgentId,
  requireBotAgentId,
  resolveExecutionIdentity
} from "./executionIdentity.js";

function settings(): RuntimeSettings {
  const next = structuredClone(defaultRuntimeSettings);
  next.agents = [
    { id: "default", name: "Momo", description: "", enabled: true },
    { id: "researcher", name: "Researcher", description: "", enabled: true }
  ];
  next.deletedAgentIds = ["ghost"];
  next.channels = {
    ...next.channels,
    telegram: {
      instances: [
        { id: "empty", name: "Empty", enabled: true, agentId: "", credentials: {}, allowedChatIds: [] },
        { id: "blank", name: "Blank", enabled: true, agentId: "   ", credentials: {}, allowedChatIds: [] },
        { id: "bound", name: "Bound", enabled: true, agentId: "researcher", credentials: {}, allowedChatIds: [] },
        { id: "ghost", name: "Ghost", enabled: true, agentId: "ghost", credentials: {}, allowedChatIds: [] },
        { id: "missing", name: "Missing", enabled: true, agentId: "nobody", credentials: {}, allowedChatIds: [] }
      ]
    }
  };
  return next;
}

test("bot binding separates empty, unknown, deleted and missing Agents", () => {
  const current = settings();
  assert.deepEqual(agentOfBot(current, "telegram", "empty"), { kind: "default", agentId: "default" });
  assert.deepEqual(agentOfBot(current, "telegram", "blank"), { kind: "default", agentId: "default" });
  assert.deepEqual(agentOfBot(current, "telegram", "bound"), { kind: "bound", agentId: "researcher" });
  assert.deepEqual(agentOfBot(current, "telegram", "nobody"), { kind: "unknown" });
  assert.deepEqual(agentOfBot(current, "nosuchchannel", "bound"), { kind: "unknown" });
  assert.deepEqual(agentOfBot(current, "telegram", "ghost"), { kind: "invalid", agentId: "ghost", reason: "deleted" });
  assert.deepEqual(agentOfBot(current, "telegram", "missing"), { kind: "invalid", agentId: "nobody", reason: "missing" });
});

test("only bound and empty bindings yield a display agent id", () => {
  const current = settings();
  assert.equal(botAgentId(current, "telegram", "empty"), "default");
  assert.equal(botAgentId(current, "telegram", "bound"), "researcher");
  assert.equal(botAgentId(current, "telegram", "nobody"), undefined);
  assert.equal(botAgentId(current, "telegram", "ghost"), undefined);
  assert.throws(() => requireBotAgentId(current, "telegram", "nobody"), /Unknown Bot/);
  assert.throws(() => requireBotAgentId(current, "telegram", "ghost"), /Agent binding is invalid/);
});

test("execution identity keeps pinned ownership and rejects a different asserted Agent", () => {
  const current = settings();
  const pinned = resolveExecutionIdentity(current, { channel: "telegram", botId: "bound", persistedAgentId: "researcher" });
  assert.deepEqual(pinned, { agentId: "researcher", mode: "pinned", source: "session", action: "reuse" });
  assert.throws(
    () => resolveExecutionIdentity(current, { channel: "telegram", botId: "bound", assertedAgentId: "default", persistedAgentId: "researcher" }),
    /Session Agent mismatch/
  );
  const rebound = resolveExecutionIdentity(current, { channel: "telegram", botId: "empty", persistedAgentId: "researcher" });
  assert.deepEqual(rebound, { agentId: "default", mode: "new", source: "default", action: "create" });
  assert.throws(
    () => resolveExecutionIdentity(current, { channel: "telegram", botId: "empty", assertedAgentId: "nobody" }),
    /Agent not found/
  );
});

test("execution identity requires a claim for legacy sessions without ownership", () => {
  const current = settings();
  assert.throws(
    () => resolveExecutionIdentity(current, { channel: "telegram", botId: "bound", persistedAgentId: undefined, explicitTarget: true, hasContext: true }),
    /unassigned; claim it/
  );
  const fresh = resolveExecutionIdentity(current, { channel: "telegram", botId: "empty" });
  assert.deepEqual(fresh, { agentId: "default", mode: "new", source: "default", action: "create" });
  const asserted = resolveExecutionIdentity(current, { channel: "web", botId: "personal", assertedAgentId: "researcher" });
  assert.deepEqual(asserted, { agentId: "researcher", mode: "new", source: "explicit", action: "create" });
});

test("recovery may keep a disabled Agent without creating a new identity", () => {
  const current = settings();
  current.agents.find(agent => agent.id === "researcher")!.enabled = false;
  const recovery = resolveExecutionIdentity(current, {
    channel: "telegram",
    botId: "bound",
    persistedAgentId: "researcher",
    explicitTarget: true,
    recoveryMatches: true
  });
  assert.deepEqual(recovery, { agentId: "researcher", mode: "recovery", source: "session", action: "reuse" });
});

test("a deleted Agent cannot be recovered", () => {
  const current = settings();
  current.deletedAgentIds = [...current.deletedAgentIds, "researcher"];
  assert.throws(
    () => resolveExecutionIdentity(current, { channel: "telegram", botId: "bound", persistedAgentId: "researcher", explicitTarget: true, recoveryMatches: true }),
    /Agent not found/
  );
});

test("only the identity module resolves channel bindings for execution", () => {
  const root = join(import.meta.dirname, "..", "..", "..", "..");
  const owner = join(import.meta.dirname, "executionIdentity.ts");
  const allowlist = new Set([
    "src/lib/server/settings/sanitize.ts",
    "src/lib/server/settings/store.ts",
    "src/lib/server/settings/validators.ts",
    "src/lib/server/app/desktopChannels.ts",
    "src/lib/server/app/desktopProfiles.ts",
    "src/lib/server/app/desktopBootstrap.ts",
    "src/routes/api/desktop/agent-bindings/+server.ts",
    "src/routes/settings/feishu/+page.svelte",
    "src/routes/settings/qq/+page.svelte",
    "src/routes/settings/telegram/+page.svelte",
    "src/routes/settings/weixin/+page.svelte",
    "src/lib/server/sessions/agentStorageLifecycle.ts"
  ]);
  const forbidden = [
    /instances\.find\([^\n]*\)\?\.agentId/,
    /instances\.find\([^\n]*\)\.agentId/,
    /\bbot\??\.agentId\s*(?:\|\||\?\?)/,
    /\binstance\??\.agentId\s*(?:\|\||\?\?)/,
    /\bbot\??\.agentId\)\s*\|\|/,
    /\binstance\??\.agentId\)\s*\|\|/
  ];
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const file = join(dir, name);
      if (statSync(file).isDirectory()) { walk(file); continue; }
      if (!/\.(ts|svelte)$/.test(name) || /\.test\.ts$/.test(name)) continue;
      if (file === owner) continue;
      const rel = relative(root, file).replaceAll("\\", "/");
      if (allowlist.has(rel)) continue;
      const source = readFileSync(file, "utf8");
      source.split("\n").forEach((line, index) => {
        if (forbidden.some(pattern => pattern.test(line))) offenders.push(`${rel}:${index + 1}: ${line.trim()}`);
      });
    }
  };
  walk(join(root, "src", "lib", "server"));
  walk(join(root, "src", "routes"));
  walk(join(root, "src", "lib", "shared"));
  assert.deepEqual(offenders, [], `Inline channel binding resolution outside executionIdentity.ts:\n${offenders.join("\n")}`);
});
