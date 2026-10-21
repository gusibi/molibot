import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "molibot-sessions-route-"));
process.env.DATA_DIR = dataDir;
const { defaultRuntimeSettings } = await import("$lib/server/settings/defaults.js");
const { POST } = await import("./+server.js");
const globals = globalThis as any;

let settings: any;
let created: Array<{ owner: string; agentId: string }> = [];

function reset(): void {
  settings = structuredClone(defaultRuntimeSettings);
  settings.agents = [
    ...settings.agents,
    { id: "researcher", name: "Researcher", description: "", enabled: true }
  ];
  settings.pendingAgentDeletions = [];
  created = [];
  globals.__molibotRuntime = {
    getSettings: () => settings,
    updateSettings: (patch: any) => { settings = { ...settings, ...patch }; return settings; },
    sessions: {
      getOrCreateEmptyWebConversation: (owner: string, agentId: string) => {
        created.push({ owner, agentId });
        return {
          conversation: {
            id: "s-1",
            agentId,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            title: ""
          },
          reused: false
        };
      }
    }
  };
}

async function post(body: unknown): Promise<{ status: number; payload: any }> {
  const response = await POST({
    request: new Request("http://isolated.invalid/api/sessions", { method: "POST", body: JSON.stringify(body) })
  } as any);
  return { status: response.status, payload: await response.json() };
}

test.beforeEach(reset);
test.after(() => {
  delete globals.__molibotRuntime;
  rmSync(dataDir, { recursive: true, force: true });
});

test("an empty Bot binding creates the draft under Momo; an unknown profile is rejected", async () => {
  const momo = await post({ profileId: "default" });
  assert.equal(momo.status, 200);
  assert.deepEqual(created.at(-1), { owner: "web:default:web-anonymous", agentId: "default" });

  const unknown = await post({ profileId: "no-such-profile" });
  assert.equal(unknown.status, 409);
  assert.match(unknown.payload.error, /Unknown Bot/);
  assert.equal(created.length, 1);
});

test("an asserted Agent wins over the binding, and disabled or deleting Agents are rejected", async () => {
  const asserted = await post({ profileId: "default", agentId: "researcher" });
  assert.equal(asserted.status, 200);
  assert.equal(created.at(-1)?.agentId, "researcher");

  settings.agents.find((agent: any) => agent.id === "researcher").enabled = false;
  const disabled = await post({ profileId: "default", agentId: "researcher" });
  assert.equal(disabled.status, 409);
  assert.match(disabled.payload.error, /disabled/);

  settings.agents.find((agent: any) => agent.id === "researcher").enabled = true;
  settings.pendingAgentDeletions = ["researcher"];
  const deleting = await post({ profileId: "default", agentId: "researcher" });
  assert.equal(deleting.status, 409);
  assert.match(deleting.payload.error, /being deleted/);
  assert.equal(created.length, 1);
});
