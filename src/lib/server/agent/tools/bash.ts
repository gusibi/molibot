import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { config } from "../../app/env.js";
import { execCommand, normalizeCommandOutput, shellEscape, stripAnsi } from "./helpers.js";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateMiddle, type TruncationResult } from "./truncate.js";

const bashSchema = Type.Object({
  label: Type.String(),
  command: Type.String(),
  timeout: Type.Optional(Type.Number())
});

interface BashToolDetails {
  truncation?: TruncationResult;
  fullOutputPath?: string;
}

const PYTHON_SANDBOX_ROOT = join(config.dataDir, "tooling", "python");
const PYTHON_VENV_DIR = join(PYTHON_SANDBOX_ROOT, "venv");
const PYTHON_UV_CACHE_DIR = join(PYTHON_SANDBOX_ROOT, "uv-cache");
const PYTHON_PIP_CACHE_DIR = join(PYTHON_SANDBOX_ROOT, "pip-cache");
const PYTHON_TMP_DIR = join(PYTHON_SANDBOX_ROOT, "tmp");

function resolveVenvBinDir(venvDir: string): string {
  return process.platform === "win32" ? join(venvDir, "Scripts") : join(venvDir, "bin");
}

function resolveVenvPythonPath(venvDir: string): string {
  return process.platform === "win32" ? join(resolveVenvBinDir(venvDir), "python.exe") : join(resolveVenvBinDir(venvDir), "python");
}

function resolveVenvActivatePath(venvDir: string): string {
  return process.platform === "win32" ? join(resolveVenvBinDir(venvDir), "activate") : join(resolveVenvBinDir(venvDir), "activate");
}

function probeCommand(command: string): boolean {
  const result = spawnSync(command, ["--version"], { stdio: "ignore" });
  return result.status === 0;
}

function pickPythonLauncher(): string {
  const candidates = [process.env.MOLIBOT_PYTHON_BIN?.trim(), "python3", "python"].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    if (probeCommand(candidate)) return candidate;
  }
  throw new Error(
    "No Python runtime found for bash tool sandbox. Install python3 (with venv support) or set MOLIBOT_PYTHON_BIN."
  );
}

