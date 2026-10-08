// Test prelude: must be the first import of a test file so `env.ts` resolves
// `DATA_DIR` to a disposable directory. Service ownership, sqlite paths and
// the pi agent dir all derive from it at module load, before any test body
// runs; without this, a native-delegation test contends with a live service's
// lease on the real data directory (and reads it at all).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDir = mkdtempSync(join(tmpdir(), "molibot-tools-test-"));
process.env.DATA_DIR = dataDir;
process.once("exit", () => {
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});
