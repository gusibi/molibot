import assert from "node:assert/strict";
import test from "node:test";
import { defaultRuntimeSettings } from "$lib/server/settings/defaults.js";
import { normalizePiProviderId } from "$lib/server/settings/index.js";
import { sanitizeAiRoutingConfig, sanitizeSettings } from "$lib/server/settings/sanitize.js";
import type { RuntimeSettings } from "$lib/server/settings/schema.js";

test("normalizePiProviderId maps provider ids pi renamed", () => {
  // pi 1.0.3 renamed the Azure provider; settings written before that keep the old id.
  assert.equal(normalizePiProviderId("azure-openai-responses"), "azure");
  assert.equal(normalizePiProviderId("  azure-openai-responses  "), "azure");
  assert.equal(normalizePiProviderId("azure"), "azure");
  assert.equal(normalizePiProviderId("anthropic"), "anthropic");
  assert.equal(normalizePiProviderId(""), "");
});

test("sanitizeAiRoutingConfig accepts a legacy provider id and stores the current one", () => {
  const patch = sanitizeAiRoutingConfig({ piModelProvider: "azure-openai-responses" }, defaultRuntimeSettings);
  assert.equal(patch.piModelProvider, "azure");
});

test("sanitizeSettings migrates a stored legacy provider id instead of dropping it", () => {
  const legacy = { ...defaultRuntimeSettings, piModelProvider: "azure-openai-responses" } as unknown as RuntimeSettings;
  const sanitized = sanitizeSettings({}, legacy);
  assert.equal(sanitized.piModelProvider, "azure");
});
