import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AgentStorageMigration } from "./agentStorageMigration.js";

for (const binding of ["researcher", ""]) {
  test(`confirmed migration fixes history ownership for binding '${binding}' without rewriting sources`, async () => {
    const root = mkdtempSync(join(tmpdir(), "molibot-associate-migration-"));
    try {
      const dir = join(root, "moli-t/bots/personal/chat/contexts");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "old.json"), "[]\n");
      const ownership = { agents: ["default", "researcher"], bots: [{ channel: "telegram", botId: "personal", agentId: binding }] };
      const migration = new AgentStorageMigration(root, ownership);
      assert.equal(migration.status().needed, true);
      const plan = await migration.execute();
      const expected = binding || "default";
      assert.equal(plan.sessions[0].agentId, expected);
      assert.equal(readFileSync(join(dir, "old.json"), "utf8"), "[]\n");
      ownership.bots[0].agentId = "default";
      assert.equal(new AgentStorageMigration(root, ownership).status().needed, false);
      const meta = JSON.parse(readFileSync(join(root, "sessions", expected, "contexts/old.meta.json"), "utf8"));
      assert.equal(meta.agentId, expected);
      assert.deepEqual(meta.source, { channel: "telegram", botId: "personal", chatId: "chat", sessionId: "old" });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}
