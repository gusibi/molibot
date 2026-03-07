import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";

interface ChannelInstancePayload {
  id: string;
  name?: string;
  enabled?: boolean;
  agentId?: string;
  credentials?: Record<string, string>;
  allowedChatIds?: string[];
}

function sanitizeInstance(input: ChannelInstancePayload): {
  id: string;
  name: string;
  enabled: boolean;
  agentId: string;
  credentials: Record<string, string>;
  allowedChatIds: string[];
} {
  const id = String(input.id ?? "").trim();
  if (!id) {
    throw new Error("instance.id is required");
  }

  const credentialsSource = input.credentials && typeof input.credentials === "object" ? input.credentials : {};
  const credentials = Object.fromEntries(
    Object.entries(credentialsSource)
      .map(([k, v]) => [String(k).trim(), String(v ?? "").trim()])
      .filter(([k, v]) => Boolean(k) && Boolean(v))
  );

  return {
    id,
    name: String(input.name ?? "").trim() || id,
    enabled: input.enabled === undefined ? true : Boolean(input.enabled),
    agentId: String(input.agentId ?? "").trim(),
    credentials,
    allowedChatIds: Array.isArray(input.allowedChatIds)
      ? input.allowedChatIds.map((v) => String(v).trim()).filter(Boolean)
      : []
  };
}

export const PUT: RequestHandler = async ({ request }) => {
  let body: { channel?: string; previousId?: string; instance?: ChannelInstancePayload };
  try {
    body = (await request.json()) as { channel?: string; previousId?: string; instance?: ChannelInstancePayload };
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const channel = String(body.channel ?? "").trim();
  if (!channel) {
    return json({ ok: false, error: "channel is required" }, { status: 400 });
  }

  if (!body.instance) {
    return json({ ok: false, error: "instance is required" }, { status: 400 });
  }

  let nextInstance: ReturnType<typeof sanitizeInstance>;
  try {
    nextInstance = sanitizeInstance(body.instance);
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "Invalid instance" }, { status: 400 });
  }

  const runtime = getRuntime();
  const current = runtime.getSettings();
  const currentChannel = current.channels[channel] ?? { instances: [] };
  const previousId = String(body.previousId ?? "").trim();

  const nextInstances = currentChannel.instances
    .filter((item) => item.id !== nextInstance.id && (!previousId || item.id !== previousId));
  nextInstances.push(nextInstance);

  const updated = runtime.updateSettings({
    channels: {
      [channel]: {
        instances: nextInstances
      }
    }
  });

  return json({ ok: true, instance: updated.channels[channel]?.instances?.find((it) => it.id === nextInstance.id) });
};

export const DELETE: RequestHandler = async ({ request }) => {
  let body: { channel?: string; id?: string };
  try {
    body = (await request.json()) as { channel?: string; id?: string };
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const channel = String(body.channel ?? "").trim();
  const id = String(body.id ?? "").trim();
  if (!channel || !id) {
    return json({ ok: false, error: "channel and id are required" }, { status: 400 });
  }

  const runtime = getRuntime();
  const current = runtime.getSettings();
  const currentChannel = current.channels[channel] ?? { instances: [] };
  const nextInstances = currentChannel.instances.filter((item) => item.id !== id);

  runtime.updateSettings({
    channels: {
      [channel]: {
        instances: nextInstances
      }
    }
  });

  return json({ ok: true });
};
