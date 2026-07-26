import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getOAuthLoginManager } from "$lib/server/agent/identity/auth.js";
import { providerAuthError } from "$lib/server/app/providerAuthApi.js";
import type { DesktopProviderAuthLogoutResponse } from "$lib/shared/desktop.js";

const NO_STORE = { "Cache-Control": "no-store" };

export const DELETE: RequestHandler = async ({ params }) => {
  try {
    const response: DesktopProviderAuthLogoutResponse = {
      ok: true,
      removed: await getOAuthLoginManager().logout(params.providerId)
    };
    return json(response, { headers: NO_STORE });
  } catch (error) {
    const failure = providerAuthError(error);
    return json(failure.payload, { status: failure.status, headers: NO_STORE });
  }
};
