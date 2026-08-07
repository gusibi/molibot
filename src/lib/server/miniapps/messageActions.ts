import { randomUUID } from "node:crypto";
import type { MiniAppHost } from "$lib/server/miniapps/host.js";
import { stageIncomingResource, validateIncomingResource } from "$lib/server/miniapps/incomingResources.js";
import {
  MiniAppError,
  miniAppToolId,
  type MessageCaptureContext,
  type MiniAppToolResult
} from "$lib/server/miniapps/types.js";

export const MAX_MESSAGE_CAPTURE_BYTES = 64 * 1024;

export interface CaptureAuthority {
  channel: string;
  now?: Date;
  dataRoot?: string;
  resolveResource?: (locator: unknown) => Promise<ResolvedMessageActionResource>;
  warn?: (event: string, detail: Record<string, unknown>) => void;
}

export interface ResolvedMessageActionResource {
  sourcePath: string;
  original: string;
  kind: "image" | "file";
  mimeType?: string;
}

export interface MessageActionInvokeRequest {
  appId: string;
  tool: string;
  capture: unknown;
  resources?: unknown[];
}

export interface MessageActionInvokeResult {
  content: MiniAppToolResult["content"];
  structuredContent?: unknown;
  /** Already sanitized by the host; absent when the app returned none. */
  card?: MiniAppToolResult["card"];
}

/** Returns the longest prefix that is complete UTF-8 and fits `maxBytes`. */
function sliceUtf8(text: string, maxBytes: number): string {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.byteLength <= maxBytes) return text;
  let end = maxBytes;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
  return bytes.subarray(0, end).toString("utf8");
}

/**
 * Builds the only capture shape an App may receive.
 *
 * Client time/channel and unknown identity fields are deliberately ignored;
 * the host clock and the route's authenticated surface own those values.
 */
export function buildMessageCaptureContext(
  input: unknown,
  authority: CaptureAuthority
): MessageCaptureContext {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new MiniAppError("capture must be an object.", "invalid_input");
  }
  const raw = input as Record<string, unknown>;
  if (typeof raw.text !== "string" || raw.text.trim().length === 0) {
    throw new MiniAppError("capture.text must be a non-empty string.", "invalid_input");
  }
  if (raw.role !== "assistant" && raw.role !== "user") {
    throw new MiniAppError("capture.role must be assistant or user.", "invalid_input");
  }

  const textBytes = Buffer.byteLength(raw.text, "utf8");
  const selection = typeof raw.selection === "string" ? raw.selection.trim() : "";
  const source = raw.source && typeof raw.source === "object" && !Array.isArray(raw.source)
    ? raw.source as Record<string, unknown>
    : {};
  const sessionTitle = typeof source.sessionTitle === "string"
    ? source.sessionTitle.trim().slice(0, 200)
    : "";

  return {
    text: sliceUtf8(raw.text, MAX_MESSAGE_CAPTURE_BYTES),
    ...(selection ? { selection: sliceUtf8(selection, MAX_MESSAGE_CAPTURE_BYTES) } : {}),
    role: raw.role,
    truncated: textBytes > MAX_MESSAGE_CAPTURE_BYTES,
    capturedAt: (authority.now ?? new Date()).toISOString(),
    source: {
      ...(sessionTitle ? { sessionTitle } : {}),
      channel: String(authority.channel ?? "").trim() || "desktop"
    }
  };
}

/** Applies the host's contribution allowlist, then invokes one declared action. */
export async function invokeMessageAction(
  host: MiniAppHost,
  request: MessageActionInvokeRequest,
  authority: CaptureAuthority
): Promise<MessageActionInvokeResult> {
  if (!request || typeof request.appId !== "string" || typeof request.tool !== "string") {
    throw new MiniAppError("appId and tool are required.", "invalid_input");
  }
  const app = host.listCatalog().find((entry) => entry.id === request.appId);
  if (!app) throw new MiniAppError("Mini App not found.", "not_found");
  if (!app.enabled || app.status !== "active") {
    throw new MiniAppError("Mini App is not active.", "disabled");
  }
  if (!app.messageActions.some((action) => action.tool === request.tool)) {
    throw new MiniAppError("This tool is not declared as a message action.", "forbidden");
  }

  const capture = buildMessageCaptureContext(request.capture, authority);
  const locators = request.resources ?? [];
  if (!Array.isArray(locators) || locators.length > 20) {
    throw new MiniAppError("resources must contain at most 20 items.", "invalid_input");
  }
  if (locators.length > 0 && (!authority.resolveResource || !authority.dataRoot)) {
    throw new MiniAppError("Attachments are unavailable.", "invalid_input");
  }
  const contribution = app.messageActions.find((action) => action.tool === request.tool)!;
  const resources = [];
  for (const locator of locators) {
    const resolved = await authority.resolveResource!(locator);
    if (!contribution.accepts.includes(resolved.kind)) {
      throw new MiniAppError("This action does not accept the attachment type.", "invalid_input");
    }
    const staged = stageIncomingResource({
      dataRoot: authority.dataRoot!,
      appId: request.appId,
      sourcePath: resolved.sourcePath,
      original: resolved.original,
      mediaType: resolved.kind,
      mimeType: resolved.mimeType,
      warn: authority.warn
    });
    resources.push(staged);
  }
  if (resources.some((resource) => !validateIncomingResource(authority.dataRoot!, request.appId, resource.path))) {
    throw new MiniAppError("Staged attachment failed validation.", "invalid_input");
  }
  if (resources.length > 0) capture.resources = resources;
  const result = await host.invokeTool(
    miniAppToolId(request.appId, request.tool),
    { capture },
    { toolCallId: `miniapp-message-action-${randomUUID()}` }
  );
  return {
    content: result.content,
    ...(result.card ? { card: result.card } : {}),
    ...(result.structuredContent !== undefined ? { structuredContent: result.structuredContent } : {})
  };
}
