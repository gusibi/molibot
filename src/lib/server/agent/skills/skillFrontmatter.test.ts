import test from "node:test";
import assert from "node:assert/strict";
import {
  formatYamlList,
  formatYamlScalar,
  parseSkillFrontmatter
} from "$lib/server/agent/skills/skillFrontmatter.js";

function doc(...frontmatterLines: string[]): string {
  return ["---", ...frontmatterLines, "---", "", "# Body"].join("\n");
}

test("returns null when there is no frontmatter block", () => {
  assert.equal(parseSkillFrontmatter("# Just a heading\n"), null);
  assert.equal(parseSkillFrontmatter("---\nname: unterminated\n"), null);
});

test("parses flat scalars and strips quotes", () => {
  const fm = parseSkillFrontmatter(doc("name: daily-news", 'description: "Summarize the news"'));
  assert.ok(fm);
  assert.equal(fm.name, "daily-news");
  assert.equal(fm.description, "Summarize the news");
});

test("parses YAML lists into a JSON array literal that parseStringList accepts", () => {
  const fm = parseSkillFrontmatter(doc("name: s", "aliases: [alpha, beta]"));
  assert.ok(fm);
  assert.deepEqual(JSON.parse(fm.aliases), ["alpha", "beta"]);
});

test("parses block-sequence lists, which the previous parser dropped", () => {
  const fm = parseSkillFrontmatter(doc("name: s", "mcpServers:", "  - github", "  - filesystem"));
  assert.ok(fm);
  assert.deepEqual(JSON.parse(fm.mcpServers), ["github", "filesystem"]);
});

test("parses nested maps instead of silently yielding an empty value", () => {
  const fm = parseSkillFrontmatter(doc("name: s", "signals:", "  cli:", "    - git", "  tools:", "    - bash"));
  assert.ok(fm);
  assert.deepEqual(JSON.parse(fm.signals), { cli: ["git"], tools: ["bash"] });
});

test("keeps literal and folded block scalars", () => {
  const literal = parseSkillFrontmatter(doc("name: s", "description: |", "  line one", "  line two"));
  assert.ok(literal);
  assert.equal(literal.description, "line one\nline two");

  const folded = parseSkillFrontmatter(doc("name: s", "description: >", "  line one", "  line two"));
  assert.ok(folded);
  assert.equal(folded.description, "line one line two");
});

test("coerces non-string scalars to strings", () => {
  const fm = parseSkillFrontmatter(doc("name: s", "draft: true", "merge_count: 3"));
  assert.ok(fm);
  assert.equal(fm.draft, "true");
  assert.equal(fm.merge_count, "3");
});

test("falls back to the legacy reader for frontmatter that is not valid YAML", () => {
  // Emitted by older versions: an unquoted description containing ": ", which a
  // real YAML parser rejects as a nested mapping.
  const legacy = doc("name: daily-news", "description: Reusable workflow draft for: 整理新闻");
  const fm = parseSkillFrontmatter(legacy);
  assert.ok(fm, "legacy skill files must not become unreadable");
  assert.equal(fm.name, "daily-news");
  assert.equal(fm.description, "Reusable workflow draft for: 整理新闻");
});

test("formatYamlScalar quotes only ambiguous values", () => {
  assert.equal(formatYamlScalar("daily-news-summary"), "daily-news-summary");
  assert.equal(formatYamlScalar("Reusable draft for: 整理新闻"), '"Reusable draft for: 整理新闻"');
  assert.equal(formatYamlScalar("true"), '"true"');
  assert.equal(formatYamlScalar("42"), '"42"');
  assert.equal(formatYamlScalar(""), '""');
  assert.equal(formatYamlScalar("- leading dash"), '"- leading dash"');
});

test("emitted frontmatter round-trips back to the original values", () => {
  const name = "yesterday-data-review";
  const description = "Use when the user needs this reusable workflow: 昨日数据回顾";
  const aliases = ["yesterday-data-review", "yesterday_data_review"];

  const fm = parseSkillFrontmatter(
    doc(
      `name: ${formatYamlScalar(name)}`,
      `description: ${formatYamlScalar(description)}`,
      `aliases: ${formatYamlList(aliases)}`
    )
  );

  assert.ok(fm);
  assert.equal(fm.name, name);
  assert.equal(fm.description, description);
  assert.deepEqual(JSON.parse(fm.aliases), aliases);
});
