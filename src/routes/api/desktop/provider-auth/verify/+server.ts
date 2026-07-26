import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { checkProviderConnectivity } from "$lib/server/app/providerConnectivity.js";
import { defaultProbeModel, providerAuthError } from "$lib/server/app/providerAuthApi.js";
import { getRuntime } from "$lib/server/app/runtime";
import type {
  DesktopProviderAuthVerifyRequest,
  DesktopProviderAuthVerifyResponse
} from "$lib/shared/desktop.js";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * POST — send one minimal real request through the provider's stored credential.
 *
 * A failed probe is still `ok: true` at the HTTP layer with `result.ok === false`:
 * "the provider rejected us" is a normal answer to this question, not a server
 * error, and the UI needs the message either way.
 */
export const POST: RequestHandler = async ({ request }) => {
  let body: DesktopProviderAuthVerifyRequest;
  try {
    body = await request.json() as DesktopProviderAuthVerifyRequest;
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400, headers: NO_STORE });
  }

  const providerId = String(body.providerId ?? "").trim();
  if (!providerId) {
    return json({ ok: false, error: "providerId is required" }, { status: 400, headers: NO_STORE });
  }

  try {
    const response: DesktopProviderAuthVerifyResponse = {
      ok: true,
      result: await checkProviderConnectivity({
        providerId,
        modelId: String(body.model ?? "").trim() || defaultProbeModel(getRuntime().getSettings(), providerId)
      })
    };
    return json(response, { headers: NO_STORE });
  } catch (error) {
    const failure = providerAuthError(error);
    return json(failure.payload, { status: failure.status, headers: NO_STORE });
  }
};
