import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import {
  listProfileFiles,
  readProfileFiles,
  validateProfileWriteRequest,
  writeProfileFiles
} from "$lib/server/agent/profiles";

type Scope = "global" | "agent" | "bot";

function isScope(value: string): value is Scope {
  return value === "global" || value === "agent" || value === "bot";
}

export const GET: RequestHandler = async ({ url }) => {
  const scope = url.searchParams.get("scope") ?? "";
  if (!isScope(scope)) {
    return json({ ok: false, error: "Invalid scope" }, { status: 400 });
  }

  try {
    const agentId = url.searchParams.get("agentId") ?? undefined;
    const channel = url.searchParams.get("channel") ?? undefined;
    const botId = url.searchParams.get("botId") ?? undefined;
    const files = readProfileFiles({ scope, agentId, channel, botId });
    return json({
      ok: true,
      scope,
      fileNames: listProfileFiles(scope),
      files
    });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
};

export const PUT: RequestHandler = async ({ request }) => {
  let body: {
    scope?: Scope;
    agentId?: string;
    channel?: string;
    botId?: string;
    files?: Record<string, unknown>;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.scope || !isScope(body.scope)) {
    return json({ ok: false, error: "Invalid scope" }, { status: 400 });
  }

  try {
    const files = validateProfileWriteRequest({
      scope: body.scope,
      files: body.files ?? {},
      agentId: body.agentId,
      channel: body.channel,
      botId: body.botId
    });
    writeProfileFiles({
      scope: body.scope,
      files,
      agentId: body.agentId,
      channel: body.channel,
      botId: body.botId
    });
    return json({
      ok: true,
      scope: body.scope,
      fileNames: listProfileFiles(body.scope),
      files: readProfileFiles({
        scope: body.scope,
        agentId: body.agentId,
        channel: body.channel,
        botId: body.botId
      })
    });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
};
