import * as lark from "@larksuiteoapi/node-sdk";
import type { RuntimeSettings } from "$lib/server/settings/schema";
import type { DesktopChannelTestRequest, DesktopChannelTestResponse } from "$lib/shared/desktop";

type FeishuClientLike = { request: (input: unknown) => Promise<any> };

export async function testDesktopChannel(
  settings: RuntimeSettings,
  request: DesktopChannelTestRequest,
  createClient: (input: { appId: string; appSecret: string }) => FeishuClientLike = ({ appId, appSecret }) => new lark.Client({ appId, appSecret, appType: lark.AppType.SelfBuild }) as unknown as FeishuClientLike
): Promise<DesktopChannelTestResponse> {
  if (request.channel !== "feishu") return { ok: false, error: "Connection test is not available for this channel" };
  const instance = settings.channels?.feishu?.instances?.find((row) => row.id === request.instanceId);
  const appId = String(request.fields?.appId ?? instance?.credentials?.appId ?? "").trim();
  const appSecret = String(request.secretValues?.appSecret ?? instance?.credentials?.appSecret ?? "").trim();
  if (!appId || !appSecret) return { ok: false, error: "appId and appSecret are required" };
  try {
    let result = await createClient({ appId, appSecret }).request({ method: "POST", url: "/open-apis/bot/v1/openclaw_bot/ping", data: { needBotInfo: true } });
    if (Number(result?.code ?? 0) !== 0) return { ok: false, error: String(result?.msg ?? `Feishu API error: ${result?.code}`) };
    let label = String(result?.data?.pingBotInfo?.botName ?? result?.data?.name ?? "").trim();
    if (!label) {
      result = await createClient({ appId, appSecret }).request({ method: "GET", url: "/open-apis/bot/v3/info" });
      if (Number(result?.code ?? 0) !== 0) return { ok: false, error: String(result?.msg ?? `Feishu API error: ${result?.code}`) };
      label = String(result?.data?.bot?.name ?? result?.data?.name ?? appId).trim();
    }
    return { ok: true, label: label || appId };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
