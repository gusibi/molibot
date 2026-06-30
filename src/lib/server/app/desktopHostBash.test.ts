import assert from "node:assert/strict";
import test from "node:test";
import type { ApprovedHostBashEntry } from "$lib/server/hostBash/types";
import {
  buildDesktopHostBashSummary,
  buildDesktopHostBashWhitelistItem
} from "./desktopHostBash";

function entry(overrides: Partial<ApprovedHostBashEntry> = {}): ApprovedHostBashEntry {
  return {
    id: "wh-1",
    toolId: "host_bash",
    displayName: "List files",
    command: "ls -la /Users/secret",
    reason: "Read-only listing",
    channel: "web",
    chatId: "chat-1",
    scopeId: "scope-1",
    approvalMode: "persistent",
    permissions: { envAllowlist: ["PATH", "HOME"], filesystem: "workspace-read", network: "none" },
    approvedAt: "2026-06-28T00:00:00.000Z",
    approvedFromRecordId: "rec-1",
    enabled: true,
    ...overrides
  };
}

test("buildDesktopHostBashWhitelistItem drops the command but keeps identity, reason, mode, and permission summary", () => {
  const item = buildDesktopHostBashWhitelistItem(entry());

  assert.equal(item.id, "wh-1");
  assert.equal(item.toolId, "host_bash");
  assert.equal(item.displayName, "List files");
  assert.equal(item.reason, "Read-only listing");
  assert.equal(item.approvalMode, "persistent");
  assert.equal(item.enabled, true);
  assert.equal(item.permissions.envAllowlist, 2);
  assert.equal(item.permissions.filesystem, "workspace-read");
  assert.equal(item.permissions.network, "none");

  const serialized = JSON.stringify(item);
  assert.equal(serialized.includes("ls -la"), false);
  assert.equal(serialized.includes("/Users/secret"), false);
  assert.equal(serialized.includes("command"), false);
  assert.equal(serialized.includes("PATH"), false);
});

test("buildDesktopHostBashSummary counts pending, whitelist, enabled, and history", () => {
  const summary = buildDesktopHostBashSummary({
    pending: [{ id: "p1" }, { id: "p2" }],
    whitelist: [entry({ id: "a", enabled: true }), entry({ id: "b", enabled: false })],
    history: [{ id: "h1" }, { id: "h2" }, { id: "h3" }]
  });

  assert.deepEqual(summary.counts, { pending: 2, whitelist: 2, whitelistEnabled: 1, history: 3 });
  assert.equal(summary.whitelist.length, 2);
  assert.equal(JSON.stringify(summary).includes("ls -la"), false);
});
