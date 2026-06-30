import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { config } from "$lib/server/app/env";
import { testCustomProvider } from "$lib/server/providers/customProtocol";
import { readWorkspaceVisionSmokeImage } from "$lib/server/providers/visionSmokeFixture";
import type {
  DesktopProviderTestRequest,
  DesktopProviderTestResponse
} from "$lib/shared/desktop";

/**
 * POST — Test a saved provider by id. The API key is read from the server
 * config, never supplied by the Desktop WebView. The response only returns
 * ok/error/message — no credentials.
 */
export const POST: RequestHandler = async ({ request }) => {
  let body: DesktopProviderTestRequest;
  try {
    body = (await request.json()) as DesktopProviderTestRequest;
  } catch {
    return json(
      { ok: false, error: "Invalid JSON body" } satisfies DesktopProviderTestResponse,
      { status: 400 }
    );
  }

  const providerId = String(body.providerId ?? "").trim();
  const requestedModel = String(body.model ?? "").trim();
  if (!providerId) {
    return json(
      { ok: false, error: "providerId is required" } satisfies DesktopProviderTestResponse,
      { status: 400 }
    );
  }

  const runtime = getRuntime();
  const settings = runtime.getSettings();
  const providers = Array.isArray(settings.customProviders) ? settings.customProviders : [];
  const provider = providers.find((p) => p.id === providerId);

  if (!provider) {
    return json(
      { ok: false, error: "Provider not found" } satisfies DesktopProviderTestResponse,
      { status: 404 }
    );
  }

  const model = requestedModel || provider.defaultModel;
  if (!provider.apiKey || !provider.baseUrl || !model) {
    return json(
      { ok: false, error: "Provider is missing required configuration (baseUrl, apiKey, or defaultModel)" } satisfies DesktopProviderTestResponse,
      { status: 400 }
    );
  }

  try {
    const tags = provider.models?.find((row) => row.id === model)?.tags ?? ["text"];
    const testImage = tags.includes("vision")
      ? readWorkspaceVisionSmokeImage(config.dataDir)
      : undefined;

    const result = await testCustomProvider({
      protocol: provider.protocol,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      path: provider.path,
      model,
      tags,
      testImage
    });

    // Never return credentials — only the test outcome
    const response: DesktopProviderTestResponse = {
      ok: result.ok,
      message: result.message,
      status: result.status,
      supportedRoles: result.supportedRoles,
      verification: result.verification
    };
    if (!result.ok) {
      response.error = result.message;
    }
    return json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const response: DesktopProviderTestResponse = {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
    return json(response, { status: 500 });
  }
};
