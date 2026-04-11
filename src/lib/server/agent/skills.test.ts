import test from "node:test";
import assert from "node:assert/strict";
import { findExplicitlyInvokedSkills, type LoadedSkill } from "./skills.js";

function createSkill(name: string, scope: LoadedSkill["scope"], filePath: string, aliases?: string[]): LoadedSkill {
  return {
    name,
    description: `${name} description`,
    filePath,
    baseDir: filePath.replace(/\/SKILL\.md$/i, ""),
    scope,
    mcpServers: [],
    aliases: aliases ?? [name]
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
