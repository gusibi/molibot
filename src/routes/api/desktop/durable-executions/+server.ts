import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime.js";
import { getApprovalBroker } from "$lib/server/approval/approvalBroker.js";
import {
  DurableExecutionConflictError,
  DurableExecutionNotFoundError,
  DurableExecutionTransitionError
} from "$lib/server/agent/durable/store.js";
import { DurableExecutionCoordinator } from "$lib/server/agent/durable/coordinator.js";
import type {
  DesktopDurableExecutionActionRequest,
  DesktopDurableExecutionActionResponse,
  DesktopDurableExecutionEvidenceReadResponse,
  DesktopDurableExecutionInspectionResponse,
  DesktopDurableExecutionResponse
} from "$lib/shared/desktop";

const coordinator = new DurableExecutionCoordinator();

function ownerId(value: unknown): string {
  // Web/Desktop currently has one local owner. Channel adapters will pass their
  // authenticated owner through the shared coordinator rather than inventing a
  // per-channel task identity.
  return String(value ?? "owner").trim() || "owner";
}

function failure(cause: unknown): Response {
  const status = cause instanceof DurableExecutionNotFoundError
    ? 404
    : cause instanceof DurableExecutionConflictError || cause instanceof DurableExecutionTransitionError
      ? 409
      : 400;
  return json({ ok: false, error: cause instanceof Error ? cause.message : String(cause) }, { status });
}

export const GET: RequestHandler = async ({ url }) => {
  try {
    const runtime = getRuntime();
    const owner = ownerId(url.searchParams.get("ownerId"));
    const executionId = String(url.searchParams.get("id") ?? "").trim();
    if (executionId) {
      const evidenceId = String(url.searchParams.get("evidenceId") ?? "").trim();
      if (evidenceId) {
        const detail = coordinator.inspect(owner, executionId);
        const manager = runtime.channelManagers.get(detail.execution.sourceChannel)?.get(detail.execution.botId);
        const evidence = coordinator.readEvidence(
          owner,
          executionId,
          evidenceId,
          manager?.readDurableRunDetail ? manager.readDurableRunDetail.bind(manager) : undefined
        );
        const response: DesktopDurableExecutionEvidenceReadResponse = { ok: true, evidence };
        return json(response, { headers: { "Cache-Control": "no-store" } });
      }
      const response: DesktopDurableExecutionInspectionResponse = { ok: true, item: coordinator.inspect(owner, executionId) };
      return json(response, { headers: { "Cache-Control": "no-store" } });
    }
    if (url.searchParams.has("evidenceId")) throw new Error("An execution id is required to read evidence.");
    const items = coordinator.list({
      ownerId: owner,
      botId: String(url.searchParams.get("botId") ?? "").trim() || undefined,
      limit: Number(url.searchParams.get("limit") ?? 50)
    });
    const response: DesktopDurableExecutionResponse = { ok: true, items };
    return json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    return failure(cause);
  }
};

export const POST: RequestHandler = async ({ request }) => {
  try {
    getRuntime();
    const body = await request.json() as DesktopDurableExecutionActionRequest;
    const owner = ownerId(body.ownerId);
    if (body.action === "create") {
      const created = coordinator.create({
        ...body,
        ownerId: owner,
        activationPath: body.activationPath ?? "deterministic"
      });
      const activated = coordinator.activate({
        ownerId: owner,
        executionId: created.execution.id,
        expectedVersion: created.execution.version
      });
      const response: DesktopDurableExecutionActionResponse = { ok: true, item: activated };
      return json(response, { headers: { "Cache-Control": "no-store" } });
    }
    if (body.action === "answer_decision") {
      const result = coordinator.answerDecision({ ...body, ownerId: owner });
      const response: DesktopDurableExecutionActionResponse = { ok: true, item: result };
      return json(response, { headers: { "Cache-Control": "no-store" } });
    }
    if (body.action === "resolve_approval") {
      const detail = coordinator.inspect(owner, body.executionId);
      const approval = detail.approvals.find((item) => item.id === body.approvalId);
      if (!approval) return json({ ok: false, error: "Approval request not found." }, { status: 404 });
      const selectedScope = body.selectedScope === "session" || body.selectedScope === "persistent" ? body.selectedScope : "once";
      if (approval.backend === "approval_broker") {
        const brokerRequest = getApprovalBroker().getRequest(approval.requestId);
        if (!brokerRequest || brokerRequest.status !== "pending") {
          return json({ ok: false, error: "The underlying approval request is no longer pending." }, { status: 409 });
        }
        const resolved = getApprovalBroker().resolveRequest({
          requestId: approval.requestId,
          status: body.status === "approved" ? "approved" : "rejected",
          ...(body.status === "approved" ? { selectedScope } : {})
        });
        if (!resolved.request) return json({ ok: false, error: "The underlying approval request could not be resolved." }, { status: 409 });
      } else if (body.status === "approved") {
        const sourceChatId = detail.execution.sourceChatId;
        if (!sourceChatId) return json({ ok: false, error: "Durable approval has no source chat." }, { status: 409 });
        const approved = getRuntime().hostBashStore.approve(sourceChatId, approval.requestId, {
          scope: selectedScope === "persistent" ? "persistent" : selectedScope === "session" ? "session" : "once"
        });
        if (!approved) return json({ ok: false, error: "The underlying Host Bash approval request is no longer pending." }, { status: 409 });
      } else {
        const sourceChatId = detail.execution.sourceChatId;
        if (!sourceChatId || !getRuntime().hostBashStore.reject(sourceChatId, approval.requestId)) {
          return json({ ok: false, error: "The underlying Host Bash approval request is no longer pending." }, { status: 409 });
        }
      }
      const result = coordinator.resolveApproval({ ...body, ownerId: owner });
      const response: DesktopDurableExecutionActionResponse = { ok: true, item: result };
      return json(response, { headers: { "Cache-Control": "no-store" } });
    }
    const result = body.action === "pause"
      ? coordinator.pause({ ...body, ownerId: owner })
      : body.action === "resume"
        ? coordinator.resume({ ...body, ownerId: owner })
        : coordinator.cancel({ ...body, ownerId: owner });
    const response: DesktopDurableExecutionActionResponse = { ok: true, item: result };
    return json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    return failure(cause);
  }
};
