import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime.js";
import type {
  HomeNotificationListOptions,
  HomeNotificationStatusFilter,
  HomeNotificationType
} from "$lib/server/app/homeNotifications.js";
import type { DesktopHomeNotificationsResponse } from "$lib/shared/desktop.js";

const VALID_NOTIFICATION_TYPES = new Set<HomeNotificationType>([
  "memory-review",
  "materials",
  "task-result",
  "task-failed",
  "action-required",
  "plan-completed",
  "cross-channel",
  "follow-up"
]);

function parseStatusFilter(value: unknown): HomeNotificationStatusFilter {
  return value === "all" || value === "read" || value === "unread" ? value : "unread";
}

function parseNotificationType(value: unknown): HomeNotificationType | undefined {
  return typeof value === "string" && VALID_NOTIFICATION_TYPES.has(value as HomeNotificationType)
    ? (value as HomeNotificationType)
    : undefined;
}

function parseLimit(value: unknown, status: HomeNotificationStatusFilter): number {
  const numeric = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  if (Number.isFinite(numeric) && numeric > 0) return Math.floor(numeric);
  return status === "unread" ? 50 : 100;
}

function parseQueryOptions(raw: { status?: unknown; type?: unknown; limit?: unknown }): HomeNotificationListOptions {
  const status = parseStatusFilter(raw.status);
  const type = parseNotificationType(raw.type);
  const limit = parseLimit(raw.limit, status);
  return { status, ...(type ? { type } : {}), limit };
}

/**
 * The home notification center read/write endpoint. GET returns the requested
 * notification slice (default unread, newest first); POST marks rows read and
 * returns the refreshed slice. Rows are pointers — detail content is resolved
 * per type from its owning system.
 */
export const GET: RequestHandler = async (event) => {
  const runtime = getRuntime();
  const params = event?.url?.searchParams;
  const options = parseQueryOptions({
    status: params?.get("status"),
    type: params?.get("type"),
    limit: params?.get("limit")
  });
  const payload: DesktopHomeNotificationsResponse = {
    ok: true,
    notifications: runtime.homeNotifications.list(options)
  };
  return json(payload, { headers: { "Cache-Control": "no-store" } });
};

export const POST: RequestHandler = async ({ request }) => {
  const runtime = getRuntime();
  try {
    const body = await request.json() as { action?: string; ids?: unknown; status?: unknown; type?: unknown; limit?: unknown };
    if (body.action === "mark_all_read") {
      runtime.homeNotifications.markAllRead();
    } else if (body.action === "mark_read") {
      const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === "string" && id.trim().length > 0) : [];
      for (const id of ids) runtime.homeNotifications.markRead(id);
    } else {
      return json({ ok: false, error: "Unsupported action" } satisfies DesktopHomeNotificationsResponse, { status: 400 });
    }
    const options = parseQueryOptions(body);
    const payload: DesktopHomeNotificationsResponse = {
      ok: true,
      notifications: runtime.homeNotifications.list(options)
    };
    return json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) } satisfies DesktopHomeNotificationsResponse, { status: 500 });
  }
};
