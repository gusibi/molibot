import test from "node:test";
import assert from "node:assert/strict";
import {
  findExplicitlyInvokedSkills,
  findSkillBySelector,
  formatSkillDetailText,
  formatSkillsDetailText,
  formatSkillsSummaryText,
  loadSkillsFromWorkspace,
  type LoadedSkill
} from "$lib/server/agent/skills/skills.js";
import { getWorkspaceStore } from "$lib/server/workspaces/store.js";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

function createSkill(name: string, scope: LoadedSkill["scope"], filePath: string, aliases?: string[]): LoadedSkill {
  return {
    name,
    description: `${name} description`,
    filePath,
    baseDir: filePath.replace(/\/SKILL\.md$/i, ""),
    scope,
    mcpServers: [],
    aliases: aliases ?? [name],
    signals: { cli: [], mcp: [], tools: [] }
  };
}

test("matches slash skill invocation inside a sentence", () => {
  const skills: LoadedSkill[] = [
    createSkill("web-search", "bot", "/tmp/bot/skills/web-search/SKILL.md", ["web-search", "websearch"])
  ];
  const matched = findExplicitlyInvokedSkills(skills, "请你现在用 /web-search 查一下今天的新闻");
  assert.equal(matched.length, 1);
  assert.equal(matched[0]?.name, "web-search");
});

test("matches normalized alias with underscore and explicit forms", () => {
  const skills: LoadedSkill[] = [
    createSkill("image-gen", "bot", "/tmp/bot/skills/image-gen/SKILL.md", ["image-gen", "image_gen"])
  ];

  assert.equal(findExplicitlyInvokedSkills(skills, "/image_gen 画一张图").length, 1);
  assert.equal(findExplicitlyInvokedSkills(skills, "skill:image_gen").length, 1);
  assert.equal(findExplicitlyInvokedSkills(skills, "$image_gen").length, 1);
});

test("matches language-agnostic label forms for non-English locales", () => {
  const skills: LoadedSkill[] = [
    createSkill("web-search", "bot", "/tmp/bot/skills/web-search/SKILL.md", ["web-search", "websearch"])
  ];

  assert.equal(findExplicitlyInvokedSkills(skills, "スキル:web-search で調べて").length, 1);
  assert.equal(findExplicitlyInvokedSkills(skills, "/기술 web-search 최신 뉴스").length, 1);
});

test("resolves alias conflicts by scope priority chat > bot > global", () => {
  const skills: LoadedSkill[] = [
    createSkill("shared", "global", "/tmp/global/skills/shared/SKILL.md", ["shared"]),
    createSkill("shared-bot", "bot", "/tmp/bot/skills/shared-bot/SKILL.md", ["shared"]),
    createSkill("shared-chat", "chat", "/tmp/chat/skills/shared-chat/SKILL.md", ["shared"])
  ];
  const matched = findExplicitlyInvokedSkills(skills, "/shared");
  assert.equal(matched.length, 1);
  assert.equal(matched[0]?.name, "shared-chat");
});

test("does not match URL path fragments as skills", () => {
  const skills: LoadedSkill[] = [
    createSkill("web-search", "bot", "/tmp/bot/skills/web-search/SKILL.md", ["web-search"])
  ];
  const matched = findExplicitlyInvokedSkills(skills, "看这个链接 https://example.com/web-search");
  assert.equal(matched.length, 0);
});

test("findSkillBySelector resolves normalized alias and prefers exact match", () => {
  const skills: LoadedSkill[] = [
    createSkill("image-gen", "global", "/tmp/global/skills/image-gen/SKILL.md", ["image-gen", "image_gen"]),
    createSkill("image-gen-chat", "chat", "/tmp/chat/skills/image-gen-chat/SKILL.md", ["imagegen"])
  ];

  assert.equal(findSkillBySelector(skills, "image_gen")?.name, "image-gen");
  assert.equal(findSkillBySelector(skills, "imagegen")?.name, "image-gen-chat");
  assert.equal(findSkillBySelector(skills, "missing"), null);
});

test("skill text formatters split summary and detail views", () => {
  const skill = createSkill("web-search", "bot", "/tmp/bot/skills/web-search/SKILL.md", ["web-search", "websearch"]);
  skill.mcpServers = ["tavily"];
  const diagnostics = ["Duplicate skill ignored"];

  const summary = formatSkillsSummaryText([skill], diagnostics, {
    footerLines: ["Use /skills <id> for details."]
  });
  assert.match(summary, /当前技能列表（共1个）/);
  assert.match(summary, /\| 编号 \| 名称 \| 路径 \|/);
  assert.match(summary, /\| 1 \| web-search \| \/tmp\/bot\/skills\/web-search\/SKILL\.md \|/);
  assert.doesNotMatch(summary, /description:/);
  assert.match(summary, /Use \/skills <id> for details\./);
  assert.match(summary, /Diagnostics:/);

  const detail = formatSkillDetailText(skill);
  assert.match(detail, /Skill: web-search/);
  assert.match(detail, /Description: web-search description/);
  assert.match(detail, /Aliases: web-search, websearch/);
  assert.match(detail, /MCP servers: tavily/);

  const detailList = formatSkillsDetailText([skill], diagnostics);
  assert.match(detailList, /1\. web-search/);
  assert.match(detailList, /- description: web-search description/);
  assert.match(detailList, /- mcp_servers: tavily/);
});

test("loadSkillsFromWorkspace filters loaded skills based on workspace whitelist", () => {
  const workspaceDir = "./.tmp/test-skills-workspace";
  const skillDir1 = join(workspaceDir, "skills/allowed-skill");
  const skillDir2 = join(workspaceDir, "skills/blocked-skill");
  mkdirSync(skillDir1, { recursive: true });
  mkdirSync(skillDir2, { recursive: true });

  writeFileSync(join(skillDir1, "skill.md"), `---
name: Allowed Skill
description: description
---
allowed skill
`);

  writeFileSync(join(skillDir2, "skill.md"), `---
name: Blocked Skill
description: description
---
blocked skill
`);

  const store = getWorkspaceStore();
  store.upsertWorkspace({
    id: "test-skills-whitelist",
    name: "Test Skills Whitelist",
    enabledSkillPaths: ["Allowed Skill"]
  });

  const result = loadSkillsFromWorkspace(workspaceDir, undefined, {
    workspaceId: "test-skills-whitelist"
  });

  assert.equal(result.skills.length, 1);
  assert.equal(result.skills[0]?.name, "Allowed Skill");

  // Cleanup
  rmSync(workspaceDir, { recursive: true, force: true });
});

test("loadSkillsFromWorkspace parses optional skill execution signals", () => {
  const workspaceDir = "./.tmp/test-skills-signals";
  const skillDir = join(workspaceDir, "skills/signal-skill");
  mkdirSync(skillDir, { recursive: true });

  writeFileSync(join(skillDir, "skill.md"), `---
name: Signal Skill
description: description
signals:
  cli: ["longbridge", "lb"]
  mcp: ["longbridge"]
  tools: ["webSearch"]
signals_tools: imageGenerate
---
signal skill
`);

  const result = loadSkillsFromWorkspace(workspaceDir);

  assert.equal(result.skills.length, 1);
  assert.deepEqual(result.skills[0]?.signals.cli, ["lb", "longbridge"]);
  assert.deepEqual(result.skills[0]?.signals.mcp, ["longbridge"]);
  assert.deepEqual(result.skills[0]?.signals.tools, ["imageGenerate", "webSearch"]);

  rmSync(workspaceDir, { recursive: true, force: true });
});
