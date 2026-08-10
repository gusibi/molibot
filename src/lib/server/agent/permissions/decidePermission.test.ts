import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PERMISSION_MODE,
  PERMISSION_MODES,
  decidePermission,
  type Containment,
  type PermissionMode
} from "$lib/server/agent/permissions/decidePermission.js";
import type { ToolEffect } from "$lib/server/agent/tools/toolClassification.js";

/**
 * PRD acceptance §1: the full matrix, asserted cell by cell rather than
 * through the implementation's own logic. Writing the table out is the point —
 * a test that recomputes the decision would pass against any bug the
 * implementation has.
 */

const EFFECTS: ToolEffect[] = ["read", "write", "execute", "network", "installed_app", "third_party", "manage"];

type Row = { effect: ToolEffect; containment: Containment; hint?: "read_only" | "destructive" | "undeclared" };

const CASES: Array<Row & { plan: string; manual: string; accept_edits: string; auto: string }> = [
  // effect            containment                            plan     manual  accept   auto
  { effect: "read", containment: "not_applicable", plan: "allow", manual: "allow", accept_edits: "allow", auto: "allow" },

  { effect: "write", containment: "in_allowed_root", plan: "deny", manual: "ask", accept_edits: "allow", auto: "allow" },
  { effect: "write", containment: "outside_allowed_root", plan: "deny", manual: "ask", accept_edits: "ask", auto: "ask" },

  { effect: "execute", containment: "sandboxed", plan: "deny", manual: "ask", accept_edits: "allow", auto: "allow" },
  { effect: "execute", containment: "host", plan: "deny", manual: "ask", accept_edits: "ask", auto: "ask" },
  { effect: "execute", containment: "host_granted", plan: "deny", manual: "ask", accept_edits: "allow", auto: "allow" },

  { effect: "network", containment: "not_applicable", plan: "deny", manual: "ask", accept_edits: "allow", auto: "allow" },

  // An installed Mini App / pi extension: the owner already approved the
  // install through `manage`, so a non-destructive call is not asked about
  // again (decision 2026-08-10).
  { effect: "installed_app", containment: "not_applicable", hint: "undeclared", plan: "deny", manual: "ask", accept_edits: "allow", auto: "allow" },
  { effect: "installed_app", containment: "not_applicable", hint: "read_only", plan: "deny", manual: "ask", accept_edits: "allow", auto: "allow" },
  // ...but the app declaring "this one deletes things" is not covered by the
  // install grant.
  { effect: "installed_app", containment: "not_applicable", hint: "destructive", plan: "deny", manual: "ask", accept_edits: "ask", auto: "ask" },

  { effect: "third_party", containment: "not_applicable", hint: "read_only", plan: "deny", manual: "ask", accept_edits: "ask", auto: "allow" },
  { effect: "third_party", containment: "not_applicable", hint: "undeclared", plan: "deny", manual: "ask", accept_edits: "ask", auto: "ask" },
  { effect: "third_party", containment: "not_applicable", hint: "destructive", plan: "deny", manual: "ask", accept_edits: "ask", auto: "ask" },

  { effect: "manage", containment: "not_applicable", plan: "deny", manual: "ask", accept_edits: "ask", auto: "ask" }
];

test("decidePermission: the full mode x effect x containment matrix", () => {
  for (const row of CASES) {
    for (const mode of PERMISSION_MODES) {
      const expected = row[mode];
      const actual = decidePermission({
        mode,
        effect: row.effect,
        containment: row.containment,
        thirdPartyHint: row.hint
      });
      assert.equal(
        actual,
        expected,
        `${mode} / ${row.effect} / ${row.containment}${row.hint ? ` / ${row.hint}` : ""}: expected ${expected}, got ${actual}`
      );
    }
  }
});

test("manage asks in every mode, Auto included", () => {
  // Installing third-party code is never automatic: the request can come from
  // content the agent read rather than from the owner (pitfall 21d).
  for (const mode of PERMISSION_MODES) {
    const decision = decidePermission({ mode, effect: "manage", containment: "not_applicable" });
    assert.equal(decision, mode === "plan" ? "deny" : "ask", `manage must never auto-allow in ${mode}`);
  }
});

test("deny appears only in Plan", () => {
  for (const mode of PERMISSION_MODES) {
    if (mode === "plan") continue;
    for (const effect of EFFECTS) {
      for (const containment of ["sandboxed", "host", "host_granted", "in_allowed_root", "outside_allowed_root", "not_applicable"] as Containment[]) {
        const decision = decidePermission({ mode, effect, containment });
        assert.notEqual(decision, "deny", `${mode}/${effect}/${containment} must offer a way through, not deny`);
      }
    }
  }
});

