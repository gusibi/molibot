import assert from "node:assert/strict";
import test from "node:test";
import { getPiModels, getPiProviders, isPiProvider } from "./piRegistry.js";

test("classifier-only providers stay out of chat settings while retaining classifier access", () => {
  assert.ok(getPiModels().getModelOfType("classifier", "typesafe", "jev-latest"));
  assert.ok(getPiProviders().every((provider) => provider.models.length > 0));
  assert.equal(getPiProviders().some((provider) => provider.id === "typesafe"), false);
  assert.equal(isPiProvider("typesafe"), false);
  assert.equal(isPiProvider("openai"), true);
  assert.equal(isPiProvider("unknown-provider"), false);
});
