import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";

export const GET: RequestHandler = async () => {
  return json({
    status: "ok",
    service: "molibot",
    ts: new Date().toISOString()
  });
};
