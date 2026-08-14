import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime.js";
import type { MiniAppHost } from "$lib/server/miniapps/host.js";
import { getMiniAppHost } from "$lib/server/miniapps/registry.js";

const MAX_CHUNK_BYTES = 25 * 1024 * 1024;
const TOKEN = /^[A-Za-z0-9_-]{1,128}$/;

type AudioIngressHost = Pick<MiniAppHost, "listCatalog" | "handleHttp">;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

function validToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN.test(value);
}

export async function _handleMiniAppAudioRequest(request: Request, host: AudioIngressHost): Promise<Response> {
  let raw: Record<string, unknown>;
  try {
    raw = await request.json() as Record<string, unknown>;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (/body size exceeded|BODY_SIZE_LIMIT|Payload Too Large/i.test(message)) {
      return json(413, { ok: false, error: "Audio upload exceeded the service request limit." });
    }
    return json(400, { ok: false, error: "Request body must be JSON." });
  }
  if (!validToken(raw.appId) || !validToken(raw.meetingId) || !validToken(raw.trackId)) {
    return json(400, { ok: false, error: "appId, meetingId, and trackId are required." });
  }
  const app = host.listCatalog().find((entry) => entry.id === raw.appId);
  if (!app || !app.enabled || app.status !== "active" || !app.hostCapabilities?.includes("audioCapture")) {
    return json(403, { ok: false, error: "Mini App is not allowed to capture audio." });
  }

  if (raw.action === "chunk") {
    if (!Number.isInteger(raw.seq) || Number(raw.seq) < 0 || !Number.isInteger(raw.startMs) || !Number.isInteger(raw.endMs)) {
      return json(400, { ok: false, error: "Chunk timing is invalid." });
    }
    if (typeof raw.audioBase64 !== "string" || raw.audioBase64.length > Math.ceil(MAX_CHUNK_BYTES * 4 / 3) + 4) {
      return json(413, { ok: false, error: "Audio chunk is too large." });
    }
    const bytes = Buffer.from(raw.audioBase64, "base64");
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_CHUNK_BYTES) {
      return json(413, { ok: false, error: "Audio chunk is empty or too large." });
    }
    const query = new URLSearchParams({
      trackId: raw.trackId,
      seq: String(raw.seq),
      startMs: String(raw.startMs),
      endMs: String(raw.endMs)
    });
    return host.handleHttp(raw.appId, new Request(`http://miniapp.local/api/chunks/${raw.meetingId}?${query}`, {
      method: "POST",
      headers: { "content-type": typeof raw.mimeType === "string" ? raw.mimeType : "audio/wav" },
      body: bytes
    }), `/chunks/${raw.meetingId}`);
  }

  if (raw.action === "finish") {
    if (!Number.isInteger(raw.expectedLastSeq) || Number(raw.expectedLastSeq) < 0 || !Number.isInteger(raw.endMs) || Number(raw.endMs) < 0) {
      return json(400, { ok: false, error: "Capture completion is invalid." });
    }
    return host.handleHttp(raw.appId, new Request(`http://miniapp.local/api/meetings/${raw.meetingId}/finish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tracks: [{ id: raw.trackId, expectedLastSeq: raw.expectedLastSeq, endMs: raw.endMs }],
        captureError: typeof raw.captureError === "string" ? raw.captureError.slice(0, 500) : ""
      })
    }), `/meetings/${raw.meetingId}/finish`);
  }

  return json(400, { ok: false, error: "Unsupported audio action." });
}

export const POST: RequestHandler = async ({ request }) => {
  getRuntime();
  return _handleMiniAppAudioRequest(request, getMiniAppHost());
};
