import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDesktopSkillSearchSettings,
  buildDesktopSkillItem,
  buildDesktopSkillsSummary,
  resolveDesktopSkillPath
} from "./desktopSkills";
import type { RuntimeSettings } from "$lib/server/settings/schema";

function item(overrides: Record<string, unknown> = {}) {
  return {
    name: "pdf",
    description: "Work with PDF files",
    scope: "global",
    enabled: true,
    mcpServers: ["fs", "remote"],
    // Path-bearing fields the mapper must drop:
    filePath: "/Users/secret/.molibot/skills/pdf/SKILL.md",
    baseDir: "/Users/secret/.molibot/skills/pdf",
    ...overrides
  };
}

test("buildDesktopSkillItem drops filePath/baseDir and reduces mcpServers to a count", () => {
  const desktop = buildDesktopSkillItem(item());

  assert.equal(desktop.name, "pdf");
  assert.equal(desktop.scope, "global");
  assert.equal(desktop.enabled, true);
  assert.equal(desktop.mcpServerCount, 2);
  assert.match(desktop.id, /^[a-f0-9]{16}$/);

  const serialized = JSON.stringify(desktop);
  assert.equal(serialized.includes("/Users/secret"), false);
  assert.equal(serialized.includes("filePath"), false);
  assert.equal(serialized.includes("baseDir"), false);
});

test("opaque skill ids resolve server-side without exposing paths", () => {
  const source = item();
  const id = buildDesktopSkillItem(source).id;
  assert.equal(resolveDesktopSkillPath({ items: [source] }, id), source.filePath);
  assert.throws(() => resolveDesktopSkillPath({ items: [source] }, "missing"), /Unknown skill/);
});

test("skill search update preserves server-owned API fields and validates provider models", () => {
  const settings = {
    skillSearch: { local: { enabled: false }, api: { enabled: false, provider: "", model: "", baseUrl: "kept", apiKey: "secret", path: "/v1/chat/completions", maxTokens: 400, temperature: 0, timeoutMs: 8000, minConfidence: 0.6 } },
    customProviders: [{ id: "custom:test", name: "Test", enabled: true, defaultModel: "m1", models: [{ id: "m1" }] }]
  } as RuntimeSettings;
  const updated = buildDesktopSkillSearchSettings(settings, { kind: "search", localEnabled: true, apiEnabled: true, apiProvider: "custom:test", apiModel: "m1", maxTokens: 900, temperature: 0.3, timeoutMs: 5000, minConfidence: 0.7 });
  assert.equal(updated.api.apiKey, "secret");
  assert.equal(updated.api.baseUrl, "kept");
  assert.equal(updated.api.maxTokens, 900);
  assert.throws(() => buildDesktopSkillSearchSettings(settings, { kind: "search", localEnabled: true, apiEnabled: true, apiProvider: "custom:test", apiModel: "missing", maxTokens: 400, temperature: 0, timeoutMs: 8000, minConfidence: 0.6 }), /Select an enabled Provider/);
});

test("buildDesktopSkillItem coerces unknown scope to global", () => {
  assert.equal(buildDesktopSkillItem(item({ scope: "weird" })).scope, "global");
});

test("buildDesktopSkillsSummary counts by scope and drops the skill-search api key", () => {
  const summary = buildDesktopSkillsSummary({
    items: [
      item({ scope: "global" }),
      item({ name: "b", scope: "bot", enabled: false, botId: "default" }),
      item({ name: "c", scope: "chat", botId: "default", chatId: "c1" })
    ],
    skillSearch: {
      local: { enabled: true },
      api: { enabled: true, provider: "custom:openrouter", model: "gpt-4o", apiKey: "sk-secret-search-key" }
    }
  } as Parameters<typeof buildDesktopSkillsSummary>[0]);

  assert.equal(summary.counts.total, 3);
  assert.equal(summary.counts.enabled, 2);
  assert.deepEqual(
    { global: summary.counts.global, bot: summary.counts.bot, chat: summary.counts.chat },
    { global: 1, bot: 1, chat: 1 }
  );
  assert.equal(summary.search.localEnabled, true);
  assert.equal(summary.search.apiEnabled, true);
  assert.equal(summary.search.apiProvider, "custom:openrouter");
  assert.equal(summary.search.apiModel, "gpt-4o");
  assert.equal(JSON.stringify(summary).includes("sk-secret-search-key"), false);
});
