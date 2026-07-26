import test from "node:test";
import assert from "node:assert/strict";
import { classifyHostBashCommand } from "$lib/server/hostBash/commandClassifier.js";

test("classifies longbridge piped to head as persistent capability plus safe helper", () => {
  const result = classifyHostBashCommand("longbridge news FIG.US 2>&1 | head -30");

  assert.equal(result.kind, "persistent-capability");
  assert.equal(result.capability.toolId, "longbridge");
  assert.deepEqual(result.capability.argv, ["news", "FIG.US"]);
  assert.deepEqual(result.safeGlue.map((item) => item.token), ["2>&1", "|"]);
  assert.deepEqual(result.safeHelpers.map((item) => item.originalSegment), ["head -30"]);
});

test("classifies repeated agent-browser chain as compound capabilities for one tool id", () => {
  const result = classifyHostBashCommand("agent-browser open https://example.com && sleep 3 && agent-browser wait --load networkidle && agent-browser close");

  assert.equal(result.kind, "compound-capabilities");
  assert.deepEqual([...new Set(result.capabilities.map((item) => item.toolId))], ["agent-browser"]);
  assert.deepEqual(result.safeHelpers.map((item) => item.originalSegment), ["sleep 3"]);
  assert.equal(result.capabilities.length, 3);
});

test("classifies quoted URL query as agent-browser capability without glob downgrade", () => {
  const result = classifyHostBashCommand('agent-browser open "https://www.google.com/search?q=2026+FIFA+World+Cup+stand+date"');

  assert.equal(result.kind, "persistent-capability");
  assert.equal(result.capability.toolId, "agent-browser");
  assert.deepEqual(result.capability.argv, ["open", "https://www.google.com/search?q=2026+FIFA+World+Cup+stand+date"]);
});

test("keeps unquoted glob tokens as one-time script", () => {
  const result = classifyHostBashCommand("echo *.ts");

  assert.equal(result.kind, "one-time-script");
  assert.match(result.reason, /glob/i);
});

test("classifies cd and echo wrappers around agent-browser as safe helpers", () => {
  const result = classifyHostBashCommand('cd /tmp && agent-browser open "https://x.test/a?b=1" && echo DONE');

  assert.equal(result.kind, "persistent-capability");
  assert.equal(result.capability.toolId, "agent-browser");
  assert.deepEqual(result.safeHelpers.map((item) => item.originalSegment), ["cd /tmp", "echo DONE"]);
  assert.deepEqual(result.safeGlue.map((item) => item.token), ["&&", "&&"]);
});

test("does not treat dynamic cd path as safe helper", () => {
  const result = classifyHostBashCommand('cd "$HOME" && agent-browser close');

  // `cd` is helper-only: it may never fall through to a capability, or the
  // argument check that rejects a dynamic path would stop being the gate.
  assert.equal(result.kind, "one-time-script");
  assert.match(result.reason, /cd/i);
});

test("classifies script with stderr merge as persistent capability", () => {
  const result = classifyHostBashCommand("skills/web-search/scripts/baidu_fast_search.sh '{\"query\":\"robotics\",\"max_results\":5}' 2>&1");

  assert.equal(result.kind, "persistent-capability");
  assert.equal(result.capability.executable, "skills/web-search/scripts/baidu_fast_search.sh");
  assert.equal(result.capability.toolId, "skills-web-search-scripts-baidu_fast_search.sh");
  assert.deepEqual(result.safeGlue.map((item) => item.token), ["2>&1"]);
});

test("degrades tee output write to one-time script", () => {
  const result = classifyHostBashCommand("longbridge quote FIG.US | tee quote.txt");

  assert.equal(result.kind, "one-time-script");
  assert.match(result.reason, /tee/i);
});

test("degrades command substitution to one-time script", () => {
  const result = classifyHostBashCommand("longbridge quote $(cat ticker.txt)");

  assert.equal(result.kind, "one-time-script");
  assert.match(result.reason, /command substitution/i);
});

test("degrades file output redirection to one-time script", () => {
  const result = classifyHostBashCommand("longbridge quote FIG.US > out.txt");

  assert.equal(result.kind, "one-time-script");
  assert.match(result.reason, /operator|redirect/i);
});

test("does not treat helper file arguments as safe", () => {
  const result = classifyHostBashCommand("longbridge quote FIG.US | head /etc/passwd");

  // `head` reading an arbitrary file must not ride along on the longbridge
  // grant. It stops being a safe helper and has to earn its own capability —
  // which is a real gate, unlike the one-time script this used to produce
  // (one-time grants nothing yet still executes once approved).
  assert.equal(result.kind, "compound-capabilities");
  assert.deepEqual(result.capabilities.map((item) => item.toolId), ["longbridge", "head"]);
  assert.equal(result.safeHelpers.length, 0);
});

test("a strict helper outside its restricted form becomes its own capability, not a one-time script", () => {
  // Regression: these were `unsupported`, so the whole command degraded to a
  // one-time script that could never graduate to a reusable grant — while
  // `rm -rf build` sailed through as a persistent capability.
  for (const command of ["grep -rn foo src", "echo 'a long status message'", "sort -u names.txt"]) {
    const result = classifyHostBashCommand(command);
    assert.equal(result.kind, "persistent-capability", command);
    assert.equal(result.capability.toolId, command.split(" ")[0], command);
  }
});

test("a parameterised URL keeps its capability whether or not the model quoted it", () => {
  const quoted = classifyHostBashCommand("curl -s 'https://api.test/v1?page=2'");
  const bare = classifyHostBashCommand("curl -s https://api.test/v1?page=2");

  assert.equal(quoted.kind, "persistent-capability");
  assert.equal(bare.kind, "persistent-capability");
  assert.equal(bare.capability.toolId, "curl");
  // Identity is the executable, so differing arguments reuse one grant.
  assert.equal(bare.capability.toolId, quoted.capability.toolId);
});

test("a real path glob is still a one-time script", () => {
  const result = classifyHostBashCommand("ls src/*.ts");

  assert.equal(result.kind, "one-time-script");
  assert.match(result.reason, /glob/i);
});

test("command substitution inside double quotes is rejected like the bare form", () => {
  for (const command of [
    'curl -s "https://api.test/?q=$(whoami)"',
    'curl -s "https://api.test/?q=`whoami`"'
  ]) {
    const result = classifyHostBashCommand(command);
    assert.equal(result.kind, "one-time-script", command);
    assert.match(result.reason, /command substitution/i);
  }

  // Single quotes are literal in bash, so they carry no substitution risk.
  assert.equal(classifyHostBashCommand("curl -s 'https://api.test/?q=$(whoami)'").kind, "persistent-capability");
});

test("degrades env assignment prefix to one-time script", () => {
  const result = classifyHostBashCommand("LONGBRIDGE_DEBUG=1 longbridge quote FIG.US");

  assert.equal(result.kind, "one-time-script");
  assert.match(result.reason, /environment assignment/i);
});
