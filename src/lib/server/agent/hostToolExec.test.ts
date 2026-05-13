import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeApprovedHostTool } from "./hostToolExec.js";
import type { ApprovedHostTool } from "../settings/index.js";

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

test("executeApprovedHostTool executes an approved fixed command with structured args", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "molibot-host-tool-"));
  const result = await executeApprovedHostTool({
    tool: approvedPrintfTool(),
    cwd,
    args: ["hello %s", "world"]
  });

  assert.equal(result.rendered, "hello world");
  assert.equal(result.details.hostTool, true);
});

test("executeApprovedHostTool passes shell metacharacters as plain argv", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "molibot-host-tool-"));
  const result = await executeApprovedHostTool({
    tool: approvedPrintfTool(),
    cwd,
    args: ["%s", "hello; echo injected"]
  });

  assert.equal(result.rendered, "hello; echo injected");
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
      args: ["-c", "printf fail >&2; exit 7"]
    }),
    /Host tool exited with code 7/
  );
});
