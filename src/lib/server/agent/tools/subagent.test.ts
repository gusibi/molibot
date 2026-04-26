import assert from "node:assert/strict";
import test from "node:test";
import { defaultRuntimeSettings } from "../../settings/defaults.js";
import { isSafeReadOnlySubagentCommand } from "./subagent.js";

test("read-only subagent bash rejects shell control operators", () => {
  assert.equal(isSafeReadOnlySubagentCommand("git diff -- src/lib/server/agent/runner.ts"), true);
  assert.equal(isSafeReadOnlySubagentCommand("rg subagent src/lib/server"), true);
  assert.equal(isSafeReadOnlySubagentCommand("git diff && rm -rf src"), false);
  assert.equal(isSafeReadOnlySubagentCommand("rg subagent src/lib/server; git checkout -- ."), false);
});

test("subagent tool uses per-agent model hint in checked-in agent configs", async () => {
  const registryModule = await import("./subagent.js");
  const settings = {
    ...defaultRuntimeSettings,
    piModelProvider: "openai",
    piModelName: "gpt-4.1-mini"
  };

  const hinted = (registryModule as unknown as {
    resolveSubagentModelHint: (modelHint: string | undefined, settings: typeof settings) =>
      | { mode: "pi" | "custom"; provider: string; model: string }
      | null;
  }).resolveSubagentModelHint("claude-sonnet-4-5", settings);

  assert.deepEqual(hinted, {
    mode: "pi",
    provider: "anthropic",
    model: "claude-sonnet-4-5"
  });
});
