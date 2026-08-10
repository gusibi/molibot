import assert from "node:assert/strict";
import test from "node:test";
import { classifyComposerSuggestion } from "./composerSuggestionCatalog.js";

test("persisted explicit Skill references classify as Skill invocations", () => {
  const reference = "[$baoyu−article−illustrator](/workspace/.agents/skills/baoyu−article−illustrator/SKILL.md)";

  assert.deepEqual(classifyComposerSuggestion(`${reference} 帮我生成配置`, []), {
    kind: "skill",
    token: "$baoyu−article−illustrator",
    consumedLength: reference.length
  });
});

test("ordinary Markdown links to files are not treated as Skill invocations", () => {
  assert.equal(classifyComposerSuggestion("[readme](/workspace/README.md) 看一下", []), null);
  assert.equal(classifyComposerSuggestion("[SKILL.md](/workspace/SKILL.md) 看一下", []), null);
});
