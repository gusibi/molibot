import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getMemoryTraceStore, type MemoryTraceFeedbackValue } from "$lib/server/memory/traceStore.js";
import type { DesktopMemoryTraceResponse } from "$lib/shared/desktop.js";

export const GET: RequestHandler = async ({ params }) => {
  const trace = params.id ? getMemoryTraceStore().getById(params.id) : null;
  if (!trace) return json({ ok: false, error: "Memory trace not found" }, { status: 404 });
  const payload: DesktopMemoryTraceResponse = {
    ok: true,
    trace: {
      id: trace.id,
      query: trace.query,
      injectedItems: trace.injectedItems,
      writeReceipts: trace.writeReceipts,
      createdAt: trace.createdAt
    }
  };
  return json(payload, { headers: { "Cache-Control": "no-store" } });
};

const FEEDBACK_VALUES: MemoryTraceFeedbackValue[] = ["helpful", "irrelevant", "incorrect", "expired", "too_private"];

export const POST: RequestHandler = async ({ params, request }) => {
  const traceId = String(params.id ?? "").trim();
  const body = (await request.json().catch(() => null)) as { memoryId?: unknown; value?: unknown; comment?: unknown } | null;
  const memoryId = String(body?.memoryId ?? "").trim();
  const value = String(body?.value ?? "") as MemoryTraceFeedbackValue;
  if (!traceId || !memoryId || !FEEDBACK_VALUES.includes(value)) {
    return json({ ok: false, error: "trace id, memory id, and valid feedback are required" }, { status: 400 });
  }
  if (!getMemoryTraceStore().getById(traceId)) {
    return json({ ok: false, error: "Memory trace not found" }, { status: 404 });
  }
  getMemoryTraceStore().setFeedback(traceId, memoryId, value, String(body?.comment ?? ""));
  return json({ ok: true });
};
