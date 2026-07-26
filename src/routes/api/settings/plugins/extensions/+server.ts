import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { getRuntime } from "$lib/server/app/runtime";
import { getPiExtensionHost } from "$lib/server/plugins/piExtensions/host";
import type { InstallPiExtensionRequest } from "$lib/server/plugins/piExtensions/install";
import { installPiExtension, uninstallPiExtension } from "$lib/server/plugins/piExtensions/install";
import { piExtensionsRootDir } from "$lib/server/plugins/piExtensions/paths";
import { describeResolvedSpec, resolveExtensionInput } from "$lib/server/plugins/piExtensions/specResolver";
import { updatePluginsConfig } from "$lib/server/settings/handlers/plugins";

/** Catalog of installed pi extensions plus their enable state. */
export const GET: RequestHandler = async () => {
  const runtime = getRuntime();
  const host = getPiExtensionHost();
  await host.load();
  return json({
    ok: true,
    root: piExtensionsRootDir(),
    loaded: host.isLoaded(),
    masterEnabled: runtime.getSettings().plugins.piExtensions.enabled !== false,
    extensions: host.listCatalog(runtime.getSettings())
  });
};

interface ExtensionActionBody {
  action?: "install" | "resolve" | "uninstall" | "reload" | "toggle" | "setBots" | "setMaster";
  /** Whatever the user pasted: package name, npm URL, or repository link. */
  input?: string;
  /** Explicit form, still accepted for scripted callers. */
  source?: "npm" | "git";
  spec?: string;
  id?: string;
  enabled?: boolean;
  disabledBots?: unknown;
}

/**
 * Accept either a pasted link (resolved here) or an explicit source+spec.
 * Keeping the explicit form means the resolver is a convenience, not a wall in
 * front of callers that already know what they want.
 */
function readInstallRequest(body: ExtensionActionBody):
  | { ok: true; request: InstallPiExtensionRequest }
  | { ok: false; error: string; hint?: string } {
  if (body.input && body.input.trim()) {
    const resolution = resolveExtensionInput(body.input);
    if (!resolution.ok) return { ok: false, error: resolution.error, hint: resolution.hint };
    const { source, spec, subdir, ref, id } = resolution.resolved;
    return { ok: true, request: { source, spec, subdir, ref, id: body.id ?? id } };
  }
  if (body.source && body.spec) {
    return { ok: true, request: { source: body.source, spec: body.spec, id: body.id } };
  }
  return { ok: false, error: "input (a package name or link) is required" };
}

export const POST: RequestHandler = async ({ request }) => {
  let body: ExtensionActionBody;
  try {
    body = (await request.json()) as ExtensionActionBody;
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const runtime = getRuntime();
  const host = getPiExtensionHost();
  const currentEntries = () => runtime.getSettings().plugins.piExtensions.entries ?? {};

  switch (body.action) {
    // Dry run: show the user what a pasted link was understood to mean.
    case "resolve": {
      const parsed = readInstallRequest(body);
      if (!parsed.ok) return json({ ok: false, error: parsed.error, hint: parsed.hint }, { status: 400 });
      return json({
        ok: true,
        request: parsed.request,
        description: describeResolvedSpec({
          source: parsed.request.source,
          spec: parsed.request.spec,
          subdir: parsed.request.subdir,
          ref: parsed.request.ref,
          id: parsed.request.id ?? "",
          kind: "npm-name"
        })
      });
    }

    case "install": {
      const parsed = readInstallRequest(body);
      if (!parsed.ok) return json({ ok: false, error: parsed.error, hint: parsed.hint }, { status: 400 });
      const result = await installPiExtension(parsed.request);
      if (!result.ok) return json({ ok: false, error: result.error, log: result.log }, { status: 400 });

      // A freshly installed extension is enabled by default, then loaded so its
      // tools and commands work without a restart.
      updatePluginsConfig(runtime, {
        piExtensions: {
          enabled: runtime.getSettings().plugins.piExtensions.enabled,
          entries: { ...currentEntries(), [result.id!]: { enabled: true, disabledBots: [] } }
        }
      });
      await host.reload();
      return json({ ok: true, id: result.id, extensions: host.listCatalog(runtime.getSettings()) });
    }

    case "uninstall": {
      if (!body.id) return json({ ok: false, error: "id is required" }, { status: 400 });
      const result = uninstallPiExtension(body.id);
      if (!result.ok) return json({ ok: false, error: result.error }, { status: 400 });

      const entries = { ...currentEntries() };
      delete entries[body.id];
      updatePluginsConfig(runtime, {
        piExtensions: { enabled: runtime.getSettings().plugins.piExtensions.enabled, entries }
      });
      await host.reload();
      return json({ ok: true, extensions: host.listCatalog(runtime.getSettings()) });
    }

    case "reload": {
      await host.reload();
      host.applyFlagValues(runtime.getSettings());
      return json({ ok: true, extensions: host.listCatalog(runtime.getSettings()) });
    }

    case "toggle": {
      if (!body.id) return json({ ok: false, error: "id is required" }, { status: 400 });
      const existing = currentEntries()[body.id];
      updatePluginsConfig(runtime, {
        piExtensions: {
          enabled: runtime.getSettings().plugins.piExtensions.enabled,
          entries: {
            ...currentEntries(),
            [body.id]: {
              enabled: Boolean(body.enabled),
              disabledBots: existing?.disabledBots ?? [],
              ...(existing?.flags ? { flags: existing.flags } : {})
            }
          }
        }
      });
      return json({ ok: true, extensions: host.listCatalog(runtime.getSettings()) });
    }

    case "setBots": {
      if (!body.id) return json({ ok: false, error: "id is required" }, { status: 400 });
      const existing = currentEntries()[body.id];
      updatePluginsConfig(runtime, {
        piExtensions: {
          enabled: runtime.getSettings().plugins.piExtensions.enabled,
          entries: {
            ...currentEntries(),
            [body.id]: {
              enabled: existing?.enabled ?? true,
              disabledBots: Array.isArray(body.disabledBots) ? body.disabledBots : [],
              ...(existing?.flags ? { flags: existing.flags } : {})
            }
          }
        }
      });
      return json({ ok: true, extensions: host.listCatalog(runtime.getSettings()) });
    }

    case "setMaster": {
      updatePluginsConfig(runtime, {
        piExtensions: { enabled: Boolean(body.enabled), entries: currentEntries() }
      });
      return json({
        ok: true,
        masterEnabled: Boolean(body.enabled),
        extensions: host.listCatalog(runtime.getSettings())
      });
    }

    default:
      return json({ ok: false, error: `Unknown action: ${String(body.action)}` }, { status: 400 });
  }
};
