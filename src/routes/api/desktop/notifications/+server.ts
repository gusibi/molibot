import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime.js";
import type { DesktopHomeNotificationsResponse } from "$lib/shared/desktop.js";

/**
 * The home notification center read/write endpoint. GET returns the unread
 * inbox (newest first); POST marks rows read. The rows are pointers — detail
 * content is resolved per type from its owning system.
 */
export const GET: RequestHandler = async () => {
  const runtime = getRuntime();
  const payload: DesktopHomeNotificationsResponse = {
    ok: true,
    notifications: runtime.homeNotifications.listUnread(50)
  };
  return json(payload, { headers: { "Cache-Control": "no-store" } });
};

export const POST: RequestHandler = async ({ request }) => {
  const runtime = getRuntime();
  try {
    const body = await request.json() as { action?: string; ids?: unknown };
    if (body.action === "mark_all_read") {
      runtime.homeNotifications.markAllRead();
    } else if (body.action === "mark_read") {
      const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === "string" && id.trim().length > 0) : [];
      for (const id of ids) runtime.homeNotifications.markRead(id);
    } else {
      return json({ ok: false, error: "Unsupported action" } satisfies DesktopHomeNotificationsResponse, { status: 400 });
    }
    const payload: DesktopHomeNotificationsResponse = {
      ok: true,
      notifications: runtime.homeNotifications.listUnread(50)
    };
    return json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) } satisfies DesktopHomeNotificationsResponse, { status: 500 });
  }
};
