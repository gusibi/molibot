import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getRuntime } from "$lib/server/app/runtime.js";
import { probeRuntime, runtimeHealthSnapshot } from "$lib/server/app/runtimeHealth.js";

/**
 * Liveness (`/api/desktop/health`) and readiness (`?deep=1`).
 *
 * The shallow answer says the HTTP server is listening. The deep answer builds
 * the runtime and answers 503 when it cannot — which is the whole point: the
 * desktop supervisor needs a probe that fails when the service is unusable,
 * and both `/health` and `/api/desktop/handshake` are static literals that
 * answer 200 from a process whose runtime never initialised.
 */
export const GET: RequestHandler = async ({ url }) => {
  const deep = url.searchParams.get("deep") === "1";
  if (!deep) {
    const snapshot = runtimeHealthSnapshot();
    return json(
      { status: "ok", service: "molibot", runtimeReady: snapshot.ready },
      { headers: { "cache-control": "no-store" } }
    );
  }

  const snapshot = probeRuntime(getRuntime);
  return json(
    {
      status: snapshot.ready ? "ok" : "unavailable",
      service: "molibot",
      runtimeReady: snapshot.ready,
      // Already redacted of the host home directory by `runtimeHealth`.
      error: snapshot.error,
      consecutiveFailures: snapshot.consecutiveFailures,
      lastFailureAt: snapshot.lastFailureAt,
      lastReadyAt: snapshot.lastReadyAt
    },
    { status: snapshot.ready ? 200 : 503, headers: { "cache-control": "no-store" } }
  );
};
