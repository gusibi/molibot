import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import {
  listProfileFiles,
  readProfileFiles,
  validateProfileWriteRequest,
  writeProfileFiles
} from "$lib/server/agent/prompts/profiles";
import type { DesktopProfileFilesResponse } from "$lib/shared/desktop";

export const GET: RequestHandler = async ({ url }) => {
  const scope = url.searchParams.get("scope") === "agent" ? "agent" : "bot";
  const agentId = String(url.searchParams.get("agentId") ?? "").trim();
  const botId = String(url.searchParams.get("profileId") ?? "").trim();
  const channel = String(url.searchParams.get("channel") ?? "web").trim();
  if (scope === "agent" ? !agentId : !botId) return json({ ok: false, error: `${scope} id is required` }, { status: 400 });
  try {
    const response: DesktopProfileFilesResponse = {
      ok: true,
      fileNames: listProfileFiles(scope),
      files: readProfileFiles(scope === "agent" ? { scope, agentId } : { scope, channel, botId })
    };
    return json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
};

export const PUT: RequestHandler = async ({ request }) => {
  let body: { scope?: "agent" | "bot"; channel?: string; profileId?: string; agentId?: string; files?: Record<string, unknown> };
  try { body = (await request.json()) as typeof body; }
  catch { return json({ ok: false, error: "Invalid JSON body" }, { status: 400 }); }
  const scope = body.scope === "agent" ? "agent" : "bot";
  const agentId = String(body.agentId ?? "").trim();
  const botId = String(body.profileId ?? "").trim();
  const channel = String(body.channel ?? "web").trim();
  if (scope === "agent" ? !agentId : !botId) return json({ ok: false, error: `${scope} id is required` }, { status: 400 });
  try {
    const target = scope === "agent" ? { scope, agentId } as const : { scope, channel, botId } as const;
    const files = validateProfileWriteRequest({ ...target, files: body.files ?? {} });
    writeProfileFiles({ ...target, files });
    const response: DesktopProfileFilesResponse = {
      ok: true,
      fileNames: listProfileFiles(scope),
      files: readProfileFiles(target)
    };
    return json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
};
