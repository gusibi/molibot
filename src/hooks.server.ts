import type { Handle } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/runtime";

// Bootstrap shared runtime once per process.
getRuntime();

export const handle: Handle = async ({ event, resolve }) => {
  return resolve(event);
};
