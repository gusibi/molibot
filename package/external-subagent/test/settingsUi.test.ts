import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "ui", "index.html"), "utf8");

test("custom settings UI follows host theme and reports content height", () => {
  assert.match(source, /data\.theme === "dark"/);
  assert.match(source, /ResizeObserver/);
  assert.match(source, /molibot:plugin:resize/);
});

test("provider enablement stays off until the matching environment check passes", () => {
  assert.match(source, /availability/);
  assert.match(source, /setProviderAvailable/);
  assert.match(source, /checkbox\.disabled\s*=\s*!available/);
  assert.match(source, /await Promise\.all\(\[runAction\("codex","detectEnvironment"\),\s*runAction\("claude-code","detectEnvironment"\)\]\)/);
});

test("runtime installation failures are surfaced instead of being reported as installed", () => {
  assert.match(source, /result\s*&&\s*result\.success/);
  assert.match(source, /throw new Error\(\(result\s*&&\s*result\.error\)/);
});
