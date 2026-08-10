import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const baseRuntime = readFileSync(join(here, "baseRuntime.ts"), "utf8");

/**
 * Automation suspends instead of blocking on an approval.
 *
 * The runtime became *capable* of this when `onApprovalRequest` started being
 * consulted at every risk level; this asserts the channel layer actually asks
 * for it. Without the default, an unattended run waits in
 * `pollApprovalRequest` and holds its execution lease in `running` — which
 * `hasActiveForTask` reads as a live owner, suppressing every later run of the
 * task as `task_already_running` (CLAUDE.md pitfall 23).
 *
 * Asserted against the source rather than by driving a whole channel runtime:
 * the property is one wiring decision, and a test that stood up a runtime
 * would prove the mock's behaviour more than the product's.
 */

test("an automation run defaults to deferring an approval", () => {
  // The default is keyed on `event.isEvent` — the automation marker — so an
  // interactive turn is untouched.
  assert.match(
    baseRuntime,
    /onApprovalRequest:\s*options\.onApprovalRequest\s*\r?\n?\s*\?\?\s*\(event\.isEvent\s*\?\s*async\s*\(\)\s*=>\s*"defer"/,
    "automation must supply a deferring handler when the caller supplied none"
  );
});

test("a caller-supplied handler is never replaced by the default", () => {
  // The Durable attempt path supplies its own handler: it defers *and* records
  // the request as it passes. Overriding it would lose the recording.
  const index = baseRuntime.indexOf("onApprovalRequest: options.onApprovalRequest");
  assert.ok(index > 0, "the caller's handler must still come first");
  const wiring = baseRuntime.slice(index, index + 200);
  assert.match(wiring, /^onApprovalRequest: options\.onApprovalRequest\s*\r?\n?\s*\?\?/);
});

test("the deferring default is explained by the failure it prevents", () => {
  // This wiring looks like a one-line default and reads as arbitrary without
  // the reason; the comment is what stops a future edit from "simplifying" it
  // away. Checked structurally so the explanation cannot quietly vanish.
  const index = baseRuntime.indexOf('async () => "defer"');
  const preceding = baseRuntime.slice(Math.max(0, index - 900), index);
  assert.match(preceding, /lease/i, "the comment must name the lease it protects");
  assert.match(preceding, /task_already_running|pitfall 23/i, "and the suppression it prevents");
});

test("interactive turns are not given a deferring default", () => {
  // A person is present, so waiting for their answer is the correct behaviour:
  // deferring would end their turn with no reply and no card to act on.
  const index = baseRuntime.indexOf('async () => "defer"');
  const around = baseRuntime.slice(Math.max(0, index - 200), index + 80);
  assert.match(around, /event\.isEvent\s*\?/, "the default must be gated on the automation marker");
});
