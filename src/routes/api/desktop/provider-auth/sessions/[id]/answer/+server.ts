import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getOAuthLoginManager } from "$lib/server/agent/identity/auth.js";
import { providerAuthError } from "$lib/server/app/providerAuthApi.js";
import type {
  DesktopProviderAuthAnswerRequest,
  DesktopProviderAuthSessionResponse
} from "$lib/shared/desktop.js";

const NO_STORE = { "Cache-Control": "no-store" };

export const POST: RequestHandler = async ({ params, request }) => {
  let body: DesktopProviderAuthAnswerRequest;
  try {
    body = await request.json() as DesktopProviderAuthAnswerRequest;
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400, headers: NO_STORE });
  }
  try {
    const response: DesktopProviderAuthSessionResponse = {
      ok: true,
      session: getOAuthLoginManager().answer(
        params.id,
        String(body.promptId ?? ""),
        String(body.value ?? "")
      )
    };
    return json(response, { headers: NO_STORE });
  } catch (error) {
    const failure = providerAuthError(error);
    return json(failure.payload, { status: failure.status, headers: NO_STORE });
  }
};
