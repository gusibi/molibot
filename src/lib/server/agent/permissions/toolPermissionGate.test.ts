import assert from "node:assert/strict";
import test from "node:test";
import {
  decideToolPermission,
  readToolTargetPath,
  resolveContainment
} from "$lib/server/agent/permissions/toolPermissionGate.js";

const ROOTS = ["/project", "/workspace/scratch"];

test("a write inside an allowed root is placed there", () => {
  const containment = resolveContainment(
    { toolId: "write", input: { path: "/project/src/a.ts" }, effect: "write" },
    { sandboxEnabled: true, allowedWriteRoots: ROOTS }
  );
  assert.equal(containment, "in_allowed_root");
});

test("a relative write resolves against cwd before it is placed", () => {
  assert.equal(
    resolveContainment(
      { toolId: "write", input: { path: "notes.md" }, effect: "write" },
      { sandboxEnabled: true, allowedWriteRoots: ROOTS, cwd: "/project" }
    ),
    "in_allowed_root"
  );
  assert.equal(
    resolveContainment(
      { toolId: "write", input: { path: "notes.md" }, effect: "write" },
      { sandboxEnabled: true, allowedWriteRoots: ROOTS, cwd: "/etc" }
    ),
    "outside_allowed_root"
  );
});

test("a write outside every root, or with no determinable target, is not auto-approved", () => {
  assert.equal(
    resolveContainment(
      { toolId: "write", input: { path: "/etc/passwd" }, effect: "write" },
      { sandboxEnabled: true, allowedWriteRoots: ROOTS }
    ),
    "outside_allowed_root"
  );
  // An unknown target is not evidence of safety. This is the difference between
  // "auto-approve" and "ask", so it defaults to the side that asks.
  assert.equal(
    resolveContainment(
      { toolId: "write", input: {}, effect: "write" },
      { sandboxEnabled: true, allowedWriteRoots: ROOTS }
    ),
    "outside_allowed_root"
  );
  // No configured roots means nothing can be judged inside one.
  assert.equal(
    resolveContainment(
      { toolId: "write", input: { path: "/project/a.ts" }, effect: "write" },
      { sandboxEnabled: true, allowedWriteRoots: [] }
    ),
    "outside_allowed_root"
  );
});

test("a path escaping a root via .. is outside it", () => {
  assert.equal(
    resolveContainment(
      { toolId: "write", input: { path: "/project/../etc/passwd" }, effect: "write" },
      { sandboxEnabled: true, allowedWriteRoots: ROOTS }
    ),
    "outside_allowed_root"
  );
});

test("execute containment follows the sandbox and any grant", () => {
  const facts = (over: Record<string, unknown>) => ({ sandboxEnabled: true, ...over });
  assert.equal(
    resolveContainment({ toolId: "bash", input: {}, effect: "execute" }, facts({})),
    "sandboxed"
  );
  assert.equal(
    resolveContainment({ toolId: "bash", input: {}, effect: "execute" }, facts({ sandboxEnabled: false })),
    "host"
  );
  assert.equal(
    resolveContainment({ toolId: "bash", input: {}, effect: "execute" }, facts({ hasApprovedHostGrant: true })),
    "host_granted"
  );
});

test("effects with no containment axis say so", () => {
  for (const effect of ["read", "network", "third_party", "manage"] as const) {
    assert.equal(
      resolveContainment({ toolId: "x", input: {}, effect }, { sandboxEnabled: true }),
      "not_applicable",
      effect
    );
  }
});

test("readToolTargetPath accepts both spellings and ignores junk", () => {
  assert.equal(readToolTargetPath({ path: "a.ts" }), "a.ts");
  assert.equal(readToolTargetPath({ file_path: "b.ts" }), "b.ts");
  assert.equal(readToolTargetPath({ path: "   " }), undefined);
  assert.equal(readToolTargetPath({ path: 42 }), undefined);
  assert.equal(readToolTargetPath(null), undefined);
  assert.equal(readToolTargetPath("nope"), undefined);
});

