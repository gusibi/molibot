import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { installAgentTemplate, listInstallableAgentTemplates, updateAgentTemplate } from "$lib/server/app/agentTemplates";
import type {
  BuiltInAgentTemplateActionRequest,
  BuiltInAgentTemplateInstallResponse,
  BuiltInAgentTemplatesResponse,
  BuiltInAgentTemplateUpdateResponse
} from "$lib/shared/agentTemplates";

export const GET: RequestHandler = async () => {
  const response: BuiltInAgentTemplatesResponse = { ok: true, templates: listInstallableAgentTemplates() };
  return json(response, { headers: { "Cache-Control": "no-store" } });
};

export const POST: RequestHandler = async ({ request }) => {
  let body: BuiltInAgentTemplateActionRequest;
  try { body = await request.json() as BuiltInAgentTemplateActionRequest; }
  catch { return json({ ok: false, error: "Invalid JSON body" }, { status: 400 }); }
  try {
    if (body.action === "update") {
      const updated = updateAgentTemplate(String(body.templateId ?? ""));
      const response: BuiltInAgentTemplateUpdateResponse = { ok: true, ...updated };
      return json(response);
    }
    const result = installAgentTemplate(String(body.templateId ?? ""));
    const response: BuiltInAgentTemplateInstallResponse = { ok: true, ...result };
    return json(response);
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
};
