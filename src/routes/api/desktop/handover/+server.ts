import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime.js";
import { SqliteTraceStore } from "$lib/server/agent/hooks/traceStore.js";
import { getEventExecutionLeaseStore } from "$lib/server/agent/eventsLeaseStore.js";
import { getApprovalBroker } from "$lib/server/approval/approvalBroker.js";
import { listDesktopSessionRuns } from "$lib/server/app/desktopConversations.js";
import { PlanService } from "$lib/server/agent/plans/service.js";
import { DurableExecutionCoordinator } from "$lib/server/agent/durable/coordinator.js";
import { readDesktopHandover, type HandoverTaskInput } from "$lib/server/app/desktopHandover.js";
import type { DesktopHandoverResponse } from "$lib/shared/desktop.js";
import { GET as listTasks } from "../../settings/tasks/+server.js";

/**
 * PA-HD1–13: one read endpoint for the whole Default Agent home. Every count,
 * entry, source and ordering decision comes from the read model, so the page and
 * its tests share one definition.
 */
export const GET: RequestHandler = async () => {
  const runtime = getRuntime();
  const traceStore = new SqliteTraceStore();
  try {
    const taskResponse = await listTasks(undefined as never);
    const taskPayload = await taskResponse.json() as { items?: HandoverTaskInput[] };
    const handover = readDesktopHandover({
      settings: runtime.getSettings(),
      sessions: runtime.sessions,
      traceStore,
      leaseStore: getEventExecutionLeaseStore(),
      hostBashStore: runtime.hostBashStore,
      brokerPending: () => getApprovalBroker().listPendingRequests(),
      sessionRuns: () => listDesktopSessionRuns().runs,
      plans: new PlanService(),
      coordinator: new DurableExecutionCoordinator(),
      tasks: taskPayload.items ?? []
    });
    const payload: DesktopHandoverResponse = { ok: true, handover };
    return json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  } finally {
    traceStore.close();
  }
};
