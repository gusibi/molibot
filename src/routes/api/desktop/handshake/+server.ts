import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { buildDesktopHandshake } from "$lib/server/app/desktopHandshake.js";

export const GET: RequestHandler = async () => {
  return json(buildDesktopHandshake(), {
    headers: {
      "cache-control": "no-store"
    }
  });
};
