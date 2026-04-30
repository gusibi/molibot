import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { config } from "$lib/server/app/env";
import { testCustomProvider, type ProviderTestPayload } from "$lib/server/providers/customProtocol";
import { readWorkspaceVisionSmokeImage } from "$lib/server/providers/visionSmokeFixture";

export const POST: RequestHandler = async ({ request }) => {
  let body: ProviderTestPayload;
  try {
    body = (await request.json()) as ProviderTestPayload;
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const baseUrl = String(body.baseUrl ?? "").trim();
  const apiKey = String(body.apiKey ?? "").trim();
  const model = String(body.model ?? "").trim();
  if (!baseUrl || !apiKey || !model) {
    return json({ ok: false, error: "baseUrl, apiKey and model are required" }, { status: 400 });
  }

  try {
    const tags = Array.isArray(body.tags) ? body.tags : [];
    const testImage = tags.includes("vision")
      ? readWorkspaceVisionSmokeImage(config.dataDir)
      : undefined;
    return json(await testCustomProvider({
      ...body,
      baseUrl,
      apiKey,
      model,
      testImage
    }));
  } catch (error) {
    return json({
      ok: false,
      status: null,
      message: error instanceof Error ? error.message : String(error),
      supportedRoles: ["system", "user", "assistant", "tool"],
      verification: {}
    });
  }
};
