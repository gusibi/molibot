import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getSkillManager, updateBuiltinSkill } from "$lib/server/app/skillManager";
import { revealAbsolutePath, revealSupported } from "$lib/server/web/revealFile";
import type {
  DesktopSkillManagerAction,
  DesktopSkillManagerResponse,
  DesktopSkillPreflightResult,
  DesktopSkillInstallResult,
  DesktopSkillDistributeResult,
  DesktopSkillUninstallResult
} from "$lib/shared/desktop";

const NO_STORE = { "Cache-Control": "no-store" } as const;

function fail(cause: unknown, status = 400) {
  return json({ ok: false, error: cause instanceof Error ? cause.message : String(cause) }, { status, headers: NO_STORE });
}

/**
 * The Skill Manager's transport.
 *
 * Every path the client sends is either an opaque id or an explicit local
 * source directory it is allowed to read. Mutations quote the server's own
 * preflight token, so a stale plan cannot be executed by replaying a request.
 */
export const GET: RequestHandler = async () => {
  try {
    const summary = getSkillManager().getOverview();
    const response: DesktopSkillManagerResponse = { ok: true, summary };
    return json(response, { headers: NO_STORE });
  } catch (cause) {
    return fail(cause, 500);
  }
};

export const POST: RequestHandler = async ({ request }) => {
  let body: DesktopSkillManagerAction;
  try {
    body = (await request.json()) as DesktopSkillManagerAction;
  } catch {
    return fail("Invalid JSON body");
  }

  const manager = getSkillManager();
  try {
    switch (body.action) {
      case "maintenance-scan":
        return json({ ok: true, scan: manager.maintenance().scan() }, { headers: NO_STORE });
      case "maintenance-compare":
        return json({ ok: true, comparison: manager.maintenance().compare(body.request.leftId, body.request.rightId) }, { headers: NO_STORE });
      case "maintenance-preflight":
        return json({ ok: true, plan: manager.maintenance().preflight(body.request) }, { headers: NO_STORE });
      case "maintenance-apply": {
        const result = manager.applyMaintenance(body.request.operation, body.request.token);
        return json({ ok: true, result, summary: manager.getOverview() }, { headers: NO_STORE });
      }
      case "preflight": {
        const result = body.request;
        if (result.method !== "copy" && result.method !== "link") return fail("Unknown install method");
        const preflight: DesktopSkillPreflightResult = manager.preflight(result);
        return json({ ok: true, preflight }, { headers: NO_STORE });
      }
      case "install": {
        // A refused install is a business outcome, not a transport failure: the
        // client needs the structured reason to render it beside the plan.
        const result: DesktopSkillInstallResult = manager.install(body.request);
        return json({ ok: true, result, summary: manager.getOverview() }, { headers: NO_STORE });
      }
      case "distribute": {
        const result: DesktopSkillDistributeResult = manager.distribute(body.request);
        return json({ ok: true, result, summary: manager.getOverview() }, { headers: NO_STORE });
      }
      case "consolidate-preflight": {
        const preflight = manager.preflightConsolidate(body.request);
        return json({ ok: true, preflight }, { headers: NO_STORE });
      }
      case "consolidate": {
        const result = manager.consolidate(body.request);
        return json({ ok: true, result, summary: manager.getOverview() }, { headers: NO_STORE });
      }
      case "remove-discovered": {
        const result = manager.removeDiscovered(body.request);
        return json({ ok: true, result, summary: manager.getOverview() }, { headers: NO_STORE });
      }
      case "check-update": {
        const result = manager.checkUpdate(body.request);
        return json({ ok: true, result }, { headers: NO_STORE });
      }
      case "unlink-distribution": {
        const result = manager.removeDistribution(body.request);
        return json({ ok: true, result, summary: manager.getOverview() }, { headers: NO_STORE });
      }
      case "uninstall": {
        const result: DesktopSkillUninstallResult = manager.uninstall(body.request);
        return json({ ok: true, result, summary: manager.getOverview() }, { headers: NO_STORE });
      }
      case "toggle":
        manager.setEnabled(body.request.id, body.request.enabled);
        return json({ ok: true, summary: manager.getOverview() }, { headers: NO_STORE });
      case "save-platforms":
        manager.savePlatforms(body.request);
        return json({ ok: true, summary: manager.getOverview() }, { headers: NO_STORE });
      case "update-builtin":
        updateBuiltinSkill(body.request.id);
        return json({ ok: true, summary: manager.getOverview() }, { headers: NO_STORE });
      case "reveal": {
        const detail = manager.getDetail(body.request.id);
        if (!revealSupported()) {
          return json({ ok: false, error: "Revealing files is only supported on macOS." }, { status: 400, headers: NO_STORE });
        }
        revealAbsolutePath(detail.baseDir, "reveal");
        return json({ ok: true }, { headers: NO_STORE });
      }
      default:
        return fail("Unsupported action");
    }
  } catch (cause) {
    return fail(cause);
  }
};
