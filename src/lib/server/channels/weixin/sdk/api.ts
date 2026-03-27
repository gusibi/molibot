import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  getConfig as vendorGetConfig,
  getUpdates as vendorGetUpdates,
  sendMessage as vendorSendMessage,
  sendTyping as vendorSendTyping
} from "#weixin-agent-sdk/src/api/api.js";
import { DEFAULT_BASE_URL } from "#weixin-agent-sdk/src/auth/accounts.js";
import {
  MessageItemType,
  MessageState,
  MessageType,
  type BaseInfo,
  type GetConfigResp,
  type GetUpdatesResp,
  type SendMessageReq,
  type SendTypingReq
} from "./types.js";

function readVendoredSdkVersion(): string {
  try {
    const packageJsonPath = join(process.cwd(), "package", "weixin-agent-sdk", "package.json");
    const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version?: string };
    return parsed.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

export { DEFAULT_BASE_URL };
export const CHANNEL_VERSION = readVendoredSdkVersion();

export class ApiError extends Error {
  readonly status: number;
  readonly code?: number;
  readonly payload?: unknown;

  constructor(message: string, options: { status: number; code?: number; payload?: unknown }) {
    super(message);
    this.name = "ApiError";
    this.status = options.status;
    this.code = options.code;
    this.payload = options.payload;
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function buildBaseInfo(): BaseInfo {
  return { channel_version: CHANNEL_VERSION };
}

async function parseJsonResponse<T>(response: Response, label: string): Promise<T> {
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as T) : ({} as T);

  if (!response.ok) {
    const message = (payload as { errmsg?: string } | null)?.errmsg ?? `${label} failed with HTTP ${response.status}`;
    throw new ApiError(message, {
      status: response.status,
      code: (payload as { errcode?: number } | null)?.errcode,
      payload
    });
  }

  if (typeof (payload as { ret?: number } | null)?.ret === "number" && (payload as { ret: number }).ret !== 0) {
    const body = payload as { errcode?: number; errmsg?: string; ret: number };
    throw new ApiError(body.errmsg ?? `${label} failed`, {
      status: response.status,
      code: body.errcode ?? body.ret,
      payload
    });
  }

  return payload;
}

export function randomWechatUin(): string {
  const value = randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(value), "utf8").toString("base64");
}

export function buildHeaders(token: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    Authorization: `Bearer ${token}`,
    "X-WECHAT-UIN": randomWechatUin()
  };
}

export async function apiFetch<T>(
  baseUrl: string,
  endpoint: string,
  body: unknown,
  token: string,
  timeoutMs = 40_000,
  signal?: AbortSignal
): Promise<T> {
  const url = new URL(endpoint, `${normalizeBaseUrl(baseUrl)}/`);
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  const response = await fetch(url, {
    method: "POST",
    headers: buildHeaders(token),
    body: JSON.stringify(body),
    signal: requestSignal
  });

  return parseJsonResponse<T>(response, endpoint);
}

export async function getUpdates(
  baseUrl: string,
  token: string,
  buf: string,
  signal?: AbortSignal
): Promise<GetUpdatesResp> {
  const payload = await vendorGetUpdates({
    baseUrl,
    token,
    get_updates_buf: buf,
    timeoutMs: 40_000,
    abortSignal: signal
  });
  if (typeof payload.ret === "number" && payload.ret !== 0) {
    throw new ApiError(payload.errmsg ?? "getupdates failed", {
      status: 200,
      code: payload.errcode ?? payload.ret,
      payload
    });
  }
  if (typeof payload.errcode === "number" && payload.errcode !== 0) {
    throw new ApiError(payload.errmsg ?? "getupdates failed", {
      status: 200,
      code: payload.errcode,
      payload
    });
  }
  return payload;
}

export async function sendMessage(
  baseUrl: string,
  token: string,
  msg: SendMessageReq["msg"]
): Promise<Record<string, unknown>> {
  return apiFetch<Record<string, unknown>>(
    baseUrl,
    "/ilink/bot/sendmessage",
    { msg, base_info: buildBaseInfo() },
    token,
    15_000
  );
}

export async function getConfig(
  baseUrl: string,
  token: string,
  userId: string,
  contextToken: string
): Promise<GetConfigResp> {
  return vendorGetConfig({
    baseUrl,
    token,
    timeoutMs: 15_000,
    ilinkUserId: userId,
    contextToken
  });
}

export async function sendTyping(
  baseUrl: string,
  token: string,
  userId: string,
  ticket: string,
  status: SendTypingReq["status"]
): Promise<Record<string, unknown>> {
  await vendorSendTyping({
    baseUrl,
    token,
    timeoutMs: 15_000,
    body: {
      ilink_user_id: userId,
      typing_ticket: ticket,
      status
    }
  });
  return {};
}

export function buildTextMessage(userId: string, contextToken: string, text: string): SendMessageReq["msg"] {
  return {
    from_user_id: "",
    to_user_id: userId,
    client_id: randomUUID(),
    message_type: MessageType.BOT,
    message_state: MessageState.FINISH,
    context_token: contextToken,
    item_list: [
      {
        type: MessageItemType.TEXT,
        text_item: { text }
      }
    ]
  };
}
