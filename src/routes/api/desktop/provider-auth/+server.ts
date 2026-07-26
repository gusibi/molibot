import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getOAuthLoginManager } from "$lib/server/agent/identity/auth.js";
import { providerAuthError, savedApiKeyOverrideIds } from "$lib/server/app/providerAuthApi.js";
import { getRuntime } from "$lib/server/app/runtime";
import type {
  DesktopProviderAuthOverviewResponse,
  DesktopProviderAuthSessionResponse,
  DesktopProviderAuthStartRequest
} from "$lib/shared/desktop.js";

const NO_STORE = { "Cache-Control": "no-store" };

export const GET: RequestHandler = async () => {
  try {
    const response: DesktopProviderAuthOverviewResponse = {
      ok: true,
      providers: await getOAuthLoginManager().listProviders({
        apiKeyOverrides: savedApiKeyOverrideIds(getRuntime().getSettings())
      })
    };
    return json(response, { headers: NO_STORE });
  } catch (error) {
    const failure = providerAuthError(error);
    return json(failure.payload, { status: failure.status, headers: NO_STORE });
  }
};

export const POST: RequestHandler = async ({ request }) => {
  let body: DesktopProviderAuthStartRequest;
  try {
    body = await request.json() as DesktopProviderAuthStartRequest;
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400, headers: NO_STORE });
  }
  try {
    const response: DesktopProviderAuthSessionResponse = {
      ok: true,
      session: getOAuthLoginManager().start(String(body.providerId ?? ""))
    };
    return json(response, { status: 201, headers: NO_STORE });
  } catch (error) {
    const failure = providerAuthError(error);
    return json(failure.payload, { status: failure.status, headers: NO_STORE });
  }
};
