import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  assertModelContextFits,
  assessModelContextPreflight,
  calibrateContextBreakdown,
  capModelPromptToTokens,
  contextBreakdownTotal,
  contextMessageBudget,
  type ContextUsageBreakdown
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

test("image blocks count as a fixed per-image estimate instead of raw bytes", () => {
  const result = assessModelContextPreflight({
    systemPrompt: "short",
    messages: [user("look"), {
      role: "user",
      content: [{ type: "image", data: "A".repeat(2_000_000), mimeType: "image/png" }],
      timestamp: 0
    } as AgentMessage],
    tools: [],
    contextWindow: 100_000
  });

  assert.equal(result.fits, true);
  // 2MB of base64 must never be treated as text; the image alone ≈ the fixed estimate.
  assert.equal(result.breakdown.files, 1_600);
  assert.ok(result.estimatedTokens >= 1_600 && result.estimatedTokens < 2_000);
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

test("tool results split into files vs toolResults by tool and memory blocks carve out of user text", () => {
  const memoryEnvelope = "<envelope>\n<current-memory>\n用户偏好：简洁回复。\n</current-memory>\n帮我看看这个文件\n</envelope>";
  const result = assessModelContextPreflight({
    systemPrompt: "system",
    messages: [
      user(memoryEnvelope),
      {
        role: "user",
        content: [{ type: "image", data: "A".repeat(4_000), mimeType: "image/png" }],
        timestamp: 0
      } as AgentMessage,
      {
        role: "toolResult",
        toolCallId: "t1",
        toolName: "read",
        content: [{ type: "text", text: "x".repeat(800) }],
        isError: false,
        timestamp: 0
      } as AgentMessage,
      {
        role: "toolResult",
        toolCallId: "t2",
        toolName: "bash",
        content: [{ type: "text", text: "y".repeat(400) }],
        isError: false,
        timestamp: 0
      } as AgentMessage
    ],
    tools: [],
    contextWindow: 100_000
  });

  assert.ok(result.breakdown.memory > 0);
  assert.ok(result.breakdown.files >= 200 + 1_600);
  assert.ok(result.breakdown.toolResults >= 100);
  assert.ok(result.breakdown.messages > 0);
  // read 的结果不再混进 messages；memory 从用户文本中剥离
  const sum = contextBreakdownTotal(result.breakdown);
  assert.equal(sum, result.estimatedTokens);
});

test("calibration rescales buckets to the provider-reported prompt total", () => {
  const estimate = estimateContextBreakdownForTest();
  const reported = 9_000;
  const calibrated = calibrateContextBreakdown(estimate, reported);

  assert.equal(contextBreakdownTotal(calibrated), reported);
  // Proportions survive calibration within rounding tolerance.
  for (const key of Object.keys(estimate) as Array<keyof typeof estimate>) {
    if (estimate[key] === 0) continue;
    const expectedShare = estimate[key] / contextBreakdownTotal(estimate);
    const actualShare = calibrated[key] / reported;
    assert.ok(Math.abs(expectedShare - actualShare) < 0.01, `${key} share drifted`);
  }
});

test("calibration returns the estimate untouched without a reported total", () => {
  const breakdown = { messages: 100, memory: 0, files: 0, toolResults: 0, mcpTools: 0, systemTools: 0, systemPrompt: 50, skills: 0, other: 0 };
  assert.equal(calibrateContextBreakdown(breakdown, 0), breakdown);
});

function estimateContextBreakdownForTest(): ContextUsageBreakdown {
  return {
    messages: 6_000,
    memory: 300,
    files: 1_500,
    toolResults: 800,
    mcpTools: 100,
    systemTools: 100,
    systemPrompt: 200,
    skills: 0,
    other: 0
  };
}
