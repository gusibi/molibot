import test from "node:test";
import assert from "node:assert/strict";
import { resolveWebDurableBotId } from "$lib/server/web/identity.js";

test("Durable Web requests use the requested manager when it exists", () => {
  const managers = new Map([["web", new Map([["default", {}], ["personal", {}]])]]);
  assert.equal(resolveWebDurableBotId("personal", managers), "personal");
});

test("virtual Web profiles use the default manager before falling back to the first manager", () => {
  const managers = new Map([["web", new Map([["default", {}], ["secondary", {}]])]]);
  assert.equal(resolveWebDurableBotId("personal", managers), "default");

  const withoutDefault = new Map([["web", new Map([["secondary", {}]])]]);
  assert.equal(resolveWebDurableBotId("personal", withoutDefault), "secondary");
});

test("Durable Web routing preserves the sanitized profile when no manager is available", () => {
  assert.equal(resolveWebDurableBotId("profile id", new Map()), "profileid");
});
