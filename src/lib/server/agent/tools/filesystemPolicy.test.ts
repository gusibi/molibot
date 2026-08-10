import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createWriteTool } from "$lib/server/agent/tools/write.js";
import { createEditTool } from "$lib/server/agent/tools/edit.js";
import { isWriteDeniedByFilesystemPolicy } from "$lib/server/agent/tools/filesystemPolicy.js";

/**
 * One path string must mean one thing in every tool (CLAUDE.md pitfall 6).
 *
 * `toolSandbox.filesystem.denyWrite` defaults to `[".env", ".env.*", "*.pem",
 * "*.key"]` and is enforced for `bash`, because bash runs inside the sandbox
 * the policy configures. `write` and `edit` never consulted it at all — they go
 * through `createPathGuard(cwd, workspaceDir)`, which is a containment guard
 * (stay inside the allowed roots) and knows nothing about the operator's
 * filesystem policy. So an operator who denied writes to `*.key` still had two
 * tools that wrote to `*.key` on request.
 *
 * That is a live hole today, and Permission Modes makes it worse: `Accept
 * edits` auto-approves file writes, which would turn "the setting silently does
 * nothing" into "we automatically approved a write the operator had denied".
 * Hence slice 0 of the Permission Modes PRD closes it before any mode exists.
 */

const DENY = [".env", ".env.*", "*.pem", "*.key"];

test("the shared predicate matches the sandbox deny patterns", () => {
  const root = "/w";
  const denied = (p: string) => isWriteDeniedByFilesystemPolicy(p, { denyWrite: DENY, allowWrite: [] }, root);

  assert.equal(denied("/w/.env"), true, ".env is denied");
  assert.equal(denied("/w/.env.local"), true, ".env.* is denied");
  assert.equal(denied("/w/server.key"), true, "*.key is denied");
  assert.equal(denied("/w/cert.pem"), true, "*.pem is denied");
  // A denied basename is denied wherever it sits, exactly like the sandbox
  // treats it — the pattern is about the file, not about one directory.
  assert.equal(denied("/w/nested/deep/.env"), true, "denied basenames apply at any depth");

  assert.equal(denied("/w/notes.md"), false, "ordinary files are allowed");
  assert.equal(denied("/w/keyboard.md"), false, "*.key must not match 'keyboard.md'");
  assert.equal(denied("/w/.environment"), false, "'.env' must not match '.environment'");
});

test("an empty deny list denies nothing", () => {
  assert.equal(
    isWriteDeniedByFilesystemPolicy("/w/.env", { denyWrite: [], allowWrite: [] }, "/w"),
    false
  );
});

test("write refuses a path the sandbox filesystem policy denies", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "molibot-fspolicy-"));
  try {
    const tool = createWriteTool({
      cwd,
      workspaceDir: cwd,
      chatId: "chat-1",
      filesystemPolicy: { denyWrite: DENY, allowWrite: [] }
    });

    // `toolDefToAgentTool` turns a failed handler into a throw, so a denied
    // write surfaces as a rejection carrying the policy's message.
    await assert.rejects(
      () => tool.execute("t1", {
        label: "write",
        path: "secrets.key",
        content: "-----BEGIN PRIVATE KEY-----"
      }),
      /filesystem policy|denyWrite/i,
      "the write must fail, not silently succeed"
    );
    assert.equal(existsSync(join(cwd, "secrets.key")), false, "no bytes may reach disk");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("write still accepts a path the policy does not deny", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "molibot-fspolicy-"));
  try {
    const tool = createWriteTool({
      cwd,
      workspaceDir: cwd,
      chatId: "chat-1",
      filesystemPolicy: { denyWrite: DENY, allowWrite: [] }
    });

    await tool.execute("t1", { label: "write", path: "notes.md", content: "hello" });
    assert.equal(readFileSync(join(cwd, "notes.md"), "utf8"), "hello");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("edit refuses a denied path, and does not modify the file", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "molibot-fspolicy-"));
  try {
    const target = join(cwd, ".env");
    writeFileSync(target, "TOKEN=original\n", "utf8");

    const tool = createEditTool({
      cwd,
      workspaceDir: cwd,
      filesystemPolicy: { denyWrite: DENY, allowWrite: [] }
    });

    await assert.rejects(
      () => tool.execute("t1", {
        label: "edit",
        path: ".env",
        oldText: "TOKEN=original",
        newText: "TOKEN=stolen"
      }),
      /filesystem policy|denyWrite/i,
      "the edit must fail"
    );
    assert.equal(readFileSync(target, "utf8"), "TOKEN=original\n", "the file must be untouched");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("with no policy supplied the file tools behave exactly as before", async () => {
  // The policy is optional so every existing construction site keeps working;
  // absence means "no filesystem policy", never "deny everything".
  const cwd = mkdtempSync(join(tmpdir(), "molibot-fspolicy-"));
  try {
    await createWriteTool({ cwd, workspaceDir: cwd, chatId: "chat-1" })
      .execute("t1", { label: "write", path: "secrets.key", content: "x" });
    assert.equal(readFileSync(join(cwd, "secrets.key"), "utf8"), "x");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
