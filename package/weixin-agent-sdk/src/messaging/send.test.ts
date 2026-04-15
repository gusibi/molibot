import test from "node:test";
import assert from "node:assert/strict";

import { filterWeixinMarkdown } from "./send.js";

test("filterWeixinMarkdown preserves supported markdown and removes unsupported image syntax", () => {
  const input = [
    "# Title",
    "",
    "| name | value |",
    "| --- | --- |",
    "| alpha | **1** |",
    "",
    "普通中文 *强调* 保留内容但去掉星号",
    "English *italic* stays",
    "![alt](https://example.com/image.png)",
    "",
    "```ts",
    "const answer = 42;",
    "```",
  ].join("\n");

  const output = filterWeixinMarkdown(input);

  assert.match(output, /# Title/);
  assert.match(output, /\| name \| value \|/);
  assert.match(output, /\*\*1\*\*/);
  assert.match(output, /普通中文 强调 保留内容但去掉星号/);
  assert.match(output, /English \*italic\* stays/);
  assert.doesNotMatch(output, /!\[alt\]/);
  assert.match(output, /```ts\nconst answer = 42;\n```/);
});
