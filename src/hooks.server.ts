import type { Handle } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";

// Bootstrap shared runtime once per process.
getRuntime();

// Node's default for an unhandled rejection is to kill the process, which
// takes down every in-flight run and surfaces as a 503 in the desktop app.
// Log and keep serving instead; individual runs report their own failures.
const globalWithGuard = globalThis as typeof globalThis & { __molibotRejectionGuard?: boolean };
if (!globalWithGuard.__molibotRejectionGuard) {
  globalWithGuard.__molibotRejectionGuard = true;
  process.on("unhandledRejection", (reason) => {
    console.error("[runtime] unhandled_rejection", reason instanceof Error ? reason.stack || reason.message : reason);
  });
}

export const handle: Handle = async ({ event, resolve }) => {
  return resolve(event);
};
