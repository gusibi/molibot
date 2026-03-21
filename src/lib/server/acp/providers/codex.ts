import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AcpTargetConfig } from "../../settings/schema.js";
import type { AcpProviderProfile } from "./types.js";

function mergedEnv(target: AcpTargetConfig): Record<string, string> {
  return {
    ...Object.fromEntries(
      Object.entries(process.env).map(([key, value]) => [key, String(value ?? "")])
    ),
    ...(target.env ?? {})
  };
}

function hasCodexAuthEnv(target: AcpTargetConfig): boolean {
  const env = mergedEnv(target);
  return Boolean(env.OPENAI_API_KEY?.trim() || env.CODEX_API_KEY?.trim());
}

function hasCodexAuthFile(target: AcpTargetConfig): boolean {
  const env = mergedEnv(target);
  const codexHome = String(env.CODEX_HOME ?? "").trim();
  const home = String(env.HOME ?? process.env.HOME ?? "").trim();
  const authPath = codexHome
    ? join(codexHome, "auth.json")
    : home
      ? join(home, ".codex", "auth.json")
      : "";
  if (!authPath || !existsSync(authPath)) return false;

  try {
    const parsed = JSON.parse(readFileSync(authPath, "utf8")) as {
      tokens?: { access_token?: unknown; refresh_token?: unknown; id_token?: unknown };
    };
    return Boolean(
      String(parsed.tokens?.access_token ?? "").trim() ||
      String(parsed.tokens?.refresh_token ?? "").trim() ||
      String(parsed.tokens?.id_token ?? "").trim()
    );
  } catch {
    return false;
  }
}

export const codexAcpProvider: AcpProviderProfile = {
  id: "codex",
  label: "Codex",
  commandNamespace: "codex",
  defaultTargetId: "codex",
  defaultTargetName: "Codex ACP",
  defaultCommand: "npx",
  defaultArgs: ["-y", "@zed-industries/codex-acp"],
  defaultEnvPlaceholder: "OPENAI_API_KEY=...",
  matchesTarget: ({ id, name, command, args }) => {
    const text = [id, name, command, ...args].join(" ").toLowerCase();
    return text.includes("codex-acp") || text.includes("openai-codex") || text.includes("codex");
  },
  hasAuthAvailable: (target) => hasCodexAuthEnv(target) || hasCodexAuthFile(target),
  buildAuthHint: () =>
    "Auth hint: no Codex auth was found in ACP target env or the local Codex auth file. Telegram ACP cannot perform interactive `codex login`, so provide OPENAI_API_KEY / CODEX_API_KEY or make sure the target process can read ~/.codex/auth.json (or $CODEX_HOME/auth.json)."
};
