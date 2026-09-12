import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  assertModelContextFits,
  assessModelContextPreflight,
  capModelPromptToTokens,
  contextMessageBudget
} from "$lib/server/agent/session/contextPreflight.js";

function user(text: string): AgentMessage {
  return { role: "user", content: [{ type: "text", text }], timestamp: 0 } as AgentMessage;
}

test("preflight counts the final user message, system prompt, and tool schemas", () => {
  const result = assessModelContextPreflight({
    systemPrompt: "S".repeat(800),
    messages: [user("中".repeat(900))],
    tools: [{ name: "large", description: "D".repeat(800), parameters: { type: "object" } }],
    contextWindow: 1200
  });

  assert.equal(result.fits, false);
  assert.ok(result.estimatedTokens > 1200);
  assert.ok(result.fixedTokens > 0);
});

test("preflight ignores base64 image bytes instead of treating them as text tokens", () => {
  const result = assessModelContextPreflight({
    systemPrompt: "short",
    messages: [user("look"), {
      role: "user",
      content: [{ type: "image", data: "A".repeat(2_000_000), mimeType: "image/png" }],
      timestamp: 0
    } as AgentMessage],
    tools: [],
    contextWindow: 1000
  });

  assert.equal(result.fits, true);
  assert.ok(result.estimatedTokens < 100);
});

test("message budget reserves the fixed prompt and tool cost", () => {
  assert.equal(contextMessageBudget(10_000, 2_500), 7_500);
  assert.equal(contextMessageBudget(100, 150), 0);
});

test("the final guard throws before a provider dispatch can start", () => {
  let providerCalled = false;
  assert.throws(() => {
    assertModelContextFits({
      systemPrompt: "system",
      messages: [user("中".repeat(2000))],
      tools: [],
      contextWindow: 1000
    });
    providerCalled = true;
  }, /Context length exceeded before provider request/);
  assert.equal(providerCalled, false);
});

test("an oversized current prompt can be capped for model context without changing the source text", () => {
  const source = "重要开头" + "中".repeat(20_000);
  const capped = capModelPromptToTokens(source, 1000);
  assert.match(capped, /^重要开头/);
  assert.match(capped, /truncated by compaction/);
  assert.ok(capped.length < source.length / 5);
  assert.equal(source.length, 20_004);
});

test("the breakdown splits skills out of the system prompt and MCP out of built-in tools", () => {
  const skillsBlock = "<available-skills>\n## Available Skills\n- alpha: does things\n</available-skills>";
  const result = assessModelContextPreflight({
    systemPrompt: `You are Molibot.\n${skillsBlock}\nBe helpful.`,
    messages: [user("中".repeat(400))],
    tools: [
      { name: "read", description: "D".repeat(400) },
      { name: "mcp__github.search", description: "D".repeat(400) },
      { description: "anonymous tool" }
    ],
    contextWindow: 100_000
  });

  assert.ok(result.breakdown.skills > 0);
  assert.equal(result.breakdown.systemPrompt + result.breakdown.skills, result.fixedTokens - result.breakdown.mcpTools - result.breakdown.systemTools - result.breakdown.other);
  assert.ok(result.breakdown.mcpTools > 0);
  assert.ok(result.breakdown.systemTools > 0);
  assert.ok(result.breakdown.other > 0);
  assert.ok(result.breakdown.messages > 0);
  // The parts always sum to the headline estimate the panel displays.
  const sum = result.breakdown.messages + result.breakdown.mcpTools + result.breakdown.systemTools
    + result.breakdown.systemPrompt + result.breakdown.skills + result.breakdown.other;
  assert.equal(sum, result.estimatedTokens);
});

test("a system prompt without a skills catalogue reports zero skill tokens", () => {
  const result = assessModelContextPreflight({
    systemPrompt: "plain prompt",
    messages: [user("hello")],
    tools: [{ name: "ls" }],
    contextWindow: 10_000
  });

  assert.equal(result.breakdown.skills, 0);
  assert.ok(result.breakdown.systemPrompt > 0);
});
