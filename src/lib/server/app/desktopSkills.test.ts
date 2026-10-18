import assert from "node:assert/strict";
import test from "node:test";
import { closeSync, ftruncateSync, mkdirSync, mkdtempSync, openSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildDesktopSkillSearchSettings,
  buildDesktopSkillItem,
  buildDesktopSkillDetail,
  desktopSkillId,
  buildDesktopSkillsSummary,
  flattenSkillFrontmatter,
  listSkillDirectory,
  readSkillFileContent,
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

// The runtime tags the workspace layer "bot" for agent AND channel-bot
// workspaces; the Desktop only projects the owner's agent workspaces, so the
// boundary maps it to the agent scope instead of leaking the runtime word.
test("buildDesktopSkillItem maps the runtime workspace layer to the agent scope", () => {
  const desktop = buildDesktopSkillItem(item({ scope: "bot", agentId: "momo" }));
  assert.equal(desktop.scope, "agent");
  assert.equal(desktop.agentId, "momo");
});

test("buildDesktopSkillsSummary counts by scope and drops the skill-search api key", () => {
  const summary = buildDesktopSkillsSummary({
    items: [
      item({ scope: "global" }),
      item({ name: "b", scope: "agent", enabled: false, agentId: "momo" }),
      item({ name: "c", scope: "chat", agentId: "momo", chatId: "c1" })
    ],
    skillSearch: {
      local: { enabled: true },
      api: { enabled: true, provider: "custom:openrouter", model: "gpt-4o", apiKey: "sk-secret-search-key" }
    }
  } as Parameters<typeof buildDesktopSkillsSummary>[0]);

  assert.equal(summary.counts.total, 3);
  assert.equal(summary.counts.enabled, 2);
  assert.deepEqual(
    { global: summary.counts.global, agent: summary.counts.agent, chat: summary.counts.chat },
    { global: 1, agent: 1, chat: 1 }
  );
  assert.equal(summary.search.localEnabled, true);
  assert.equal(summary.search.apiEnabled, true);
  assert.equal(summary.search.apiProvider, "custom:openrouter");
  assert.equal(summary.search.apiModel, "gpt-4o");
  assert.equal(JSON.stringify(summary).includes("sk-secret-search-key"), false);
});

// Built-in version state is what the Settings "update" affordance reads. It is
// supplied by the caller (it comes from the skills root on disk, not from the
// shared route's payload), so the mapper must pass it through rather than
// dropping it — a dropped field here is a button that never appears.
test("buildDesktopSkillsSummary carries built-in Skill version state through", () => {
  const summary = buildDesktopSkillsSummary(
    { items: [item({ scope: "global" })] } as Parameters<typeof buildDesktopSkillsSummary>[0],
    [{ id: "miniapp-creator", skillId: "builtin-opaque-id", version: "1.3.0", installedVersion: "1.2.0", installed: true, updateAvailable: true, modified: false }]
  );
  assert.deepEqual(summary.builtins, [
    { id: "miniapp-creator", skillId: "builtin-opaque-id", version: "1.3.0", installedVersion: "1.2.0", installed: true, updateAvailable: true, modified: false }
  ]);
  // Omitting the argument must not produce `undefined` for a field the UI maps over.
  assert.deepEqual(
    buildDesktopSkillsSummary({ items: [] } as Parameters<typeof buildDesktopSkillsSummary>[0]).builtins,
    []
  );
});

test("built-in workspace identity matches the discovered copy without relying on its display name", () => {
  const filePath = "/tmp/skill-identity/skills/miniapp-creator/SKILL.md";
  const builtinId = desktopSkillId(filePath);
  assert.equal(buildDesktopSkillItem(item({ filePath, name: "Renamed by owner" })).id, builtinId);
  assert.notEqual(buildDesktopSkillItem(item({ filePath: "/tmp/skill-identity/sessions/momo/skills/miniapp-creator/SKILL.md", name: "Renamed by owner", scope: "agent" })).id, builtinId);
  assert.match(builtinId, /^[a-f0-9]{16}$/);
});

test("flattenSkillFrontmatter expands nested maps to dotted keys and keeps scalars", () => {
  // The frontmatter parser stringifies nested YAML, so the detail mapper has to
  // expand those strings back into readable rows.
  const rows = flattenSkillFrontmatter({
    name: "a-share-paper-trading",
    "metadata": JSON.stringify({ openclaw: { emoji: "📈", requires: { bins: ["python3"] } } }),
    aliases: JSON.stringify(["a-share", "paper"]),
    "read_when": JSON.stringify(["pricing", "orders"]),
    plain: "1.2.3"
  });
  assert.deepEqual(rows, [
    { key: "name", value: "a-share-paper-trading" },
    { key: "metadata.openclaw.emoji", value: "📈" },
    { key: "metadata.openclaw.requires.bins", value: "python3" },
    { key: "aliases", value: "a-share, paper" },
    { key: "read_when", value: "pricing, orders" },
    { key: "plain", value: "1.2.3" }
  ]);
  assert.deepEqual(flattenSkillFrontmatter(null), []);
});

test("buildDesktopSkillDetail carries the path, frontmatter, version and directory listing", () => {
  const detail = buildDesktopSkillDetail({
    item: {
      name: "grabby",
      description: "抓取网页内容",
      scope: "global",
      enabled: false,
      mcpServers: ["fs"],
      filePath: "/tmp/skills/grabby/SKILL.md",
      baseDir: "/tmp/skills/grabby"
    },
    frontmatter: { name: "grabby", version: "2.1.0", metadata: JSON.stringify({ clawdbot: { emoji: "🕸" } }) },
    updatedAt: "2026-02-12T00:00:00.000Z",
    files: [{ path: "SKILL.md", kind: "file", size: 12 }],
    builtin: null
  });

  assert.equal(detail.id, desktopSkillId("/tmp/skills/grabby/SKILL.md"));
  assert.equal(detail.baseDir, "/tmp/skills/grabby");
  assert.equal(detail.filePath, "/tmp/skills/grabby/SKILL.md");
  assert.equal(detail.version, "2.1.0");
  assert.equal(detail.enabled, false);
  assert.equal(detail.updatedAt, "2026-02-12T00:00:00.000Z");
  assert.deepEqual(detail.mcpServers, ["fs"]);
  assert.deepEqual(detail.files, [{ path: "SKILL.md", kind: "file", size: 12 }]);
  assert.ok(detail.frontmatter.some((row) => row.key === "metadata.clawdbot.emoji" && row.value === "🕸"));
});

test("listSkillDirectory and readSkillFileContent stay inside the Skill directory", () => {
  const root = mkdtempSync(join(tmpdir(), "molibot-skill-detail-"));
  const outside = join(root, "..", `molibot-outside-${Date.now()}.txt`);
  try {
    mkdirSync(join(root, "scripts"));
    mkdirSync(join(root, "references"));
    writeFileSync(join(root, "SKILL.md"), "---\nname: demo\n---\nbody");
    writeFileSync(join(root, "scripts", "run.mjs"), "console.log(1)");
    writeFileSync(join(root, "references", "doc.md"), "# doc");
    writeFileSync(join(root, "blob.bin"), Buffer.from([0, 1, 2, 3]));
    writeFileSync(outside, "secret");

    const files = listSkillDirectory(root);
    assert.deepEqual(
      files.map((entry) => `${entry.kind}:${entry.path}`),
      ["dir:references", "dir:scripts", "file:blob.bin", "file:references/doc.md", "file:scripts/run.mjs", "file:SKILL.md"]
    );
    assert.equal(files.find((entry) => entry.path === "SKILL.md")?.size, Buffer.byteLength("---\nname: demo\n---\nbody"));
    assert.equal(files.find((entry) => entry.path === "references/doc.md")?.size, 5);

    assert.equal(readSkillFileContent(root, "SKILL.md").content, "---\nname: demo\n---\nbody");
    assert.equal(readSkillFileContent(root, "blob.bin").binary, true);
    assert.throws(() => readSkillFileContent(root, outside), /escapes the Skill directory/);
    assert.throws(() => readSkillFileContent(root, "references"), /Not a file/);
    assert.throws(() => readSkillFileContent(root, "missing.md"), /File not found/);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { force: true });
  }
});

test("preview reads a bounded prefix even when the file exceeds Node's whole-file limit", () => {
  const root = mkdtempSync(join(tmpdir(), "molibot-skill-preview-"));
  try {
    const fd = openSync(join(root, "large.bin"), "w");
    // Sparse allocation exercises the read bound without allocating gigabytes.
    try { ftruncateSync(fd, 2 ** 31); } finally { closeSync(fd); }
    assert.deepEqual(readSkillFileContent(root, "large.bin"), { content: "", truncated: true, binary: true });
    writeFileSync(join(root, "exact.txt"), "a".repeat(256 * 1024));
    const exact = readSkillFileContent(root, "exact.txt");
    assert.equal(exact.truncated, false);
    assert.equal(exact.content.length, 256 * 1024);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
