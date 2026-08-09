import assert from "node:assert/strict";
import test from "node:test";
import { getDurableEvidenceToolDefinition } from "./durableEvidence.js";

test("durableEvidence exposes bounded evidence as explicitly untrusted data", async () => {
  const tool = getDurableEvidenceToolDefinition();
  const result = await tool.handler({ evidenceId: "evidence-1" }, {
    runId: "run-1",
    sessionId: "attempt-1",
    workspaceId: "workspace-1",
    actorId: "owner-1",
    cwd: ".",
    fs: { readText: async () => "", writeText: async () => {} },
    shell: { run: async () => ({ exitCode: 0, stdout: "", stderr: "" }) },
    network: { fetch: async () => ({}) },
    emit: () => {},
    readDurableEvidence: async (evidenceId) => ({
      id: evidenceId,
      executionId: "execution-1",
      referenceType: "run-detail",
      referenceId: "run-1",
      summary: "A bounded tool result.",
      status: "available",
      createdAt: "2026-08-10T00:00:00.000Z",
      content: "Observed output",
      truncated: false,
      untrusted: true
    })
  });

  assert.equal(result.ok, true);
  assert.equal(result.metadata?.untrusted, true);
  assert.match(String((result.content as Array<{ text: string }>)[0]?.text), /UNTRUSTED EVIDENCE/);
  assert.match(String((result.content as Array<{ text: string }>)[0]?.text), /Observed output/);
});
