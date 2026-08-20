import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { resolveCodex, resolveClaudeCode, installProviderRuntime } from "#external-subagent";
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
  let body: { provider?: "codex" | "claude-code" };
  try {
    body = (await request.json()) as { provider?: "codex" | "claude-code" };
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const provider = body.provider;
  if (provider !== "codex" && provider !== "claude-code") {
    return json({ ok: false, error: "Invalid provider. Must be 'codex' or 'claude-code'" }, { status: 400 });
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
