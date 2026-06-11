import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import * as lark from "@larksuiteoapi/node-sdk";

interface FeishuTestBody {
  appId?: string;
  appSecret?: string;
}

type FeishuClientLike = { request: (input: unknown) => Promise<any> };

function readString(value: unknown): string {
  return String(value ?? "").trim();
}

function extractBotInfo(data: Record<string, any> | undefined): { botName?: string; botOpenId?: string } {
  const bot = data?.bot && typeof data.bot === "object" ? data.bot as Record<string, any> : {};
  const pingBotInfo = data?.pingBotInfo && typeof data.pingBotInfo === "object" ? data.pingBotInfo as Record<string, any> : {};
  return {
    botName: readString(pingBotInfo.botName || data?.name || bot.name || data?.bot_name || bot.bot_name) || undefined,
    botOpenId: readString(pingBotInfo.botID || data?.open_id || bot.open_id || data?.bot_id || bot.bot_id) || undefined
  };
}

export async function _createFeishuTestResponse(
  body: FeishuTestBody,
  createClient: (input: { appId: string; appSecret: string }) => FeishuClientLike = ({ appId, appSecret }) => new lark.Client({
    appId,
    appSecret,
    appType: lark.AppType.SelfBuild
  }) as unknown as FeishuClientLike
): Promise<Response> {
  const appId = readString(body.appId);
  const appSecret = readString(body.appSecret);
  if (!appId || !appSecret) {
    return json({ ok: false, error: "appId and appSecret are required" }, { status: 400 });
  }

  try {
    const client = createClient({ appId, appSecret });
    let response = await client.request({
      method: "POST",
      url: "/open-apis/bot/v1/openclaw_bot/ping",
      data: { needBotInfo: true }
    });
    const code = Number(response?.code ?? 0);
    const msg = readString(response?.msg);
    if (code !== 0) {
      return json({
        ok: false,
        appId,
        code,
        msg,
        error: msg || `Feishu API error: ${code}`
      });
    }

    let { botName, botOpenId } = extractBotInfo(response?.data);
    if (!botOpenId) {
      response = await client.request({
        method: "GET",
        url: "/open-apis/bot/v3/info"
      });
      const fallbackCode = Number(response?.code ?? 0);
      const fallbackMsg = readString(response?.msg);
      if (fallbackCode !== 0) {
        return json({
          ok: false,
          appId,
          code: fallbackCode,
          msg: fallbackMsg,
          error: fallbackMsg || `Feishu API error: ${fallbackCode}`
        });
      }
      ({ botName, botOpenId } = extractBotInfo(response?.data));
    }
    return json({
      ok: true,
      appId,
      botName,
      botOpenId
    });
  } catch (error) {
    return json({
      ok: false,
      appId,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

export const POST: RequestHandler = async ({ request }) => {
  let body: FeishuTestBody;
  try {
    body = await request.json() as FeishuTestBody;
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  return _createFeishuTestResponse(body);
};
