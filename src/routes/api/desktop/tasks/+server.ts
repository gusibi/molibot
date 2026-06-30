import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { buildDesktopTaskSummary, resolveDesktopTaskPaths } from "$lib/server/app/desktopTasks";
import type { DesktopTaskActionRequest, DesktopTaskActionResponse, DesktopTaskResponse } from "$lib/shared/desktop";

// The shared tasks route's GET handler reads task files and returns the full
// (credential-bearing) item list. It ignores its RequestEvent argument, so we
// reuse it here and then project the result through the credential-safe
// desktop mapper instead of duplicating the file-reading logic.
import { GET as listTasks, POST as manageTasks } from "../../settings/tasks/+server";

interface SharedTaskListResponse {
  ok: true;
  items: unknown[];
}

export const GET: RequestHandler = async () => {
  const result = await listTasks(undefined as never);
  const payload = (await result.json()) as SharedTaskListResponse;
  if (!payload.ok) {
    return json({ ok: false, error: "Failed to list tasks" }, { status: 500 });
  }

  const summary = buildDesktopTaskSummary(payload.items as Parameters<typeof buildDesktopTaskSummary>[0]);
  const response: DesktopTaskResponse = { ok: true, summary };
  return json(response, { headers: { "Cache-Control": "no-store" } });
};

async function rawTaskList(): Promise<SharedTaskListResponse> {
  const result = await listTasks(undefined as never);
  return await result.json() as SharedTaskListResponse;
}

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json() as DesktopTaskActionRequest;
    const before = await rawTaskList();
    const rawItems = before.items as Parameters<typeof resolveDesktopTaskPaths>[0];
    const ids = body.action === "update" ? [body.id] : body.ids;
    if (!Array.isArray(ids) || ids.length === 0) throw new Error("Task ids are required");
    const paths = resolveDesktopTaskPaths(rawItems, ids);
    const pathToId = new Map([...paths].map(([id, path]) => [path, id]));
    const sharedBody = body.action === "update"
      ? { action: "update", filePath: paths.get(body.id), patch: body.patch }
      : { action: body.action, filePaths: body.ids.map((id) => paths.get(id)) };
    const result = await manageTasks({ request: new Request("http://localhost/api/settings/tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sharedBody) }) } as never);
    const managed = await result.json() as { ok?: boolean; updated?: string; deleted?: string[]; triggered?: string[]; failed?: Array<{ filePath: string; reason: string }>; error?: string };
    if (body.action === "update" && !managed.ok) throw new Error(managed.error || "Failed to update task");
    const after = await rawTaskList();
    const affectedPaths = body.action === "update" ? [managed.updated ?? ""] : body.action === "delete" ? managed.deleted ?? [] : managed.triggered ?? [];
    const response: DesktopTaskActionResponse = {
      ok: true,
      summary: buildDesktopTaskSummary(after.items as Parameters<typeof buildDesktopTaskSummary>[0]),
      affected: affectedPaths.map((path) => pathToId.get(path)).filter((id): id is string => Boolean(id)),
      failed: (managed.failed ?? []).map((item) => ({ id: pathToId.get(item.filePath) ?? "", reason: item.reason }))
    };
    return json(response);
  } catch (cause) {
    return json({ ok: false, error: cause instanceof Error ? cause.message : String(cause) }, { status: 400 });
  }
};
