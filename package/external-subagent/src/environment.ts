import type { ExternalSubagentProviderId } from "./types.js";

/** Regex pattern matching credential-shaped environment variables. */
export const SENSITIVE_ENV_PATTERN = /KEY|PASSWORD|SECRET|TOKEN/i;

/** Known internal prefixes that must never leak to external child agents. */
export const INTERNAL_ENV_PREFIXES = ["MOLIBOT_", "MOM_", "DSH_"];

/** Explicit allowed authentication variables per provider. */
export const PROVIDER_AUTH_ALLOWLIST: Record<ExternalSubagentProviderId, readonly string[]> = {
  codex: ["OPENAI_API_KEY", "CODEX_API_KEY", "OPENAI_BASE_URL"],
  "claude-code": ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL"]
};

/**
 * Returns a base scrubbed environment derived from process.env, with all
 * credential-shaped and internal variables removed.
 */
export function getScrubbedBaseEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    const isSensitive = SENSITIVE_ENV_PATTERN.test(key);
    const isInternal = INTERNAL_ENV_PREFIXES.some((prefix) => key.toUpperCase().startsWith(prefix));
    if (!isSensitive && !isInternal) {
      env[key] = value;
    }
  }
  return env;
}

/**
 * Builds the isolated execution environment for a specific external subagent provider.
 * Starts from the scrubbed base environment, adds only the provider's allowed auth
 * variables (if present in ambient environment), and overlays any caller-specified extra env.
 */
export function buildProviderEnv(
  providerId: ExternalSubagentProviderId,
  extraEnv?: Record<string, string | undefined>
): NodeJS.ProcessEnv {
  const base = getScrubbedBaseEnv();
  const allowedAuth = PROVIDER_AUTH_ALLOWLIST[providerId] ?? [];

  // Re-inject allowed auth variables from process.env if present
  for (const authKey of allowedAuth) {
    if (process.env[authKey] !== undefined) {
      base[authKey] = process.env[authKey]!;
    }
  }

  // Overlay explicit extra env
  if (extraEnv) {
    for (const [key, value] of Object.entries(extraEnv)) {
      if (value === undefined) {
        delete base[key];
      } else {
        base[key] = value;
      }
    }
  }

  if (process.platform === "win32") {
    // Normalize case on Windows
    const normalized: Record<string, string> = {};
    for (const [k, v] of Object.entries(base)) {
      normalized[k.toUpperCase()] = v;
    }
    return normalized;
  }

  return base;
}
