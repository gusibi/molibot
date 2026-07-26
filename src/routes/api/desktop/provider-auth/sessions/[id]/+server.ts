import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getOAuthLoginManager } from "$lib/server/agent/identity/auth.js";
import { providerAuthError } from "$lib/server/app/providerAuthApi.js";
import type { DesktopProviderAuthSessionResponse } from "$lib/shared/desktop.js";

const NO_STORE = { "Cache-Control": "no-store" };

export const GET: RequestHandler = async ({ params }) => {
  try {
    const response: DesktopProviderAuthSessionResponse = {
      ok: true,
      session: getOAuthLoginManager().get(params.id)
    };
    return json(response, { headers: NO_STORE });
  } catch (error) {
    const failure = providerAuthError(error);
    return json(failure.payload, { status: failure.status, headers: NO_STORE });
  }
};

export const DELETE: RequestHandler = async ({ params }) => {
  try {
    const response: DesktopProviderAuthSessionResponse = {
      ok: true,
      session: getOAuthLoginManager().cancel(params.id)
    };
    return json(response, { headers: NO_STORE });
  } catch (error) {
    const failure = providerAuthError(error);
    return json(failure.payload, { status: failure.status, headers: NO_STORE });
  }
};
