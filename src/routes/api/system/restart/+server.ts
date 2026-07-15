import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";

export const POST: RequestHandler = async () => {
  if (process.env.MOLIBOT_DESKTOP_MANAGED !== "1") {
    return json(
      { ok: false, error: "Service restart is only available for desktop-managed services." },
      { status: 409 }
    );
  }

  const port = getRuntime().getSettings().serverPort;
  const host = process.env.HOST || "127.0.0.1";
  const endpoint = `http://${host}:${port}`;
  const timer = setTimeout(() => process.kill(process.pid, "SIGTERM"), 250);
  timer.unref();
  return json({ ok: true, endpoint });
};
