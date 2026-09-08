import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import { SessionStore } from "$lib/server/sessions/store.js";
import { SessionLifecycleStore } from "$lib/server/sessions/sessionLifecycleStore.js";
import { SessionLifecycleService } from "$lib/server/sessions/sessionLifecycleService.js";
import { SessionBulkStore, type BulkTarget } from "$lib/server/sessions/sessionBulkStore.js";
import { SessionBulkService } from "$lib/server/sessions/sessionBulkService.js";
import type {
  ExtractAndArchiveResult,
  SessionExtractionResult
} from "$lib/server/sessions/sessionExtractionService.js";
import { executeManagedExtraction } from "$lib/server/sessions/sessionExtractionBatch.js";

const OWNER = "web:personal:web-anonymous";

function scriptedResult(id: string, status: SessionExtractionResult["status"]): SessionExtractionResult {
  return {
    conversationId: id,
    status,
    messageRevision: "1:m1:2026-09-10T00:00:00.000Z",
    processedThroughId: "m1",
    savedMemoryIds: status === "saved" ? ["mem-1"] : [],
    savedDocRefs: [],
    pendingCandidateIds: status === "pending-review" ? ["cand-1"] : [],
    failureReasons: status === "failed" ? ["boom"] : []
  };
}

/** RED: batch module does not exist yet. Scripted T8 seam. */
function fakeExtraction(archivedIds: Set<string>) {
  return {
    async extract(input: { conversationId: string }): Promise<SessionExtractionResult> {
      const id = input.conversationId;
      const status = id === "fail-1" ? "failed" : id === "pending-1" ? "pending-review" : "saved";
      return scriptedResult(id, status);
    },
    async extractAndArchive(input: { conversationId: string }): Promise<ExtractAndArchiveResult> {
      const base = await this.extract(input);
      if (base.status !== "saved" && base.status !== "no-useful-information") {
        return {
          ...base,
          archived: false,
          archiveReason: base.status === "pending-review" ? "pending-review" : "extraction-failed"
        };
      }
      if (archivedIds.has(input.conversationId)) return { ...base, archived: true };
      return { ...base, archived: false, archiveReason: "archive-skipped: busy" };
    }
  };
}

function fakeSelections(targets: BulkTarget[]) {
  return {
    getSelectionTargets(selectionId: string): BulkTarget[] {
      if (selectionId !== "sel-1") throw new Error(`Unknown selection: ${selectionId}`);
      return targets;
    }
  };
}

test("extract-and-archive archives only gated successes and reports the gate plainly", async () => {
  const result = await executeManagedExtraction(
    { extraction: fakeExtraction(new Set(["a"])), selections: fakeSelections([]) },
    {
      mode: "extract-and-archive",
      targets: [{ conversationId: "a", expectedVersion: null }, { conversationId: "pending-1", expectedVersion: null }, { conversationId: "fail-1", expectedVersion: null }]
    }
  );
  assert.equal(result.mode, "extract-and-archive");
  assert.equal(result.counts.total, 3);
  assert.equal(result.counts.archived, 1);
  assert.equal(result.counts.failed, 1);
  const byId = new Map(result.items.map((item) => [item.conversationId, item]));
  assert.equal(byId.get("a")?.archived, true);
  assert.equal(byId.get("a")?.status, "saved");
  assert.equal(byId.get("pending-1")?.archived, false);
  assert.equal(byId.get("pending-1")?.archiveReason, "pending-review");
  assert.equal(byId.get("fail-1")?.archived, false);
  assert.equal(byId.get("fail-1")?.archiveReason, "extraction-failed");
});

test("extract mode never archives and resolves server selections", async () => {
  const result = await executeManagedExtraction(
    {
      extraction: fakeExtraction(new Set(["a"])),
      selections: fakeSelections([{ conversationId: "a", expectedVersion: 1 }])
    },
    { mode: "extract", selectionId: "sel-1" }
  );
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].archived, false);
  assert.equal(result.items[0].archiveReason, undefined);
  assert.equal(result.counts.archived, 0);
});

test("unknown selection surfaces instead of silently extracting nothing", async () => {
  await assert.rejects(
    () =>
      executeManagedExtraction(
        { extraction: fakeExtraction(new Set()), selections: fakeSelections([]) },
        { mode: "extract", selectionId: "missing" }
      ),
    /Unknown selection/
  );
});

test("real bulk snapshots feed extraction targets; extraction never deletes", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "molibot-session-extract-batch-"));
  const originals = {
    webWorkspaceDir: storagePaths.webWorkspaceDir,
    sessionsDir: storagePaths.sessionsDir,
    sessionsIndexFile: storagePaths.sessionsIndexFile,
    projectsDir: storagePaths.projectsDir
  };
  storagePaths.webWorkspaceDir = path.join(root, "web");
  storagePaths.sessionsDir = path.join(root, "legacy");
  storagePaths.sessionsIndexFile = path.join(root, "legacy-index.json");
  storagePaths.projectsDir = path.join(root, "projects");
  t.after(() => {
    Object.assign(storagePaths, originals);
    rmSync(root, { recursive: true, force: true });
  });
  const sessions = new SessionStore();
  const lifecycleRows = new SessionLifecycleStore(path.join(root, "sessions.db"));
  t.after(() => {
    try { lifecycleRows.close(); } catch { /* ignore */ }
  });
  const lifecycle = new SessionLifecycleService({ sessions, lifecycle: lifecycleRows });
  const bulk = new SessionBulkService({ lifecycle, lifecycleRows, bulk: new SessionBulkStore(path.join(root, "bulk.db")) });
  const conversation = sessions.createWebConversation(OWNER);
  const selection = bulk.createSelection({ requesterExternalUserId: OWNER, targets: [conversation.id] });

  const seen: string[] = [];
  const result = await executeManagedExtraction(
    {
      extraction: {
        async extract(input: { conversationId: string }) {
          seen.push(input.conversationId);
          return scriptedResult(input.conversationId, "saved");
        },
        async extractAndArchive(input: { conversationId: string }) {
          seen.push(input.conversationId);
          const base = scriptedResult(input.conversationId, "saved");
          return { ...base, archived: false, archiveReason: "archive-skipped: busy" };
        }
      },
      selections: { getSelectionTargets: (selectionId: string) => bulk.getSelectionTargets(selectionId) }
    },
    { mode: "extract-and-archive", selectionId: selection.selectionId, requesterExternalUserId: OWNER }
  );
  assert.deepEqual(seen, [conversation.id]);
  assert.equal(result.items[0].archived, false);
  // The session still exists: extraction never deletes.
  assert.ok(sessions.getConversationById(conversation.id, "web", OWNER));
  assert.throws(() => bulk.getSelectionTargets("nope"), /Unknown selection/);
});
