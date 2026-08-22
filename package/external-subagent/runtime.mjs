import { resolveCodex, resolveClaudeCode, installProviderRuntime } from "./src/resolver.ts";
import { ExternalSubagentRuntime } from "./src/runtime.ts";

/**
 * Settings runtime actions for External Subagent plugin (issue #34).
 * Executed in the isolated worker process fault domain.
 */

export async function detectEnvironment(input, ctx) {
  const provider = input?.provider;
  const customPath = input?.customPath || (provider === "codex" ? ctx.config.codexPath : ctx.config.claudeCodePath);
  const runtimesDir = ctx.dataDir;

  if (provider === "codex") {
    return resolveCodex({ customPath, runtimesDir });
  } else if (provider === "claude-code") {
    return resolveClaudeCode({ customPath, runtimesDir });
  } else {
    // Return both
    return {
      codex: resolveCodex({ customPath: ctx.config.codexPath, runtimesDir }),
      claudeCode: resolveClaudeCode({ customPath: ctx.config.claudeCodePath, runtimesDir })
    };
  }
}

export async function installProvider(input, ctx) {
  const provider = input?.provider;
  if (provider !== "codex" && provider !== "claude-code") {
    throw new Error(`Unknown provider: ${provider}`);
  }

  const targetDir = ctx.dataDir;
  return installProviderRuntime(provider, targetDir, (msg) => {
    ctx.emitProgress({ message: msg });
  });
}

export async function testProvider(input, ctx) {
  const provider = input?.provider;
  if (provider !== "codex" && provider !== "claude-code") {
    throw new Error(`Unknown provider: ${provider}`);
  }

  const customPath = input?.customPath || (provider === "codex" ? ctx.config.codexPath : ctx.config.claudeCodePath);
  const runtime = new ExternalSubagentRuntime({
    customPaths: {
      codex: provider === "codex" ? customPath : undefined,
      "claude-code": provider === "claude-code" ? customPath : undefined
    },
    runtimesDir: ctx.dataDir
  });

  const testTask = "echo hello from external subagent test";
  const result = await runtime.run(provider, { task: testTask, timeoutMs: 30000 });

  return {
    success: result.stopReason === "completed",
    output: result.output,
    error: result.diagnostic
  };
}
