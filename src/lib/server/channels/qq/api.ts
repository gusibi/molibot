import { momWarn } from "../../agent/log.js";

const API_BASE = "https://api.sgroup.qq.com";
const TOKEN_URL = "https://bots.qq.com/app/getAppAccessToken";

let cachedToken: { token: string; expiresAt: number; appId: string } | null = null;
let inflight: Promise<string> | null = null;

interface QqTokenResponse {
  access_token?: string;
  expires_in?: number;
}

interface QqGatewayResponse {
  url: string;
}

export interface QqMessageResponse {
  id?: string;
  message_id?: string;
  timestamp?: string | number;
}

async function requestToken(appId: string, clientSecret: string): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appId, clientSecret })
  });

  const data = (await res.json().catch(() => ({}))) as QqTokenResponse;
  if (!res.ok || !data.access_token) {
    throw new Error(`qq_token_failed:${res.status}`);
  }

  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 7200) * 1000,
    appId
  };
  return data.access_token;
}

export async function getAccessToken(appId: string, clientSecret: string): Promise<string> {
  if (
    cachedToken &&
    cachedToken.appId === appId &&
    Date.now() < cachedToken.expiresAt - 5 * 60_000
  ) {
    return cachedToken.token;
  }

  if (cachedToken && cachedToken.appId !== appId) {
    cachedToken = null;
    inflight = null;
  }

  if (inflight) return inflight;

  inflight = requestToken(appId, clientSecret).finally(() => {
    inflight = null;
  });

  return inflight;
}

export function clearTokenCache(): void {
  cachedToken = null;
}

async function apiRequest<T>(
  accessToken: string,
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `QQBot ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const raw = await res.text();
  const data = (raw ? JSON.parse(raw) : {}) as T;

  if (!res.ok) {
    const msg = typeof data === "object" && data ? JSON.stringify(data) : raw;
    throw new Error(`qq_api_error:${path}:${res.status}:${msg}`);
  }

  return data;
}

function nextMsgSeq(): number {
  return Math.floor(Math.random() * 65535);
}

function buildMessageBody(content: string, msgId?: string): Record<string, unknown> {
  const body: Record<string, unknown> = {
    content,
    msg_type: 0,
    msg_seq: nextMsgSeq()
  };
  if (msgId) body.msg_id = msgId;
  return body;
}

export async function getGatewayUrl(accessToken: string): Promise<string> {
  const data = await apiRequest<QqGatewayResponse>(accessToken, "GET", "/gateway");
  if (!data.url) {
    throw new Error("qq_gateway_empty_url");
  }
  return data.url;
}

export async function sendC2CMessage(
  accessToken: string,
  openid: string,
  content: string,
  replyToId?: string
): Promise<QqMessageResponse> {
  return apiRequest<QqMessageResponse>(
    accessToken,
    "POST",
    `/v2/users/${openid}/messages`,
    buildMessageBody(content, replyToId)
  );
}

export async function sendGroupMessage(
  accessToken: string,
  groupOpenid: string,
  content: string,
  replyToId?: string
): Promise<QqMessageResponse> {
  return apiRequest<QqMessageResponse>(
    accessToken,
    "POST",
    `/v2/groups/${groupOpenid}/messages`,
    buildMessageBody(content, replyToId)
  );
}

export async function sendChannelMessage(
  accessToken: string,
  channelId: string,
  content: string,
  replyToId?: string
): Promise<QqMessageResponse> {
  return apiRequest<QqMessageResponse>(
    accessToken,
    "POST",
    `/channels/${channelId}/messages`,
    buildMessageBody(content, replyToId)
  );
}

export async function safeSend(
  sender: () => Promise<QqMessageResponse>,
  fallback: () => Promise<QqMessageResponse>
): Promise<QqMessageResponse | null> {
  try {
    return await sender();
  } catch (error) {
    momWarn("qq", "send_reply_failed_fallback_proactive", {
      error: error instanceof Error ? error.message : String(error)
    });
    try {
      return await fallback();
    } catch (fallbackError) {
      momWarn("qq", "send_proactive_failed", {
        error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
      });
      return null;
    }
  }
}
