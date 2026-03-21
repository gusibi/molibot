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

export const claudeCodeAcpProvider: AcpProviderProfile = {
  id: "claude-code",
  label: "Claude Code",
  commandNamespace: "claude-code",
  defaultTargetId: "claude-code",
  defaultTargetName: "Claude Code ACP",
  defaultCommand: "npx",
  defaultArgs: ["-y", "@zed-industries/claude-code-acp"],
  defaultEnvPlaceholder: "ANTHROPIC_API_KEY=...",
  matchesTarget: ({ id, name, command, args }) => {
    const text = [id, name, command, ...args].join(" ").toLowerCase();
    return text.includes("claude-code-acp") || text.includes("claude-agent-acp") || text.includes("claude code");
  },
  hasAuthAvailable: (target) => Boolean(mergedEnv(target).ANTHROPIC_API_KEY?.trim()),
  buildAuthHint: () =>
    "Auth hint: no ANTHROPIC_API_KEY was found for the Claude Code ACP target. If your adapter relies on local Claude Code login instead, pre-authenticate it in the host terminal first, because Telegram ACP cannot complete interactive `claude` login flows."
};
