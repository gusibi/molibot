import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decideBashToolPolicy, findFileToolRedirect, resolveBashContainment } from "$lib/server/agent/tools/bashPolicy.js";
import type { ToolDefinition } from "$lib/server/agent/tools/toolTypes.js";

test("bash policy redirects standalone file readers to the read tool", () => {
  assert.match(findFileToolRedirect("cat notes.md") ?? "", /read tool/);
  assert.match(findFileToolRedirect("head -n 20 data.csv") ?? "", /read tool/);
  assert.match(findFileToolRedirect("tail -100 app.log") ?? "", /read tool/);
});

test("bash policy redirects shell file writes to the write/edit tools", () => {
  assert.match(findFileToolRedirect("echo 'hello' > out.txt") ?? "", /write tool/);
  assert.match(findFileToolRedirect("printf 'a\\n' >> out.txt") ?? "", /write tool/);
  assert.match(findFileToolRedirect("cat > config.json") ?? "", /write tool/);
  assert.match(findFileToolRedirect("cat <<EOF > script.sh") ?? "", /write tool/);
  assert.match(findFileToolRedirect("echo data | tee out.txt") ?? "", /write tool/);
});

test("bash policy redirects in-place editors to the edit tool", () => {
  assert.match(findFileToolRedirect("sed -i '' 's/a/b/' file.txt") ?? "", /edit tool/);
  assert.match(findFileToolRedirect("perl -i -pe 's/a/b/' file.txt") ?? "", /edit tool/);
});

test("bash policy allows legitimate compound shell usage", () => {
  assert.equal(findFileToolRedirect("cat a.csv b.csv > merged.csv"), null);
  assert.equal(findFileToolRedirect("cat access.log | grep 500 | wc -l"), null);
  assert.equal(findFileToolRedirect("make 2>&1 | tee build.log"), null);
  assert.equal(findFileToolRedirect("sed 's/a/b/' file.txt | sort"), null);
  assert.equal(findFileToolRedirect("npm test"), null);
  assert.equal(findFileToolRedirect("python3 process.py --input data.csv"), null);
});

test("bash containment separates the sandbox axis from the ask axis", () => {
  // Slice 0 of the Permission Modes PRD: `sandboxEnabled` used to short-circuit
  // straight to `allow`, which collapsed "where does this run" and "should we
  // ask" into one boolean. The containment value keeps them apart so a mode can
  // be written against it without re-deriving the sandbox state.
  assert.equal(
    resolveBashContainment({ sandboxEnabled: true, hasApprovedHostGrant: false }),
    "sandboxed"
  );
  assert.equal(
    resolveBashContainment({ sandboxEnabled: false, hasApprovedHostGrant: false }),
    "host",
    "sandbox off means host containment - it must not read as 'allowed'"
  );
  // An approved Host Bash grant is what makes a host command routine, and it
  // outranks the sandbox flag: the grant is the thing the user consented to.
  assert.equal(
    resolveBashContainment({ sandboxEnabled: true, hasApprovedHostGrant: true }),
    "host_granted"
  );
  assert.equal(
    resolveBashContainment({ sandboxEnabled: false, hasApprovedHostGrant: true }),
    "host_granted"
  );
});

function bashTool(): ToolDefinition {
  return {
    id: "bash",
    name: "Bash",
    description: "",
    inputSchema: {},
    risk: "high",
    source: "host",
    effect: "execute",
    handler: async () => ({ ok: true, content: "" })
  };
}

// No standing grant: every decision below is the mode's, not a leftover approval.
const emptyStore = { getApprovedEntry: () => null, listApproved: () => [], list: () => [] } as never;
const request = () => ({ id: "req-bash-1" } as never);

function decide(mode: Parameters<typeof decideBashToolPolicy>[0]["permissionMode"], sandboxEnabled: boolean) {
  return decideBashToolPolicy({
    tool: bashTool(),
    input: { command: "npm test" },
    ctx: {} as never,
    sandboxEnabled,
    hostBashStore: emptyStore,
    permissionMode: mode,
    buildApprovalRequest: request
  });
}

test("Manual asks before a sandboxed command instead of running it", () => {
  // PRD acceptance §2. Without this, Manual silently did not apply to bash at
  // all — the one tool a user most expects it to cover.
  assert.equal(decide("manual", true).type, "approval_required");
});

test("Accept edits and Auto still run a sandboxed command directly", () => {
  assert.equal(decide("accept_edits", true).type, "allow");
  assert.equal(decide("auto", true).type, "allow");
});

test("a host command is left to the Host Bash conversation, never double-prompted", () => {
  // The bash handler blocks on the Host Bash store and executes inline once
  // approved. Returning `approval_required` here as well would make the user
  // approve the same command twice — the double prompt this branch has always
  // existed to prevent. It stays `allow` so that conversation can happen.
  for (const mode of ["manual", "accept_edits", "auto"] as const) {
    assert.equal(decide(mode, false).type, "allow", mode);
  }
});

test("Plan denies bash outright, in either containment", () => {
  assert.equal(decide("plan", true).type, "deny");
  assert.equal(decide("plan", false).type, "deny");
});

test("a caller that supplies no mode keeps the previous always-allow behaviour", () => {
  // Tightening a caller that predates modes would be a silent behaviour change
  // in code that never opted in.
  const decision = decideBashToolPolicy({
    tool: bashTool(),
    input: { command: "npm test" },
    ctx: {} as never,
    sandboxEnabled: true,
    hostBashStore: emptyStore
  });
  assert.equal(decision.type, "allow");
});

test("a shell file-reader is still redirected before any mode is consulted", () => {
  // The redirect is about *what this command is*, not about whether to ask, so
  // it must not become mode-dependent.
  const decision = decideBashToolPolicy({
    tool: bashTool(),
    input: { command: "cat notes.md" },
    ctx: {} as never,
    sandboxEnabled: true,
    hostBashStore: emptyStore,
    permissionMode: "auto",
    buildApprovalRequest: request
  });
  assert.equal(decision.type, "deny");
  assert.match((decision as { reason: string }).reason, /read tool/);
});
