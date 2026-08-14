export const MINIAPP_HOST_CAPABILITY_PROTOCOL = "molibot-miniapp-host-capability" as const;
export const MINIAPP_HOST_CAPABILITY_VERSION = 1 as const;

export type MiniAppHostCapabilityRequest =
  | {
      protocol: typeof MINIAPP_HOST_CAPABILITY_PROTOCOL;
      version: typeof MINIAPP_HOST_CAPABILITY_VERSION;
      requestId: string;
      action: "audio.start";
      meetingId: string;
      trackId: string;
    }
  | {
      protocol: typeof MINIAPP_HOST_CAPABILITY_PROTOCOL;
      version: typeof MINIAPP_HOST_CAPABILITY_VERSION;
      requestId: string;
      action: "audio.pause" | "audio.resume" | "audio.stop" | "audio.status";
    };

export interface MiniAppHostCapabilityResult {
  protocol: typeof MINIAPP_HOST_CAPABILITY_PROTOCOL;
  version: typeof MINIAPP_HOST_CAPABILITY_VERSION;
  requestId: string;
  type: "result";
  ok: boolean;
  payload?: Record<string, unknown>;
  error?: string;
}

export type MiniAppHostCapabilityParseResult =
  | { ok: true; value: MiniAppHostCapabilityRequest }
  | { ok: false; reason: string };

function validToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

export function parseMiniAppHostCapabilityMessage(value: unknown): MiniAppHostCapabilityParseResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, reason: "message must be an object" };
  const raw = value as Record<string, unknown>;
  if (raw.protocol !== MINIAPP_HOST_CAPABILITY_PROTOCOL || raw.version !== MINIAPP_HOST_CAPABILITY_VERSION) {
    return { ok: false, reason: "unsupported protocol" };
  }
  if (!validToken(raw.requestId)) return { ok: false, reason: "invalid requestId" };
  if (raw.action === "audio.start") {
    if (!validToken(raw.meetingId) || !validToken(raw.trackId)) return { ok: false, reason: "invalid audio target" };
    return { ok: true, value: {
      protocol: MINIAPP_HOST_CAPABILITY_PROTOCOL,
      version: MINIAPP_HOST_CAPABILITY_VERSION,
      requestId: raw.requestId,
      action: raw.action,
      meetingId: raw.meetingId,
      trackId: raw.trackId
    } };
  }
  if (["audio.pause", "audio.resume", "audio.stop", "audio.status"].includes(String(raw.action))) {
    return { ok: true, value: {
      protocol: MINIAPP_HOST_CAPABILITY_PROTOCOL,
      version: MINIAPP_HOST_CAPABILITY_VERSION,
      requestId: raw.requestId,
      action: raw.action as "audio.pause" | "audio.resume" | "audio.stop" | "audio.status"
    } };
  }
  return { ok: false, reason: "unsupported action" };
}

export function miniAppHostCapabilityResult(
  requestId: string,
  result: { ok: true; payload?: Record<string, unknown> } | { ok: false; error: string }
): MiniAppHostCapabilityResult {
  return {
    protocol: MINIAPP_HOST_CAPABILITY_PROTOCOL,
    version: MINIAPP_HOST_CAPABILITY_VERSION,
    requestId,
    type: "result",
    ...result
  };
}
