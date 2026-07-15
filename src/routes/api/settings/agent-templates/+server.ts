import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { installAgentTemplate, listInstallableAgentTemplates } from "$lib/server/app/agentTemplates";
import type { BuiltInAgentTemplateInstallResponse, BuiltInAgentTemplatesResponse } from "$lib/shared/agentTemplates";

export const GET: RequestHandler = async () => {
  const response: BuiltInAgentTemplatesResponse = { ok: true, templates: listInstallableAgentTemplates() };
  return json(response, { headers: { "Cache-Control": "no-store" } });
};

export const POST: RequestHandler = async ({ request }) => {
  let body: { templateId?: string };
  try { body = await request.json() as { templateId?: string }; }
  catch { return json({ ok: false, error: "Invalid JSON body" }, { status: 400 }); }
  try {
    const result = installAgentTemplate(String(body.templateId ?? ""));
    const response: BuiltInAgentTemplateInstallResponse = { ok: true, ...result };
    return json(response);
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
};
