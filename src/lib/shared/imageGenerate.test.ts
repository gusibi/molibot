import assert from "node:assert/strict";
import test from "node:test";
import { selectImageEngine } from "./imageGenerate.js";

test("automatic image selection can choose Pi without a duplicate credential", () => {
  const engines = [{ id: "pi", credentialSource: "provider" as const, enabled: true, hasCredentials: false }, { id: "openai", enabled: true, hasCredentials: true }];
  assert.equal(selectImageEngine("auto", "pi", engines), "pi");
  assert.equal(selectImageEngine("auto", "auto", engines), "openai");
  assert.equal(selectImageEngine("auto", "auto", [engines[0]]), "pi");
  assert.equal(selectImageEngine("pi", "auto", [{ ...engines[0], enabled: false }]), undefined);
});
