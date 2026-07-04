import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { buildDesktopTaskSessionMessages, buildDesktopTaskSummary, desktopTaskId, resolveDesktopTaskPaths, type DesktopTaskExecutionLoader } from "$lib/server/app/desktopTasks";
import type { DesktopTaskActionRequest, DesktopTaskActionResponse, DesktopTaskResponse } from "$lib/shared/desktop";
import { resolve } from "node:path";
import { MomRuntimeStore } from "$lib/server/agent/session/store";
import { getEventExecutionLeaseStore } from "$lib/server/agent/eventsLeaseStore";

// The shared tasks route's GET handler reads task files and returns the full
// (credential-bearing) item list. It ignores its RequestEvent argument, so we
// reuse it here and then project the result through the credential-safe
// desktop mapper instead of duplicating the file-reading logic.
import { GET as listTasks, POST as manageTasks } from "../../settings/tasks/+server";

interface SharedTaskListResponse {
  ok: true;
  items: unknown[];
  targets?: Array<{ channel: string; botId: string; chatId: string; scope: "workspace" | "chat-scratch" }>;
}

function projectExecutions(taskId: string, limit: number, offset = 0) {
  const store = getEventExecutionLeaseStore();
  return store.listForTask(taskId, limit, offset).map((execution) => ({
    id: execution.id,
    status: execution.status,
    sessionId: execution.sessionId,
    runId: execution.runId,
    attempt: execution.attempt,
    maxAttempts: execution.maxAttempts,
    startedAt: execution.startedAt,
    finishedAt: execution.finishedAt,
    stopReason: execution.stopReason,
    lastError: execution.lastError
  }));
}

const loadTaskExecutions: DesktopTaskExecutionLoader = (taskId) => ({
  items: projectExecutions(taskId, 3),
  total: getEventExecutionLeaseStore().countForTask(taskId)
});

export const GET: RequestHandler = async () => {
  const result = await listTasks(undefined as never);
  const payload = (await result.json()) as SharedTaskListResponse;
  if (!payload.ok) {
    return json({ ok: false, error: "Failed to list tasks" }, { status: 500 });
  }

  const summary = buildDesktopTaskSummary(payload.items as Parameters<typeof buildDesktopTaskSummary>[0], loadTaskExecutions, payload.targets ?? []);
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
    if (body.action === "create") {
      const result = await manageTasks({ request: new Request("http://localhost/api/settings/tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) } as never);
      const managed = await result.json() as { ok?: boolean; created?: string; error?: string };
      if (!managed.ok || !managed.created) throw new Error(managed.error || "Failed to create task");
      const after = await rawTaskList();
      const createdId = desktopTaskId(managed.created);
      return json({ ok: true, summary: buildDesktopTaskSummary(after.items as Parameters<typeof buildDesktopTaskSummary>[0], loadTaskExecutions, after.targets ?? []), affected: [createdId], failed: [] } satisfies DesktopTaskActionResponse);
    }
    const ids = body.action === "update" || body.action === "session" || body.action === "history" ? [body.id] : body.ids;
    if (!Array.isArray(ids) || ids.length === 0) throw new Error("Task ids are required");
    const paths = resolveDesktopTaskPaths(rawItems, ids);
    const pathToId = new Map([...paths].map(([id, path]) => [path, id]));
    if (body.action === "history") {
      const item = rawItems.find((entry) => pathToId.get(entry.filePath) === body.id);
      if (!item) throw new Error("Task not found");
      const pageSize = Math.max(1, Math.min(50, Math.round(body.pageSize || 10)));
      const page = Math.max(1, Math.round(body.page || 1));
      const taskId = String(item.taskId ?? "").trim();
      const response: DesktopTaskActionResponse = {
        ok: true,
        summary: buildDesktopTaskSummary(rawItems, loadTaskExecutions, before.targets ?? []),
        affected: [], failed: [],
        history: { items: projectExecutions(taskId, pageSize, (page - 1) * pageSize), page, pageSize, total: getEventExecutionLeaseStore().countForTask(taskId) }
      };
      return json(response);
    }
    if (body.action === "session") {
      const item = rawItems.find((entry) => pathToId.get(entry.filePath) === body.id);
      if (!item) throw new Error("Task not found");
      const execution = getEventExecutionLeaseStore().getById(body.executionId);
      if (!execution || execution.taskId !== item.taskId) throw new Error("Execution not found");
      const marker = item.scope === "workspace" ? "/events/" : `/${item.chatId}/scratch/events/`;
      const markerIndex = resolve(item.filePath).indexOf(marker);
      if (markerIndex < 0) throw new Error("Unsupported task path");
      const workspaceDir = resolve(item.filePath).slice(0, markerIndex);
      const store = new MomRuntimeStore(workspaceDir);
      const messages = buildDesktopTaskSessionMessages(store.loadContext(item.chatId, execution.sessionId));
      const response: DesktopTaskActionResponse = {
        ok: true,
        summary: buildDesktopTaskSummary(rawItems, loadTaskExecutions, before.targets ?? []),
        affected: [],
        failed: [],
        session: {
          taskId: item.taskId ?? "",
          sessionId: execution.sessionId,
          messages
        }
      };
      return json(response);
    }
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
      summary: buildDesktopTaskSummary(after.items as Parameters<typeof buildDesktopTaskSummary>[0], loadTaskExecutions, after.targets ?? []),
      affected: affectedPaths.map((path) => pathToId.get(path)).filter((id): id is string => Boolean(id)),
      failed: (managed.failed ?? []).map((item) => ({ id: pathToId.get(item.filePath) ?? "", reason: item.reason }))
    };
    return json(response);
  } catch (cause) {
    return json({ ok: false, error: cause instanceof Error ? cause.message : String(cause) }, { status: 400 });
  }
};
