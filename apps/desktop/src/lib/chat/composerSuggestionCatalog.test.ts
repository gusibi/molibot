import assert from "node:assert/strict";
import test from "node:test";
import { classifyComposerSuggestion, segmentComposerInvocations } from "./composerSuggestionCatalog.js";
import type { DesktopComposerSuggestion } from "@molibot/desktop-contract";

const CATALOG: DesktopComposerSuggestion[] = [
  { id: "cmd:grabby", kind: "command", label: "/grabby", insertText: "/grabby ", description: "抓取", aliases: [], submitOnSelect: true },
  { id: "skill:code", kind: "skill", label: "/code", insertText: "/code ", description: "写代码", aliases: [], submitOnSelect: false },
  { id: "app:timer", kind: "miniapp", label: "@timer", insertText: "@timer ", description: "计时", aliases: [], submitOnSelect: false }
];

/** Segments must always re-join to the exact input: the overlay mirrors it glyph-for-glyph. */
function flatten(segments: ReturnType<typeof segmentComposerInvocations>): string {
  return segments.map((segment) => segment.text).join("");
}

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

test("recognized tokens pill at any offset and prose runs stay intact", () => {
  const text = "帮我 /grabby 抓取，再 /code 一下 @timer";
  const segments = segmentComposerInvocations(text, CATALOG);

  assert.deepEqual(segments, [
    { text: "帮我 ", kind: null },
    { text: "/grabby", kind: "command" },
    { text: " 抓取，再 ", kind: null },
    { text: "/code", kind: "skill" },
    { text: " 一下 ", kind: null },
    { text: "@timer", kind: "miniapp" }
  ]);
  assert.equal(flatten(segments), text);
});

test("unknown tokens and everyday prose never pill", () => {
  const text = "3/4 的邮件发到 a@b.com，见 [readme](docs/x.md) 与 /nope";
  const segments = segmentComposerInvocations(text, CATALOG);

  assert.deepEqual(segments, [{ text, kind: null }]);
  assert.equal(flatten(segments), text);
});

test("persisted file references pill as one file entity", () => {
  const text = "先看 @[readme.md](docs/readme.md) 再改 @[App.tsx](src/App.tsx:12)";
  const segments = segmentComposerInvocations(text, CATALOG);

  assert.deepEqual(segments, [
    { text: "先看 ", kind: null },
    { text: "@[readme.md](docs/readme.md)", kind: "file" },
    { text: " 再改 ", kind: null },
    { text: "@[App.tsx](src/App.tsx:12)", kind: "file" }
  ]);
  assert.equal(flatten(segments), text);
});

test("persisted Skill references pill as one skill entity", () => {
  const text = "[$writer](.agents/skills/writer/SKILL.md) 开写";
  const segments = segmentComposerInvocations(text, CATALOG);

  assert.deepEqual(segments, [
    { text: "[$writer](.agents/skills/writer/SKILL.md)", kind: "skill" },
    { text: " 开写", kind: null }
  ]);
  assert.equal(flatten(segments), text);
});

test("catalog tokens inside a persisted reference never double-pill", () => {
  // The reference path contains `/SKILL.md`; a `/skill`-like run inside it must
  // not open a second pill inside the first entity.
  const text = "@[writer](skills/writer/SKILL.md) 然后 /code";
  const segments = segmentComposerInvocations(text, CATALOG);

  assert.deepEqual(segments, [
    { text: "@[writer](skills/writer/SKILL.md)", kind: "file" },
    { text: " 然后 ", kind: null },
    { text: "/code", kind: "skill" }
  ]);
  assert.equal(flatten(segments), text);
});

test("mixed entities merge in reading order", () => {
  const text = "/grabby 抓 [$writer](s/writer/SKILL.md) 和 @[a.md](a.md) 给 @timer";
  const segments = segmentComposerInvocations(text, CATALOG);

  assert.deepEqual(segments.map((segment) => segment.kind), [
    "command",
    null,
    "skill",
    null,
    "file",
    null,
    "miniapp"
  ]);
  assert.equal(flatten(segments), text);
});
