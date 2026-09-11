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
 * Unified execution-mode spec: the full matrix, asserted cell by cell rather
 * than through the implementation's own logic. Writing the table out is the
 * point — a test that recomputes the decision would pass against any bug the
 * implementation has.
 *
 * Auto is full access: it allows everything Molibot can gate. Accept edits is
 * the routine-project-work mode: project writes and sandboxed commands are
 * automatic, out-of-bounds / host / external effects ask.
 */

const EFFECTS: ToolEffect[] = ["read", "write", "execute", "network", "installed_app", "third_party", "manage"];

type Row = { effect: ToolEffect; containment: Containment; hint?: "read_only" | "destructive" | "undeclared" };

const CASES: Array<Row & { plan: string; manual: string; accept_edits: string; auto: string }> = [
  // effect            containment                            plan     manual  accept   auto
  { effect: "read", containment: "not_applicable", plan: "allow", manual: "allow", accept_edits: "allow", auto: "allow" },

  { effect: "write", containment: "in_allowed_root", plan: "deny", manual: "ask", accept_edits: "allow", auto: "allow" },
  { effect: "write", containment: "outside_allowed_root", plan: "deny", manual: "ask", accept_edits: "ask", auto: "allow" },

  { effect: "execute", containment: "sandboxed", plan: "deny", manual: "ask", accept_edits: "allow", auto: "allow" },
  { effect: "execute", containment: "host", plan: "deny", manual: "ask", accept_edits: "ask", auto: "allow" },
  { effect: "execute", containment: "host_granted", plan: "deny", manual: "ask", accept_edits: "allow", auto: "allow" },

  { effect: "network", containment: "not_applicable", plan: "deny", manual: "ask", accept_edits: "allow", auto: "allow" },

  // An installed Mini App / pi extension: the owner already approved the
  // install through `manage`, so a non-destructive call is not asked about
  // again. The app declaring "this one deletes things" is still asked about in
  // restricted modes; full access is the owner's standing approval.
  { effect: "installed_app", containment: "not_applicable", hint: "undeclared", plan: "deny", manual: "ask", accept_edits: "allow", auto: "allow" },
  { effect: "installed_app", containment: "not_applicable", hint: "read_only", plan: "deny", manual: "ask", accept_edits: "allow", auto: "allow" },
  { effect: "installed_app", containment: "not_applicable", hint: "destructive", plan: "deny", manual: "ask", accept_edits: "ask", auto: "allow" },

  { effect: "third_party", containment: "not_applicable", hint: "read_only", plan: "deny", manual: "ask", accept_edits: "ask", auto: "allow" },
  { effect: "third_party", containment: "not_applicable", hint: "undeclared", plan: "deny", manual: "ask", accept_edits: "ask", auto: "allow" },
  { effect: "third_party", containment: "not_applicable", hint: "destructive", plan: "deny", manual: "ask", accept_edits: "ask", auto: "allow" },

  { effect: "manage", containment: "not_applicable", plan: "deny", manual: "ask", accept_edits: "ask", auto: "allow" }
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

test("Auto never asks and never denies: full access is the product promise", () => {
  // A mode that still produced permission cards would be the old partial
  // automation under a new name. Availability, schema validation and
  // correctness checks are orthogonal and stay out of this matrix.
  for (const effect of EFFECTS) {
    for (const containment of ["sandboxed", "host", "host_granted", "in_allowed_root", "outside_allowed_root", "not_applicable"] as Containment[]) {
      for (const hint of ["read_only", "destructive", "undeclared"] as const) {
        const decision = decidePermission({ mode: "auto", effect, containment, thirdPartyHint: hint });
        assert.equal(decision, "allow", `auto/${effect}/${containment}/${hint} must allow`);
      }
    }
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

test("restricted modes never auto-allow an unsandboxed command", () => {
  // pitfall 15: enabled-sandbox failures must fail closed. The call site
  // reports `host` when the sandbox could not start, so restricted modes gate
  // it. Auto never consults the sandbox, so the failure mode cannot arise.
  for (const mode of ["manual", "accept_edits"] as const) {
    const decision = decidePermission({ mode, effect: "execute", containment: "host" });
    assert.notEqual(decision, "allow", `${mode} must not auto-allow an unsandboxed command`);
  }
});

test("Accept edits asks for every external effect, Auto allows them all", () => {
  // The reason both modes exist: Accept edits is project-scoped routine work;
  // Auto is the owner standing behind every effect the task produces.
  const externalRows = CASES.filter((row) =>
    row.effect === "third_party" || row.effect === "manage"
    || (row.effect === "write" && row.containment === "outside_allowed_root")
    || (row.effect === "execute" && row.containment === "host")
    || (row.effect === "installed_app" && row.hint === "destructive")
  );
  assert.ok(externalRows.length >= 6);
  for (const row of externalRows) {
    assert.equal(row.accept_edits, "ask", `accept_edits/${row.effect}`);
    assert.equal(row.auto, "allow", `auto/${row.effect}`);
  }
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

test("installing is gated in restricted modes", () => {
  // Otherwise the trust would be circular: anything could install itself and
  // then run freely. Only full access stands behind installs.
  for (const mode of ["manual", "accept_edits"] as const) {
    assert.equal(decidePermission({ mode, effect: "manage", containment: "not_applicable" }), "ask", mode);
  }
  assert.equal(decidePermission({ mode: "auto", effect: "manage", containment: "not_applicable" }), "allow");
});

test("a missing third-party annotation never reads as read-only in Accept edits", () => {
  assert.equal(
    decidePermission({ mode: "accept_edits", effect: "third_party", containment: "not_applicable", thirdPartyHint: "read_only" }),
    "ask"
  );
  assert.equal(
    decidePermission({ mode: "accept_edits", effect: "third_party", containment: "not_applicable" }),
    "ask"
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
