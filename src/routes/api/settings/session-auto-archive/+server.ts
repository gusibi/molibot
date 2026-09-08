import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { sanitizeSessionAutoArchiveSettings } from "$lib/server/settings/sanitize.js";
import {
  deleteSessionAutoArchiveBot,
  getSessionAutoArchive,
  updateSessionAutoArchiveGlobal,
  upsertSessionAutoArchiveBot
} from "$lib/server/settings/handlers/sessionAutoArchive.js";

function overview() {
  const runtime = getRuntime();
  const policy = getSessionAutoArchive(runtime);
  return {
    policy,
    previewCount: runtime.sessionAutoArchive.previewCount(policy),
    lastRun: runtime.sessionAutoArchive.getLastRun()
  };
}

export const GET: RequestHandler = async () => {
  try {
    return json({ ok: true, ...overview() });
  } catch (error: any) {
    return json({ ok: false, error: error.message || String(error) }, { status: 500 });
  }
};

/**
 * Read-only preview for unsaved edits: how many sessions currently qualify
 * under the candidate policy. Never mutates sessions — saving still takes
 * effect on the next scheduled sweep.
 */
export const POST: RequestHandler = async ({ request }) => {
  let body: { policy?: unknown };
  try {
    body = (await request.json()) as { policy?: unknown };
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  try {
    const runtime = getRuntime();
    const candidate = sanitizeSessionAutoArchiveSettings(
      body.policy,
      runtime.getSettings().sessionAutoArchive
    );
    return json({ ok: true, previewCount: runtime.sessionAutoArchive.previewCount(candidate) });
  } catch (error: any) {
    return json({ ok: false, error: error.message || String(error) }, { status: 400 });
  }
};

export const PUT: RequestHandler = async ({ request }) => {
  let body: { global?: unknown; bot?: unknown; botId?: unknown };
  try {
    body = (await request.json()) as { global?: unknown; bot?: unknown; botId?: unknown };
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  try {
    const runtime = getRuntime();
    if (body.bot !== undefined || body.botId !== undefined) {
      const raw = (body.bot ?? {}) as Record<string, unknown>;
      const botId = String(body.botId ?? raw.botId ?? "").trim();
      if (!botId) return json({ ok: false, error: "botId is required" }, { status: 400 });
      upsertSessionAutoArchiveBot(runtime, botId, raw);
    } else if (body.global !== undefined) {
      updateSessionAutoArchiveGlobal(runtime, body.global);
    } else {
      return json({ ok: false, error: "global or bot policy is required" }, { status: 400 });
    }
    return json({ ok: true, ...overview() });
  } catch (error: any) {
    return json({ ok: false, error: error.message || String(error) }, { status: 400 });
  }
};

export const DELETE: RequestHandler = async ({ request }) => {
  let body: { botId?: string };
  try {
    body = (await request.json()) as { botId?: string };
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  const botId = String(body.botId ?? "").trim();
  if (!botId) {
    return json({ ok: false, error: "botId is required" }, { status: 400 });
  }
  try {
    deleteSessionAutoArchiveBot(getRuntime(), botId);
    return json({ ok: true, ...overview() });
  } catch (error: any) {
    return json({ ok: false, error: error.message || String(error) }, { status: 400 });
  }
};
