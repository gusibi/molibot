import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getMemoryTraceStore, type MemoryTraceFeedbackValue } from "$lib/server/memory/traceStore.js";
import type { DesktopMemoryTraceResponse } from "$lib/shared/desktop.js";
import { getRuntime } from "$lib/server/app/runtime.js";

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
  const body = (await request.json().catch(() => null)) as { memoryId?: unknown; value?: unknown; comment?: unknown; idempotencyKey?: unknown } | null;
  const memoryId = String(body?.memoryId ?? "").trim();
  const value = String(body?.value ?? "") as MemoryTraceFeedbackValue;
  const idempotencyKey = String(body?.idempotencyKey ?? "").trim();
  if (!traceId || !memoryId || !idempotencyKey || !FEEDBACK_VALUES.includes(value)) {
    return json({ ok: false, error: "trace id, memory id, idempotency key, and valid feedback are required" }, { status: 400 });
  }
  if (!getMemoryTraceStore().getById(traceId)) {
    return json({ ok: false, error: "Memory trace not found" }, { status: 404 });
  }
  try {
    const result = await getRuntime().memory.applyTraceFeedback(getMemoryTraceStore(), {
      traceId,
      memoryId,
      value,
      comment: String(body?.comment ?? ""),
      idempotencyKey
    });
    return json({ ok: true, duplicate: result.duplicate });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    const status = /not injected|not authorized/i.test(message) ? 403 : 409;
    return json({ ok: false, error: message }, { status });
  }
};
