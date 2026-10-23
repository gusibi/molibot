import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime.js";
import { compactHandoverSnapshot } from "$lib/server/app/desktopHandover.js";
import type { DesktopHandoverAckResponse, DesktopHandoverResponse } from "$lib/shared/desktop.js";
import { GET as readHandover } from "../+server.js";

/** The previous generation stays usable across a quick leave-and-return. */
const PREVIOUS_GENERATION_VISIBLE_MS = 60 * 60 * 1000;

/**
 * Writes the Handover window when the user leaves the home (PA-HD3). Reading
 * the page never acknowledges it: opening and switching away must not swallow
 * events, so the write happens only here.
 *
 * The current rendering is frozen as the single previous generation (PA-HD13).
 * When the window is already empty and a fresh previous generation exists, that
 * one is kept — otherwise an immediate second leave would erase the very content
 * the user just saw.
 */
export const POST: RequestHandler = async () => {
  try {
    const now = new Date();
    const response = await readHandover(undefined as never);
    const payload = await response.json() as DesktopHandoverResponse;
    if (!payload.ok) throw new Error("Could not read the current Handover.");
    const runtime = getRuntime();
    const navigation = runtime.getSettings().desktopNavigation;
    const previous = navigation.previousHandover;
    const previousFresh = previous && now.getTime() - Date.parse(previous.capturedAt) <= PREVIOUS_GENERATION_VISIBLE_MS;
    const lastAcknowledgedAt = now.toISOString();
    runtime.updateSettings({
      desktopNavigation: {
        ...navigation,
        lastAcknowledgedAt,
        previousHandover: payload.handover.items.length === 0 && previousFresh
          ? previous
          : compactHandoverSnapshot(payload.handover, lastAcknowledgedAt)
      }
    });
    const ack: DesktopHandoverAckResponse = { ok: true, lastAcknowledgedAt };
    return json(ack, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
};
