import assert from "node:assert/strict";
import test from "node:test";
import { buildSkillSearchSettings } from "$lib/server/skills/searchSettings.js";
import { flattenSkillFrontmatter } from "$lib/server/skills/frontmatterView.js";
import type { RuntimeSettings } from "$lib/server/settings/schema";

test("skill search update preserves server-owned API fields and validates provider models", () => {
  const settings = {
    skillSearch: {
      local: { enabled: false },
      api: {
        enabled: false,
        provider: "",
        model: "",
        baseUrl: "kept",
        apiKey: "secret",
        path: "/v1/chat/completions",
        maxTokens: 400,
        temperature: 0,
        timeoutMs: 8000,
        minConfidence: 0.6
      }
    },
    customProviders: [{ id: "custom:test", name: "Test", enabled: true, defaultModel: "m1", models: [{ id: "m1" }] }]
  } as RuntimeSettings;

  const updated = buildSkillSearchSettings(settings, {
    localEnabled: true,
    apiEnabled: true,
    apiProvider: "custom:test",
    apiModel: "m1",
    maxTokens: 900,
    temperature: 0.3,
    timeoutMs: 5000,
    minConfidence: 0.7
  });

  assert.equal(updated.local.enabled, true);
  assert.equal(updated.api.enabled, true);
  assert.equal(updated.api.baseUrl, "kept");
  assert.equal(updated.api.apiKey, "secret");
  assert.equal(updated.api.maxTokens, 900);

  assert.throws(
    () => buildSkillSearchSettings(settings, {
      localEnabled: true,
      apiEnabled: true,
      apiProvider: "custom:test",
      apiModel: "missing",
      maxTokens: 900,
      temperature: 0.3,
      timeoutMs: 5000,
      minConfidence: 0.7
    }),
    /Select an enabled Provider and model/
  );
});

test("frontmatter display expands nested maps to dotted keys and keeps scalars", () => {
  const rows = flattenSkillFrontmatter({
    name: "pdf",
    description: "Work with PDFs",
    metadata: JSON.stringify({ openclaw: { emoji: "📄" } }),
    aliases: JSON.stringify(["doc", "paper"])
  });

  assert.deepEqual(rows, [
    { key: "name", value: "pdf" },
    { key: "description", value: "Work with PDFs" },
    { key: "metadata.openclaw.emoji", value: "📄" },
    { key: "aliases", value: "doc, paper" }
  ]);
});

test("skill search exposes endpoint fields without ever clearing a stored key by omission", () => {
  const settings = {
    skillSearch: {
      local: { enabled: false },
      api: {
        enabled: true,
        provider: "custom:test",
        model: "m1",
        baseUrl: "https://old",
        apiKey: "secret",
        path: "/v1/chat/completions",
        maxTokens: 400,
        temperature: 0,
        timeoutMs: 8000,
        minConfidence: 0.6
      }
    },
    customProviders: [{ id: "custom:test", name: "Test", enabled: true, defaultModel: "m1", models: [{ id: "m1" }] }]
  } as RuntimeSettings;
  const base = {
    localEnabled: true,
    apiEnabled: true,
    apiProvider: "custom:test",
    apiModel: "m1",
    maxTokens: 400,
    temperature: 0,
    timeoutMs: 8000,
    minConfidence: 0.6
  };

  const updated = buildSkillSearchSettings(settings, {
    ...base,
    apiBaseUrl: "https://new",
    apiPath: "/chat",
    apiKey: "rotated"
  });
  assert.equal(updated.api.baseUrl, "https://new");
  assert.equal(updated.api.path, "/chat");
  assert.equal(updated.api.apiKey, "rotated");

  // Leaving the masked field blank keeps the stored secret; an explicit base
  // URL clear is still honoured.
  const kept = buildSkillSearchSettings(settings, { ...base, apiBaseUrl: "", apiKey: "" });
  assert.equal(kept.api.baseUrl, "");
  assert.equal(kept.api.apiKey, "secret");
  assert.equal(kept.api.path, "/v1/chat/completions");
});
