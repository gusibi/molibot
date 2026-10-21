import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "molibot-agents-route-"));
process.env.DATA_DIR = dataDir;
const { defaultRuntimeSettings } = await import("$lib/server/settings/defaults.js");
const { DELETE } = await import("./+server.js");
const globals = globalThis as any;

let settings: any;

function reset(): void {
  settings = structuredClone(defaultRuntimeSettings);
  settings.agents = [
    { id: "default", name: "Momo", description: "", enabled: true },
    { id: "writer", name: "Writer", description: "", enabled: true }
  ];
  settings.deletedAgentIds = [];
  settings.pendingAgentDeletions = [];
  settings.channels = {
    ...settings.channels,
    telegram: {
      instances: [
        { id: "personal", name: "Personal", enabled: true, agentId: "writer", credentials: {}, allowedChatIds: [] }
      ]
    }
  };
  globals.__molibotRuntime = {
    getSettings: () => settings,
    updateSettings: (patch: any) => { settings = { ...settings, ...patch }; return settings; },
    sessions: {},
    sessionLifecycle: { listAgentHistory: () => [], archiveAgentHistory: () => [] }
  };
}

async function remove(id: string): Promise<{ status: number; payload: any }> {
  const response = await DELETE({ url: new URL(`http://isolated.invalid/api/desktop/agents?id=${id}`) } as any);
  return { status: response.status, payload: await response.json() };
}

test.beforeEach(reset);
test.after(() => {
  delete globals.__molibotRuntime;
  rmSync(dataDir, { recursive: true, force: true });
});

test("deleting a channel-bound Agent returns the structured blocker instead of a string", async () => {
  const blocked = await remove("writer");
  assert.equal(blocked.status, 400);
  assert.deepEqual(blocked.payload.blockers, [{ kind: "channel", channel: "telegram", instanceId: "personal" }]);
  assert.equal(settings.agents.some((agent: any) => agent.id === "writer"), true, "a blocked delete must not change settings");
  assert.deepEqual(settings.pendingAgentDeletions, []);
});

test("deleting an unknown Agent is a plain error with no blockers", async () => {
  const missing = await remove("ghost");
  assert.equal(missing.status, 400);
  assert.equal(missing.payload.blockers, undefined);
  assert.match(missing.payload.error, /Agent not found/);
});