function ensurePythonVirtualEnv(): void {
  const pythonPath = resolveVenvPythonPath(PYTHON_VENV_DIR);
  if (!existsSync(pythonPath)) {
    mkdirSync(PYTHON_SANDBOX_ROOT, { recursive: true });

    const launcher = pickPythonLauncher();
    try {
      execFileSync(launcher, ["-m", "venv", PYTHON_VENV_DIR], { stdio: "pipe" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to initialize Python sandbox virtualenv at ${PYTHON_VENV_DIR}. ${message}`
      );
    }
  }

  try {
    execFileSync(pythonPath, ["-m", "pip", "--version"], { stdio: "pipe" });
  } catch {
    try {
      execFileSync(pythonPath, ["-m", "ensurepip", "--upgrade"], { stdio: "pipe" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Python sandbox at ${PYTHON_VENV_DIR} is missing pip and ensurepip failed. ${message}`
      );
    }
  }
}

function buildPythonSandboxEnv(): NodeJS.ProcessEnv {
  ensurePythonVirtualEnv();
  mkdirSync(PYTHON_UV_CACHE_DIR, { recursive: true });
  mkdirSync(PYTHON_PIP_CACHE_DIR, { recursive: true });
  mkdirSync(PYTHON_TMP_DIR, { recursive: true });

  const venvBinDir = resolveVenvBinDir(PYTHON_VENV_DIR);
  const venvPythonPath = resolveVenvPythonPath(PYTHON_VENV_DIR);
  const currentPath = process.env.PATH ?? "";
  const mergedPath = currentPath ? `${venvBinDir}${delimiter}${currentPath}` : venvBinDir;

  return {
    PATH: mergedPath,
    VIRTUAL_ENV: PYTHON_VENV_DIR,
    UV_PROJECT_ENVIRONMENT: PYTHON_VENV_DIR,
    UV_CACHE_DIR: PYTHON_UV_CACHE_DIR,
    UV_PYTHON: venvPythonPath,
    PIP_CACHE_DIR: PYTHON_PIP_CACHE_DIR,
    PIP_REQUIRE_VIRTUALENV: "false",
    PIP_DISABLE_PIP_VERSION_CHECK: "1",
    PIP_ROOT_USER_ACTION: "ignore",
    TMPDIR: PYTHON_TMP_DIR,
    PYTHONNOUSERSITE: "1"
  };
}

function sanitizePythonCommand(command: string): string {
  return command.replace(/\s--break-system-packages(?=\s|$)/g, "");
}

function wrapCommandWithPythonSandbox(command: string): string {
  const venvPythonPath = resolveVenvPythonPath(PYTHON_VENV_DIR);
  const venvActivatePath = resolveVenvActivatePath(PYTHON_VENV_DIR);
  const sanitized = sanitizePythonCommand(command);
  return [
    `VENV_PYTHON=${shellEscape(venvPythonPath)}`,
    `. ${shellEscape(venvActivatePath)} >/dev/null 2>&1 || true`,
    "python() { \"$VENV_PYTHON\" \"$@\"; }",
    "python3() { \"$VENV_PYTHON\" \"$@\"; }",
    "pip() { \"$VENV_PYTHON\" -m pip \"$@\"; }",
    "pip3() { \"$VENV_PYTHON\" -m pip \"$@\"; }",
    sanitized
  ].join("\n");
}

function isDeferredWaitCommand(command: string): boolean {
  const normalized = command.toLowerCase();
  return (
    /\bsleep\b/.test(normalized) ||
    /\btimeout\b/.test(normalized) ||
    /\bwait\b/.test(normalized) ||
    /\bping\s+-c\b/.test(normalized)
  );
}

function touchesExternalScheduler(command: string): boolean {
  const normalized = command.toLowerCase();
  return (
    /\bcrontab\b/.test(normalized) ||
    /\bat\b/.test(normalized) ||
    /\batq\b/.test(normalized) ||
    /\batrm\b/.test(normalized) ||
    /\blaunchctl\b/.test(normalized) ||
    /\bschtasks\b/.test(normalized)
  );
}

function touchesMemoryFiles(command: string): boolean {
  const normalized = command.toLowerCase();
  if (normalized.includes("/api/memory")) return false;
  return /memory\.md|\/memory\//i.test(command);
}

function touchesSettingsFile(command: string): boolean {
  const normalized = command.toLowerCase();
  const fullSettingsPath = config.settingsFile.replace(/\\/g, "/").toLowerCase();
  return (
    normalized.includes(fullSettingsPath) ||
    normalized.includes("~/.molibot/settings.json") ||
    normalized.includes("/.molibot/settings.json")
  );
}

function buildTempOutputPath(cwd: string): string {
  const dir = join(cwd, ".mom-tool-output");
  mkdirSync(dir, { recursive: true });
  return join(dir, `bash-${Date.now()}-${randomBytes(4).toString("hex")}.log`);
}

function stripShellQuotes(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function decodeDoubleQuotedShellText(value: string): string {
  const unquoted = stripShellQuotes(value);
  return unquoted
    .replace(/\\n/g, "\n")
    .replace(/\\"/g, "\"")
    .replace(/\\\\/g, "\\");
}

function inferCommandWorkingDir(command: string, fallbackCwd: string): string {
  const match = command.match(/(?:^|\s)cd\s+("[^"]+"|'[^']+'|[^\s&;|]+)\s*(?:&&|;|\|\|)/);
  if (!match) return fallbackCwd;
  const rawDir = stripShellQuotes(match[1] ?? "");
  return isAbsolute(rawDir) ? rawDir : resolve(fallbackCwd, rawDir);
}

function captureSayTranscript(command: string, fallbackCwd: string): void {
  const sayMatch = command.match(/\bsay\b[\s\S]*?\s-o\s+("[^"]+"|'[^']+'|[^\s]+)\s+("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/);
  if (!sayMatch) return;

  const baseDir = inferCommandWorkingDir(command, fallbackCwd);
  const rawOutputPath = stripShellQuotes(sayMatch[1] ?? "");
  const transcript = decodeDoubleQuotedShellText(sayMatch[2] ?? "");
  if (!rawOutputPath || !transcript.trim()) return;

  const outputPath = isAbsolute(rawOutputPath) ? rawOutputPath : resolve(baseDir, rawOutputPath);
  writeFileSync(`${outputPath}.transcript.txt`, `${transcript.trim()}\n`, "utf8");
}

export function createBashTool(cwd: string): AgentTool<typeof bashSchema> {
  return {
    name: "bash",
    label: "bash",
    description:
      `Execute a bash command in scratch workspace. Long output is compressed to preserve both the beginning and the end within ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}.`,
    parameters: bashSchema,
    execute: async (_toolCallId, params, signal) => {
      if (isDeferredWaitCommand(params.command)) {
        throw new Error(
          "Waiting/sleep commands are not allowed. For delayed reminders, create a one-shot event file under a watched events directory."
        );
      }
      if (touchesExternalScheduler(params.command)) {
        throw new Error(
          "External schedulers (crontab/at/launchctl/schtasks) are not allowed. Use watched event JSON files for all reminders and recurring tasks."
        );
      }
      if (touchesMemoryFiles(params.command)) {
        throw new Error(
          "Direct memory file operations are blocked. Use the memory tool (or /api/memory gateway) for all memory reads/writes/updates."
        );
      }
      if (touchesSettingsFile(params.command)) {
        throw new Error(
          "Direct runtime settings-file operations are blocked. Use the switch_model tool or a settings API/runtime update path instead of editing settings.json."
        );
      }

      const sandboxEnv = buildPythonSandboxEnv();
      const wrappedCommand = wrapCommandWithPythonSandbox(params.command);

      const result = await execCommand(wrappedCommand, {
        cwd,
        timeoutSeconds: params.timeout,
        signal,
        env: sandboxEnv
      });

      try {
        captureSayTranscript(params.command, cwd);
      } catch {
        // Ignore transcript sidecar capture failures; command output remains authoritative.
      }

      let output = "";
      if (result.stdout) output += result.stdout;
      if (result.stderr) output += `${output ? "\n" : ""}${result.stderr}`;
      output = normalizeCommandOutput(stripAnsi(output));

      const truncation = truncateMiddle(output);
      let rendered = truncation.content || "(no output)";
      let details: BashToolDetails | undefined;

      if (truncation.truncated) {
        const fullOutputPath = buildTempOutputPath(cwd);
        writeFileSync(fullOutputPath, output, "utf8");
        rendered += `\n\n[Output compressed from ${truncation.totalLines} lines / ${formatSize(truncation.totalBytes)}. Full output: ${fullOutputPath}]`;
        details = { truncation, fullOutputPath };
      }

      if (result.code !== 0) {
        throw new Error(`${rendered}\n\nCommand exited with code ${result.code}`.trim());
      }

      return {
        content: [{ type: "text", text: rendered }],
        details
      };
    }
  };
}
