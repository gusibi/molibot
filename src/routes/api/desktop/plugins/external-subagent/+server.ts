import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { resolveCodex, resolveClaudeCode, installProviderRuntime } from "#external-subagent";
import { runExternalSubagentProbe } from "$lib/server/plugins/externalSubagent/probe.js";
import { getRuntime } from "$lib/server/app/runtime.js";
import { storagePaths } from "$lib/server/infra/db/storage.js";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

export const GET: RequestHandler = async ({ url }) => {
  const runtime = getRuntime();
  const settings = runtime.getSettings();
  const pluginSettings = settings.plugins.externalSubagent;

  const runtimesDir = join(storagePaths.dataDir, "runtimes", "external-subagent");
  const customCodexPath = url.searchParams.get("codexPath") || pluginSettings?.codexPath || "";
  const customClaudePath = url.searchParams.get("claudeCodePath") || pluginSettings?.claudeCodePath || "";

  const codex = resolveCodex({
    customPath: customCodexPath,
    runtimesDir
  });

  const claudeCode = resolveClaudeCode({
    customPath: customClaudePath,
    runtimesDir
  });

  return json({
    ok: true,
    runtimesDir,
    codex,
    claudeCode
  });
};

export const POST: RequestHandler = async ({ request }) => {
  let body: {
    provider?: "codex" | "claude-code";
    action?: "install" | "test";
    codexPath?: string;
    claudeCodePath?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const provider = body.provider;
  if (provider !== "codex" && provider !== "claude-code") {
    return json({ ok: false, error: "Invalid provider. Must be 'codex' or 'claude-code'" }, { status: 400 });
  }

  // One real minimal turn through the shared runtime: only a completed turn
  // counts as available, so a failed probe must read as unavailable even when
  // path detection is green.
  if (body.action === "test") {
    const settings = getRuntime().getSettings();
    const pluginSettings = settings.plugins.externalSubagent;
    const customPath =
      (provider === "codex" ? body.codexPath : body.claudeCodePath) ||
      (provider === "codex" ? pluginSettings?.codexPath : pluginSettings?.claudeCodePath) ||
      undefined;
    const permissionMode =
      provider === "codex" ? pluginSettings?.codexPermissionMode : pluginSettings?.claudeCodePermissionMode;

    const result = await runExternalSubagentProbe(provider, { customPath, permissionMode });
    return json({
      ok: result.ok,
      provider,
      stopReason: result.stopReason,
      output: result.output,
      diagnostic: result.diagnostic,
      durationMs: result.durationMs
    });
  }

  const runtimesDir = join(storagePaths.dataDir, "runtimes", "external-subagent");
  try {
    mkdirSync(runtimesDir, { recursive: true });
  } catch {
    // ignore
  }

  const result = await installProviderRuntime(provider, runtimesDir);
  return json({
    ok: result.success,
    error: result.error,
    runtimesDir
  });
};
