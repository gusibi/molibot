import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { buildDesktopOpenConnectorSummary, saveOpenConnectorSettings } from "$lib/server/app/desktopOpenConnector";
import { config } from "$lib/server/app/env";
import { reconcileMcpServers } from "$lib/server/agent/tools/mcp";
import { effectiveMcpServers } from "$lib/server/settings/openConnector";
import type { DesktopOpenConnectorResponse, DesktopOpenConnectorSaveRequest, DesktopOpenConnectorTokenResponse } from "$lib/shared/desktop";

export const GET: RequestHandler = async () => {
  const summary = await buildDesktopOpenConnectorSummary(getRuntime().getSettings());
  return json({ ok: true, summary } satisfies DesktopOpenConnectorResponse, { headers: { "Cache-Control": "no-store" } });
};

export const PUT: RequestHandler = async ({ request }) => {
  try {
    const runtime = getRuntime();
    const body = await request.json() as DesktopOpenConnectorSaveRequest;
    runtime.updateSettings({ openConnector: saveOpenConnectorSettings(runtime.getSettings(), body) });
    await reconcileMcpServers(effectiveMcpServers(runtime.getSettings()), {
      workspaceDir: config.webWorkspaceDir,
      connectEnabled: Boolean(runtime.getSettings().openConnector.enabled)
    });
    const summary = await buildDesktopOpenConnectorSummary(runtime.getSettings(), { refresh: true });
    return json({ ok: true, summary } satisfies DesktopOpenConnectorResponse, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    return json({ ok: false, error: cause instanceof Error ? cause.message : String(cause) }, { status: 400 });
  }
};

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json() as { action?: string };
    if (body.action === "refresh-catalog") {
      const summary = await buildDesktopOpenConnectorSummary(getRuntime().getSettings(), { refresh: true });
      return json({ ok: true, summary } satisfies DesktopOpenConnectorResponse, { headers: { "Cache-Control": "no-store" } });
    }
    if (body.action === "reveal-token") {
      const runtimeToken = getRuntime().getSettings().openConnector.runtimeToken;
      return json({ ok: true, runtimeToken } satisfies DesktopOpenConnectorTokenResponse, { headers: { "Cache-Control": "no-store" } });
    }
    throw new Error("Unsupported OpenConnector action.");
  } catch (cause) {
    return json({ ok: false, error: cause instanceof Error ? cause.message : String(cause) } satisfies DesktopOpenConnectorTokenResponse, { status: 400 });
  }
};
