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

  assert.equal(result.kind, "one-time-script");
  assert.match(result.reason, /head/i);
});

test("degrades env assignment prefix to one-time script", () => {
  const result = classifyHostBashCommand("LONGBRIDGE_DEBUG=1 longbridge quote FIG.US");

  assert.equal(result.kind, "one-time-script");
  assert.match(result.reason, /environment assignment/i);
});
