import assert from "node:assert/strict";
import test from "node:test";
import {
  rewriteBrokerApprovalToolResultInContext
} from "./brokerApprovalResume.js";

test("rewriteBrokerApprovalToolResultInContext rewrites approved toolResult by requestId", () => {
  const messages = [
    {
      role: "user",
      content: [{ type: "text", text: "query search console" }]
    },
    {
      role: "assistant",
      content: [
        {
          type: "toolCall",
          id: "call-1",
          name: "mcp__connector__execute_action",
          arguments: { actionId: "google_search_console.query" }
        }
      ]
    },
    {
      role: "toolResult",
      toolCallId: "call-1",
      toolName: "mcp__connector__execute_action",
      content: [{ type: "text", text: "Tool execution is waiting for user approval." }],
      details: { approvalRequestId: "req-123", hostBashApproval: {} },
      isError: true
    }
  ];

  const rewritten = rewriteBrokerApprovalToolResultInContext(
    messages,
    "req-123",
    "approved",
    "mcp__connector__execute_action"
  );

  assert.equal(rewritten, true);
  const resultMsg = messages[2];
  assert.equal(resultMsg.isError, false);
  assert.match(resultMsg.content[0].text, /approved the execution of mcp__connector__execute_action/);
  assert.match(resultMsg.content[0].text, /re-issue your intended tool call now/i);
});

test("rewriteBrokerApprovalToolResultInContext rewrites rejected toolResult by requestId", () => {
  const messages = [
    {
      role: "toolResult",
      toolCallId: "call-2",
      content: [{ type: "text", text: "Tool execution is waiting for user approval." }],
      details: { approvalRequestId: "req-456" },
      isError: true
    }
  ];

  const rewritten = rewriteBrokerApprovalToolResultInContext(
    messages,
    "req-456",
    "rejected",
    "mcp__connector__execute_action"
  );

  assert.equal(rewritten, true);
  const resultMsg = messages[0];
  assert.equal(resultMsg.isError, true);
  assert.match(resultMsg.content[0].text, /rejected the execution/);
  assert.match(resultMsg.content[0].text, /Do not retry/);
});

test("rewriteBrokerApprovalToolResultInContext returns false when no matching request exists", () => {
  const messages = [
    {
      role: "toolResult",
      toolCallId: "call-1",
      content: [{ type: "text", text: "Some normal output" }]
    }
  ];

  const rewritten = rewriteBrokerApprovalToolResultInContext(messages, "non-existent", "approved");
  assert.equal(rewritten, false);
});
