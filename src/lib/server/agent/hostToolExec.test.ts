import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeApprovedHostTool, executeHostToolApproval } from "./hostToolExec.js";
import type { ApprovedHostTool, HostToolApprovalRequest } from "../settings/index.js";

function approvedPrintfTool(): ApprovedHostTool {
  return {
    toolId: "test-printf",
    displayName: "Test printf",
    command: "printf",
    reason: "test",
    permissions: {
      envAllowlist: ["PATH"],
      filesystem: "scratch-only",
      network: "none"
    },
    approvedAt: "2026-05-12T00:00:00.000Z",
    approvedFromRequestId: "hta-test",
    channel: "test",
    chatId: "chat-1",
    scopeId: "chat-1",
    enabled: true
  };
}

test("executeApprovedHostTool executes approved command through shell", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "molibot-host-tool-"));
  const result = await executeApprovedHostTool({
    tool: approvedPrintfTool(),
    cwd,
    originalCommand: "printf 'hello %s' world",
    args: ["hello %s", "world"]
  });

  assert.equal(result.rendered, "hello world");
  assert.equal(result.details.hostTool, true);
});

test("executeApprovedHostTool expands environment variables through shell", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "molibot-host-tool-"));
  process.env.MOLIBOT_HOST_TOOL_TEST_TOKEN = "expanded";
  try {
    const result = await executeApprovedHostTool({
      tool: approvedPrintfTool(),
      cwd,
      originalCommand: "printf '%s' \"$MOLIBOT_HOST_TOOL_TEST_TOKEN\"",
      args: ["%s", "$MOLIBOT_HOST_TOOL_TEST_TOKEN"]
    });

    assert.equal(result.rendered, "expanded");
  } finally {
    delete process.env.MOLIBOT_HOST_TOOL_TEST_TOKEN;
  }
});

test("executeApprovedHostTool surfaces non-zero exits", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "molibot-host-tool-"));
  await assert.rejects(
    () => executeApprovedHostTool({
      tool: {
        ...approvedPrintfTool(),
        toolId: "test-sh",
        command: "sh"
      },
      cwd,
      originalCommand: "printf fail >&2; exit 7",
      args: ["-c", "printf fail >&2; exit 7"]
    }),
    /Host tool exited with code 7/
  );
});

test("executeHostToolApproval runs one-time host script approvals without persisting a reusable tool", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "molibot-host-tool-"));
  const outputPath = join(cwd, "ephemeral.txt");
  const request: HostToolApprovalRequest = {
    id: "hta-one-time-1",
    toolId: "one-time-mkdir",
    displayName: "One-time install script",
    command: "mkdir",
    reason: "test",
    permissions: {
      envAllowlist: ["PATH"],
      filesystem: "workspace-write",
      network: "none"
    },
    channel: "test",
    chatId: "chat-1",
    scopeId: "chat-1",
    requestedAt: "2026-05-16T00:00:00.000Z",
    approvalMode: "ephemeral",
    status: "approved",
    pendingAction: {
      kind: "run_one_time_host_script",
      originalCommand: `printf '%s' 'hello once' > ${JSON.stringify(outputPath)}`,
      timeout: 10
    }
  };

  const result = await executeHostToolApproval({
    request,
    cwd
  });

  assert.equal(result.details.hostTool, true);
  assert.equal(readFileSync(outputPath, "utf8"), "hello once");
});