test("the gate classifies by tool id when the definition does not declare an effect", () => {
  // A tool registered before the dimension existed still gets gated correctly,
  // rather than falling through to whatever the default happens to be.
  const result = decideToolPermission("manual", { toolId: "bash", input: { command: "ls" } }, { sandboxEnabled: true });
  assert.equal(result.effect, "execute");
  assert.equal(result.decision, "ask");
});

test("a declared effect is never second-guessed by the tool name", () => {
  // A Mini App tool whose manifest says read-only must keep that classification;
  // re-deriving it from the id is exactly the name-guessing that
  // getRuntimeToolClassification exists to prevent.
  const result = decideToolPermission(
    "auto",
    { toolId: "miniapp__notes__add", input: {}, effect: "installed_app", thirdPartyHint: "read_only" },
    { sandboxEnabled: true }
  );
  assert.equal(result.decision, "allow");

  const destructive = decideToolPermission(
    "auto",
    { toolId: "miniapp__notes__add", input: {}, effect: "installed_app", thirdPartyHint: "destructive" },
    { sandboxEnabled: true }
  );
  assert.equal(destructive.decision, "ask");
});

test("Accept edits auto-approves a project write but still asks outside it", () => {
  const inside = decideToolPermission(
    "accept_edits",
    { toolId: "write", input: { path: "/project/a.ts" } },
    { sandboxEnabled: true, allowedWriteRoots: ROOTS }
  );
  assert.equal(inside.decision, "allow");

  const outside = decideToolPermission(
    "accept_edits",
    { toolId: "write", input: { path: "/etc/hosts" } },
    { sandboxEnabled: true, allowedWriteRoots: ROOTS }
  );
  assert.equal(outside.decision, "ask");
});

test("turning the sandbox off does not become a Bypass mode", () => {
  // The regression this whole slice exists to prevent: `bashPolicy` used to
  // return `allow` the moment the sandbox was off, so "no sandbox" silently
  // meant "never ask" — the Bypass档 the PRD refuses to ship.
  const result = decideToolPermission(
    "manual",
    { toolId: "bash", input: { command: "rm -rf /" } },
    { sandboxEnabled: false }
  );
  assert.equal(result.containment, "host");
  assert.equal(result.decision, "ask");

  // ...and it does not become allow in the loosest mode either.
  assert.equal(
    decideToolPermission("auto", { toolId: "bash", input: {} }, { sandboxEnabled: false }).decision,
    "ask"
  );
});

test("Plan denies the tools it must never run", () => {
  for (const toolId of ["write", "edit", "bash"]) {
    assert.equal(
      decideToolPermission("plan", { toolId, input: { path: "/project/a.ts" } }, {
        sandboxEnabled: true,
        allowedWriteRoots: ROOTS
      }).decision,
      "deny",
      toolId
    );
  }
  assert.equal(
    decideToolPermission("plan", { toolId: "read", input: {} }, { sandboxEnabled: true }).decision,
    "allow"
  );
});

test("an installed Mini App runs without a card in the default mode", () => {
  // The interruption this distinction exists to prevent: three installed apps
  // would otherwise put an approval card in front of every note and expense.
  const result = decideToolPermission(
    "accept_edits",
    { toolId: "miniapp__todo__add", input: {} },
    { sandboxEnabled: true }
  );
  assert.equal(result.effect, "installed_app");
  assert.equal(result.decision, "allow");

  // An external MCP call in the same mode still asks.
  assert.equal(
    decideToolPermission("accept_edits", { toolId: "mcp__srv__query", input: {} }, { sandboxEnabled: true }).decision,
    "ask"
  );
});

test("installing code asks in every mode", () => {
  for (const mode of ["manual", "accept_edits", "auto"] as const) {
    assert.equal(
      decideToolPermission(mode, { toolId: "miniAppManage", input: { action: "install" } }, { sandboxEnabled: true }).decision,
      "ask",
      mode
    );
  }
});
