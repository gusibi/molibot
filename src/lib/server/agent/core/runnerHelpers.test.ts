import assert from "node:assert/strict";
import test from "node:test";
import { injectExplicitSkillInvocationContext } from "$lib/server/agent/core/runnerHelpers.js";

test("explicit Skill invocation persists as a readable Markdown reference without inline control blocks", () => {
  const rendered = injectExplicitSkillInvocationContext(
    "/diagnosing-bugs 修复这个问题",
    [{
      name: "diagnosing-bugs",
      scope: "global",
      filePath: "/workspace/.agents/skills/diagnosing-bugs/SKILL.md",
      baseDir: "/workspace/.agents/skills/diagnosing-bugs",
      aliases: []
    }]
  );

  assert.equal(
    rendered,
    "[$diagnosing-bugs](/workspace/.agents/skills/diagnosing-bugs/SKILL.md) 修复这个问题"
  );
  assert.doesNotMatch(rendered, /\[explicit skill invocation\]|content:\s*\|/);
});

