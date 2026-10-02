import { json } from "@sveltejs/kit";
import type { RoomService } from "$lib/server/rooms/service.js";
import type { RoomSubmission, RoomPermissionMode } from "$lib/shared/rooms.js";

function ids(value: unknown): string[] {
  if (!Array.isArray(value) || value.some(x => typeof x !== "string")) throw new Error("Agent IDs must be a list of strings");
  return value;
}
function permission(value: unknown): RoomPermissionMode | undefined {
  if (value === undefined) return undefined;
  if (!["plan", "manual", "accept_edits", "auto"].includes(String(value))) throw new Error("Invalid permission mode");
  return value as RoomPermissionMode;
}
function text(value: unknown): string { return typeof value === "string" ? value : ""; }
export async function handleRoomRequest(service: RoomService, request: Request, url: URL): Promise<Response> {
  try {
    if (request.method === "GET") {
      const id = url.searchParams.get("id");
      return json({ ok: true, ...(id ? { view: service.view(id) } : { rooms: service.list() }) }, { headers: { "Cache-Control": "no-store" } });
    }
    const body = await request.json() as Record<string, unknown>;
    const id = text(body.roomId);
    switch (body.action) {
      case "create": {
        const room = service.create({ title: text(body.title), agentIds: ids(body.agentIds), primaryAgentId: text(body.primaryAgentId) || undefined, projectId: text(body.projectId) || undefined, permissionMode: permission(body.permissionMode) });
        return json({ ok: true, room });
      }
      case "send": {
        const input: RoomSubmission = { submissionId: text(body.submissionId), text: text(body.text), agentIds: body.agentIds === undefined ? undefined : ids(body.agentIds), replyToId: text(body.replyToId) || undefined, attachments: service.attachments(id, body.attachmentIds === undefined ? [] : ids(body.attachmentIds)) };
        return json({ ok: true, dispatch: service.send(id, input) });
      }
      case "update": {
        const mode = permission(body.permissionMode);
        return json({ ok: true, room: service.update(id, { title: text(body.title) || undefined, agentIds: ids(body.agentIds), primaryAgentId: text(body.primaryAgentId), permissionMode: mode as RoomPermissionMode | undefined }) });
      }
      case "approve": {
        if (body.decision !== "approve_once" && body.decision !== "reject") throw new Error("Invalid approval decision");
        service.resolveApproval(id, text(body.executionId), body.decision); break;
      }
      case "reconcile": {
        if (body.outcome !== "completed" && body.outcome !== "failed") throw new Error("Invalid operation outcome");
        service.reconcileOperation(id, text(body.executionId), text(body.operationId), body.outcome); break;
      }
      case "delete": service.delete(id); break;
      case "stop": service.stop(id, text(body.executionId) || undefined); break;
      case "steer": return json({ ok: true, delivered: service.steer(id, text(body.executionId), text(body.text)) });
      case "resume": return json({ ok: true, dispatch: service.resume(id, text(body.executionId), text(body.submissionId)) });
      default: throw new Error("Unknown Room action");
    }
    return json({ ok: true });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
