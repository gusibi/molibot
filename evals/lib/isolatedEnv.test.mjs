import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { isolatedDataEnv } from "./isolatedEnv.mjs";

test("every managed data path in a child belongs to its temporary root", () => {
  const root = join(tmpdir(), "molibot-isolated-env");
  const previous = { DATA_DIR: "old-data", DB_DIR: "old-db", PI_CODING_AGENT_DIR: "old-agent", KEEP: "unchanged" };
  const env = isolatedDataEnv(root, previous);
  assert.equal(env.KEEP, "unchanged");
  for (const name of ["DATA_DIR", "DB_DIR", "SETTINGS_DB_FILE", "SETTINGS_FILE", "WEB_WORKSPACE_DIR", "SESSIONS_DIR", "SESSIONS_INDEX_FILE", "PI_CODING_AGENT_DIR"]) assert.ok(env[name] === root || env[name].startsWith(root + "/"), name);
  assert.deepEqual(previous, { DATA_DIR: "old-data", DB_DIR: "old-db", PI_CODING_AGENT_DIR: "old-agent", KEEP: "unchanged" });
});
