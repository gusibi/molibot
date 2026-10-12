import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadPiExtensionsInProcess } from "$lib/server/plugins/piExtensions/processClient.js";
import { buildPiExtensionRuntimeSnapshot } from "$lib/server/plugins/piExtensions/runtimeSnapshot.js";

const FIXTURE = `import { Type } from "@sinclair/typebox";
export default function reader(pi: any) {
  pi.registerTool({
    name: "read_session",
    label: "Read session",
    description: "reads the session snapshot",
    parameters: Type.Object({}),
    async execute(_id: string, _params: unknown, _signal: AbortSignal, _onUpdate: unknown, ctx: any) {
      const sm = ctx.sessionManager;
      const entries = sm.getEntries();
      const second = entries[1] && entries[1].id;
      return { content: [{ type: "text", text: JSON.stringify({
        id: sm.getSessionId(),
        cwd: sm.getCwd(),
        file: sm.getSessionFile(),
        dir: sm.getSessionDir(),
        name: sm.getSessionName(),
        header: sm.getHeader(),
        leafId: sm.getLeafId(),
        leafEntry: sm.getLeafEntry(),
        entries,
        branchFromSecond: sm.getBranch(second),
        second: sm.getEntry("2"),
        label: sm.getLabel("2"),
        tree: sm.getTree(),
        projection: sm.buildSessionProjection()
      }) }], details: {} };
    }
  });
}
`;

async function withFixture<T>(run: (client: NonNullable<Awaited<ReturnType<typeof loadPiExtensionsInProcess>>["client"]>, dataDir: string) => Promise<T>): Promise<T> {
  const dataDir = mkdtempSync(join(tmpdir(), "molibot-pi-ext-session-"));
  mkdirSync(join(dataDir, "extensions", "reader"), { recursive: true });
  writeFileSync(join(dataDir, "extensions", "reader", "index.ts"), FIXTURE, "utf8");
  const result = await loadPiExtensionsInProcess({ cwd: dataDir, agentDir: dataDir });
  try {
    assert.ok(result.client, "the worker client should exist");
    return await run(result.client, dataDir);
  } finally {
    result.client?.dispose();
    rmSync(dataDir, { recursive: true, force: true });
  }
}

test("ctx.sessionManager reads identity, entries, branch and projection from the native snapshot", async () => {
  await withFixture(async (client, dataDir) => {
    const snapshot = buildPiExtensionRuntimeSnapshot({
      cwd: "/work",
      isIdle: false,
      model: { provider: "openai", id: "gpt", api: "openai" },
      thinkingLevel: "high",
      session: {
        id: "s-1",
        cwd: "/work",
        file: "/data/pi/s-1/conv.db",
        dir: "/data/pi/s-1",
        entries: [
          { id: "1", kind: "molibot.runner-binding", messages: [] },
          { id: "2", kind: "message", messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] },
          { id: "3", kind: "message", messages: [{ role: "assistant", content: [{ type: "text", text: "yo" }] }] }
        ]
      }
    });
    const response = await client.request("invokeTool", {
      extensionId: "reader", toolName: "read_session", toolCallId: "call-1", params: {}, cwd: dataDir, runtime: snapshot
    });
    const payload = JSON.parse(response.value.content[0].text);

    assert.equal(payload.id, "s-1");
    assert.equal(payload.cwd, "/work");
    assert.equal(payload.file, "/data/pi/s-1/conv.db");
    assert.equal(payload.dir, "/data/pi/s-1");
    assert.deepEqual(payload.header, { type: "session", id: "s-1", cwd: "/work", timestamp: "" });
    assert.equal(payload.leafId, "3");
    assert.equal(payload.leafEntry.id, "3");
    assert.equal(payload.entries.length, 3);
    assert.equal(payload.entries[0].type, "custom");
    assert.equal(payload.entries[0].customType, "molibot.runner-binding");
    assert.equal(payload.entries[1].type, "message");
    assert.deepEqual(payload.entries[1].message, { role: "user", content: [{ type: "text", text: "hi" }] });
    assert.equal(payload.second.id, "2");
    assert.deepEqual(payload.branchFromSecond.map((entry: any) => entry.id), ["1", "2"]);
    assert.equal(payload.tree.length, 3);
    assert.deepEqual(payload.tree[0].children, []);
    assert.equal(payload.projection.messages.length, 2);
    assert.equal(payload.projection.thinkingLevel, "high");
    assert.deepEqual(payload.projection.model, { provider: "openai", modelId: "gpt" });
    assert.equal("name" in payload, false);
    assert.equal("label" in payload, false);
  });
});