test("Plan denies everything that is not a local read", () => {
  for (const effect of EFFECTS) {
    const decision = decidePermission({ mode: "plan", effect, containment: "not_applicable" });
    assert.equal(decision, effect === "read" ? "allow" : "deny", effect);
  }
});

test("an unavailable sandbox is host containment, and host never auto-allows", () => {
  // pitfall 15: enabled-sandbox failures must fail closed. The call site reports
  // `host` when the sandbox could not start, so this is the line that stops a
  // provider error from silently becoming "run it on the host".
  for (const mode of PERMISSION_MODES) {
    const decision = decidePermission({ mode, effect: "execute", containment: "host" });
    assert.notEqual(decision, "allow", `${mode} must not auto-allow an unsandboxed command`);
  }
});

test("Accept edits and Auto differ on exactly one thing", () => {
  // If these two modes ever agree on every row, one of them has no reason to
  // exist and the menu is lying to the user.
  const differing: string[] = [];
  for (const row of CASES) {
    if (row.accept_edits !== row.auto) {
      differing.push(`${row.effect}/${row.hint ?? row.containment}`);
    }
  }
  assert.deepEqual(
    differing,
    ["third_party/read_only"],
    "Accept edits and Auto must differ on exactly one row, or one of them has no reason to exist"
  );
});

test("an installed app is trusted more than an external MCP server", () => {
  // The distinction the matrix turns on: the owner installed one and merely
  // configured a connection to the other. Same hint, different answer.
  const installed = decidePermission({
    mode: "accept_edits", effect: "installed_app", containment: "not_applicable", thirdPartyHint: "undeclared"
  });
  const external = decidePermission({
    mode: "accept_edits", effect: "third_party", containment: "not_applicable", thirdPartyHint: "undeclared"
  });
  assert.equal(installed, "allow");
  assert.equal(external, "ask");
});

test("installing is still gated even though calling an installed app is not", () => {
  // Otherwise the trust would be circular: anything could install itself and
  // then run freely.
  for (const mode of ["manual", "accept_edits", "auto"] as const) {
    assert.equal(decidePermission({ mode, effect: "manage", containment: "not_applicable" }), "ask", mode);
  }
});

test("a declared readOnlyHint relaxes only Auto, and destructive always wins", () => {
  assert.equal(
    decidePermission({ mode: "auto", effect: "third_party", containment: "not_applicable", thirdPartyHint: "read_only" }),
    "allow"
  );
  assert.equal(
    decidePermission({ mode: "accept_edits", effect: "third_party", containment: "not_applicable", thirdPartyHint: "read_only" }),
    "ask",
    "the relaxation must not leak below Auto"
  );
  assert.equal(
    decidePermission({ mode: "auto", effect: "third_party", containment: "not_applicable", thirdPartyHint: "destructive" }),
    "ask"
  );
  // Absent annotation defaults to the safe value even when the field is omitted
  // entirely, not just when it is explicitly "undeclared".
  assert.equal(
    decidePermission({ mode: "auto", effect: "third_party", containment: "not_applicable" }),
    "ask",
    "a missing annotation is never read as read-only"
  );
});

test("the modes are monotone: nothing gets stricter as you move right", () => {
  // Plan ⊂ Manual ⊂ Accept edits ⊂ Auto. A later mode may never be stricter
  // than an earlier one for the same call, or the ordering shown in the UI
  // would be a lie.
  const rank = { deny: 0, ask: 1, allow: 2 } as const;
  const containments: Containment[] = ["sandboxed", "host", "host_granted", "in_allowed_root", "outside_allowed_root", "not_applicable"];
  for (const effect of EFFECTS) {
    for (const containment of containments) {
      for (const hint of ["read_only", "destructive", "undeclared"] as const) {
        let previous = -1;
        for (const mode of PERMISSION_MODES as PermissionMode[]) {
          const decision = decidePermission({ mode, effect, containment, thirdPartyHint: hint });
          assert.ok(
            rank[decision] >= previous,
            `${effect}/${containment}/${hint}: ${mode} is stricter than the mode before it`
          );
          previous = rank[decision];
        }
      }
    }
  }
});

test("the default mode is Accept edits", () => {
  assert.equal(DEFAULT_PERMISSION_MODE, "accept_edits");
  assert.ok(PERMISSION_MODES.includes(DEFAULT_PERMISSION_MODE));
});
