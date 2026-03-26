import { mkdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { config } from "../../app/env.js";
import { execCommand, normalizeCommandOutput, stripAnsi } from "./helpers.js";
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

      const result = await execCommand(params.command, {
        cwd,
        timeoutSeconds: params.timeout,
        signal
      });

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
