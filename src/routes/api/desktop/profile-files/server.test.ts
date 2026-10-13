import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import { getGlobalProfileDir } from "$lib/server/agent/prompts/profiles.js";
import { GET, PUT } from "./+server.js";

test("the native profile endpoint reads and saves shared rules without replacing other profile files", async () => {
  const directory = mkdtempSync(join(tmpdir(), "native-shared-rules-")); const original = storagePaths.dataDir;
  try {
    storagePaths.dataDir = directory; const global = getGlobalProfileDir(); mkdirSync(global, { recursive: true });
    writeFileSync(join(global, "AGENTS.md"), "original rules"); writeFileSync(join(global, "USER.md"), "owner profile");
    const url = new URL("http://localhost/api/desktop/profile-files?scope=global");
    const initial = await GET({ url } as any); assert.equal(initial.status, 200); assert.equal((await initial.json()).files["AGENTS.md"], "original rules");
    const saved = await PUT({ request: new Request(url, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ scope: "global", files: { "AGENTS.md": "# AGENTS.md\n\nupdated rules" } }) }) } as any);
    assert.equal(saved.status, 200); assert.equal((await saved.json()).files["AGENTS.md"], "# AGENTS.md\n\nupdated rules");
    assert.equal(readFileSync(join(global, "USER.md"), "utf8"), "owner profile");
    assert.equal((await (await GET({ url } as any)).json()).files["AGENTS.md"], "# AGENTS.md\n\nupdated rules");
  } finally { storagePaths.dataDir = original; rmSync(directory, { recursive: true, force: true }); }
});
