import { execSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import type { ExternalSubagentProviderId, ProviderAvailability } from "./types.js";

const require = createRequire(import.meta.url);

export const TARGET_DEPENDENCIES = {
  codex: "@openai/codex@0.147.0",
  "claude-code": "@anthropic-ai/claude-agent-sdk@0.3.220"
};

/**
 * Finds an executable in system PATH using `which` on POSIX or `where` on Windows.
 */
export function findExecutableInPath(name: string): string | null {
  try {
    const cmd = process.platform === "win32" ? `where ${name}` : `which ${name}`;
    const output = execSync(cmd, { stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" }).trim();
    const firstLine = output.split(/\r?\n/)[0]?.trim();
    if (firstLine && existsSync(firstLine)) {
      return firstLine;
    }
  } catch {
    // Not found in PATH
  }
  return null;
}

/**
 * Resolves Codex binary or package info.
 */
export function resolveCodex(options?: {
  customPath?: string;
  runtimesDir?: string;
}): ProviderAvailability {
  // 1. Custom path
  if (options?.customPath) {
    const custom = resolve(options.customPath);
    if (existsSync(custom)) {
      // Check if it's a directory containing package.json
      const pkgPath = join(custom, "package.json");
      if (existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
          const binRel = pkg.bin?.codex || pkg.bin;
          if (binRel) {
            return {
              available: true,
              source: "custom",
              packagePath: custom,
              executablePath: resolve(custom, binRel),
              version: pkg.version
            };
          }
        } catch {
          // parse failed
        }
      }
      return {
        available: true,
        source: "custom",
        executablePath: custom
      };
    }
    return {
      available: false,
      source: "custom",
      error: `Custom Codex path does not exist: ${options.customPath}`
    };
  }

  // 2. Check local data dir runtimes (e.g. ~/.molibot/runtimes/external-subagent)
  if (options?.runtimesDir) {
    const candidatePkg = join(options.runtimesDir, "node_modules", "@openai", "codex", "package.json");
    if (existsSync(candidatePkg)) {
      try {
        const pkg = JSON.parse(readFileSync(candidatePkg, "utf8"));
        const binRel = pkg.bin?.codex || pkg.bin;
        return {
          available: true,
          source: "installed",
          packagePath: dirname(candidatePkg),
          executablePath: resolve(dirname(candidatePkg), binRel),
          version: pkg.version
        };
      } catch {
        // Continue
      }
    }
  }

  // 3. Check project node_modules
  try {
    const pkgPath = require.resolve("@openai/codex/package.json");
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      const binRel = pkg.bin?.codex || pkg.bin;
      return {
        available: true,
        source: "installed",
        packagePath: dirname(pkgPath),
        executablePath: resolve(dirname(pkgPath), binRel),
        version: pkg.version
      };
    }
  } catch {
    // Not installed in project
  }

  // 4. Check system PATH
  const systemCli = findExecutableInPath("codex");
  if (systemCli) {
    return {
      available: true,
      source: "system",
      executablePath: systemCli
    };
  }

  return {
    available: false,
    error: "Codex is not installed. Specify a custom path, install via settings, or install @openai/codex."
  };
}

/**
 * Resolves Claude Code SDK or CLI info.
 */
export function resolveClaudeCode(options?: {
  customPath?: string;
  runtimesDir?: string;
}): ProviderAvailability {
  // 1. Custom path
  if (options?.customPath) {
    const custom = resolve(options.customPath);
    if (existsSync(custom)) {
      const pkgPath = join(custom, "package.json");
      if (existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
          return {
            available: true,
            source: "custom",
            packagePath: custom,
            version: pkg.version
          };
        } catch {
          // parse failed
        }
      }
      return {
        available: true,
        source: "custom",
        executablePath: custom
      };
    }
    return {
      available: false,
      source: "custom",
      error: `Custom Claude Code path does not exist: ${options.customPath}`
    };
  }

  // 2. Check local data dir runtimes
  if (options?.runtimesDir) {
    const candidatePkg = join(options.runtimesDir, "node_modules", "@anthropic-ai", "claude-agent-sdk", "package.json");
    if (existsSync(candidatePkg)) {
      try {
        const pkg = JSON.parse(readFileSync(candidatePkg, "utf8"));
        return {
          available: true,
          source: "installed",
          packagePath: dirname(candidatePkg),
          version: pkg.version
        };
      } catch {
        // Continue
      }
    }
  }

  // 3. Check project node_modules
  try {
    const pkgPath = require.resolve("@anthropic-ai/claude-agent-sdk/package.json");
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      return {
        available: true,
        source: "installed",
        packagePath: dirname(pkgPath),
        version: pkg.version
      };
    }
  } catch {
    // Not installed in project
  }

  // 4. Check system PATH for claude CLI
  const systemCli = findExecutableInPath("claude");
  if (systemCli) {
    return {
      available: true,
      source: "system",
      executablePath: systemCli
    };
  }

  return {
    available: false,
    error: "Claude Code SDK is not installed. Specify a custom path, install via settings, or install @anthropic-ai/claude-agent-sdk."
  };
}

/**
 * Installs a provider runtime dependency into a dedicated directory using pnpm/npm.
 */
export async function installProviderRuntime(
  providerId: ExternalSubagentProviderId,
  targetDir: string,
  onProgress?: (message: string) => void
): Promise<{ success: boolean; error?: string }> {
  const spec = TARGET_DEPENDENCIES[providerId];
  if (!spec) {
    return { success: false, error: `Unknown provider ${providerId}` };
  }

  onProgress?.(`Installing ${spec} into ${targetDir}...`);

  return new Promise((resolveResult) => {
    // Determine package manager: try pnpm, fallback to npm
    let packageManager = "pnpm";
    try {
      execSync("pnpm --version", { stdio: "ignore" });
    } catch {
      packageManager = "npm";
    }

    const args = packageManager === "pnpm"
      ? ["add", "--dir", targetDir, spec]
      : ["install", "--prefix", targetDir, spec];

    const child = spawn(packageManager, args, {
      cwd: targetDir,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env
    });

    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      onProgress?.(chunk.toString("utf8"));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      onProgress?.(chunk.toString("utf8"));
    });

    child.on("close", (code) => {
      if (code === 0) {
        onProgress?.(`Successfully installed ${spec}`);
        resolveResult({ success: true });
      } else {
        resolveResult({
          success: false,
          error: `Installation failed with exit code ${code}: ${stderr}`
        });
      }
    });

    child.on("error", (err) => {
      resolveResult({
        success: false,
        error: `Failed to spawn ${packageManager}: ${err.message}`
      });
    });
  });
}
