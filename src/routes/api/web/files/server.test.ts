import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { ConversationMessage } from "$lib/shared/types/message.js";
import { _buildConversationFiles } from "./+server.js";

test("ordinary Session scratch outputs are listed without an attachment copy", () => {
  const workspaceDir = mkdtempSync(path.join(tmpdir(), "molibot-session-files-"));
  const externalUserId = "web:default:web-anonymous";
  const relativeOutput = "2026/08/26/report.html";
  const local = `${externalUserId}/scratch/${relativeOutput}`;
  try {
    mkdirSync(path.dirname(path.join(workspaceDir, local)), { recursive: true });
    writeFileSync(path.join(workspaceDir, local), "<!doctype html><p>ready</p>");

    const messages = [{
      id: "assistant-1",
      conversationId: "session-1",
      role: "assistant",
      content: "完成",
      createdAt: "2026-08-26T00:00:00.000Z",
      activities: [{
        key: "write-1",
        kind: "tool",
        label: "Write",
        state: "success",
        fileOutput: { path: relativeOutput, action: "created", rootKind: "scratch" }
      }]
    }] satisfies ConversationMessage[];

    assert.deepEqual(_buildConversationFiles(workspaceDir, externalUserId, messages), [{
      id: Buffer.from(local, "utf8").toString("base64url"),
      original: "report.html",
      local,
      mimeType: undefined,
      mediaType: "file",
      size: 27,
      createdAt: "2026-08-26T00:00:00.000Z",
      source: "persisted",
      previewKind: "code"
    }]);
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("ordinary Session scratch outputs reject a symlink escape", () => {
  const workspaceDir = mkdtempSync(path.join(tmpdir(), "molibot-session-files-"));
  const outsideDir = mkdtempSync(path.join(tmpdir(), "molibot-session-files-outside-"));
  const externalUserId = "web:default:web-anonymous";
  try {
    const scratchRoot = path.join(workspaceDir, externalUserId, "scratch");
    mkdirSync(scratchRoot, { recursive: true });
    writeFileSync(path.join(outsideDir, "secret.html"), "secret");
    symlinkSync(path.join(outsideDir, "secret.html"), path.join(scratchRoot, "escape.html"));

    const messages = [{
      id: "assistant-1",
      conversationId: "session-1",
      role: "assistant",
      content: "完成",
      createdAt: "2026-08-26T00:00:00.000Z",
      activities: [{
        key: "write-1",
        kind: "tool",
        label: "Write",
        state: "success",
        fileOutput: { path: "escape.html", action: "created", rootKind: "scratch" }
      }]
    }] satisfies ConversationMessage[];

    assert.deepEqual(_buildConversationFiles(workspaceDir, externalUserId, messages), []);
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});
