import { json, type RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime.js";
import { FeishuManager } from "$lib/server/channels/feishu/runtime.js";

export const POST: RequestHandler = async ({ request }) => {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON payload." }, { status: 400 });
  }

  const runtime = getRuntime();
  const managers = runtime.channelManagers.get("feishu");
  if (!managers || managers.size === 0) {
    return json({ ok: false, error: "No active Feishu managers." }, { status: 404 });
  }

  for (const manager of managers.values()) {
    if (!(manager instanceof FeishuManager)) continue;
    const result = await manager.handleCardCallbackRequest(payload);
    if (result !== undefined) {
      return json(result ?? {});
    }
  }

  return json({ ok: false, error: "No Feishu card handler accepted this callback." }, { status: 400 });
};
